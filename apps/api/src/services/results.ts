import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { buildSummary, resultKey, type BiomarkerSummary, type LabReport } from '@vitalog/shared';
import { db, type Tx } from '../db/client';
import { favorites, laboratories, labReports, labResults } from '../db/schema';

type ResultRow = typeof labResults.$inferSelect;
type Row = ResultRow & { labName?: string | null };

// Pure logic lives in @vitalog/shared/aggregate (also used by the in-browser local mode)
export { buildSummary, customKeyFor, deriveResultFields, rangeOf, resultKey, toLabResult, toSeriesPoint, type ResultInput } from '@vitalog/shared';

/**
 * Summaries for all biomarkers of a user in ONE query (window functions), returning at most
 * the 12 most recent measurements per biomarker – scales to 10k+ results.
 */
export async function biomarkerSummaries(userId: string, opts: { keys?: string[]; from?: string | null; to?: string | null } = {}): Promise<BiomarkerSummary[]> {
  const conds = [sql`r.user_id = ${userId}`];
  if (opts.from) conds.push(sql`r.collected_at >= ${opts.from}`);
  if (opts.to) conds.push(sql`r.collected_at <= ${opts.to}`);
  if (opts.keys?.length) conds.push(sql`coalesce(r.biomarker_id, r.custom_key) in ${opts.keys}`);
  const rows = await db.execute<Record<string, unknown>>(sql`
    select * from (
      select r.*, l.name as lab_name,
        row_number() over (partition by coalesce(r.biomarker_id, r.custom_key) order by r.collected_at desc, r.created_at desc) as rn,
        count(*) over (partition by coalesce(r.biomarker_id, r.custom_key)) as cnt
      from lab_results r
      left join lab_reports rep on rep.id = r.report_id
      left join laboratories l on l.id = rep.laboratory_id
      where ${sql.join(conds, sql` and `)}
    ) t where rn <= 12
    order by coalesce(biomarker_id, custom_key), rn`);
  const favs = new Set((await db.select({ k: favorites.biomarkerKey }).from(favorites).where(eq(favorites.userId, userId))).map((f) => f.k));
  const grouped = new Map<string, { rows: Row[]; count: number }>();
  for (const raw of rows) {
    const r = mapRaw(raw);
    const key = resultKey(r);
    const g = grouped.get(key) ?? { rows: [], count: Number(raw.cnt) };
    g.rows.push(r);
    grouped.set(key, g);
  }
  return [...grouped.entries()].map(([k, g]) => buildSummary(k, g.rows, g.count, favs.has(k)));
}

/** Map a raw snake_case row (from db.execute) to the Drizzle row shape. */
function mapRaw(raw: Record<string, unknown>): Row {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const s = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
  const d = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  return {
    id: String(raw.id),
    userId: String(raw.user_id),
    reportId: s(raw.report_id),
    biomarkerId: s(raw.biomarker_id),
    customKey: s(raw.custom_key),
    originalName: String(raw.original_name),
    valueText: String(raw.value_text),
    valueNumeric: n(raw.value_numeric),
    valueComparator: s(raw.value_comparator),
    unit: s(raw.unit),
    rangeLow: n(raw.range_low),
    rangeHigh: n(raw.range_high),
    rangeText: s(raw.range_text),
    rangeSource: s(raw.range_source) as Row['rangeSource'],
    status: String(raw.status) as Row['status'],
    collectedAt: d(raw.collected_at),
    labCode: s(raw.lab_code),
    labComment: s(raw.lab_comment),
    source: String(raw.source) as Row['source'],
    sourceLabel: s(raw.source_label),
    sourceDocumentId: s(raw.source_document_id),
    sourcePage: n(raw.source_page),
    extractionConfidence: n(raw.extraction_confidence),
    extractedAt: s(raw.extracted_at),
    edited: Boolean(raw.edited),
    confirmedAt: s(raw.confirmed_at),
    createdAt: s(raw.created_at)!,
    updatedAt: s(raw.updated_at)!,
    labName: s(raw.lab_name),
  };
}

/** Full series of one biomarker (oldest → newest), user-scoped. */
export async function biomarkerSeries(userId: string, key: string, from?: string | null, to?: string | null) {
  const keyCond = key.startsWith('custom:') ? eq(labResults.customKey, key) : eq(labResults.biomarkerId, key);
  const conds = [eq(labResults.userId, userId), keyCond];
  if (from) conds.push(sql`${labResults.collectedAt} >= ${from}`);
  if (to) conds.push(sql`${labResults.collectedAt} <= ${to}`);
  const rows = await db
    .select({ r: labResults, labName: laboratories.name })
    .from(labResults)
    .leftJoin(labReports, eq(labReports.id, labResults.reportId))
    .leftJoin(laboratories, eq(laboratories.id, labReports.laboratoryId))
    .where(and(...conds))
    .orderBy(asc(labResults.collectedAt), asc(labResults.createdAt));
  return rows.map(({ r, labName }) => ({ ...r, labName }));
}

export async function reportSummaries(userId: string, where?: ReturnType<typeof and>, limit = 50, offset = 0, order: 'newest' | 'oldest' = 'newest'): Promise<LabReport[]> {
  const rows = await db
    .select({
      rep: labReports,
      lab: laboratories,
      cnt: sql<number>`(select count(*)::int from lab_results x where x.report_id = ${labReports.id})`,
      out: sql<number>`(select count(*)::int from lab_results x where x.report_id = ${labReports.id} and x.status in ('above','below'))`,
    })
    .from(labReports)
    .leftJoin(laboratories, eq(laboratories.id, labReports.laboratoryId))
    .where(where ? and(eq(labReports.userId, userId), where) : eq(labReports.userId, userId))
    .orderBy(order === 'newest' ? desc(labReports.collectedAt) : asc(labReports.collectedAt), desc(labReports.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(({ rep, lab, cnt, out }) => ({
    id: rep.id,
    title: rep.title,
    reportType: rep.reportType as LabReport['reportType'],
    collectedAt: rep.collectedAt,
    laboratory: lab ? { id: lab.id, name: lab.name, address: lab.address, phone: lab.phone, website: lab.website, sourceDocumentId: lab.sourceDocumentId } : null,
    documentId: rep.documentId,
    specialistId: rep.specialistId,
    patientNameOnDocument: rep.patientNameOnDocument,
    labComment: rep.labComment,
    resultCount: cnt,
    outOfRangeCount: out,
    createdAt: rep.createdAt,
  }));
}

/** Previous measurement of the same biomarker before a given date (for report tables). */
export async function previousValues(userId: string, keys: string[], beforeDate: string, tx: Tx | typeof db = db) {
  if (!keys.length) return new Map<string, ResultRow>();
  const rows = await tx
    .select()
    .from(labResults)
    .where(and(eq(labResults.userId, userId), sql`${labResults.collectedAt} < ${beforeDate}`, sql`coalesce(${labResults.biomarkerId}, ${labResults.customKey}) in ${keys}`))
    .orderBy(desc(labResults.collectedAt));
  const map = new Map<string, ResultRow>();
  for (const r of rows) if (!map.has(resultKey(r))) map.set(resultKey(r), r);
  return map;
}

