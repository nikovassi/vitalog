import { and, eq } from 'drizzle-orm';
import { processPdf, ProcessingError, type ProgressUpdate } from '@vitalog/parser';
import { config } from '../config';
import { db } from '../db/client';
import { documents, extractionCandidates, notifications, processingJobs, profiles, usageCounters, users } from '../db/schema';
import { getUserFile } from '../lib/files';
import { getAi, getOcr } from './providers';
import { bumpUsage, period } from './uploads';

const TIMEOUT_MS = 5 * 60_000;

export const ERROR_MESSAGES: Record<string, string> = {
  invalid_pdf: 'Файлът е повреден или не е валиден PDF.',
  encrypted_pdf: 'PDF файлът е защитен с парола. Качи версия без парола.',
  too_many_pages: 'Документът има твърде много страници.',
  no_text: 'Не открихме текст в документа. Ако е сканиран, опитай с по-ясно копие.',
  ocr_failed: 'Не успяхме да разчетем сканирания документ.',
  unrecognized_document: 'Не разпознахме лабораторни резултати в този документ.',
  no_results: 'Не открихме показатели в документа.',
  ai_error: 'Автоматичното структуриране не успя.',
  internal: 'Възникна грешка при обработката. Опитай отново.',
};

/** Worker entry: one processing job. All writes are scoped to the job's user. */
export async function runProcessingJob(jobId: string) {
  const [job] = await db.select().from(processingJobs).where(eq(processingJobs.id, jobId));
  if (!job || job.stage === 'completed' || job.stage === 'review_required') return;
  const [doc] = await db.select().from(documents).where(and(eq(documents.id, job.documentId), eq(documents.userId, job.userId)));
  const [user] = await db.select({ dekEnc: users.dekEnc }).from(users).where(eq(users.id, job.userId));
  const [profile] = await db.select({ ai: profiles.aiProcessingConsentAt }).from(profiles).where(eq(profiles.userId, job.userId));
  if (!doc || !user) return;

  let lastWrite = 0;
  const onProgress = async (p: ProgressUpdate) => {
    const now = Date.now();
    if (now - lastWrite < 300 && p.stageProgress !== 100 && p.stageProgress !== 0) return;
    lastWrite = now;
    await db.update(processingJobs).set({ stage: p.stage, stageProgress: p.stageProgress, ...(p.pagesTotal !== undefined ? { pagesTotal: p.pagesTotal, pagesDone: p.pagesDone ?? null } : {}), updatedAt: new Date().toISOString() }).where(eq(processingJobs.id, jobId));
  };

  // AI only with explicit consent, configured provider, and remaining AI quota
  let ai = null;
  if (profile?.ai) {
    const [usage] = await db.select().from(usageCounters).where(and(eq(usageCounters.userId, job.userId), eq(usageCounters.period, period())));
    if ((usage?.aiCalls ?? 0) < config.MONTHLY_AI_LIMIT) ai = getAi();
  }

  try {
    const pdf = await getUserFile(user.dekEnc, doc.storageKey);
    const result = await Promise.race([
      processPdf(new Uint8Array(pdf), { maxPages: config.MAX_PDF_PAGES, ocr: getOcr(), ai, onProgress }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new ProcessingError('internal', 'timeout')), TIMEOUT_MS)),
    ]);
    if (result.usedAi) await bumpUsage(job.userId, 'aiCalls');
    await db.transaction(async (tx) => {
      await tx.delete(extractionCandidates).where(eq(extractionCandidates.jobId, jobId));
      if (result.candidates.length) {
        await tx.insert(extractionCandidates).values(result.candidates.map((c, i) => ({
          jobId, userId: job.userId, position: i, biomarkerId: c.biomarkerId, originalName: c.originalName.slice(0, 160), rawLine: c.rawLine,
          valueText: c.valueText.slice(0, 60), valueNumeric: c.valueNumeric, valueComparator: c.valueComparator, unit: c.unit?.slice(0, 40) ?? null,
          rangeLow: c.referenceRange?.low ?? null, rangeHigh: c.referenceRange?.high ?? null, rangeText: c.referenceRange?.text ?? null,
          labCode: c.labCode, labComment: c.labComment, page: c.page, confidence: c.confidence, issues: c.issues,
        })));
      }
      await tx.update(documents).set({ pageCount: result.pageCount }).where(eq(documents.id, doc.id));
      await tx.update(processingJobs).set({ stage: 'review_required', stageProgress: 100, meta: result.meta, usedOcr: result.usedOcr, usedAi: result.usedAi, updatedAt: new Date().toISOString() }).where(eq(processingJobs.id, jobId));
      await tx.insert(notifications).values({ userId: job.userId, kind: 'review_ready', title: 'Резултатът е готов за потвърждение', body: `Открихме ${result.candidates.length} показателя в „${doc.name}“.`, link: `/app/review/${jobId}` });
    });
  } catch (err) {
    const code = err instanceof ProcessingError ? err.code : 'internal';
    if (!(err instanceof ProcessingError)) console.error('processing failed', jobId, (err as Error).message);
    await db.update(processingJobs).set({ stage: 'failed', errorCode: code, updatedAt: new Date().toISOString() }).where(eq(processingJobs.id, jobId));
    await db.insert(notifications).values({ userId: job.userId, kind: 'processing_failed', title: 'Документът не беше обработен', body: ERROR_MESSAGES[code] ?? ERROR_MESSAGES.internal!, link: `/app/upload?job=${jobId}` });
  }
}
