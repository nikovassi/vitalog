/**
 * LOCAL MODE backend. Implements the same REST routes as apps/api, backed by IndexedDB in
 * the user's browser. Used by the GitHub Pages build (VITE_LOCAL_MODE=true): uploads are
 * processed on the device and nothing is transmitted anywhere.
 *
 * Shared logic (statuses, trends, conversions, summaries, FHIR) comes from @vitalog/shared,
 * so results are identical to the server version.
 */
import {
  BIOMARKERS, buildFhirBundle, buildSummary, CATEGORY_LABELS, computeChange, confirmReviewSchema, CONSENT_VERSION,
  DEMO_EVENTS, DEMO_SPECIALISTS, deriveResultFields, getBiomarker, manualResultSchema, normalizeAliasKey, noteSchema,
  profileUpdateSchema, rangeOf, reportUpdateSchema, resultEditSchema, resultKey, specialistSchema, STATUS_LABELS,
  timelineEventSchema, toDisplayUnit, toLabResult, toSeriesPoint,
  type BiomarkerSummary, type CompareRow, type DashboardResponse, type Document, type ExtractionCandidate, type LabReport,
  type MeResponse, type ResultRecord, type Specialist,
} from '@vitalog/shared';
import { ProcessingError } from '@vitalog/parser';
import { CLOUD_AVAILABLE } from '../cloud/sync';
import { getStorageMode, setRecoveryCode, setStorageMode } from '../cloud/notice';
import {
  deleteFile, getFile, isCloud, loadState, nowIso, putFile, saveState, setRemote, uid, wipeAll,
  type LocalCandidate, type LocalDocument, type LocalJob, type LocalReport, type LocalSpecialist, type LocalState,
} from './store';
import { MAX_UPLOAD_MB, processInBrowser, sha256Hex } from './processing';

export class LocalError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}
const notFound = (what = 'Ресурсът') => new LocalError(404, 'not_found', `${what} не е намерен.`);
const bad = (msg: string, code = 'bad_request') => new LocalError(400, code, msg);
const serverOnly = (what: string) => new LocalError(403, 'server_only', `${what} е налично само в сървърната версия. В тази версия данните не напускат браузъра ти.`);

const BASE = import.meta.env.BASE_URL;

// ── Mappers (same shapes as the API) ─────────────────────────────
function labName(s: LocalState, reportId: string | null) {
  const rep = reportId ? s.reports.find((r) => r.id === reportId) : null;
  return rep?.laboratoryId ? s.labs.find((l) => l.id === rep.laboratoryId)?.name ?? null : null;
}
const toDoc = (d: LocalDocument): Document => ({ id: d.id, name: d.name, category: d.category, documentDate: d.documentDate, mimeType: d.mimeType, sizeBytes: d.sizeBytes, pageCount: d.pageCount, source: d.source === 'demo' ? 'demo' : 'upload', uploadedAt: d.uploadedAt, reportId: null });
const toSpec = (x: LocalSpecialist): Specialist => ({ id: x.id, name: x.name, specialty: x.specialty, phone: x.phone, email: x.email, address: x.address, clinic: x.clinic, website: x.website, note: x.note, photoDocumentId: null, hasPhoto: !!x.photoFileId, lastVisitAt: x.lastVisitAt, nextVisitAt: x.nextVisitAt, createdAt: x.createdAt });
const toJob = (j: LocalJob) => ({ id: j.id, documentId: j.documentId, stage: j.stage, stageProgress: j.stageProgress, pagesTotal: j.pagesTotal, pagesDone: j.pagesDone, usedOcr: j.usedOcr, errorCode: j.errorCode, createdAt: j.createdAt, updatedAt: j.updatedAt });

function reportSummary(s: LocalState, r: LocalReport): LabReport {
  const lab = r.laboratoryId ? s.labs.find((l) => l.id === r.laboratoryId) : null;
  const res = s.results.filter((x) => x.reportId === r.id);
  return {
    id: r.id, title: r.title, reportType: r.reportType as LabReport['reportType'], collectedAt: r.collectedAt,
    laboratory: lab ? { ...lab } : null, documentId: r.documentId, specialistId: r.specialistId, patientNameOnDocument: r.patientNameOnDocument,
    labComment: r.labComment, resultCount: res.length, outOfRangeCount: res.filter((x) => x.status === 'above' || x.status === 'below').length, createdAt: r.createdAt,
  };
}
const reportsSorted = (s: LocalState) => [...s.reports].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt) || b.createdAt.localeCompare(a.createdAt));

const newestFirst = (a: ResultRecord, b: ResultRecord) => b.collectedAt.localeCompare(a.collectedAt) || b.createdAt.localeCompare(a.createdAt);

function summaries(s: LocalState, opts: { keys?: string[]; from?: string | null; to?: string | null } = {}): BiomarkerSummary[] {
  const groups = new Map<string, ResultRecord[]>();
  for (const r of s.results) {
    if (opts.from && r.collectedAt < opts.from) continue;
    if (opts.to && r.collectedAt > opts.to) continue;
    const k = resultKey(r);
    if (opts.keys && !opts.keys.includes(k)) continue;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  return [...groups.entries()].map(([k, rows]) => {
    rows.sort(newestFirst);
    return buildSummary(k, rows.slice(0, 12).map((r) => ({ ...r, labName: labName(s, r.reportId) })), rows.length, s.favorites.includes(k));
  });
}

function series(s: LocalState, key: string) {
  return s.results.filter((r) => resultKey(r) === key).sort((a, b) => -newestFirst(a, b)).map((r) => toSeriesPoint({ ...r, labName: labName(s, r.reportId) }));
}

function filterBiomarkers(list: BiomarkerSummary[], q: URLSearchParams) {
  const search = q.get('search');
  if (search) {
    const needle = search.toLowerCase();
    const key = normalizeAliasKey(search);
    list = list.filter((x) => {
      const bm = getBiomarker(x.id);
      return [x.name, ...(bm ? [bm.canonicalName, ...bm.aliases] : [])].some((n) => n.toLowerCase().includes(needle) || (key.length >= 2 && normalizeAliasKey(n).includes(key)));
    });
  }
  if (q.get('category')) list = list.filter((x) => x.category === q.get('category'));
  const status = q.get('status') ?? 'all';
  if (status === 'out_of_range') list = list.filter((x) => x.latest?.status === 'above' || x.latest?.status === 'below');
  else if (status !== 'all') list = list.filter((x) => x.latest?.status === status);
  if (q.get('favorites')) list = list.filter((x) => x.favorite);
  const by: Record<string, (a: BiomarkerSummary, b: BiomarkerSummary) => number> = {
    newest: (a, b) => (b.latest?.date ?? '').localeCompare(a.latest?.date ?? ''),
    oldest: (a, b) => (a.latest?.date ?? '').localeCompare(b.latest?.date ?? ''),
    name: (a, b) => a.name.localeCompare(b.name, 'bg'),
    latest_value: (a, b) => (b.latest?.displayValue ?? -Infinity) - (a.latest?.displayValue ?? -Infinity),
    most_measured: (a, b) => b.count - a.count,
  };
  return list.sort((a, b) => (by[q.get('sort') ?? 'newest'] ?? by.newest!)(a, b) || a.name.localeCompare(b.name, 'bg'));
}

let cloudEmail: string | null = null;
const cloud = () => import('../cloud/sync');

function me(s: LocalState): MeResponse {
  const p = s.profile!;
  return {
    csrfToken: 'local',
    mfaPending: false,
    user: { id: 'local', email: isCloud() && cloudEmail ? cloudEmail : 'Само в този браузър', emailVerified: true, role: 'user', mfaEnabled: false, createdAt: p.createdAt },
    profile: { userId: 'local', displayName: p.displayName, fullName: p.fullName, birthYear: p.birthYear, theme: p.theme, locale: 'bg', onboardingCompletedAt: p.onboardingCompletedAt, aiProcessingConsent: false, isDemo: p.isDemo },
  };
}

const log = (s: LocalState, action: string) => { s.activity.unshift({ action, at: nowIso() }); s.activity.length = Math.min(s.activity.length, 200); };
const notify = (s: LocalState, kind: string, title: string, body: string | null, link: string | null) => s.notifications.unshift({ id: uid(), kind, title, body, link, readAt: null, createdAt: nowIso() });

// ── Upload + processing ──────────────────────────────────────────
async function storePdf(s: LocalState, file: File, category: LocalDocument['category'], documentDate: string | null, source: 'upload' | 'demo' = 'upload') {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) throw new LocalError(413, 'file_too_large', `Файлът е твърде голям. Максимум ${MAX_UPLOAD_MB} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new LocalError(415, 'not_pdf', 'Файлът не е валиден PDF. Поддържат се само PDF документи.');
  const hash = await sha256Hex(bytes);
  const dup = s.documents.find((d) => d.sha256 === hash);
  if (dup) {
    const rep = s.reports.find((r) => r.documentId === dup.id);
    throw new LocalError(409, 'duplicate', 'Този файл вече е качен.', { documentId: dup.id, reportId: rep?.id ?? null });
  }
  const doc: LocalDocument = { id: uid(), name: file.name.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '').slice(0, 120) || 'document.pdf', category, documentDate, mimeType: 'application/pdf', sizeBytes: bytes.length, pageCount: null, sha256: hash, source, uploadedAt: nowIso() };
  await putFile(doc.id, bytes);
  s.documents.unshift(doc);
  return { doc, bytes };
}

async function runJob(jobId: string, bytes: Uint8Array) {
  const s = await loadState();
  const job = s.jobs.find((j) => j.id === jobId);
  if (!job) return;
  try {
    const result = await processInBrowser(bytes, (p) => {
      Object.assign(job, { stage: p.stage, stageProgress: p.stageProgress, updatedAt: nowIso() }, p.pagesTotal !== undefined ? { pagesTotal: p.pagesTotal, pagesDone: p.pagesDone ?? null } : {});
      if (p.stage === 'ocr') job.usedOcr = true;
    });
    s.candidates = s.candidates.filter((c) => c.jobId !== jobId);
    result.candidates.forEach((c, i) => s.candidates.push({
      id: uid(), jobId, position: i, biomarkerId: c.biomarkerId, originalName: c.originalName, rawLine: c.rawLine, valueText: c.valueText,
      valueNumeric: c.valueNumeric, valueComparator: c.valueComparator, unit: c.unit, rangeLow: c.referenceRange?.low ?? null, rangeHigh: c.referenceRange?.high ?? null,
      rangeText: c.referenceRange?.text ?? null, labCode: c.labCode, labComment: c.labComment, page: c.page, confidence: c.confidence, issues: c.issues, decision: 'pending',
    }));
    const doc = s.documents.find((d) => d.id === job.documentId);
    if (doc) doc.pageCount = result.pageCount;
    Object.assign(job, { stage: 'review_required', stageProgress: 100, meta: result.meta, usedOcr: result.usedOcr, updatedAt: nowIso() });
    notify(s, 'review_ready', 'Резултатът е готов за потвърждение', `Открихме ${result.candidates.length} показателя в „${doc?.name ?? 'документа'}“.`, `/app/review/${jobId}`);
  } catch (err) {
    const code = err instanceof ProcessingError ? err.code : 'internal';
    if (!(err instanceof ProcessingError)) console.error('local processing failed', err);
    Object.assign(job, { stage: 'failed', errorCode: code, updatedAt: nowIso() });
    notify(s, 'processing_failed', 'Документът не беше обработен', null, `/app/upload?job=${jobId}`);
  }
  await saveState(s);
}

function confirmJob(s: LocalState, job: LocalJob, body: unknown, now = nowIso()) {
  const input = confirmReviewSchema.parse(body);
  const cands = s.candidates.filter((c) => c.jobId === job.id);
  const byId = new Map(cands.map((c) => [c.id, c]));
  for (const d of input.candidates) if (!byId.has(d.id)) throw bad('Невалиден резултат в заявката.');
  const accepted = input.candidates.filter((d) => d.decision === 'accepted');
  if (!accepted.length) throw bad('Потвърди поне един резултат или откажи документа.', 'nothing_accepted');
  for (const d of accepted) if (/\?/.test(d.valueText)) throw bad(`„${d.originalName}“: стойността не е разчетена. Поправи я или я изключи.`, 'unreadable_value');
  if (input.meta.specialistId && !s.specialists.some((x) => x.id === input.meta.specialistId)) throw notFound('Специалистът');
  const meta = job.meta!;
  let laboratoryId: string | null = null;
  if (input.meta.laboratoryName) {
    let lab = s.labs.find((l) => l.name === input.meta.laboratoryName);
    if (!lab) {
      const fromDoc = meta.laboratoryName === input.meta.laboratoryName;
      lab = { id: uid(), name: input.meta.laboratoryName, address: fromDoc ? meta.laboratoryAddress : null, phone: fromDoc ? meta.laboratoryPhone : null, website: fromDoc ? meta.laboratoryWebsite : null, sourceDocumentId: fromDoc ? job.documentId : null };
      s.labs.push(lab);
    }
    laboratoryId = lab.id;
  }
  const rep: LocalReport = { id: uid(), title: input.meta.title, reportType: input.meta.reportType, collectedAt: input.meta.collectedAt, laboratoryId, documentId: job.documentId, specialistId: input.meta.specialistId, patientNameOnDocument: meta.patientName, labComment: meta.labComment, createdAt: now };
  s.reports.push(rep);
  const sameRange = (c: LocalCandidate, r: { low: number | null; high: number | null } | null) => (c.rangeLow ?? null) === (r?.low ?? null) && (c.rangeHigh ?? null) === (r?.high ?? null);
  const fmt = (l: number | null, h: number | null) => (l === null && h === null ? null : `${l ?? ''}–${h ?? ''}`);
  for (const d of accepted) {
    const c = byId.get(d.id)!;
    const fields = deriveResultFields({ biomarkerId: d.biomarkerId, originalName: d.originalName, valueText: d.valueText, unit: d.unit, referenceRange: d.referenceRange, rangeSource: sameRange(c, d.referenceRange) ? 'laboratory' : 'user' });
    const edits: Array<[string, string | null, string | null]> = [];
    if (c.valueText !== d.valueText) edits.push(['value', c.valueText, d.valueText]);
    if ((c.unit ?? null) !== (d.unit ?? null)) edits.push(['unit', c.unit, d.unit]);
    if (!sameRange(c, d.referenceRange)) edits.push(['range', fmt(c.rangeLow, c.rangeHigh), d.referenceRange ? fmt(d.referenceRange.low, d.referenceRange.high) : null]);
    if ((c.biomarkerId ?? null) !== (d.biomarkerId ?? null)) edits.push(['biomarker', c.biomarkerId, d.biomarkerId]);
    const id = uid();
    s.results.push({ ...fields, id, reportId: rep.id, collectedAt: input.meta.collectedAt, labCode: c.labCode, labComment: c.labComment, source: 'pdf', sourceDocumentId: job.documentId, sourcePage: c.page, extractedAt: job.updatedAt, edited: edits.length > 0, confirmedAt: now, createdAt: now, updatedAt: now });
    for (const [field, o, n] of edits) s.edits.push({ id: uid(), resultId: id, field, originalValue: o, newValue: n, context: 'review', editedAt: now });
  }
  for (const d of input.candidates) byId.get(d.id)!.decision = d.decision;
  Object.assign(job, { stage: 'completed', reportId: rep.id, updatedAt: now });
  const doc = s.documents.find((x) => x.id === job.documentId);
  if (doc) doc.documentDate = input.meta.collectedAt;
  s.events.push({ id: uid(), kind: 'lab_report', title: input.meta.title, date: input.meta.collectedAt, description: null, refId: rep.id, showOnCharts: false });
  notify(s, 'report_added', 'Изследването е добавено към твоята здравна история.', null, `/app/reports/${rep.id}`);
  log(s, 'report.confirm');
  return { reportId: rep.id, saved: accepted.length };
}

// ── Demo seeding: the real pipeline on synthetic PDFs, in the browser ──
const DEMO_REPORTS = [
  { file: 'demo-2025-01-15-alpha.pdf', title: 'Кръвни изследвания', type: 'blood', spec: null },
  { file: 'demo-2025-06-15-alpha.pdf', title: 'Кръвни изследвания', type: 'blood', spec: null },
  { file: 'demo-2025-10-10-beta.pdf', title: 'Кръвни изследвания', type: 'blood', spec: 0 },
  { file: 'demo-2026-02-01-gamma.pdf', title: 'Хормонални изследвания', type: 'hormones', spec: 0 },
  { file: 'demo-2026-09-12-alpha.pdf', title: 'Кръвни изследвания', type: 'blood', spec: 1 },
];

async function fetchDemo(file: string) {
  const res = await fetch(`${BASE}demo/${file}`);
  if (!res.ok) throw new LocalError(500, 'demo_missing', 'Демо файловете не са налични.');
  return new File([await res.blob()], file, { type: 'application/pdf' });
}

async function seedDemo(s: LocalState) {
  const now = nowIso();
  s.profile = { displayName: 'Николай', fullName: 'Николай Тестов (синтетичен пациент)', birthYear: null, theme: s.profile?.theme ?? 'system', onboardingCompletedAt: now, isDemo: true, createdAt: now };
  s.active = true;
  const specIds = DEMO_SPECIALISTS.map((x) => {
    const id = uid();
    s.specialists.push({ id, name: x.name, specialty: x.specialty, phone: x.phone, email: x.email, address: x.address, clinic: x.clinic, website: x.website, note: x.note, photoFileId: null, lastVisitAt: x.lastVisitAt, nextVisitAt: x.nextVisitAt, createdAt: now, updatedAt: now });
    return id;
  });
  for (const d of DEMO_REPORTS) {
    const { doc, bytes } = await storePdf(s, await fetchDemo(d.file), 'lab_results', null, 'demo');
    doc.name = `Резултати ${d.file.slice(5, 15).split('-').reverse().join('.')}.pdf`;
    const result = await processInBrowser(bytes, () => {});
    const job: LocalJob = { id: uid(), documentId: doc.id, stage: 'review_required', stageProgress: 100, pagesTotal: result.pageCount, pagesDone: result.pageCount, usedOcr: false, errorCode: null, meta: result.meta, reportId: null, createdAt: now, updatedAt: now };
    s.jobs.push(job);
    const cands = result.candidates.map((c, i): LocalCandidate => ({ id: uid(), jobId: job.id, position: i, biomarkerId: c.biomarkerId, originalName: c.originalName, rawLine: c.rawLine, valueText: c.valueText, valueNumeric: c.valueNumeric, valueComparator: c.valueComparator, unit: c.unit, rangeLow: c.referenceRange?.low ?? null, rangeHigh: c.referenceRange?.high ?? null, rangeText: c.referenceRange?.text ?? null, labCode: c.labCode, labComment: c.labComment, page: c.page, confidence: c.confidence, issues: c.issues, decision: 'pending' }));
    s.candidates.push(...cands);
    confirmJob(s, job, {
      meta: { collectedAt: result.meta.collectedAt, title: d.title, reportType: d.type, laboratoryName: result.meta.laboratoryName, specialistId: d.spec === null ? null : specIds[d.spec]! },
      candidates: cands.map((c) => ({ id: c.id, decision: 'accepted', biomarkerId: c.biomarkerId, originalName: c.originalName, valueText: c.valueText, unit: c.unit, referenceRange: c.rangeLow === null && c.rangeHigh === null ? null : { low: c.rangeLow, high: c.rangeHigh } })),
    }, now);
  }
  for (const e of [{ file: 'demo-outpatient-2025-09-05.pdf', name: 'Амбулаторен лист – ендокринолог (демо).pdf', category: 'outpatient_sheet' as const, date: '2025-09-05' }, { file: 'demo-discharge-2024-11-20.pdf', name: 'Епикриза (демо).pdf', category: 'discharge_summary' as const, date: '2024-11-20' }]) {
    const { doc } = await storePdf(s, await fetchDemo(e.file), e.category, e.date, 'demo');
    doc.name = e.name;
  }
  for (const e of DEMO_EVENTS) s.events.push({ id: uid(), kind: e.kind, title: e.title, date: e.date, description: e.description, refId: null, showOnCharts: true });
  s.favorites = ['glucose', 'hba1c', 'ldl', 'hdl', 'uric_acid'];
  s.notes.push({ id: uid(), targetType: 'biomarker', targetId: 'uric_acid', body: 'Започнах нов режим на хранене от март 2025. (демо бележка)', createdAt: now });
  // one upload still waiting for review
  const { doc, bytes } = await storePdf(s, await fetchDemo('demo-pending-2026-10-01-alpha.pdf'), 'lab_results', null, 'demo');
  doc.name = 'Резултати 01.10.2026.pdf';
  const job: LocalJob = { id: uid(), documentId: doc.id, stage: 'queued', stageProgress: 0, pagesTotal: null, pagesDone: null, usedOcr: false, errorCode: null, meta: null, reportId: null, createdAt: now, updatedAt: now };
  s.jobs.push(job);
  s.notifications = s.notifications.filter((n) => n.kind !== 'report_added');
  await saveState(s);
  await runJob(job.id, bytes);
}

// ── Router ───────────────────────────────────────────────────────
type Handler = (ctx: { s: LocalState; p: string[]; q: URLSearchParams; body: unknown }) => unknown | Promise<unknown>;
const routes: Array<[string, RegExp, Handler]> = [];
const route = (method: string, pattern: string, h: Handler) => routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`), h]);
const requireProfile = (s: LocalState) => { if (!s.profile || !s.active) throw new LocalError(401, 'unauthorized', 'Не си влязъл.'); };

route('GET', '/api/auth/me', ({ s }) => { requireProfile(s); return me(s); });
route('POST', '/api/auth/demo', async ({ s }) => {
  if (isCloud()) throw bad('Излез от облачния профил, за да отвориш демото.', 'cloud_active');
  setStorageMode('device');
  if (s.profile?.isDemo && s.reports.length) { s.active = true; await saveState(s); return me(s); }
  if (s.profile && !s.profile.isDemo && s.reports.length) throw bad('В този браузър вече има твои данни. Изтрий ги от „Профил“, преди да отвориш демото.', 'has_data');
  await wipeAll();
  const fresh = await loadState();
  await seedDemo(fresh);
  return me(fresh);
});
/** Cloud account: sign in, attach the encrypted remote store, make sure a profile exists. */
async function attachCloud(session: { adapter: import('./store').RemoteAdapter; email: string; recoveryCode?: string }, displayName?: string) {
  setRemote(session.adapter);
  setStorageMode('cloud');
  cloudEmail = session.email;
  setRecoveryCode(session.recoveryCode);
  const st = await loadState();
  if (!st.profile) {
    const now = nowIso();
    st.profile = { displayName: displayName?.trim().slice(0, 80) || session.email.split('@')[0]!, fullName: null, birthYear: null, theme: 'system', onboardingCompletedAt: null, isDemo: false, createdAt: now };
    log(st, 'profile.create');
  }
  st.active = true;
  await saveState(st);
  return me(st);
}

route('POST', '/api/auth/register', async ({ s, body }) => {
  const b = body as { displayName?: string; email?: string; password?: string };
  if (b.email && b.password) {
    if (!CLOUD_AVAILABLE) throw serverOnly('Регистрацията с email');
    const c = await cloud();
    const r = await c.signUp(b.email.trim().toLowerCase(), b.password);
    if (r === 'confirm_email') throw new LocalError(400, 'confirm_email', `Изпратихме писмо за потвърждение на ${b.email}. Отвори линка в него и след това влез.`);
    return attachCloud(r, b.displayName);
  }
  setStorageMode('device');
  if (s.profile?.isDemo) { await wipeAll(); }
  const st = await loadState();
  const now = nowIso();
  st.profile = { displayName: (b.displayName ?? '').trim().slice(0, 80) || 'Ти', fullName: null, birthYear: null, theme: 'system', onboardingCompletedAt: null, isDemo: false, createdAt: now };
  st.active = true;
  log(st, 'profile.create');
  await saveState(st);
  return me(st);
});
route('POST', '/api/auth/login', async ({ s, body }) => {
  const b = (body ?? {}) as { email?: string; password?: string };
  if (b.email && b.password) {
    if (!CLOUD_AVAILABLE) throw serverOnly('Входът с email');
    const c = await cloud();
    try {
      return await attachCloud(await c.signIn(b.email.trim().toLowerCase(), b.password));
    } catch (e) {
      const err = e as { code?: string; message: string; status?: number };
      throw new LocalError(err.status ?? 400, err.code ?? 'error', err.message);
    }
  }
  if (!s.profile) throw new LocalError(401, 'invalid_credentials', 'В този браузър няма профил. Започни нов или отвори демото.');
  s.active = true;
  await saveState(s);
  return me(s);
});
route('POST', '/api/auth/logout', async ({ s }) => {
  if (isCloud()) {
    await (await cloud()).signOut();
    setRemote(null); // nothing from the cloud account stays on the device
    cloudEmail = null;
    return { ok: true };
  }
  s.active = false;
  await saveState(s);
  return { ok: true };
});
route('POST', '/api/auth/recover', async ({ body }) => {
  const c = await cloud();
  try {
    return await attachCloud(await c.recover(String((body as { code?: string }).code ?? '')));
  } catch (e) {
    const err = e as { code?: string; message: string; status?: number };
    throw new LocalError(err.status ?? 400, err.code ?? 'error', err.message);
  }
});
route('POST', '/api/auth/forgot', async ({ body }) => {
  if (!CLOUD_AVAILABLE) throw serverOnly('Възстановяването на парола');
  await (await cloud()).requestPasswordReset(String((body as { email?: string }).email ?? ''));
  return { ok: true, message: 'Ако има профил с този email, изпратихме линк за смяна на паролата.' };
});
route('POST', '/api/auth/reset', async ({ body }) => {
  const c = await cloud();
  try {
    await c.setNewPassword(String((body as { password?: string }).password ?? ''));
  } catch (e) { throw new LocalError(400, 'reset', (e as Error).message); }
  return { ok: true };
});
route('POST', '/api/auth/change-password', async ({ body }) => {
  if (!isCloud()) throw serverOnly('Смяната на парола');
  const b = body as { currentPassword: string; newPassword: string };
  try {
    setRecoveryCode(await (await cloud()).changePassword(b.currentPassword, b.newPassword));
  } catch (e) {
    const err = e as { code?: string; message: string };
    throw new LocalError(400, err.code ?? 'error', err.message);
  }
  return { ok: true };
});
route('GET', '/api/auth/sessions', () => [{ id: 'local', userAgent: navigator.userAgent, ipPrefix: 'само това устройство', createdAt: nowIso(), lastSeenAt: nowIso(), current: true }]);
route('GET', '/api/auth/consent-texts', () => ({ version: CONSENT_VERSION }));

route('PATCH', '/api/profile', async ({ s, body }) => {
  requireProfile(s);
  const b = profileUpdateSchema.parse(body);
  const p = s.profile!;
  if (b.displayName !== undefined) p.displayName = b.displayName;
  if (b.fullName !== undefined) p.fullName = b.fullName;
  if (b.birthYear !== undefined) p.birthYear = b.birthYear;
  if (b.theme !== undefined) p.theme = b.theme;
  if (b.onboardingCompleted) p.onboardingCompletedAt = nowIso();
  if (b.aiProcessingConsent) throw serverOnly('AI обработката');
  await saveState(s);
  return me(s);
});
route('GET', '/api/account/privacy', ({ s }) => ({ aiAvailable: false, local: true, consents: [], usage: { period: '', documentsProcessed: s.documents.length, documentsLimit: Infinity, aiCalls: 0 }, retention: { auditDays: 0 } }));
route('GET', '/api/account/activity', ({ s }) => s.activity.slice(0, 100).map((a) => ({ ...a, ipPrefix: null, userAgent: null, byOwner: true })));
route('POST', '/api/account/delete', async () => {
  if (isCloud()) {
    await (await cloud()).deleteAccount();
    setRemote(null);
    cloudEmail = null;
    return { ok: true };
  }
  await wipeAll();
  return { ok: true };
});

route('GET', '/api/dashboard', ({ s }): DashboardResponse => {
  requireProfile(s);
  const all = summaries(s);
  const yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const reps = reportsSorted(s);
  const favs = all.filter((x) => x.favorite);
  const byRecency = [...all].sort((a, b) => (b.latest?.date ?? '').localeCompare(a.latest?.date ?? '') || b.count - a.count);
  const cat = new Map<string, { total: number; outOfRange: number }>();
  for (const x of all) {
    const c = cat.get(x.category) ?? { total: 0, outOfRange: 0 };
    c.total++;
    if (x.latest?.status === 'above' || x.latest?.status === 'below') c.outOfRange++;
    cat.set(x.category, c);
  }
  const last12 = reps.filter((r) => r.collectedAt >= yearAgo).length;
  const facts: string[] = [];
  if (reps.length) {
    facts.push(`През последните 12 месеца имаш ${last12} ${last12 === 1 ? 'лабораторно изследване' : 'лабораторни изследвания'} и ${all.length} проследявани показателя.`);
    const most = [...all].sort((a, b) => b.count - a.count)[0];
    if (most && most.count > 1) {
      facts.push(`Показателят „${most.name}“ е измерван ${most.count} пъти.`);
      if (most.latest) facts.push(`Последната стойност на ${most.name} е ${most.latest.valueText}${most.latest.unit ? ` ${most.latest.unit}` : ''}.`);
    }
  }
  const docs = [...s.documents].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return {
    displayName: s.profile!.displayName,
    stats: { reports: reps.length, results: s.results.length, biomarkers: all.length, lastReportAt: reps[0]?.collectedAt ?? null, reportsLast12m: last12 },
    pendingReviews: s.jobs.filter((j) => j.stage !== 'completed').slice(-5).reverse().map(toJob),
    latestReport: reps[0] ? reportSummary(s, reps[0]) : null,
    latestDocument: docs[0] ? toDoc(docs[0]) : null,
    overview: [...favs, ...[...all].sort((a, b) => b.count - a.count).filter((x) => !x.favorite)].slice(0, 6),
    outOfRange: byRecency.filter((x) => x.latest && (x.latest.status === 'above' || x.latest.status === 'below')).slice(0, 6),
    changed: all.filter((x) => x.change && x.change.direction !== 'stable').sort((a, b) => Math.abs(b.change!.percent ?? 0) - Math.abs(a.change!.percent ?? 0)).slice(0, 6),
    favorites: favs,
    recentReports: reps.slice(0, 4).map((r) => reportSummary(s, r)),
    recentDocuments: docs.slice(0, 4).map(toDoc),
    specialists: s.specialists.slice(0, 4).map(toSpec),
    categories: [...cat.entries()].map(([category, v]) => ({ category: category as BiomarkerSummary['category'], ...v })),
    summaryFacts: facts,
  };
});

route('GET', '/api/biomarkers', ({ s, q }) => filterBiomarkers(summaries(s), q));
route('GET', '/api/biomarkers/:key', ({ s, p }) => {
  const key = decodeURIComponent(p[0]!);
  const ser = series(s, key);
  if (!ser.length) throw notFound('Показателят');
  const rows = s.results.filter((r) => resultKey(r) === key).sort(newestFirst);
  return {
    summary: buildSummary(key, rows.slice(0, 12).map((r) => ({ ...r, labName: labName(s, r.reportId) })), rows.length, s.favorites.includes(key)),
    biomarker: getBiomarker(key) ?? null,
    series: ser,
    events: s.events.filter((e) => e.showOnCharts).sort((a, b) => a.date.localeCompare(b.date)),
    notes: s.notes.filter((n) => n.targetType === 'biomarker' && n.targetId === key),
  };
});
route('PUT', '/api/biomarkers/:key/favorite', async ({ s, p }) => { const k = decodeURIComponent(p[0]!); if (!s.favorites.includes(k)) s.favorites.push(k); await saveState(s); return { favorite: true }; });
route('DELETE', '/api/biomarkers/:key/favorite', async ({ s, p }) => { const k = decodeURIComponent(p[0]!); s.favorites = s.favorites.filter((x) => x !== k); await saveState(s); return { favorite: false }; });
route('GET', '/api/catalog', () => BIOMARKERS.map((b) => ({ id: b.id, name: b.bgName, canonicalName: b.canonicalName, unit: b.unit, supportedUnits: b.supportedUnits, category: b.category, categoryLabel: CATEGORY_LABELS[b.category] })));

route('GET', '/api/reports', ({ s, q }) => {
  let items = reportsSorted(s).map((r) => reportSummary(s, r));
  const search = q.get('search')?.toLowerCase();
  if (search) items = items.filter((r) => r.title.toLowerCase().includes(search) || r.laboratory?.name.toLowerCase().includes(search) || s.results.some((x) => x.reportId === r.id && x.originalName.toLowerCase().includes(search)));
  if (q.get('laboratoryId')) items = items.filter((r) => r.laboratory?.id === q.get('laboratoryId'));
  if (q.get('from')) items = items.filter((r) => r.collectedAt >= q.get('from')!);
  if (q.get('to')) items = items.filter((r) => r.collectedAt <= q.get('to')!);
  if (q.get('sort') === 'oldest') items.reverse();
  return { items, total: items.length, page: 1, pageSize: items.length || 20, laboratories: s.labs.map((l) => ({ id: l.id, name: l.name })) };
});
route('GET', '/api/reports/compare', ({ s, q }) => {
  const ra = s.reports.find((r) => r.id === q.get('a'));
  const rb = s.reports.find((r) => r.id === q.get('b'));
  if (!ra || !rb) throw notFound('Изследването');
  const results = s.results.filter((r) => r.reportId === ra.id || r.reportId === rb.id);
  const keys = [...new Set(results.map(resultKey))];
  const rows: CompareRow[] = keys.map((k) => {
    const x = results.find((r) => r.reportId === ra.id && resultKey(r) === k);
    const y = results.find((r) => r.reportId === rb.id && resultKey(r) === k);
    const bm = getBiomarker(k);
    const conv = (r?: ResultRecord) => (r && r.valueComparator === null ? (bm ? toDisplayUnit(bm, r.valueNumeric, r.unit)?.value ?? null : r.valueNumeric) : null);
    const cx = conv(x), cy = conv(y);
    const comparable = cx !== null && cy !== null && (!!bm || x!.unit === y!.unit);
    const cell = (r?: ResultRecord) => (r ? { valueText: r.valueText, value: r.valueNumeric, unit: r.unit, status: r.status } : null);
    return { biomarkerId: k, name: bm?.bgName ?? (x ?? y)!.originalName, a: cell(x), b: cell(y), change: comparable ? computeChange(cy!, cx!) : null, comparable };
  });
  rows.sort((p, r) => Number(!!r.a && !!r.b) - Number(!!p.a && !!p.b) || p.name.localeCompare(r.name, 'bg'));
  return { a: reportSummary(s, ra), b: reportSummary(s, rb), rows };
});
route('GET', '/api/reports/:id', ({ s, p }) => {
  const rep = s.reports.find((r) => r.id === p[0]);
  if (!rep) throw notFound('Изследването');
  const rows = s.results.filter((r) => r.reportId === rep.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((r) => {
    const prev = s.results.filter((x) => resultKey(x) === resultKey(r) && x.collectedAt < rep.collectedAt).sort(newestFirst)[0];
    const bm = getBiomarker(r.biomarkerId);
    const cur = bm ? toDisplayUnit(bm, r.valueNumeric, r.unit)?.value : r.valueNumeric;
    const old = prev ? (bm ? toDisplayUnit(bm, prev.valueNumeric, prev.unit)?.value : prev.unit === r.unit ? prev.valueNumeric : null) : null;
    const change = cur != null && old != null && r.valueComparator === null && prev!.valueComparator === null ? computeChange(cur, old) : null;
    return { ...toLabResult(r), biomarkerName: bm?.bgName ?? r.originalName, previous: prev ? { date: prev.collectedAt, valueText: prev.valueText, value: prev.valueNumeric, unit: prev.unit } : null, change };
  });
  const doc = rep.documentId ? s.documents.find((d) => d.id === rep.documentId) : null;
  const spec = rep.specialistId ? s.specialists.find((x) => x.id === rep.specialistId) : null;
  return { report: reportSummary(s, rep), results: rows, document: doc ? toDoc(doc) : null, specialist: spec ? toSpec(spec) : null, notes: s.notes.filter((n) => n.targetType === 'report' && n.targetId === rep.id) };
});
route('PATCH', '/api/reports/:id', async ({ s, p, body }) => {
  const b = reportUpdateSchema.parse(body);
  const rep = s.reports.find((r) => r.id === p[0]);
  if (!rep) throw notFound('Изследването');
  if (b.specialistId && !s.specialists.some((x) => x.id === b.specialistId)) throw notFound('Специалистът');
  Object.assign(rep, b);
  if (b.collectedAt) s.results.filter((r) => r.reportId === rep.id).forEach((r) => (r.collectedAt = b.collectedAt!));
  await saveState(s);
  return { ok: true };
});
route('DELETE', '/api/reports/:id', async ({ s, p }) => {
  if (!s.reports.some((r) => r.id === p[0])) throw notFound('Изследването');
  const ids = new Set(s.results.filter((r) => r.reportId === p[0]).map((r) => r.id));
  s.reports = s.reports.filter((r) => r.id !== p[0]);
  s.results = s.results.filter((r) => !ids.has(r.id));
  s.edits = s.edits.filter((e) => !ids.has(e.resultId));
  s.events = s.events.filter((e) => e.refId !== p[0]);
  log(s, 'report.delete');
  await saveState(s);
  return { ok: true };
});

route('POST', '/api/results', async ({ s, body }) => {
  const b = manualResultSchema.parse(body);
  const now = nowIso();
  const r: ResultRecord = { ...deriveResultFields({ ...b, rangeSource: 'user' }), id: uid(), reportId: b.reportId ?? null, collectedAt: b.collectedAt, labCode: null, labComment: null, source: 'manual', sourceDocumentId: null, sourcePage: null, extractedAt: null, edited: false, confirmedAt: now, createdAt: now, updatedAt: now };
  s.results.push(r);
  if (b.note) s.notes.push({ id: uid(), targetType: 'biomarker', targetId: resultKey(r), body: b.note, createdAt: now });
  await saveState(s);
  return toLabResult(r);
});
route('PATCH', '/api/results/:id', async ({ s, p, body }) => {
  const b = resultEditSchema.parse(body);
  const cur = s.results.find((r) => r.id === p[0]);
  if (!cur) throw notFound('Резултатът');
  const next = deriveResultFields({
    biomarkerId: b.biomarkerId !== undefined ? b.biomarkerId : cur.biomarkerId, originalName: cur.originalName, valueText: b.valueText ?? cur.valueText,
    unit: b.unit !== undefined ? b.unit : cur.unit, referenceRange: b.referenceRange !== undefined ? b.referenceRange : rangeOf(cur),
    rangeSource: b.referenceRange !== undefined ? 'user' : (cur.rangeSource ?? 'laboratory'),
  });
  const changes: Array<[string, unknown, unknown]> = [['value', cur.valueText, next.valueText], ['unit', cur.unit, next.unit], ['range', `${cur.rangeLow ?? ''}–${cur.rangeHigh ?? ''}`, `${next.rangeLow ?? ''}–${next.rangeHigh ?? ''}`], ['biomarker', cur.biomarkerId, next.biomarkerId]];
  const now = nowIso();
  let changed = false;
  for (const [field, o, n] of changes) {
    if ((o ?? null) !== (n ?? null)) { changed = true; s.edits.push({ id: uid(), resultId: cur.id, field, originalValue: o === null || o === undefined ? null : String(o), newValue: n === null || n === undefined ? null : String(n), context: 'edit', editedAt: now }); }
  }
  if (changed) Object.assign(cur, next, b.collectedAt ? { collectedAt: b.collectedAt } : {}, { edited: true, updatedAt: now });
  await saveState(s);
  return toLabResult(cur);
});
route('DELETE', '/api/results/:id', async ({ s, p }) => {
  if (!s.results.some((r) => r.id === p[0])) throw notFound('Резултатът');
  s.results = s.results.filter((r) => r.id !== p[0]);
  await saveState(s);
  return { ok: true };
});
route('GET', '/api/results/:id/history', ({ s, p }) => {
  const r = s.results.find((x) => x.id === p[0]);
  if (!r) throw notFound('Резултатът');
  return { result: toLabResult(r), source: r.source, extractedAt: r.extractedAt, createdAt: r.createdAt, updatedAt: r.updatedAt, edits: s.edits.filter((e) => e.resultId === r.id).map((e) => ({ ...e, editedBy: 'Ти' })) };
});

route('GET', '/api/search', ({ s, q }) => {
  const needle = (q.get('q') ?? '').toLowerCase();
  const bms = filterBiomarkers(summaries(s), new URLSearchParams({ search: needle }));
  return {
    biomarkers: bms.slice(0, 10),
    reports: reportsSorted(s).map((r) => reportSummary(s, r)).filter((r) => r.title.toLowerCase().includes(needle) || r.laboratory?.name.toLowerCase().includes(needle) || s.results.some((x) => x.reportId === r.id && (x.originalName.toLowerCase().includes(needle) || bms.some((b) => b.id === resultKey(x))))).slice(0, 10),
    documents: s.documents.filter((d) => d.name.toLowerCase().includes(needle)).slice(0, 10).map(toDoc),
    specialists: s.specialists.filter((x) => `${x.name} ${x.specialty} ${x.clinic ?? ''}`.toLowerCase().includes(needle)).slice(0, 10).map(toSpec),
  };
});
route('GET', '/api/timeline', ({ s }) => ({
  items: [
    ...reportsSorted(s).map((r) => { const x = reportSummary(s, r); return { type: 'report', date: r.collectedAt, id: r.id, title: r.title, subtitle: x.laboratory?.name ?? null, meta: `${x.resultCount} показателя`, kind: 'lab_report' }; }),
    ...s.events.filter((e) => !e.refId).map((e) => ({ type: 'event', date: e.date, id: e.id, title: e.title, subtitle: e.description, meta: null, kind: e.kind })),
    ...s.documents.filter((d) => d.category !== 'lab_results' && d.documentDate).map((d) => ({ type: 'document', date: d.documentDate!, id: d.id, title: d.name, subtitle: null, meta: null, kind: d.category })),
  ].sort((a, b) => b.date.localeCompare(a.date)),
}));

// Jobs / uploads
route('GET', '/api/jobs', ({ s }) => s.jobs.filter((j) => j.stage !== 'completed').reverse().map((j) => ({ ...toJob(j), documentName: s.documents.find((d) => d.id === j.documentId)?.name ?? null })));
route('GET', '/api/jobs/:id', ({ s, p }) => { const j = s.jobs.find((x) => x.id === p[0]); if (!j) throw notFound('Обработката'); return { ...toJob(j), reportId: j.reportId }; });
route('GET', '/api/jobs/:id/review', ({ s, p }) => {
  const j = s.jobs.find((x) => x.id === p[0]);
  if (!j) throw notFound('Обработката');
  if (j.stage !== 'review_required') throw new LocalError(409, 'not_ready', 'Документът все още не е готов за преглед.');
  const doc = s.documents.find((d) => d.id === j.documentId)!;
  const meta = j.meta!;
  const fullName = s.profile?.fullName;
  const tokens = (x: string) => new Set(x.toLowerCase().split(/[\s,.]+/).filter((t) => t.length > 2));
  return {
    job: toJob(j), document: toDoc(doc), meta,
    candidates: s.candidates.filter((c) => c.jobId === j.id).sort((a, b) => a.position - b.position).map((c): ExtractionCandidate => ({
      id: c.id, jobId: c.jobId, biomarkerId: c.biomarkerId, originalName: c.originalName, rawLine: c.rawLine, valueText: c.valueText, valueNumeric: c.valueNumeric,
      valueComparator: c.valueComparator as ExtractionCandidate['valueComparator'], unit: c.unit,
      referenceRange: c.rangeLow !== null || c.rangeHigh !== null ? { low: c.rangeLow, high: c.rangeHigh, text: c.rangeText, source: 'laboratory' } : null,
      labCode: c.labCode, labComment: c.labComment, page: c.page, confidence: c.confidence, issues: c.issues, decision: c.decision,
    })),
    suspectedDuplicateReportId: meta.collectedAt ? s.reports.find((r) => r.collectedAt === meta.collectedAt)?.id ?? null : null,
    patientNameMismatch: !!(fullName && meta.patientName && ![...tokens(meta.patientName)].some((t) => tokens(fullName).has(t))),
  };
});
route('POST', '/api/jobs/:id/confirm', async ({ s, p, body }) => {
  const j = s.jobs.find((x) => x.id === p[0]);
  if (!j) throw notFound('Обработката');
  if (j.stage !== 'review_required') throw new LocalError(409, 'not_ready', 'Този документ вече е обработен.');
  const r = confirmJob(s, j, body);
  await saveState(s);
  return r;
});
route('POST', '/api/jobs/:id/discard', async ({ s, p }) => {
  const j = s.jobs.find((x) => x.id === p[0]);
  if (!j) throw notFound('Обработката');
  s.jobs = s.jobs.filter((x) => x.id !== j.id);
  s.candidates = s.candidates.filter((c) => c.jobId !== j.id);
  s.documents = s.documents.filter((d) => d.id !== j.documentId);
  await deleteFile(j.documentId);
  await saveState(s);
  return { ok: true };
});
route('POST', '/api/jobs/:id/retry', async ({ s, p }) => {
  const j = s.jobs.find((x) => x.id === p[0] && x.stage === 'failed');
  if (!j) throw notFound('Обработката');
  Object.assign(j, { stage: 'queued', stageProgress: 0, errorCode: null });
  const bytes = await getFile(j.documentId);
  void runJob(j.id, bytes!);
  return toJob(j);
});

// Documents
route('GET', '/api/documents', ({ s, q }) => {
  let items = [...s.documents].sort((a, b) => (b.documentDate ?? b.uploadedAt).localeCompare(a.documentDate ?? a.uploadedAt));
  if (q.get('category')) items = items.filter((d) => d.category === q.get('category'));
  if (q.get('search')) items = items.filter((d) => d.name.toLowerCase().includes(q.get('search')!.toLowerCase()));
  const counts = Object.entries(s.documents.reduce<Record<string, number>>((a, d) => ({ ...a, [d.category]: (a[d.category] ?? 0) + 1 }), {})).map(([category, n]) => ({ category, n }));
  return { items: items.map((d) => ({ ...toDoc(d), reportId: s.reports.find((r) => r.documentId === d.id)?.id ?? null })), total: items.length, page: 1, pageSize: items.length, counts };
});
route('PATCH', '/api/documents/:id', async ({ s, p, body }) => {
  const d = s.documents.find((x) => x.id === p[0]);
  if (!d) throw notFound('Документът');
  Object.assign(d, body as object);
  await saveState(s);
  return toDoc(d);
});
route('DELETE', '/api/documents/:id', async ({ s, p }) => {
  if (!s.documents.some((x) => x.id === p[0])) throw notFound('Документът');
  s.documents = s.documents.filter((x) => x.id !== p[0]);
  s.reports.filter((r) => r.documentId === p[0]).forEach((r) => (r.documentId = null));
  await deleteFile(p[0]!);
  await saveState(s);
  return { ok: true };
});
route('POST', '/api/documents/:id/url', async ({ s, p }) => {
  if (!s.documents.some((x) => x.id === p[0])) throw notFound('Документът');
  const bytes = await getFile(p[0]!);
  if (!bytes) throw notFound('Файлът');
  return { url: URL.createObjectURL(new Blob([bytes as unknown as ArrayBuffer], { type: 'application/pdf' })), expiresIn: 300 };
});

// Specialists, notes, events, appointments, notifications
route('GET', '/api/specialists', ({ s }) => s.specialists.map((x) => ({ ...toSpec(x), reportCount: s.reports.filter((r) => r.specialistId === x.id).length })).sort((a, b) => a.name.localeCompare(b.name, 'bg')));
route('GET', '/api/specialists/:id', ({ s, p }) => {
  const x = s.specialists.find((y) => y.id === p[0]);
  if (!x) throw notFound('Специалистът');
  return { specialist: toSpec(x), reports: reportsSorted(s).filter((r) => r.specialistId === x.id).map((r) => reportSummary(s, r)), notes: s.notes.filter((n) => n.targetType === 'specialist' && n.targetId === x.id), appointments: [] };
});
route('POST', '/api/specialists', async ({ s, body }) => {
  const b = specialistSchema.parse(body);
  const now = nowIso();
  const x: LocalSpecialist = { id: uid(), name: b.name, specialty: b.specialty, phone: b.phone ?? null, email: b.email ?? null, address: b.address ?? null, clinic: b.clinic ?? null, website: b.website ?? null, note: b.note ?? null, photoFileId: null, lastVisitAt: b.lastVisitAt ?? null, nextVisitAt: b.nextVisitAt ?? null, createdAt: now, updatedAt: now };
  s.specialists.push(x);
  await saveState(s);
  return toSpec(x);
});
route('PATCH', '/api/specialists/:id', async ({ s, p, body }) => {
  const x = s.specialists.find((y) => y.id === p[0]);
  if (!x) throw notFound('Специалистът');
  Object.assign(x, specialistSchema.partial().parse(body), { updatedAt: nowIso() });
  await saveState(s);
  return toSpec(x);
});
route('DELETE', '/api/specialists/:id', async ({ s, p }) => {
  const x = s.specialists.find((y) => y.id === p[0]);
  if (!x) throw notFound('Специалистът');
  s.specialists = s.specialists.filter((y) => y.id !== x.id);
  s.reports.filter((r) => r.specialistId === x.id).forEach((r) => (r.specialistId = null));
  if (x.photoFileId) await deleteFile(x.photoFileId);
  await saveState(s);
  return { ok: true };
});
route('GET', '/api/notes', ({ s, q }) => s.notes.filter((n) => (!q.get('targetType') || n.targetType === q.get('targetType')) && (!q.get('targetId') || n.targetId === q.get('targetId'))));
route('POST', '/api/notes', async ({ s, body }) => { const b = noteSchema.parse(body); const n = { id: uid(), ...b, createdAt: nowIso() }; s.notes.unshift(n); await saveState(s); return n; });
route('PATCH', '/api/notes/:id', async ({ s, p, body }) => { const n = s.notes.find((x) => x.id === p[0]); if (!n) throw notFound('Бележката'); n.body = String((body as { body: string }).body).slice(0, 4000); await saveState(s); return n; });
route('DELETE', '/api/notes/:id', async ({ s, p }) => { s.notes = s.notes.filter((x) => x.id !== p[0]); await saveState(s); return { ok: true }; });
route('GET', '/api/events', ({ s }) => s.events.filter((e) => !e.refId));
route('POST', '/api/events', async ({ s, body }) => { const b = timelineEventSchema.parse(body); const e = { id: uid(), ...b, description: b.description ?? null, refId: null }; s.events.push(e); await saveState(s); return e; });
route('DELETE', '/api/events/:id', async ({ s, p }) => { s.events = s.events.filter((x) => x.id !== p[0]); await saveState(s); return { ok: true }; });
route('GET', '/api/notifications', ({ s }) => ({ items: s.notifications.slice(0, 30), unread: s.notifications.filter((n) => !n.readAt).length }));
route('POST', '/api/notifications/read-all', async ({ s }) => { s.notifications.forEach((n) => (n.readAt ??= nowIso())); await saveState(s); return { ok: true }; });
route('POST', '/api/notifications/:id/read', async ({ s, p }) => { const n = s.notifications.find((x) => x.id === p[0]); if (n) n.readAt = nowIso(); await saveState(s); return { ok: true }; });
route('GET', '/api/shares', () => []);
route('POST', '/api/shares', () => { throw serverOnly('Споделянето с лекар чрез линк'); });
route('POST', '/api/auth/reauth', () => ({ ok: true }));

let resumed: Promise<void> | null = null;
/** On page load, reconnect a cloud session (Supabase session + key cached on this device). */
function resumeCloud(): Promise<void> {
  resumed ??= (async () => {
    if (!CLOUD_AVAILABLE || getStorageMode() !== 'cloud' || isCloud()) return;
    try {
      const sess = await (await cloud()).resumeSession();
      if (sess) {
        setRemote(sess.adapter);
        cloudEmail = sess.email;
      } else {
        setRemote(null);
        throw new LocalError(401, 'unauthorized', 'Влез отново.');
      }
    } catch (e) {
      if (e instanceof LocalError) throw e;
      throw new LocalError(503, 'network', 'Няма връзка с облака. Провери интернет връзката.');
    }
  })();
  const p = resumed;
  p.catch(() => { resumed = null; });
  return p;
}

export async function localRequest(method: string, rawUrl: string, body?: unknown): Promise<unknown> {
  const path = new URL(rawUrl, 'http://local').pathname;
  // auth routes work without a session; everything else needs the cloud store attached first
  if (!/^\/api\/auth\/(login|register|demo|recover|forgot|reset)$/.test(path)) {
    try { await resumeCloud(); } catch (e) {
      if (getStorageMode() === 'cloud') throw e;
    }
  }
  const s = await loadState();
  const url = new URL(rawUrl, 'http://local');
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = url.pathname.match(re);
    if (match) {
      try {
        return await h({ s, p: match.slice(1), q: url.searchParams, body });
      } catch (e) {
        if (e instanceof LocalError) throw e;
        if ((e as { name?: string }).name === 'ZodError') throw bad((e as { issues: Array<{ message: string }> }).issues[0]?.message ?? 'Невалидни данни.', 'validation');
        throw e;
      }
    }
  }
  throw new LocalError(404, 'not_found', 'Не е налично в тази версия.');
}

/** Multipart uploads (PDFs, specialist photos) in local mode. */
export async function localUpload(method: string, rawUrl: string, form: FormData, onProgress: (pct: number) => void): Promise<unknown> {
  const s = await loadState();
  requireProfile(s);
  const file = form.get('file');
  if (!(file instanceof File)) throw bad('Не е избран файл.', 'no_file');
  onProgress(100); // nothing is transferred: the file is read locally
  if (rawUrl === '/api/uploads') {
    const { doc, bytes } = await storePdf(s, file, 'lab_results', null);
    const job: LocalJob = { id: uid(), documentId: doc.id, stage: 'queued', stageProgress: 0, pagesTotal: null, pagesDone: null, usedOcr: false, errorCode: null, meta: null, reportId: null, createdAt: nowIso(), updatedAt: nowIso() };
    s.jobs.push(job);
    log(s, 'document.upload');
    await saveState(s);
    void runJob(job.id, bytes);
    return { jobId: job.id, documentId: doc.id };
  }
  if (rawUrl === '/api/documents') {
    const category = (form.get('category') as LocalDocument['category']) ?? 'other';
    const date = (form.get('documentDate') as string) || null;
    const { doc } = await storePdf(s, file, category, date);
    log(s, 'document.upload');
    await saveState(s);
    return toDoc(doc);
  }
  const photo = rawUrl.match(/^\/api\/specialists\/([^/]+)\/photo$/);
  if (photo && method === 'PUT') {
    const x = s.specialists.find((y) => y.id === photo[1]);
    if (!x) throw notFound('Специалистът');
    if (file.size > 2 * 1024 * 1024) throw new LocalError(413, 'file_too_large', 'Снимката е твърде голяма (макс. 2 MB).');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new LocalError(415, 'bad_type', 'Поддържат се само JPEG, PNG и WebP снимки.');
    if (x.photoFileId) await deleteFile(x.photoFileId);
    x.photoFileId = uid();
    await putFile(x.photoFileId, new Uint8Array(await file.arrayBuffer()));
    await saveState(s);
    return { ok: true };
  }
  throw new LocalError(404, 'not_found', 'Не е налично в тази версия.');
}

/** Blob URL for a specialist photo (local mode). */
export async function localPhotoUrl(id: string): Promise<string | null> {
  const s = await loadState();
  const x = s.specialists.find((y) => y.id === id);
  if (!x?.photoFileId) return null;
  const bytes = await getFile(x.photoFileId);
  return bytes ? URL.createObjectURL(new Blob([bytes as unknown as ArrayBuffer])) : null;
}

/** Client-side exports (CSV, JSON, FHIR). The PDF summary needs the server version. */
export async function localDownload(rawUrl: string): Promise<Blob> {
  const s = await loadState();
  const url = new URL(rawUrl, 'http://local');
  if (url.pathname === '/api/export/csv') {
    const keys = url.searchParams.get('biomarkers')?.split(',').filter(Boolean);
    const cell = (v: unknown) => {
      let x = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(x) && !/^-?\d+([.,]\d+)?$/.test(x)) x = `'${x}`;
      return /[",;\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
    };
    const lines = ['Дата;Показател;Име в документа;Стойност;Единица;Реф. минимум;Реф. максимум;Реф. текст;Статус;Лаборатория;Източник;Страница;Редактиран'];
    for (const r of [...s.results].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt))) {
      if (keys && !keys.includes(resultKey(r))) continue;
      lines.push([r.collectedAt, getBiomarker(r.biomarkerId)?.bgName ?? r.originalName, r.originalName, r.valueText, r.unit, r.rangeLow, r.rangeHigh, r.rangeText, STATUS_LABELS[r.status], labName(s, r.reportId), r.source, r.sourcePage, r.edited ? 'да' : 'не'].map(cell).join(';'));
    }
    return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  }
  if (url.pathname === '/api/export/json') {
    const { candidates: _c, jobs: _j, ...data } = s;
    return new Blob([JSON.stringify({ exportedAt: nowIso(), format: 'vitalog-export-v1', note: 'Експорт от локалната версия (данните са само в този браузър).', ...data }, null, 2)], { type: 'application/json' });
  }
  if (url.pathname === '/api/export/fhir') {
    const bundle = buildFhirBundle({
      user: { id: 'local', displayName: s.profile?.displayName ?? '', fullName: s.profile?.fullName ?? null, birthYear: s.profile?.birthYear ?? null },
      reports: s.reports, results: s.results, laboratories: s.labs,
      specialists: s.specialists, documents: s.documents,
    });
    return new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/fhir+json' });
  }
  throw serverOnly('PDF обобщението');
}

