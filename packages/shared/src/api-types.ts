import type {
  Biomarker, Document, ExtractedReportMeta, ExtractionCandidate, LabReport, LabResult,
  Note, Notification, ProcessingJob, Profile, ResultStatus, Specialist, TimelineEvent, User,
} from './models';
import type { Change } from './trend';

/** Response shapes of the REST API (see apps/api/src/routes). */

export interface MeResponse { user: User; profile: Profile; csrfToken: string; mfaPending: boolean }

export interface SeriesPoint {
  resultId: string;
  date: string;
  value: number | null;
  valueText: string;
  unit: string | null;
  /** Value in the biomarker display unit if safely convertible, else null. */
  displayValue: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  rangeText: string | null;
  /** Lab range converted with the same exact rule as the value (null when not convertible). */
  displayRangeLow: number | null;
  displayRangeHigh: number | null;
  status: ResultStatus;
  reportId: string | null;
  laboratoryName: string | null;
  source: LabResult['source'];
  sourceDocumentId: string | null;
  sourcePage: number | null;
  edited: boolean;
}

export interface BiomarkerSummary {
  /** Catalog id, or "custom:<normalized name>" for results without a catalog match. */
  id: string;
  name: string;
  category: Biomarker['category'];
  unit: string | null;
  count: number;
  latest: SeriesPoint | null;
  previous: SeriesPoint | null;
  change: Change | null;
  favorite: boolean;
  sparkline: Array<number | null>;
  /** True when measurements use units that cannot be safely converted to one scale. */
  mixedUnits: boolean;
}

export interface BiomarkerDetail {
  summary: BiomarkerSummary;
  biomarker: Biomarker | null;
  series: SeriesPoint[];
  events: TimelineEvent[];
  notes: Note[];
}

export interface ReportResultRow extends LabResult {
  biomarkerName: string;
  previous: { date: string; valueText: string; value: number | null; unit: string | null } | null;
  change: Change | null;
}

export interface ReportDetail {
  report: LabReport;
  results: ReportResultRow[];
  document: Document | null;
  specialist: Specialist | null;
  notes: Note[];
}

export interface DashboardResponse {
  displayName: string;
  stats: { reports: number; results: number; biomarkers: number; lastReportAt: string | null; reportsLast12m: number };
  pendingReviews: ProcessingJob[];
  latestReport: LabReport | null;
  latestDocument: Document | null;
  overview: BiomarkerSummary[];
  outOfRange: BiomarkerSummary[];
  changed: BiomarkerSummary[];
  favorites: BiomarkerSummary[];
  recentReports: LabReport[];
  recentDocuments: Document[];
  specialists: Specialist[];
  categories: Array<{ category: Biomarker['category']; total: number; outOfRange: number }>;
  summaryFacts: string[];
}

export interface ReviewResponse {
  job: ProcessingJob;
  document: Document;
  meta: ExtractedReportMeta;
  candidates: ExtractionCandidate[];
  suspectedDuplicateReportId: string | null;
}

export interface CompareRow {
  biomarkerId: string;
  name: string;
  a: { valueText: string; value: number | null; unit: string | null; status: ResultStatus } | null;
  b: { valueText: string; value: number | null; unit: string | null; status: ResultStatus } | null;
  change: Change | null;
  comparable: boolean;
}

export interface SearchResponse {
  biomarkers: BiomarkerSummary[];
  reports: LabReport[];
  documents: Document[];
  specialists: Specialist[];
}

export interface Paginated<T> { items: T[]; total: number; page: number; pageSize: number }

export type { Notification };
