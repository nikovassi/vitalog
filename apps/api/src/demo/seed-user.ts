import { eq } from 'drizzle-orm';
import { processPdf, NoopOcr, type PipelineResult } from '@vitalog/parser';
import { config } from '../config';
import { db } from '../db/client';
import {
  documents, extractionCandidates, favorites, laboratories, labReports, labResults, notes, notifications, processingJobs,
  profiles, specialists, timelineEvents, users,
} from '../db/schema';
import { newWrappedDek, randomToken, sha256 } from '../lib/crypto';
import { putUserFile } from '../lib/files';
import { hashPassword } from '../lib/auth';
import { deriveResultFields } from '../services/results';
import { DEMO_EVENTS, DEMO_EXTRA_DOCS, DEMO_PATIENT, DEMO_PENDING_SPEC, DEMO_SPECIALISTS, demoReportSpecs } from './data';
import { renderLabPdf, renderTextPdf } from './lab-pdf';

interface Prepared { pdf: Buffer; parsed: PipelineResult; title: string; date: string }

/** Generated once per process: synthetic PDFs parsed by the real pipeline. */
let prepared: Promise<{ reports: Prepared[]; pending: Prepared; extras: Array<{ name: string; category: 'outpatient_sheet' | 'discharge_summary'; date: string; pdf: Buffer }> }> | null = null;

function prepare() {
  prepared ??= (async () => {
    const reports: Prepared[] = [];
    for (const { date, title, spec } of demoReportSpecs()) {
      const pdf = await renderLabPdf(spec);
      reports.push({ pdf, parsed: await processPdf(new Uint8Array(pdf), { maxPages: 30, ocr: new NoopOcr() }), title, date });
    }
    const pendingPdf = await renderLabPdf(DEMO_PENDING_SPEC);
    const pending = { pdf: pendingPdf, parsed: await processPdf(new Uint8Array(pendingPdf), { maxPages: 30, ocr: new NoopOcr() }), title: 'Кръвни изследвания', date: '2026-10-01' };
    const extras = await Promise.all(DEMO_EXTRA_DOCS.map(async (e) => ({ name: e.name, category: e.category, date: e.date, pdf: await renderTextPdf(e.title, e.paragraphs) })));
    return { reports, pending, extras };
  })();
  return prepared;
}

export async function createDemoAccount(): Promise<string> {
  const [u] = await db.insert(users).values({
    email: `demo-${randomToken(9).toLowerCase()}@demo.vitalog.invalid`,
    passwordHash: await hashPassword(randomToken(24)), // unusable password: demo is session-only
    dekEnc: newWrappedDek(),
    emailVerifiedAt: new Date().toISOString(),
    isDemo: true,
    demoExpiresAt: new Date(Date.now() + config.DEMO_TTL_HOURS * 3600_000).toISOString(),
  }).returning();
  await db.insert(profiles).values({ userId: u!.id, displayName: 'Николай', fullName: DEMO_PATIENT, onboardingCompletedAt: new Date().toISOString() });
  await seedDemoData(u!.id, u!.dekEnc);
  return u!.id;
}

export async function createSeedUser(email: string, password: string): Promise<string> {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing[0]) await db.delete(users).where(eq(users.id, existing[0].id));
  const [u] = await db.insert(users).values({ email, passwordHash: await hashPassword(password), dekEnc: newWrappedDek(), emailVerifiedAt: new Date().toISOString() }).returning();
  await db.insert(profiles).values({ userId: u!.id, displayName: 'Николай', fullName: DEMO_PATIENT });
  await seedDemoData(u!.id, u!.dekEnc);
  return u!.id;
}

async function seedDemoData(userId: string, dekEnc: string) {
  const { reports, pending, extras } = await prepare();
  const now = new Date().toISOString();

  const specIds: string[] = [];
  for (const s of DEMO_SPECIALISTS) {
    const [row] = await db.insert(specialists).values({ ...s, userId }).returning({ id: specialists.id });
    specIds.push(row!.id);
  }

  const storeDoc = async (name: string, pdf: Buffer, category: typeof documents.$inferInsert['category'], date: string | null, pages: number | null) => {
    const key = await putUserFile(userId, dekEnc, pdf);
    const [d] = await db.insert(documents).values({ userId, name, category, documentDate: date, mimeType: 'application/pdf', sizeBytes: pdf.length, pageCount: pages, sha256: sha256(pdf), storageKey: key, source: 'demo' }).returning({ id: documents.id });
    return d!.id;
  };

  for (const [i, rep] of reports.entries()) {
    const m = rep.parsed.meta;
    const docId = await storeDoc(`Резултати ${rep.date.split('-').reverse().join('.')} – ${m.laboratoryName}.pdf`, rep.pdf, 'lab_results', rep.date, rep.parsed.pageCount);
    const [lab] = await db.insert(laboratories).values({ userId, name: m.laboratoryName!, address: m.laboratoryAddress, phone: m.laboratoryPhone, website: m.laboratoryWebsite, sourceDocumentId: docId })
      .onConflictDoUpdate({ target: [laboratories.userId, laboratories.name], set: { name: m.laboratoryName! } }).returning({ id: laboratories.id });
    const specialistId = i === 2 || i === 3 ? specIds[0]! : i === 4 ? specIds[1]! : null;
    const [r] = await db.insert(labReports).values({ userId, title: rep.title, reportType: i === 3 ? 'hormones' : 'blood', collectedAt: rep.date, laboratoryId: lab!.id, documentId: docId, specialistId, patientNameOnDocument: m.patientName, labComment: m.labComment }).returning({ id: labReports.id });
    await db.insert(labResults).values(rep.parsed.candidates.map((c) => ({
      ...deriveResultFields({ biomarkerId: c.biomarkerId, originalName: c.originalName, valueText: c.valueText, unit: c.unit, referenceRange: c.referenceRange, rangeSource: 'laboratory' }),
      userId, reportId: r!.id, collectedAt: rep.date, labCode: c.labCode, source: 'pdf' as const, sourceDocumentId: docId, sourcePage: c.page,
      extractionConfidence: c.confidence, extractedAt: now, confirmedAt: now,
    })));
    await db.insert(timelineEvents).values({ userId, kind: 'lab_report', title: rep.title, date: rep.date, refId: r!.id, showOnCharts: false });
  }

  for (const e of extras) await storeDoc(e.name, e.pdf, e.category, e.date, 1);
  for (const e of DEMO_EVENTS) await db.insert(timelineEvents).values({ userId, ...e, showOnCharts: true });
  await db.insert(favorites).values(['glucose', 'hba1c', 'ldl', 'hdl', 'uric_acid'].map((k) => ({ userId, biomarkerKey: k })));
  await db.insert(notes).values([
    { userId, targetType: 'biomarker', targetId: 'uric_acid', body: 'Започнах нов режим на хранене от март 2025. (демо бележка)' },
    { userId, targetType: 'specialist', targetId: specIds[0]!, body: 'Следващ контрол на щитовидната жлеза – ноември. (демо)' },
  ]);

  // pending review job
  const pendingDocId = await storeDoc('Резултати 01.10.2026 – Синтетична лаборатория „Алфа“.pdf', pending.pdf, 'lab_results', null, pending.parsed.pageCount);
  const [job] = await db.insert(processingJobs).values({ userId, documentId: pendingDocId, stage: 'review_required', stageProgress: 100, pagesTotal: 1, pagesDone: 1, meta: pending.parsed.meta }).returning({ id: processingJobs.id });
  await db.insert(extractionCandidates).values(pending.parsed.candidates.map((c, i) => ({
    jobId: job!.id, userId, position: i, biomarkerId: c.biomarkerId, originalName: c.originalName, rawLine: c.rawLine, valueText: c.valueText,
    valueNumeric: c.valueNumeric, valueComparator: c.valueComparator, unit: c.unit, rangeLow: c.referenceRange?.low ?? null, rangeHigh: c.referenceRange?.high ?? null,
    rangeText: c.referenceRange?.text ?? null, labCode: c.labCode, labComment: c.labComment, page: c.page, confidence: c.confidence, issues: c.issues,
  })));
  await db.insert(notifications).values([
    { userId, kind: 'review_ready', title: 'Резултатът е готов за потвърждение', body: `Открихме ${pending.parsed.candidates.length} показателя.`, link: `/app/review/${job!.id}` },
    { userId, kind: 'report_added', title: 'Изследването е добавено към твоята здравна история.', link: null, readAt: now },
  ]);
}
