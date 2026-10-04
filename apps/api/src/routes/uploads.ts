import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  confirmReviewSchema, normalizeAliasKey, type ExtractionCandidate, type ReviewResponse,
} from '@vitalog/shared';
import { config } from '../config';
import { db } from '../db/client';
import {
  documents, extractionCandidates, laboratories, labReports, labResults, notifications, processingJobs, profiles,
  resultEdits, specialists, timelineEvents,
} from '../db/schema';
import { requireUser } from '../lib/auth';
import { audit } from '../lib/audit';
import { deleteUserFile } from '../lib/files';
import { badRequest, HttpError, notFound, UUID_RE } from '../lib/http';
import { enqueueProcessing } from '../lib/queue';
import { deriveResultFields } from '../services/results';
import { bumpUsage, checkQuota, storeUpload } from '../services/uploads';
import { toDocument, toJob } from '../services/mappers';

const idParam = z.object({ id: z.string().regex(UUID_RE) });

export const uploadRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireUser);

  app.post('/uploads', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (req, reply) => {
    const user = req.user!;
    if (config.REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
      throw new HttpError(403, 'email_unverified', 'Потвърди email адреса си, преди да качваш документи.');
    }
    await checkQuota(user.id);
    const file = await req.file();
    if (!file) throw badRequest('Не е избран файл.', 'no_file');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw new HttpError(413, 'file_too_large', `Файлът е твърде голям. Максимум ${config.MAX_UPLOAD_MB} MB.`);
    if (buf.length === 0) throw badRequest('Файлът е празен.', 'empty_file');
    const doc = await storeUpload(user, buf, file.filename, 'lab_results');
    const [job] = await db.insert(processingJobs).values({ userId: user.id, documentId: doc.id }).returning();
    await bumpUsage(user.id, 'documentsProcessed', buf.length);
    await enqueueProcessing(job!.id);
    await audit(req, 'document.upload', { targetType: 'document', targetId: doc.id });
    return reply.status(202).send({ jobId: job!.id, documentId: doc.id });
  });

  app.get('/jobs', async (req) => {
    const rows = await db.select().from(processingJobs)
      .where(and(eq(processingJobs.userId, req.user!.id), ne(processingJobs.stage, 'completed')))
      .orderBy(desc(processingJobs.createdAt)).limit(20);
    const docs = rows.length ? await db.select().from(documents).where(inArray(documents.id, rows.map((r) => r.documentId))) : [];
    return rows.map((j) => ({ ...toJob(j), documentName: docs.find((d) => d.id === j.documentId)?.name ?? null }));
  });

  app.get('/jobs/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const [job] = await db.select().from(processingJobs).where(and(eq(processingJobs.id, id), eq(processingJobs.userId, req.user!.id)));
    if (!job) throw notFound('Обработката');
    return { ...toJob(job), reportId: job.reportId };
  });

  app.get('/jobs/:id/review', async (req): Promise<ReviewResponse & { patientNameMismatch: boolean }> => {
    const { id } = idParam.parse(req.params);
    const uid = req.user!.id;
    const [job] = await db.select().from(processingJobs).where(and(eq(processingJobs.id, id), eq(processingJobs.userId, uid)));
    if (!job) throw notFound('Обработката');
    if (job.stage !== 'review_required') throw new HttpError(409, 'not_ready', 'Документът все още не е готов за преглед.');
    const [doc] = await db.select().from(documents).where(and(eq(documents.id, job.documentId), eq(documents.userId, uid)));
    const cands = await db.select().from(extractionCandidates).where(and(eq(extractionCandidates.jobId, id), eq(extractionCandidates.userId, uid))).orderBy(extractionCandidates.position);
    const meta = job.meta!;
    let dupReport: string | null = null;
    if (meta.collectedAt) {
      const [r] = await db.select({ id: labReports.id }).from(labReports).where(and(eq(labReports.userId, uid), eq(labReports.collectedAt, meta.collectedAt)));
      dupReport = r?.id ?? null;
    }
    const [profile] = await db.select({ fullName: profiles.fullName }).from(profiles).where(eq(profiles.userId, uid));
    const patientNameMismatch = !!(profile?.fullName && meta.patientName && !namesLikelyMatch(profile.fullName, meta.patientName));
    return {
      job: toJob(job),
      document: toDocument(doc!),
      meta,
      candidates: cands.map((c): ExtractionCandidate => ({
        id: c.id, jobId: c.jobId, biomarkerId: c.biomarkerId, originalName: c.originalName, rawLine: c.rawLine,
        valueText: c.valueText, valueNumeric: c.valueNumeric, valueComparator: c.valueComparator as ExtractionCandidate['valueComparator'], unit: c.unit,
        referenceRange: c.rangeLow !== null || c.rangeHigh !== null ? { low: c.rangeLow, high: c.rangeHigh, text: c.rangeText, source: 'laboratory' } : null,
        labCode: c.labCode, labComment: c.labComment, page: c.page, confidence: c.confidence, issues: c.issues as ExtractionCandidate['issues'], decision: c.decision,
      })),
      suspectedDuplicateReportId: dupReport,
      patientNameMismatch,
    };
  });

  /** The ONLY path from extracted data to stored results: explicit user confirmation. */
  app.post('/jobs/:id/confirm', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = confirmReviewSchema.parse(req.body);
    const uid = req.user!.id;
    const [job] = await db.select().from(processingJobs).where(and(eq(processingJobs.id, id), eq(processingJobs.userId, uid)));
    if (!job) throw notFound('Обработката');
    if (job.stage !== 'review_required') throw new HttpError(409, 'not_ready', 'Този документ вече е обработен.');
    const cands = await db.select().from(extractionCandidates).where(and(eq(extractionCandidates.jobId, id), eq(extractionCandidates.userId, uid)));
    const byId = new Map(cands.map((c) => [c.id, c]));
    for (const d of body.candidates) if (!byId.has(d.id)) throw badRequest('Невалиден резултат в заявката.');
    const accepted = body.candidates.filter((d) => d.decision === 'accepted');
    if (!accepted.length) throw badRequest('Потвърди поне един резултат или откажи документа.', 'nothing_accepted');
    for (const d of accepted) {
      if (/\?/.test(d.valueText)) throw badRequest(`„${d.originalName}“: стойността не е разчетена. Поправи я или я изключи.`, 'unreadable_value');
    }
    if (body.meta.specialistId) {
      const [s] = await db.select({ id: specialists.id }).from(specialists).where(and(eq(specialists.id, body.meta.specialistId), eq(specialists.userId, uid)));
      if (!s) throw notFound('Специалистът');
    }
    const meta = job.meta!;
    const now = new Date().toISOString();

    const reportId = await db.transaction(async (tx) => {
      let laboratoryId: string | null = null;
      if (body.meta.laboratoryName) {
        // Lab contact details only when they come from this document (never invented)
        const fromDoc = meta.laboratoryName === body.meta.laboratoryName;
        const [lab] = await tx.insert(laboratories).values({
          userId: uid, name: body.meta.laboratoryName,
          address: fromDoc ? meta.laboratoryAddress : null, phone: fromDoc ? meta.laboratoryPhone : null, website: fromDoc ? meta.laboratoryWebsite : null,
          sourceDocumentId: fromDoc ? job.documentId : null,
        }).onConflictDoUpdate({ target: [laboratories.userId, laboratories.name], set: { name: body.meta.laboratoryName } }).returning({ id: laboratories.id });
        laboratoryId = lab!.id;
      }
      const [rep] = await tx.insert(labReports).values({
        userId: uid, title: body.meta.title, reportType: body.meta.reportType, collectedAt: body.meta.collectedAt, laboratoryId,
        documentId: job.documentId, specialistId: body.meta.specialistId, patientNameOnDocument: meta.patientName, labComment: meta.labComment,
      }).returning({ id: labReports.id });
      for (const d of accepted) {
        const c = byId.get(d.id)!;
        const fields = deriveResultFields({
          biomarkerId: d.biomarkerId, originalName: d.originalName, valueText: d.valueText, unit: d.unit,
          referenceRange: d.referenceRange,
          rangeSource: sameRange(c, d.referenceRange) ? 'laboratory' : 'user',
        });
        const edits: Array<[string, string | null, string | null]> = [];
        if (c.valueText !== d.valueText) edits.push(['value', c.valueText, d.valueText]);
        if ((c.unit ?? null) !== (d.unit ?? null)) edits.push(['unit', c.unit, d.unit]);
        if (!sameRange(c, d.referenceRange)) edits.push(['range', fmtRange(c.rangeLow, c.rangeHigh), d.referenceRange ? fmtRange(d.referenceRange.low, d.referenceRange.high) : null]);
        if ((c.biomarkerId ?? null) !== (d.biomarkerId ?? null)) edits.push(['biomarker', c.biomarkerId, d.biomarkerId]);
        if (c.originalName !== d.originalName) edits.push(['name', c.originalName, d.originalName]);
        const [res] = await tx.insert(labResults).values({
          ...fields, userId: uid, reportId: rep!.id, collectedAt: body.meta.collectedAt, labCode: c.labCode, labComment: c.labComment,
          source: 'pdf', sourceDocumentId: job.documentId, sourcePage: c.page, extractionConfidence: c.confidence,
          extractedAt: job.updatedAt, edited: edits.length > 0, confirmedAt: now,
        }).returning({ id: labResults.id });
        for (const [field, o, n] of edits) {
          await tx.insert(resultEdits).values({ resultId: res!.id, userId: uid, field, originalValue: o, newValue: n, context: 'review', editedBy: uid });
        }
      }
      for (const d of body.candidates) await tx.update(extractionCandidates).set({ decision: d.decision }).where(eq(extractionCandidates.id, d.id));
      await tx.update(processingJobs).set({ stage: 'completed', reportId: rep!.id, completedAt: now, updatedAt: now }).where(eq(processingJobs.id, id));
      await tx.update(documents).set({ documentDate: body.meta.collectedAt }).where(eq(documents.id, job.documentId));
      await tx.insert(timelineEvents).values({ userId: uid, kind: 'lab_report', title: body.meta.title, date: body.meta.collectedAt, refId: rep!.id, showOnCharts: false });
      await tx.insert(notifications).values({ userId: uid, kind: 'report_added', title: 'Изследването е добавено към твоята здравна история.', link: `/app/reports/${rep!.id}` });
      return rep!.id;
    });
    await audit(req, 'report.confirm', { targetType: 'report', targetId: reportId });
    return { reportId, saved: accepted.length };
  });

  app.post('/jobs/:id/discard', async (req) => {
    const { id } = idParam.parse(req.params);
    const uid = req.user!.id;
    const [job] = await db.select().from(processingJobs).where(and(eq(processingJobs.id, id), eq(processingJobs.userId, uid)));
    if (!job) throw notFound('Обработката');
    if (job.stage === 'completed') throw new HttpError(409, 'completed', 'Документът вече е добавен. Изтрий изследването от страницата му.');
    const [doc] = await db.delete(documents).where(and(eq(documents.id, job.documentId), eq(documents.userId, uid))).returning();
    if (doc) await deleteUserFile(doc.storageKey);
    await audit(req, 'document.delete', { targetType: 'document', targetId: job.documentId });
    return { ok: true };
  });

  app.post('/jobs/:id/retry', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (req) => {
    const { id } = idParam.parse(req.params);
    const [job] = await db.update(processingJobs).set({ stage: 'queued', stageProgress: 0, errorCode: null, updatedAt: new Date().toISOString() })
      .where(and(eq(processingJobs.id, id), eq(processingJobs.userId, req.user!.id), eq(processingJobs.stage, 'failed'))).returning();
    if (!job) throw notFound('Обработката');
    await db.delete(extractionCandidates).where(eq(extractionCandidates.jobId, id));
    await enqueueProcessing(id);
    return toJob(job);
  });
};

function sameRange(c: { rangeLow: number | null; rangeHigh: number | null }, r: { low: number | null; high: number | null } | null) {
  return (c.rangeLow ?? null) === (r?.low ?? null) && (c.rangeHigh ?? null) === (r?.high ?? null);
}
const fmtRange = (l: number | null, h: number | null) => (l === null && h === null ? null : `${l ?? ''}–${h ?? ''}`);

/** Loose check to warn (not block) when the PDF seems to belong to someone else. */
function namesLikelyMatch(a: string, b: string) {
  const tokens = (s: string) => new Set(s.toLowerCase().split(/[\s,.]+/).filter((t) => t.length > 2).map(normalizeAliasKey));
  const ta = tokens(a);
  return [...tokens(b)].some((t) => ta.has(t));
}
