import type { Document, Note, ProcessingJob, Specialist, TimelineEvent } from '@vitalog/shared';
import type { documents, notes, processingJobs, specialists, timelineEvents } from '../db/schema';

/** DB row → API model. Internal columns (storage keys, hashes) are never exposed. */
export const toDocument = (d: typeof documents.$inferSelect): Document => ({
  id: d.id, name: d.name, category: d.category, documentDate: d.documentDate, mimeType: d.mimeType,
  sizeBytes: d.sizeBytes, pageCount: d.pageCount, source: d.source, uploadedAt: d.uploadedAt, reportId: null,
});

export const toSpecialist = (s: typeof specialists.$inferSelect): Specialist => ({
  id: s.id, name: s.name, specialty: s.specialty, phone: s.phone, email: s.email, address: s.address, clinic: s.clinic,
  website: s.website, note: s.note, photoDocumentId: null, hasPhoto: !!s.photoStorageKey, lastVisitAt: s.lastVisitAt, nextVisitAt: s.nextVisitAt, createdAt: s.createdAt,
});

export const toNote = (n: typeof notes.$inferSelect): Note => ({ id: n.id, targetType: n.targetType, targetId: n.targetId, body: n.body, createdAt: n.createdAt });

export const toTimelineEvent = (e: typeof timelineEvents.$inferSelect): TimelineEvent => ({
  id: e.id, kind: e.kind as TimelineEvent['kind'], title: e.title, date: e.date, description: e.description, refId: e.refId, showOnCharts: e.showOnCharts,
});

export const toJob = (j: typeof processingJobs.$inferSelect): ProcessingJob => ({
  id: j.id, documentId: j.documentId, stage: j.stage as ProcessingJob['stage'], stageProgress: j.stageProgress,
  pagesTotal: j.pagesTotal, pagesDone: j.pagesDone, usedOcr: j.usedOcr, errorCode: j.errorCode as ProcessingJob['errorCode'],
  createdAt: j.createdAt, updatedAt: j.updatedAt,
});
