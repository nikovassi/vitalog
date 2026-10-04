/**
 * Domain models shared by API and web. Mirrors the Postgres schema in
 * apps/api/src/db/schema.ts. FHIR mapping notes are in docs/04-DATA-MODEL.md.
 * All dates are ISO strings on the wire ("YYYY-MM-DD" for clinical dates).
 */

export type Role = 'user' | 'support' | 'admin' | 'superadmin';
export type ThemePreference = 'system' | 'light' | 'dark';

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  role: Role;
  mfaEnabled: boolean;
  createdAt: string;
}

export interface Profile {
  userId: string;
  displayName: string;
  /** Optional; only used to match the patient name printed in a PDF. */
  fullName: string | null;
  birthYear: number | null;
  theme: ThemePreference;
  locale: 'bg' | 'en';
  onboardingCompletedAt: string | null;
  aiProcessingConsent: boolean;
  isDemo: boolean;
}

export type BiomarkerCategory =
  | 'blood_count'
  | 'liver'
  | 'kidney'
  | 'lipids'
  | 'glucose_metabolism'
  | 'thyroid'
  | 'hormones'
  | 'vitamins'
  | 'minerals'
  | 'inflammation'
  | 'other';

/** y = x * factor (+ offset). Only exact, molecular-weight based or identity conversions. */
export interface UnitConversion {
  from: string;
  to: string;
  factor: number;
  source: string;
}

export interface Biomarker {
  id: string;
  canonicalName: string;
  bgName: string;
  /** Exact-match aliases (any language, abbreviations). Matching normalizes case/spacing/µ. */
  aliases: string[];
  category: BiomarkerCategory;
  /** The unit Bulgarian labs most commonly report; used for chart display. */
  unit: string;
  supportedUnits: string[];
  conversionRules: UnitConversion[];
  /** LOINC code for the canonical unit's property – only when verified, otherwise null. */
  loinc: string | null;
  /** Neutral one-line description of what is measured. Never an interpretation. */
  description: string;
  /**
   * Deliberately always null in the catalog: reference ranges come from the lab document
   * or the user. Kept in the model so a future, sourced range table can be attached.
   */
  referenceRange: null;
  source: string;
}

export type RangeComparator = '<' | '<=' | '>' | '>=';

export interface ReferenceRange {
  low: number | null;
  high: number | null;
  /** Original text as printed, e.g. "35 - 52", "< 5.2", "отрицателен". */
  text: string | null;
  source: 'laboratory' | 'user';
}

export type ResultStatus = 'in_range' | 'above' | 'below' | 'unknown';
export type ResultSource = 'pdf' | 'manual' | 'import' | 'device';

export interface Laboratory {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  /** Document the info was read from; null for user-entered labs. */
  sourceDocumentId: string | null;
}

export type ReportType =
  | 'blood'
  | 'hormones'
  | 'urine'
  | 'biochemistry'
  | 'mixed'
  | 'other';

export interface LabReport {
  id: string;
  title: string;
  reportType: ReportType;
  collectedAt: string; // YYYY-MM-DD
  laboratory: Laboratory | null;
  documentId: string | null;
  specialistId: string | null;
  patientNameOnDocument: string | null;
  labComment: string | null;
  resultCount: number;
  outOfRangeCount: number;
  createdAt: string;
}

export interface LabResult {
  id: string;
  reportId: string | null;
  biomarkerId: string | null;
  /** Name exactly as printed in the source. */
  originalName: string;
  /** Raw value text as printed ("35,0", "< 0.5", "отрицателен"). */
  valueText: string;
  valueNumeric: number | null;
  valueComparator: RangeComparator | null;
  unit: string | null;
  /** Value converted to the biomarker's display unit when an explicit rule exists. */
  normalizedValue: number | null;
  normalizedUnit: string | null;
  referenceRange: ReferenceRange | null;
  status: ResultStatus;
  collectedAt: string;
  labCode: string | null;
  labComment: string | null;
  source: ResultSource;
  sourceDocumentId: string | null;
  sourcePage: number | null;
  extractedAt: string | null;
  edited: boolean;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DocumentCategory =
  | 'lab_results'
  | 'imaging'
  | 'discharge_summary'
  | 'outpatient_sheet'
  | 'prescription'
  | 'other';

export interface Document {
  id: string;
  name: string;
  category: DocumentCategory;
  documentDate: string | null;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  source: 'upload' | 'generated' | 'demo';
  uploadedAt: string;
  reportId: string | null;
}

export interface Specialist {
  id: string;
  name: string;
  specialty: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  clinic: string | null;
  website: string | null;
  note: string | null;
  photoDocumentId: string | null;
  hasPhoto: boolean;
  lastVisitAt: string | null;
  nextVisitAt: string | null;
  createdAt: string;
}

export interface Appointment {
  id: string;
  specialistId: string | null;
  title: string;
  at: string;
  location: string | null;
  note: string | null;
}

export type NoteTarget = 'report' | 'biomarker' | 'specialist' | 'appointment' | 'general';

export interface Note {
  id: string;
  targetType: NoteTarget;
  targetId: string | null;
  body: string;
  createdAt: string;
}

export type TimelineEventKind =
  | 'lab_report'
  | 'appointment'
  | 'medication_start'
  | 'medication_stop'
  | 'diet_change'
  | 'exercise'
  | 'vaccination'
  | 'imaging'
  | 'note'
  | 'other';

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  title: string;
  date: string;
  description: string | null;
  /** Linked entity, e.g. a report id for kind=lab_report. */
  refId: string | null;
  /** Show as a marker on biomarker charts. */
  showOnCharts: boolean;
}

export type NotificationKind =
  | 'review_ready'
  | 'processing_failed'
  | 'report_added'
  | 'unreviewed_data'
  | 'share_accessed'
  | 'security';

export interface Notification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface ShareScope {
  biomarkerIds: string[] | 'all';
  from: string | null;
  to: string | null;
  includeSpecialists: boolean;
}

export interface ShareLink {
  id: string;
  label: string;
  scope: ShareScope;
  expiresAt: string;
  revokedAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
}

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.password_reset_requested'
  | 'auth.password_reset'
  | 'auth.password_changed'
  | 'auth.email_verified'
  | 'auth.mfa_enabled'
  | 'auth.mfa_disabled'
  | 'auth.session_revoked'
  | 'document.upload'
  | 'document.view'
  | 'document.download'
  | 'document.delete'
  | 'report.confirm'
  | 'report.view'
  | 'report.delete'
  | 'result.create'
  | 'result.edit'
  | 'result.delete'
  | 'share.create'
  | 'share.revoke'
  | 'share.access'
  | 'export.create'
  | 'account.delete'
  | 'consent.change'
  | 'admin.role_change';

export interface AuditLog {
  id: string;
  actorUserId: string | null;
  subjectUserId: string | null;
  action: AuditAction;
  targetType: string | null;
  targetId: string | null;
  ipPrefix: string | null;
  userAgent: string | null;
  at: string;
}

export type JobStage =
  | 'queued'
  | 'extracting_text'
  | 'ocr'
  | 'parsing'
  | 'ai_structuring'
  | 'normalizing'
  | 'validating'
  | 'review_required'
  | 'completed'
  | 'failed';

export type JobErrorCode =
  | 'invalid_pdf'
  | 'encrypted_pdf'
  | 'too_many_pages'
  | 'no_text'
  | 'ocr_failed'
  | 'unrecognized_document'
  | 'no_results'
  | 'ai_error'
  | 'internal';

export interface ProcessingJob {
  id: string;
  documentId: string;
  stage: JobStage;
  /** 0..100 within the current stage, as reported by the worker. */
  stageProgress: number;
  pagesTotal: number | null;
  pagesDone: number | null;
  usedOcr: boolean;
  errorCode: JobErrorCode | null;
  createdAt: string;
  updatedAt: string;
}

export type CandidateIssue =
  | 'unknown_biomarker'
  | 'unreadable_value'
  | 'missing_unit'
  | 'unknown_unit'
  | 'missing_range'
  | 'duplicate'
  | 'value_range_mismatch'
  | 'ocr_low_confidence'
  /** AI returned a value that does not appear in the document text. */
  | 'not_found_in_source';

/** An extracted, not-yet-confirmed result shown on the review screen. */
export interface ExtractionCandidate {
  id: string;
  jobId: string;
  biomarkerId: string | null;
  originalName: string;
  rawLine: string;
  valueText: string;
  valueNumeric: number | null;
  valueComparator: RangeComparator | null;
  unit: string | null;
  referenceRange: ReferenceRange | null;
  labCode: string | null;
  labComment: string | null;
  page: number | null;
  /** Internal only; the UI shows "Провери" instead of the number. */
  confidence: number;
  issues: CandidateIssue[];
  decision: 'pending' | 'accepted' | 'rejected';
}

export interface ExtractedReportMeta {
  collectedAt: string | null;
  laboratoryName: string | null;
  laboratoryAddress: string | null;
  laboratoryPhone: string | null;
  laboratoryWebsite: string | null;
  patientName: string | null;
  reportType: ReportType | null;
  title: string | null;
  labComment: string | null;
  formatId: string;
}
