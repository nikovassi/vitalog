import { sql } from 'drizzle-orm';
import {
  bigserial, boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, real, text,
  timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import type { ExtractedReportMeta, ShareScope } from '@vitalog/shared';

/**
 * PostgreSQL schema. Every table holding user data has user_id and every query filters on it
 * (see src/lib/authz.ts). Deleting a user cascades to all their data (GDPR Art. 17).
 * FHIR mapping: docs/04-DATA-MODEL.md.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);
const userRef = () => uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' });
const created = () => ts('created_at').notNull().defaultNow();
const updated = () => ts('updated_at').notNull().defaultNow();

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: ts('email_verified_at'),
  role: text('role', { enum: ['user', 'support', 'admin', 'superadmin'] }).notNull().default('user'),
  /** AES-256-GCM encrypted TOTP secret. */
  mfaSecretEnc: text('mfa_secret_enc'),
  mfaEnabledAt: ts('mfa_enabled_at'),
  failedLoginCount: integer('failed_login_count').notNull().default(0),
  lockedUntil: ts('locked_until'),
  /** Per-user data encryption key, wrapped with the master KEK. Destroying it = crypto-shredding. */
  dekEnc: text('dek_enc').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  demoExpiresAt: ts('demo_expires_at'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)]);

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  fullName: text('full_name'),
  birthYear: integer('birth_year'),
  theme: text('theme', { enum: ['system', 'light', 'dark'] }).notNull().default('system'),
  locale: text('locale', { enum: ['bg', 'en'] }).notNull().default('bg'),
  onboardingCompletedAt: ts('onboarding_completed_at'),
  aiProcessingConsentAt: ts('ai_processing_consent_at'),
  updatedAt: updated(),
});

/** Consent ledger (GDPR Art. 7 / 9(2)(a)): append-only. */
export const consents = pgTable('consents', {
  id: id(),
  userId: userRef(),
  kind: text('kind', { enum: ['health_data', 'ai_processing'] }).notNull(),
  version: text('version').notNull(),
  granted: boolean('granted').notNull(),
  textHash: text('text_hash').notNull(),
  ipPrefix: text('ip_prefix'),
  at: ts('at').notNull().defaultNow(),
}, (t) => [index('consents_user_idx').on(t.userId)]);

export const sessions = pgTable('sessions', {
  id: id(),
  userId: userRef(),
  tokenHash: text('token_hash').notNull(),
  csrfToken: text('csrf_token').notNull(),
  mfaPending: boolean('mfa_pending').notNull().default(false),
  reauthAt: ts('reauth_at'),
  userAgent: text('user_agent'),
  ipPrefix: text('ip_prefix'),
  createdAt: created(),
  lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
}, (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)]);

export const authTokens = pgTable('auth_tokens', {
  id: id(),
  userId: userRef(),
  kind: text('kind', { enum: ['email_verify', 'password_reset'] }).notNull(),
  tokenHash: text('token_hash').notNull(),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: created(),
}, (t) => [uniqueIndex('auth_tokens_hash_uq').on(t.tokenHash)]);

export const recoveryCodes = pgTable('recovery_codes', {
  id: id(),
  userId: userRef(),
  codeHash: text('code_hash').notNull(),
  usedAt: ts('used_at'),
});

/** Catalog mirror (source of truth: packages/shared/src/biomarkers.ts), synced on migrate. */
export const biomarkers = pgTable('biomarkers', {
  id: text('id').primaryKey(),
  canonicalName: text('canonical_name').notNull(),
  bgName: text('bg_name').notNull(),
  category: text('category').notNull(),
  unit: text('unit').notNull(),
  supportedUnits: jsonb('supported_units').$type<string[]>().notNull(),
  loinc: text('loinc'),
  description: text('description').notNull(),
  source: text('source').notNull(),
});

export const biomarkerAliases = pgTable('biomarker_aliases', {
  aliasKey: text('alias_key').primaryKey(),
  alias: text('alias').notNull(),
  biomarkerId: text('biomarker_id').notNull().references(() => biomarkers.id, { onDelete: 'cascade' }),
});

export const laboratories = pgTable('laboratories', {
  id: id(),
  userId: userRef(),
  name: text('name').notNull(),
  address: text('address'),
  phone: text('phone'),
  website: text('website'),
  sourceDocumentId: uuid('source_document_id'),
  createdAt: created(),
}, (t) => [uniqueIndex('laboratories_user_name_uq').on(t.userId, t.name)]);

export const documents = pgTable('documents', {
  id: id(),
  userId: userRef(),
  name: text('name').notNull(),
  category: text('category', { enum: ['lab_results', 'imaging', 'discharge_summary', 'outpatient_sheet', 'prescription', 'other'] }).notNull(),
  documentDate: date('document_date', { mode: 'string' }),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  pageCount: integer('page_count'),
  sha256: text('sha256').notNull(),
  storageKey: text('storage_key').notNull(),
  source: text('source', { enum: ['upload', 'generated', 'demo'] }).notNull(),
  uploadedAt: ts('uploaded_at').notNull().defaultNow(),
}, (t) => [index('documents_user_idx').on(t.userId, t.uploadedAt), uniqueIndex('documents_user_sha_uq').on(t.userId, t.sha256)]);

export const specialists = pgTable('specialists', {
  id: id(),
  userId: userRef(),
  name: text('name').notNull(),
  specialty: text('specialty').notNull(),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  clinic: text('clinic'),
  website: text('website'),
  note: text('note'),
  /** Encrypted photo in private storage (JPEG/PNG). */
  photoStorageKey: text('photo_storage_key'),
  lastVisitAt: date('last_visit_at', { mode: 'string' }),
  nextVisitAt: date('next_visit_at', { mode: 'string' }),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [index('specialists_user_idx').on(t.userId)]);

export const processingJobs = pgTable('processing_jobs', {
  id: id(),
  userId: userRef(),
  documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
  stage: text('stage').notNull().default('queued'),
  stageProgress: integer('stage_progress').notNull().default(0),
  pagesTotal: integer('pages_total'),
  pagesDone: integer('pages_done'),
  usedOcr: boolean('used_ocr').notNull().default(false),
  usedAi: boolean('used_ai').notNull().default(false),
  errorCode: text('error_code'),
  meta: jsonb('meta').$type<ExtractedReportMeta>(),
  reportId: uuid('report_id'),
  createdAt: created(),
  updatedAt: updated(),
  completedAt: ts('completed_at'),
}, (t) => [index('jobs_user_idx').on(t.userId, t.stage)]);

export const extractionCandidates = pgTable('extraction_candidates', {
  id: id(),
  jobId: uuid('job_id').notNull().references(() => processingJobs.id, { onDelete: 'cascade' }),
  userId: userRef(),
  position: integer('position').notNull(),
  biomarkerId: text('biomarker_id'),
  originalName: text('original_name').notNull(),
  rawLine: text('raw_line').notNull(),
  valueText: text('value_text').notNull(),
  valueNumeric: doublePrecision('value_numeric'),
  valueComparator: text('value_comparator'),
  unit: text('unit'),
  rangeLow: doublePrecision('range_low'),
  rangeHigh: doublePrecision('range_high'),
  rangeText: text('range_text'),
  labCode: text('lab_code'),
  labComment: text('lab_comment'),
  page: integer('page'),
  confidence: real('confidence').notNull(),
  issues: jsonb('issues').$type<string[]>().notNull(),
  decision: text('decision', { enum: ['pending', 'accepted', 'rejected'] }).notNull().default('pending'),
}, (t) => [index('candidates_job_idx').on(t.jobId)]);

export const labReports = pgTable('lab_reports', {
  id: id(),
  userId: userRef(),
  title: text('title').notNull(),
  reportType: text('report_type').notNull(),
  collectedAt: date('collected_at', { mode: 'string' }).notNull(),
  laboratoryId: uuid('laboratory_id').references(() => laboratories.id, { onDelete: 'set null' }),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  specialistId: uuid('specialist_id').references(() => specialists.id, { onDelete: 'set null' }),
  patientNameOnDocument: text('patient_name_on_document'),
  labComment: text('lab_comment'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [index('reports_user_date_idx').on(t.userId, t.collectedAt)]);

/**
 * One measurement. The reference range is stored with the measurement (as in FHIR
 * Observation.referenceRange) because it belongs to that lab/method/date.
 */
export const labResults = pgTable('lab_results', {
  id: id(),
  userId: userRef(),
  reportId: uuid('report_id').references(() => labReports.id, { onDelete: 'cascade' }),
  biomarkerId: text('biomarker_id').references(() => biomarkers.id),
  /** Grouping key for results without a catalog match ("custom:<normalized name>"). */
  customKey: text('custom_key'),
  originalName: text('original_name').notNull(),
  valueText: text('value_text').notNull(),
  valueNumeric: doublePrecision('value_numeric'),
  valueComparator: text('value_comparator'),
  unit: text('unit'),
  rangeLow: doublePrecision('range_low'),
  rangeHigh: doublePrecision('range_high'),
  rangeText: text('range_text'),
  rangeSource: text('range_source', { enum: ['laboratory', 'user'] }),
  status: text('status', { enum: ['in_range', 'above', 'below', 'unknown'] }).notNull(),
  collectedAt: date('collected_at', { mode: 'string' }).notNull(),
  labCode: text('lab_code'),
  labComment: text('lab_comment'),
  source: text('source', { enum: ['pdf', 'manual', 'import', 'device'] }).notNull(),
  sourceLabel: text('source_label'),
  sourceDocumentId: uuid('source_document_id').references(() => documents.id, { onDelete: 'set null' }),
  sourcePage: integer('source_page'),
  extractionConfidence: real('extraction_confidence'),
  extractedAt: ts('extracted_at'),
  edited: boolean('edited').notNull().default(false),
  confirmedAt: ts('confirmed_at'),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  index('results_user_bm_date_idx').on(t.userId, t.biomarkerId, t.collectedAt),
  index('results_user_custom_idx').on(t.userId, t.customKey),
  index('results_user_date_idx').on(t.userId, t.collectedAt),
  index('results_report_idx').on(t.reportId),
]);

/** Audit trail of every change to a value (extracted → reviewed → later edits). */
export const resultEdits = pgTable('result_edits', {
  id: id(),
  resultId: uuid('result_id').notNull().references(() => labResults.id, { onDelete: 'cascade' }),
  userId: userRef(),
  field: text('field').notNull(),
  originalValue: text('original_value'),
  newValue: text('new_value'),
  context: text('context', { enum: ['review', 'edit'] }).notNull(),
  editedBy: uuid('edited_by').notNull(),
  editedAt: ts('edited_at').notNull().defaultNow(),
}, (t) => [index('result_edits_result_idx').on(t.resultId)]);

export const favorites = pgTable('favorites', {
  userId: userRef(),
  biomarkerKey: text('biomarker_key').notNull(),
  createdAt: created(),
}, (t) => [primaryKey({ columns: [t.userId, t.biomarkerKey] })]);

export const appointments = pgTable('appointments', {
  id: id(),
  userId: userRef(),
  specialistId: uuid('specialist_id').references(() => specialists.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  at: ts('at').notNull(),
  location: text('location'),
  note: text('note'),
  createdAt: created(),
}, (t) => [index('appointments_user_idx').on(t.userId, t.at)]);

export const notes = pgTable('notes', {
  id: id(),
  userId: userRef(),
  targetType: text('target_type', { enum: ['report', 'biomarker', 'specialist', 'appointment', 'general'] }).notNull(),
  targetId: text('target_id'),
  body: text('body').notNull(),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [index('notes_target_idx').on(t.userId, t.targetType, t.targetId)]);

export const timelineEvents = pgTable('timeline_events', {
  id: id(),
  userId: userRef(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  description: text('description'),
  refId: uuid('ref_id'),
  showOnCharts: boolean('show_on_charts').notNull().default(true),
  createdAt: created(),
}, (t) => [index('events_user_date_idx').on(t.userId, t.date)]);

export const notifications = pgTable('notifications', {
  id: id(),
  userId: userRef(),
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  link: text('link'),
  readAt: ts('read_at'),
  createdAt: created(),
}, (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)]);

export const shareLinks = pgTable('share_links', {
  id: id(),
  userId: userRef(),
  label: text('label').notNull(),
  tokenHash: text('token_hash').notNull(),
  scope: jsonb('scope').$type<ShareScope>().notNull(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  accessCount: integer('access_count').notNull().default(0),
  lastAccessedAt: ts('last_accessed_at'),
  createdAt: created(),
}, (t) => [uniqueIndex('share_links_token_uq').on(t.tokenHash)]);

/**
 * Security audit log. No FK to users on purpose: entries outlive account deletion for the
 * retention period (AUDIT_RETENTION_DAYS) and never contain medical values.
 */
export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actorUserId: uuid('actor_user_id'),
  subjectUserId: uuid('subject_user_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  ipPrefix: text('ip_prefix'),
  userAgent: text('user_agent'),
  at: ts('at').notNull().defaultNow(),
}, (t) => [index('audit_subject_idx').on(t.subjectUserId, t.at), index('audit_action_idx').on(t.action, t.at)]);

export const usageCounters = pgTable('usage_counters', {
  userId: userRef(),
  period: text('period').notNull(), // YYYY-MM
  documentsProcessed: integer('documents_processed').notNull().default(0),
  aiCalls: integer('ai_calls').notNull().default(0),
  bytesUploaded: doublePrecision('bytes_uploaded').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.userId, t.period] })]);
