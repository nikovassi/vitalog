/**
 * LOCAL MODE storage (GitHub Pages build). Everything lives in this browser's IndexedDB:
 * the structured data as one versioned JSON state, PDF/photo bytes as separate records.
 * Nothing is sent to any server.
 */
import type {
  CandidateIssue, DocumentCategory, ExtractedReportMeta, JobErrorCode, JobStage, NoteTarget, ResultRecord, ThemePreference,
} from '@vitalog/shared';

export interface LocalProfile {
  displayName: string;
  fullName: string | null;
  birthYear: number | null;
  theme: ThemePreference;
  onboardingCompletedAt: string | null;
  isDemo: boolean;
  createdAt: string;
}
export interface LocalLab { id: string; name: string; address: string | null; phone: string | null; website: string | null; sourceDocumentId: string | null }
export interface LocalDocument { id: string; name: string; category: DocumentCategory; documentDate: string | null; mimeType: string; sizeBytes: number; pageCount: number | null; sha256: string; source: 'upload' | 'demo'; uploadedAt: string }
export interface LocalJob { id: string; documentId: string; stage: JobStage; stageProgress: number; pagesTotal: number | null; pagesDone: number | null; usedOcr: boolean; errorCode: JobErrorCode | null; meta: ExtractedReportMeta | null; reportId: string | null; createdAt: string; updatedAt: string }
export interface LocalCandidate {
  id: string; jobId: string; position: number; biomarkerId: string | null; originalName: string; rawLine: string; valueText: string;
  valueNumeric: number | null; valueComparator: string | null; unit: string | null; rangeLow: number | null; rangeHigh: number | null;
  rangeText: string | null; labCode: string | null; labComment: string | null; page: number | null; confidence: number;
  issues: CandidateIssue[]; decision: 'pending' | 'accepted' | 'rejected';
}
export interface LocalReport { id: string; title: string; reportType: string; collectedAt: string; laboratoryId: string | null; documentId: string | null; specialistId: string | null; patientNameOnDocument: string | null; labComment: string | null; createdAt: string }
export interface LocalEdit { id: string; resultId: string; field: string; originalValue: string | null; newValue: string | null; context: 'review' | 'edit'; editedAt: string }
export interface LocalSpecialist {
  id: string; name: string; specialty: string; phone: string | null; email: string | null; address: string | null; clinic: string | null;
  website: string | null; note: string | null; photoFileId: string | null; lastVisitAt: string | null; nextVisitAt: string | null; createdAt: string; updatedAt: string;
}
export interface LocalNote { id: string; targetType: NoteTarget; targetId: string | null; body: string; createdAt: string }
export interface LocalEvent { id: string; kind: string; title: string; date: string; description: string | null; refId: string | null; showOnCharts: boolean }
export interface LocalNotification { id: string; kind: string; title: string; body: string | null; link: string | null; readAt: string | null; createdAt: string }
export interface LocalActivity { action: string; at: string }

export interface LocalState {
  version: 1;
  profile: LocalProfile | null;
  /** false after "Изход": data stays, but the app shows the start screen. */
  active: boolean;
  labs: LocalLab[];
  documents: LocalDocument[];
  jobs: LocalJob[];
  candidates: LocalCandidate[];
  reports: LocalReport[];
  results: ResultRecord[];
  edits: LocalEdit[];
  favorites: string[];
  specialists: LocalSpecialist[];
  notes: LocalNote[];
  events: LocalEvent[];
  notifications: LocalNotification[];
  activity: LocalActivity[];
}

export const emptyState = (): LocalState => ({
  version: 1, profile: null, active: false, labs: [], documents: [], jobs: [], candidates: [], reports: [], results: [], edits: [],
  favorites: [], specialists: [], notes: [], events: [], notifications: [], activity: [],
});

const DB_NAME = 'vitalog-local';
const STATE_KEY = 'state';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('state');
      req.result.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
const db = () => (dbPromise ??= openDb());

function tx<T>(store: 'state' | 'files', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then((d) => new Promise<T | undefined>((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Хранилището на браузъра отказа записа (възможно е да е пълно).'));
  }));
}

let cache: LocalState | null = null;

export async function loadState(): Promise<LocalState> {
  if (cache) return cache;
  try {
    const raw = await tx<LocalState>('state', 'readonly', (s) => s.get(STATE_KEY));
    cache = raw && raw.version === 1 ? raw : emptyState();
  } catch {
    // Private mode / storage blocked: keep working in memory for this tab
    cache = emptyState();
  }
  return cache;
}

let saving: Promise<unknown> = Promise.resolve();
export function saveState(state: LocalState): Promise<unknown> {
  cache = state;
  // serialize writes; structuredClone so later in-memory mutations don't race the write
  const snapshot = structuredClone(state);
  saving = saving.then(() => tx('state', 'readwrite', (s) => s.put(snapshot, STATE_KEY))).catch(() => {});
  return saving;
}

export const putFile = (id: string, bytes: Uint8Array) => tx('files', 'readwrite', (s) => s.put(bytes, id));
export const getFile = (id: string) => tx<Uint8Array>('files', 'readonly', (s) => s.get(id));
export const deleteFile = (id: string) => tx('files', 'readwrite', (s) => s.delete(id));

/** "Изтрий всички данни": state and files. */
export async function wipeAll() {
  cache = emptyState();
  await tx('state', 'readwrite', (s) => s.clear());
  await tx('files', 'readwrite', (s) => s.clear());
}

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
