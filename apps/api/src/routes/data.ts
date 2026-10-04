import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, gte, ilike, inArray, isNull, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import {
  BIOMARKERS, CATEGORY_LABELS, computeChange, getBiomarker, isoDate, manualResultSchema, normalizeAliasKey,
  reportUpdateSchema, resultEditSchema, toDisplayUnit,
  type BiomarkerDetail, type BiomarkerSummary, type CompareRow, type DashboardResponse, type ReportDetail, type ReportResultRow,
} from '@vitalog/shared';
import { db } from '../db/client';
import {
  documents, favorites, laboratories, labReports, labResults, notes, processingJobs, profiles, resultEdits,
  specialists, timelineEvents,
} from '../db/schema';
import { requireUser } from '../lib/auth';
import { audit } from '../lib/audit';
import { likeEscape, notFound, UUID_RE } from '../lib/http';
import {
  biomarkerSeries, biomarkerSummaries, buildSummary, deriveResultFields, previousValues, rangeOf, reportSummaries,
  resultKey, toLabResult, toSeriesPoint,
} from '../services/results';
import { toDocument, toJob, toNote, toSpecialist, toTimelineEvent } from '../services/mappers';

const listQuery = z.object({
  search: z.string().max(100).optional(),
  category: z.string().max(40).optional(),
  status: z.enum(['all', 'in_range', 'above', 'below', 'unknown', 'out_of_range']).default('all'),
  sort: z.enum(['newest', 'oldest', 'name', 'latest_value', 'most_measured']).default('newest'),
  favorites: z.coerce.boolean().optional(),
});

const BIOMARKER_KEY = /^(custom:[\p{L}\p{N}µ%/]+|[a-z0-9_]+)$/u;
const keyParam = z.object({ key: z.string().max(100).regex(BIOMARKER_KEY) });
const idParam = z.object({ id: z.string().regex(UUID_RE) });

export const dataRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  // ── Dashboard ────────────────────────────────────────────────
  app.get('/dashboard', async (req): Promise<DashboardResponse> => {
    const uid = req.user!.id;
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, uid));
    const summaries = await biomarkerSummaries(uid);
    const yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
    const [counts] = await db.execute<{ reports: number; results: number; last: string | null; last12: number }>(sql`
      select (select count(*)::int from lab_reports where user_id = ${uid}) as reports,
             (select count(*)::int from lab_results where user_id = ${uid}) as results,
             (select max(collected_at)::text from lab_reports where user_id = ${uid}) as last,
             (select count(*)::int from lab_reports where user_id = ${uid} and collected_at >= ${yearAgo}) as last12`);
    const pending = await db.select().from(processingJobs)
      .where(and(eq(processingJobs.userId, uid), notInArray(processingJobs.stage, ['completed'])))
      .orderBy(desc(processingJobs.createdAt)).limit(5);
    const recentReports = await reportSummaries(uid, undefined, 4);
    const recentDocs = await db.select().from(documents).where(eq(documents.userId, uid)).orderBy(desc(documents.uploadedAt)).limit(4);
    const specs = await db.select().from(specialists).where(eq(specialists.userId, uid)).orderBy(desc(specialists.updatedAt)).limit(4);

    const byRecency = [...summaries].sort((a, b) => (b.latest?.date ?? '').localeCompare(a.latest?.date ?? '') || b.count - a.count);
    const favs = summaries.filter((s) => s.favorite);
    const overview = [...favs, ...[...summaries].sort((a, b) => b.count - a.count).filter((s) => !s.favorite)].slice(0, 6);
    const outOfRange = byRecency.filter((s) => s.latest && (s.latest.status === 'above' || s.latest.status === 'below'));
    const changed = summaries
      .filter((s) => s.change && s.change.direction !== 'stable')
      .sort((a, b) => Math.abs(b.change!.percent ?? 0) - Math.abs(a.change!.percent ?? 0))
      .slice(0, 6);
    const catMap = new Map<string, { total: number; outOfRange: number }>();
    for (const s of summaries) {
      const c = catMap.get(s.category) ?? { total: 0, outOfRange: 0 };
      c.total++;
      if (s.latest?.status === 'above' || s.latest?.status === 'below') c.outOfRange++;
      catMap.set(s.category, c);
    }

    const facts: string[] = [];
    if (counts!.reports > 0) {
      facts.push(`През последните 12 месеца имаш ${counts!.last12} ${counts!.last12 === 1 ? 'лабораторно изследване' : 'лабораторни изследвания'} и ${summaries.length} проследявани показателя.`);
      const most = [...summaries].sort((a, b) => b.count - a.count)[0];
      if (most && most.count > 1) {
        facts.push(`Показателят „${most.name}“ е измерван ${most.count} пъти.`);
        if (most.latest) facts.push(`Последната стойност на ${most.name} е ${most.latest.valueText}${most.latest.unit ? ` ${most.latest.unit}` : ''}.`);
      }
    }
    return {
      displayName: profile?.displayName ?? '',
      stats: { reports: counts!.reports, results: counts!.results, biomarkers: summaries.length, lastReportAt: counts!.last, reportsLast12m: counts!.last12 },
      pendingReviews: pending.map(toJob),
      latestReport: recentReports[0] ?? null,
      latestDocument: recentDocs[0] ? toDocument(recentDocs[0]) : null,
      overview,
      outOfRange: outOfRange.slice(0, 6),
      changed,
      favorites: favs,
      recentReports,
      recentDocuments: recentDocs.map(toDocument),
      specialists: specs.map(toSpecialist),
      categories: [...catMap.entries()].map(([category, v]) => ({ category: category as BiomarkerSummary['category'], ...v })),
      summaryFacts: facts,
    };
  });

  // ── Biomarkers ───────────────────────────────────────────────
  app.get('/biomarkers', async (req) => {
    const q = listQuery.parse(req.query);
    let list = await biomarkerSummaries(req.user!.id);
    if (q.search) {
      const needle = q.search.toLowerCase();
      const key = normalizeAliasKey(q.search);
      list = list.filter((s) => {
        const bm = getBiomarker(s.id);
        const names = [s.name, ...(bm ? [bm.canonicalName, ...bm.aliases] : [])];
        return names.some((n) => n.toLowerCase().includes(needle) || normalizeAliasKey(n).includes(key));
      });
    }
    if (q.category) list = list.filter((s) => s.category === q.category);
    if (q.status === 'out_of_range') list = list.filter((s) => s.latest?.status === 'above' || s.latest?.status === 'below');
    else if (q.status !== 'all') list = list.filter((s) => s.latest?.status === q.status);
    if (q.favorites) list = list.filter((s) => s.favorite);
    const sorters: Record<typeof q.sort, (a: BiomarkerSummary, b: BiomarkerSummary) => number> = {
      newest: (a, b) => (b.latest?.date ?? '').localeCompare(a.latest?.date ?? ''),
      oldest: (a, b) => (a.latest?.date ?? '').localeCompare(b.latest?.date ?? ''),
      name: (a, b) => a.name.localeCompare(b.name, 'bg'),
      latest_value: (a, b) => (b.latest?.displayValue ?? -Infinity) - (a.latest?.displayValue ?? -Infinity),
      most_measured: (a, b) => b.count - a.count,
    };
    return list.sort((a, b) => sorters[q.sort](a, b) || a.name.localeCompare(b.name, 'bg'));
  });

  app.get('/biomarkers/:key', async (req): Promise<BiomarkerDetail> => {
    const { key } = keyParam.parse(req.params);
    const { from, to } = z.object({ from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    const uid = req.user!.id;
    const all = await biomarkerSeries(uid, key);
    if (!all.length) throw notFound('Показателят');
    const fav = await db.select().from(favorites).where(and(eq(favorites.userId, uid), eq(favorites.biomarkerKey, key)));
    const desc_ = [...all].reverse();
    const summary = buildSummary(key, desc_, all.length, fav.length > 0);
    const series = (from || to ? all.filter((r) => (!from || r.collectedAt >= from) && (!to || r.collectedAt <= to)) : all);
    const events = await db.select().from(timelineEvents).where(and(eq(timelineEvents.userId, uid), eq(timelineEvents.showOnCharts, true))).orderBy(timelineEvents.date);
    const n = await db.select().from(notes).where(and(eq(notes.userId, uid), eq(notes.targetType, 'biomarker'), eq(notes.targetId, key))).orderBy(desc(notes.createdAt));
    return {
      summary,
      biomarker: getBiomarker(key) ?? null,
      series: series.map(toSeriesPoint),
      events: events.map(toTimelineEvent),
      notes: n.map(toNote),
    };
  });

  app.put('/biomarkers/:key/favorite', async (req) => {
    const { key } = keyParam.parse(req.params);
    await db.insert(favorites).values({ userId: req.user!.id, biomarkerKey: key }).onConflictDoNothing();
    return { favorite: true };
  });
  app.delete('/biomarkers/:key/favorite', async (req) => {
    const { key } = keyParam.parse(req.params);
    await db.delete(favorites).where(and(eq(favorites.userId, req.user!.id), eq(favorites.biomarkerKey, key)));
    return { favorite: false };
  });

  /** Catalog for pickers (manual entry, review screen). */
  app.get('/catalog', async () => BIOMARKERS.map((b) => ({ id: b.id, name: b.bgName, canonicalName: b.canonicalName, unit: b.unit, supportedUnits: b.supportedUnits, category: b.category, categoryLabel: CATEGORY_LABELS[b.category] })));

  // ── Reports ──────────────────────────────────────────────────
  app.get('/reports', async (req) => {
    const q = z.object({
      search: z.string().max(100).optional(),
      laboratoryId: z.string().regex(UUID_RE).optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
      sort: z.enum(['newest', 'oldest']).default('newest'),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }).parse(req.query);
    const uid = req.user!.id;
    const conds = [];
    if (q.laboratoryId) conds.push(eq(labReports.laboratoryId, q.laboratoryId));
    if (q.from) conds.push(gte(labReports.collectedAt, q.from));
    if (q.to) conds.push(lte(labReports.collectedAt, q.to));
    if (q.search) {
      const like = `%${likeEscape(q.search)}%`;
      conds.push(or(ilike(labReports.title, like), sql`exists (select 1 from laboratories l where l.id = ${labReports.laboratoryId} and l.name ilike ${like})`)!);
    }
    const where = conds.length ? and(...conds) : undefined;
    const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(labReports).where(where ? and(eq(labReports.userId, uid), where) : eq(labReports.userId, uid))) as [{ total: number }];
    const items = await reportSummaries(uid, where, q.pageSize, (q.page - 1) * q.pageSize, q.sort);
    const labs = await db.select({ id: laboratories.id, name: laboratories.name }).from(laboratories).where(eq(laboratories.userId, uid)).orderBy(laboratories.name);
    return { items, total, page: q.page, pageSize: q.pageSize, laboratories: labs };
  });

  app.get('/reports/compare', async (req): Promise<{ a: unknown; b: unknown; rows: CompareRow[] }> => {
    const { a, b } = z.object({ a: z.string().regex(UUID_RE), b: z.string().regex(UUID_RE) }).parse(req.query);
    const uid = req.user!.id;
    const reps = await reportSummaries(uid, inArray(labReports.id, [a, b]), 2);
    const ra = reps.find((r) => r.id === a);
    const rb = reps.find((r) => r.id === b);
    if (!ra || !rb) throw notFound('Изследването');
    const results = await db.select().from(labResults).where(and(eq(labResults.userId, uid), inArray(labResults.reportId, [a, b])));
    const keys = [...new Set(results.map(resultKey))];
    const rows: CompareRow[] = keys.map((k) => {
      const x = results.find((r) => r.reportId === a && resultKey(r) === k);
      const y = results.find((r) => r.reportId === b && resultKey(r) === k);
      const bm = getBiomarker(k);
      const conv = (r: typeof x) => (r && r.valueComparator === null ? (bm ? toDisplayUnit(bm, r.valueNumeric, r.unit)?.value ?? null : r.valueNumeric) : null);
      const cx = conv(x);
      const cy = conv(y);
      const comparable = cx !== null && cy !== null && (!!bm || x!.unit === y!.unit);
      const cell = (r: typeof x) => (r ? { valueText: r.valueText, value: r.valueNumeric, unit: r.unit, status: r.status } : null);
      return { biomarkerId: k, name: bm?.bgName ?? (x ?? y)!.originalName, a: cell(x), b: cell(y), change: comparable ? computeChange(cy!, cx!) : null, comparable };
    });
    rows.sort((p, q2) => Number(!!q2.a && !!q2.b) - Number(!!p.a && !!p.b) || p.name.localeCompare(q2.name, 'bg'));
    return { a: ra, b: rb, rows };
  });

  app.get('/reports/:id', async (req): Promise<ReportDetail> => {
    const { id } = idParam.parse(req.params);
    const uid = req.user!.id;
    const [report] = await reportSummaries(uid, eq(labReports.id, id), 1);
    if (!report) throw notFound('Изследването');
    const results = await db.select().from(labResults).where(and(eq(labResults.userId, uid), eq(labResults.reportId, id))).orderBy(labResults.createdAt);
    const prev = await previousValues(uid, [...new Set(results.map(resultKey))], report.collectedAt);
    const rows: ReportResultRow[] = results.map((r) => {
      const p = prev.get(resultKey(r));
      const bm = getBiomarker(r.biomarkerId);
      const cur = bm ? toDisplayUnit(bm, r.valueNumeric, r.unit)?.value : r.valueNumeric;
      const old = p ? (bm ? toDisplayUnit(bm, p.valueNumeric, p.unit)?.value : p.unit === r.unit ? p.valueNumeric : null) : null;
      const change = cur != null && old != null && r.valueComparator === null && p!.valueComparator === null ? computeChange(cur, old) : null;
      return {
        ...toLabResult(r),
        biomarkerName: bm?.bgName ?? r.originalName,
        previous: p ? { date: p.collectedAt, valueText: p.valueText, value: p.valueNumeric, unit: p.unit } : null,
        change,
      };
    });
    const [doc] = report.documentId ? await db.select().from(documents).where(and(eq(documents.id, report.documentId), eq(documents.userId, uid))) : [];
    const [spec] = report.specialistId ? await db.select().from(specialists).where(and(eq(specialists.id, report.specialistId), eq(specialists.userId, uid))) : [];
    const n = await db.select().from(notes).where(and(eq(notes.userId, uid), eq(notes.targetType, 'report'), eq(notes.targetId, id))).orderBy(desc(notes.createdAt));
    await audit(req, 'report.view', { targetType: 'report', targetId: id });
    return { report, results: rows, document: doc ? toDocument(doc) : null, specialist: spec ? toSpecialist(spec) : null, notes: n.map(toNote) };
  });

  app.patch('/reports/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = reportUpdateSchema.parse(req.body);
    const uid = req.user!.id;
    if (body.specialistId) {
      const [s] = await db.select({ id: specialists.id }).from(specialists).where(and(eq(specialists.id, body.specialistId), eq(specialists.userId, uid)));
      if (!s) throw notFound('Специалистът');
    }
    const [row] = await db.update(labReports).set({ ...body, updatedAt: new Date().toISOString() }).where(and(eq(labReports.id, id), eq(labReports.userId, uid))).returning({ id: labReports.id });
    if (!row) throw notFound('Изследването');
    if (body.collectedAt) await db.update(labResults).set({ collectedAt: body.collectedAt }).where(and(eq(labResults.reportId, id), eq(labResults.userId, uid)));
    return { ok: true };
  });

  app.delete('/reports/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const uid = req.user!.id;
    const [row] = await db.delete(labReports).where(and(eq(labReports.id, id), eq(labReports.userId, uid))).returning({ id: labReports.id });
    if (!row) throw notFound('Изследването');
    await db.delete(timelineEvents).where(and(eq(timelineEvents.userId, uid), eq(timelineEvents.refId, id)));
    await audit(req, 'report.delete', { targetType: 'report', targetId: id });
    return { ok: true };
  });

  // ── Results ──────────────────────────────────────────────────
  app.post('/results', async (req) => {
    const body = manualResultSchema.parse(req.body);
    const uid = req.user!.id;
    if (body.reportId) {
      const [r] = await db.select({ id: labReports.id }).from(labReports).where(and(eq(labReports.id, body.reportId), eq(labReports.userId, uid)));
      if (!r) throw notFound('Изследването');
    }
    const fields = deriveResultFields({ ...body, rangeSource: 'user' });
    const now = new Date().toISOString();
    const [row] = await db.insert(labResults).values({
      ...fields, userId: uid, reportId: body.reportId ?? null, collectedAt: body.collectedAt, source: 'manual',
      sourceLabel: body.sourceLabel ?? null, confirmedAt: now,
    }).returning();
    if (body.note) await db.insert(notes).values({ userId: uid, targetType: 'biomarker', targetId: resultKey(row!), body: body.note });
    await audit(req, 'result.create', { targetType: 'result', targetId: row!.id });
    return toLabResult(row!);
  });

  app.patch('/results/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = resultEditSchema.parse(req.body);
    const uid = req.user!.id;
    const [cur] = await db.select().from(labResults).where(and(eq(labResults.id, id), eq(labResults.userId, uid)));
    if (!cur) throw notFound('Резултатът');
    const next = deriveResultFields({
      biomarkerId: body.biomarkerId !== undefined ? body.biomarkerId : cur.biomarkerId,
      originalName: cur.originalName,
      valueText: body.valueText ?? cur.valueText,
      unit: body.unit !== undefined ? body.unit : cur.unit,
      referenceRange: body.referenceRange !== undefined ? body.referenceRange : rangeOf(cur),
      rangeSource: body.referenceRange !== undefined ? 'user' : (cur.rangeSource ?? 'laboratory'),
    });
    const changes: Array<[string, string | null, string | null]> = [];
    const cmp = (field: string, a: unknown, b: unknown) => {
      const sa = a === null || a === undefined ? null : String(a);
      const sb = b === null || b === undefined ? null : String(b);
      if (sa !== sb) changes.push([field, sa, sb]);
    };
    cmp('value', cur.valueText, next.valueText);
    cmp('unit', cur.unit, next.unit);
    cmp('range', rangeOf(cur) ? `${cur.rangeLow ?? ''}–${cur.rangeHigh ?? ''}` : null, next.rangeLow !== null || next.rangeHigh !== null ? `${next.rangeLow ?? ''}–${next.rangeHigh ?? ''}` : null);
    cmp('biomarker', cur.biomarkerId, next.biomarkerId);
    if (body.collectedAt) cmp('date', cur.collectedAt, body.collectedAt);
    if (!changes.length) return toLabResult(cur);
    const [row] = await db.transaction(async (tx) => {
      for (const [field, o, n] of changes) {
        await tx.insert(resultEdits).values({ resultId: id, userId: uid, field, originalValue: o, newValue: n, context: 'edit', editedBy: uid });
      }
      return tx.update(labResults).set({ ...next, ...(body.collectedAt ? { collectedAt: body.collectedAt } : {}), edited: true, updatedAt: new Date().toISOString() }).where(and(eq(labResults.id, id), eq(labResults.userId, uid))).returning();
    });
    await audit(req, 'result.edit', { targetType: 'result', targetId: id });
    return toLabResult(row!);
  });

  app.delete('/results/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const [row] = await db.delete(labResults).where(and(eq(labResults.id, id), eq(labResults.userId, req.user!.id))).returning({ id: labResults.id });
    if (!row) throw notFound('Резултатът');
    await audit(req, 'result.delete', { targetType: 'result', targetId: id });
    return { ok: true };
  });

  app.get('/results/:id/history', async (req) => {
    const { id } = idParam.parse(req.params);
    const uid = req.user!.id;
    const [r] = await db.select().from(labResults).where(and(eq(labResults.id, id), eq(labResults.userId, uid)));
    if (!r) throw notFound('Резултатът');
    const edits = await db.select().from(resultEdits).where(and(eq(resultEdits.resultId, id), eq(resultEdits.userId, uid))).orderBy(resultEdits.editedAt);
    return {
      result: toLabResult(r),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      source: r.source,
      extractedAt: r.extractedAt,
      edits: edits.map((e) => ({ field: e.field, originalValue: e.originalValue, newValue: e.newValue, context: e.context, editedAt: e.editedAt, editedBy: e.editedBy === uid ? 'Ти' : 'Друг потребител' })),
    };
  });

  // ── Search ───────────────────────────────────────────────────
  app.get('/search', async (req) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(100) }).parse(req.query);
    const uid = req.user!.id;
    const like = `%${likeEscape(q)}%`;
    const needle = q.toLowerCase();
    const key = normalizeAliasKey(q);
    const summaries = (await biomarkerSummaries(uid)).filter((s) => {
      const bm = getBiomarker(s.id);
      return [s.name, ...(bm ? [bm.canonicalName, ...bm.aliases] : [])].some((n) => n.toLowerCase().includes(needle) || (key.length >= 2 && normalizeAliasKey(n).includes(key)));
    });
    const reports = await reportSummaries(uid, or(ilike(labReports.title, like), sql`exists (select 1 from laboratories l where l.id = ${labReports.laboratoryId} and l.name ilike ${like})`, sql`exists (select 1 from lab_results x where x.report_id = ${labReports.id} and (x.original_name ilike ${like} or x.biomarker_id in ${summaries.length ? summaries.map((s) => s.id) : ['__none__']}))`), 10);
    const docs = await db.select().from(documents).where(and(eq(documents.userId, uid), ilike(documents.name, like))).limit(10);
    const specs = await db.select().from(specialists).where(and(eq(specialists.userId, uid), or(ilike(specialists.name, like), ilike(specialists.specialty, like), ilike(specialists.clinic, like)))).limit(10);
    return { biomarkers: summaries.slice(0, 10), reports, documents: docs.map(toDocument), specialists: specs.map(toSpecialist) };
  });

  // ── Timeline ─────────────────────────────────────────────────
  app.get('/timeline', async (req) => {
    const { limit, before } = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), before: isoDate.optional() }).parse(req.query);
    const uid = req.user!.id;
    const dateCond = before ? lte(labReports.collectedAt, before) : undefined;
    const reports = await reportSummaries(uid, dateCond, limit);
    const events = await db.select().from(timelineEvents)
      .where(and(eq(timelineEvents.userId, uid), isNull(timelineEvents.refId), before ? lte(timelineEvents.date, before) : undefined))
      .orderBy(desc(timelineEvents.date)).limit(limit);
    const docs = await db.select().from(documents)
      .where(and(eq(documents.userId, uid), ne(documents.category, 'lab_results'), sql`${documents.documentDate} is not null`))
      .orderBy(desc(documents.documentDate)).limit(limit);
    const items = [
      ...reports.map((r) => ({ type: 'report' as const, date: r.collectedAt, id: r.id, title: r.title, subtitle: r.laboratory?.name ?? null, meta: `${r.resultCount} показателя`, kind: 'lab_report' })),
      ...events.map((e) => ({ type: 'event' as const, date: e.date, id: e.id, title: e.title, subtitle: e.description, meta: null, kind: e.kind })),
      ...docs.map((d) => ({ type: 'document' as const, date: d.documentDate!, id: d.id, title: d.name, subtitle: null, meta: null, kind: d.category })),
    ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
    return { items };
  });
};

