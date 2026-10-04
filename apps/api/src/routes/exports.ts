import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import { buildFhirBundle, getBiomarker, isoDate, STATUS_LABELS, summaryRequestSchema } from '@vitalog/shared';
import { db } from '../db/client';
import {
  appointments, consents, documents, laboratories, labReports, labResults, notes, profiles, resultEdits, specialists,
  timelineEvents, users,
} from '../db/schema';
import { requireRecentAuth, requireUser } from '../lib/auth';
import { audit } from '../lib/audit';
import { biomarkerSeries, biomarkerSummaries, toSeriesPoint } from '../services/results';
import { renderSummaryPdf } from '../services/summary-pdf';
import { toSpecialist } from '../services/mappers';

const csvCell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v);
  // CSV injection protection for spreadsheet apps
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const exportRoutes: FastifyPluginAsync = async (app) => {
  /** CSV of selected biomarkers / period. */
  app.get('/export/csv', { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const q = z.object({ biomarkers: z.string().max(4000).optional(), from: isoDate.optional(), to: isoDate.optional() }).parse(req.query);
    const uid = req.user!.id;
    const keys = q.biomarkers ? q.biomarkers.split(',').filter(Boolean).slice(0, 200) : null;
    const conds = [eq(labResults.userId, uid)];
    if (q.from) conds.push(gte(labResults.collectedAt, q.from));
    if (q.to) conds.push(lte(labResults.collectedAt, q.to));
    if (keys) conds.push(or(inArray(labResults.biomarkerId, keys), inArray(labResults.customKey, keys))!);
    const rows = await db.select({ r: labResults, lab: laboratories.name }).from(labResults)
      .leftJoin(labReports, eq(labReports.id, labResults.reportId))
      .leftJoin(laboratories, eq(laboratories.id, labReports.laboratoryId))
      .where(and(...conds)).orderBy(asc(labResults.collectedAt));
    const head = ['Дата', 'Показател', 'Име в документа', 'Стойност', 'Единица', 'Реф. минимум', 'Реф. максимум', 'Реф. текст', 'Статус', 'Лаборатория', 'Източник', 'Страница', 'Редактиран'];
    const lines = [head.join(';')];
    for (const { r, lab } of rows) {
      lines.push([r.collectedAt, getBiomarker(r.biomarkerId)?.bgName ?? r.originalName, r.originalName, r.valueText, r.unit, r.rangeLow, r.rangeHigh, r.rangeText, STATUS_LABELS[r.status], lab, r.source, r.sourcePage, r.edited ? 'да' : 'не'].map(csvCell).join(';'));
    }
    await audit(req, 'export.create', { targetType: 'csv' });
    return reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="vitalog-results.csv"').send('﻿' + lines.join('\r\n'));
  });

  /** Full account export (GDPR Art. 15/20). Requires recent password confirmation. */
  app.get('/export/json', { preHandler: requireRecentAuth, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const data = await collectAll(req.user!.id);
    await audit(req, 'export.create', { targetType: 'json' });
    return reply.header('Content-Disposition', 'attachment; filename="vitalog-export.json"').send({
      exportedAt: new Date().toISOString(),
      format: 'vitalog-export-v1',
      note: 'Оригиналните PDF файлове могат да бъдат изтеглени от „Документи“.',
      ...data,
    });
  });

  app.get('/export/fhir', { preHandler: requireRecentAuth, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const d = await collectAll(req.user!.id);
    const bundle = buildFhirBundle({
      user: { id: req.user!.id, displayName: d.profile.displayName, fullName: d.profile.fullName, birthYear: d.profile.birthYear },
      reports: d.reports, results: d.results, laboratories: d.laboratories, specialists: d.specialists, documents: d.documents,
    });
    await audit(req, 'export.create', { targetType: 'fhir' });
    return reply.header('Content-Type', 'application/fhir+json').header('Content-Disposition', 'attachment; filename="vitalog-fhir-bundle.json"').send(bundle);
  });

  /** "Генерирай медицинско обобщение" – only what the user selected. */
  app.post('/export/summary', { preHandler: requireUser, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const body = summaryRequestSchema.parse(req.body);
    const uid = req.user!.id;
    const summaries = await biomarkerSummaries(uid, { from: body.from, to: body.to, keys: body.biomarkerIds === 'all' ? undefined : body.biomarkerIds });
    const selected = await Promise.all(summaries.sort((a, b) => a.name.localeCompare(b.name, 'bg')).map(async (s) => ({
      summary: s,
      series: (await biomarkerSeries(uid, s.id, body.from, body.to)).map(toSeriesPoint),
    })));
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, uid));
    const pdf = await renderSummaryPdf({
      patientName: body.includePatientName ? (profile?.fullName ?? profile?.displayName ?? null) : null,
      from: body.from,
      to: body.to,
      biomarkers: selected,
      includeCharts: body.includeCharts,
      includeHistory: body.includeHistory,
      specialists: body.includeSpecialists ? (await db.select().from(specialists).where(eq(specialists.userId, uid))).map(toSpecialist) : null,
      documents: body.includeDocuments
        ? await db.select({ name: documents.name, documentDate: documents.documentDate, category: documents.category }).from(documents)
          .where(and(eq(documents.userId, uid), body.from ? gte(documents.documentDate, body.from) : undefined, body.to ? lte(documents.documentDate, body.to) : undefined))
        : null,
    });
    await audit(req, 'export.create', { targetType: 'summary_pdf' });
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', 'attachment; filename="vitalog-summary.pdf"').send(pdf);
  });
};

async function collectAll(uid: string) {
  const [u] = await db.select({ email: users.email, createdAt: users.createdAt }).from(users).where(eq(users.id, uid));
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, uid));
  const reports = await db.select().from(labReports).where(eq(labReports.userId, uid));
  const results = await db.select().from(labResults).where(eq(labResults.userId, uid));
  const docs = await db.select().from(documents).where(eq(documents.userId, uid));
  return {
    account: u!,
    profile: profile!,
    consents: await db.select().from(consents).where(eq(consents.userId, uid)),
    laboratories: await db.select().from(laboratories).where(eq(laboratories.userId, uid)),
    reports,
    results: results.map(({ extractionConfidence: _c, ...r }) => r),
    resultEdits: await db.select().from(resultEdits).where(eq(resultEdits.userId, uid)),
    specialists: (await db.select().from(specialists).where(eq(specialists.userId, uid))).map(({ photoStorageKey: _k, ...s }) => s),
    appointments: await db.select().from(appointments).where(eq(appointments.userId, uid)),
    notes: await db.select().from(notes).where(eq(notes.userId, uid)),
    timelineEvents: await db.select().from(timelineEvents).where(eq(timelineEvents.userId, uid)),
    documents: docs.map(({ storageKey: _k, ...d }) => d),
  };
}
