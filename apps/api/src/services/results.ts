import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  canonicalizeUnit, computeChange, computeStatus, getBiomarker, normalizeAliasKey, parseLabNumber, rangeToDisplayUnit, toDisplayUnit,
  type BiomarkerSummary, type LabReport, type LabResult, type RangeComparator, type ReferenceRange, type SeriesPoint,
} from '@vitalog/shared';
import { db, type Tx } from '../db/client';
import { favorites, laboratories, labReports, labResults } from '../db/schema';

type ResultRow = typeof labResults.$inferSelect;
type Row = ResultRow & { labName?: string | null };

export const resultKey = (r: Pick<ResultRow, 'biomarkerId' | 'customKey'>) => r.biomarkerId ?? r.customKey ?? 'custom:unknown';
export const customKeyFor = (name: string) => `custom:${normalizeAliasKey(name).slice(0, 80)}`;

export function rangeOf(r: Pick<ResultRow, 'rangeLow' | 'rangeHigh' | 'rangeText' | 'rangeSource'>): ReferenceRange | null {
  if (r.rangeLow === null && r.rangeHigh === null && !r.rangeText) return null;
  return { low: r.rangeLow, high: r.rangeHigh, text: r.rangeText, source: r.rangeSource ?? 'laboratory' };
}

export function toLabResult(r: ResultRow): LabResult {
  return {
    id: r.id,
    reportId: r.reportId,
    biomarkerId: r.biomarkerId,
    originalName: r.originalName,
    valueText: r.valueText,
    valueNumeric: r.valueNumeric,
    valueComparator: r.valueComparator as RangeComparator | null,
    unit: r.unit,
    normalizedValue: null,
    normalizedUnit: null,
    referenceRange: rangeOf(r),
    status: r.status,
    collectedAt: r.collectedAt,
    labCode: r.labCode,
    labComment: r.labComment,
    source: r.source,
    sourceDocumentId: r.sourceDocumentId,
    sourcePage: r.sourcePage,
    extractedAt: r.extractedAt,
    edited: r.edited,
    confirmedAt: r.confirmedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toSeriesPoint(r: Row): SeriesPoint {
  const bm = getBiomarker(r.biomarkerId);
  const display = bm && r.valueComparator === null ? toDisplayUnit(bm, r.valueNumeric, r.unit) : null;
  const range = rangeOf(r);
  const displayRange = bm ? rangeToDisplayUnit(bm, range, r.unit) : range;
  return {
    resultId: r.id,
    date: r.collectedAt,
    value: r.valueNumeric,
    valueText: r.valueText,
    unit: r.unit,
    displayValue: bm ? (display?.value ?? null) : r.valueComparator === null ? r.valueNumeric : null,
    rangeLow: r.rangeLow,
    rangeHigh: r.rangeHigh,
    rangeText: r.rangeText,
    displayRangeLow: displayRange?.low ?? null,
    displayRangeHigh: displayRange?.high ?? null,
    status: r.status,
    reportId: r.reportId,
    laboratoryName: r.labName ?? null,
    source: r.source,
    sourceDocumentId: r.sourceDocumentId,
    sourcePage: r.sourcePage,
    edited: r.edited,
  };
}

/** rows: one biomarker, newest first. */
export function buildSummary(key: string, rows: Row[], total: number, favorite: boolean): BiomarkerSummary {
  const bm = getBiomarker(key);
  const points = rows.map(toSeriesPoint);
  const latest = points[0] ?? null;
  const previous = points[1] ?? null;
  // Mixed units = some numeric measurement cannot be safely put on the display scale
  const units = new Set(rows.map((r) => canonicalizeUnit(r.unit) ?? r.unit ?? ''));
  const mixedUnits = bm
    ? rows.some((r, i) => r.valueNumeric !== null && r.valueComparator === null && points[i]!.displayValue === null)
    : units.size > 1;
  const comparable = latest?.displayValue != null && previous?.displayValue != null && (bm || units.size === 1);
  const change = comparable ? computeChange(latest!.displayValue!, previous!.displayValue!) : null;
  return {
    id: key,
    name: bm?.bgName ?? rows[0]?.originalName ?? key,
    category: bm?.category ?? 'other',
    unit: bm?.unit ?? latest?.unit ?? null,
    count: total,
    latest,
    previous,
    change,
    favorite,
    sparkline: points.slice(0, 12).reverse().map((p) => p.displayValue),
    mixedUnits,
  };
}

/**
 * Summaries for all biomarkers of a user in ONE query (window functions), returning at most
 * the 12 most recent measurements per biomarker – scales to 10k+ results.
 */
export async function biomarkerSummaries(userId: string, opts: { keys?: string[]; from?: string | null; to?: string | null } = {}): Promise<BiomarkerSummary[]> {
  const conds = [sql`r.user_id = ${userId}`];
  if (opts.from) conds.push(sql`r.collected_at >= ${opts.from}`);
  if (opts.to) conds.push(sql`r.collected_at <= ${opts.to}`);
  if (opts.keys?.length) conds.push(sql`coalesce(r.biomarker_id, r.custom_key) in ${opts.keys}`);
  const rows = await db.execute<Record<string, unknown>>(sql`
    select * from (
      select r.*, l.name as lab_name,
        row_number() over (partition by coalesce(r.biomarker_id, r.custom_key) order by r.collected_at desc, r.created_at desc) as rn,
        count(*) over (partition by coalesce(r.biomarker_id, r.custom_key)) as cnt
      from lab_results r
      left join lab_reports rep on rep.id = r.report_id
      left join laboratories l on l.id = rep.laboratory_id
      where ${sql.join(conds, sql` and `)}
    ) t where rn <= 12
    order by coalesce(biomarker_id, custom_key), rn`);
  const favs = new Set((await db.select({ k: favorites.biomarkerKey }).from(favorites).where(eq(favorites.userId, userId))).map((f) => f.k));
  const grouped = new Map<string, { rows: Row[]; count: number }>();
  for (const raw of rows) {
    const r = mapRaw(raw);
    const key = resultKey(r);
    const g = grouped.get(key) ?? { rows: [], count: Number(raw.cnt) };
    g.rows.push(r);
    grouped.set(key, g);
  }
  return [...grouped.entries()].map(([k, g]) => buildSummary(k, g.rows, g.count, favs.has(k)));
}

/** Map a raw snake_case row (from db.execute) to the Drizzle row shape. */
function mapRaw(raw: Record<string, unknown>): Row {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const s = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
  const d = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  return {
    id: String(raw.id),
    userId: String(raw.user_id),
    reportId: s(raw.report_id),
    biomarkerId: s(raw.biomarker_id),
    customKey: s(raw.custom_key),
    originalName: String(raw.original_name),
    valueText: String(raw.value_text),
    valueNumeric: n(raw.value_numeric),
    valueComparator: s(raw.value_comparator),
    unit: s(raw.unit),
    rangeLow: n(raw.range_low),
    rangeHigh: n(raw.range_high),
    rangeText: s(raw.range_text),
    rangeSource: s(raw.range_source) as Row['rangeSource'],
    status: String(raw.status) as Row['status'],
    collectedAt: d(raw.collected_at),
    labCode: s(raw.lab_code),
    labComment: s(raw.lab_comment),
    source: String(raw.source) as Row['source'],
    sourceLabel: s(raw.source_label),
    sourceDocumentId: s(raw.source_document_id),
    sourcePage: n(raw.source_page),
    extractionConfidence: n(raw.extraction_confidence),
    extractedAt: s(raw.extracted_at),
    edited: Boolean(raw.edited),
    confirmedAt: s(raw.confirmed_at),
    createdAt: s(raw.created_at)!,
    updatedAt: s(raw.updated_at)!,
    labName: s(raw.lab_name),
  };
}

/** Full series of one biomarker (oldest → newest), user-scoped. */
export async function biomarkerSeries(userId: string, key: string, from?: string | null, to?: string | null) {
  const keyCond = key.startsWith('custom:') ? eq(labResults.customKey, key) : eq(labResults.biomarkerId, key);
  const conds = [eq(labResults.userId, userId), keyCond];
  if (from) conds.push(sql`${labResults.collectedAt} >= ${from}`);
  if (to) conds.push(sql`${labResults.collectedAt} <= ${to}`);
  const rows = await db
    .select({ r: labResults, labName: laboratories.name })
    .from(labResults)
    .leftJoin(labReports, eq(labReports.id, labResults.reportId))
    .leftJoin(laboratories, eq(laboratories.id, labReports.laboratoryId))
    .where(and(...conds))
    .orderBy(asc(labResults.collectedAt), asc(labResults.createdAt));
  return rows.map(({ r, labName }) => ({ ...r, labName }));
}

export interface ResultInput {
  biomarkerId: string | null;
  originalName: string;
  valueText: string;
  unit: string | null;
  referenceRange: { low: number | null; high: number | null; text?: string | null } | null;
  rangeSource: 'laboratory' | 'user';
}

/** Derive stored fields (numeric value, canonical unit, status) from user/extracted input. */
export function deriveResultFields(input: ResultInput) {
  const parsed = parseLabNumber(input.valueText);
  const unit = input.unit ? (canonicalizeUnit(input.unit) ?? input.unit.trim()) : null;
  const range: ReferenceRange | null = input.referenceRange && (input.referenceRange.low !== null || input.referenceRange.high !== null || input.referenceRange.text)
    ? { low: input.referenceRange.low, high: input.referenceRange.high, text: input.referenceRange.text ?? null, source: input.rangeSource }
    : null;
  const biomarkerId = input.biomarkerId && getBiomarker(input.biomarkerId) ? input.biomarkerId : null;
  return {
    biomarkerId,
    customKey: biomarkerId ? null : customKeyFor(input.originalName),
    originalName: input.originalName,
    valueText: input.valueText,
    valueNumeric: parsed?.value ?? null,
    valueComparator: parsed?.comparator ?? null,
    unit,
    rangeLow: range?.low ?? null,
    rangeHigh: range?.high ?? null,
    rangeText: range?.text ?? null,
    rangeSource: range ? input.rangeSource : null,
    status: computeStatus(parsed?.value ?? null, (parsed?.comparator ?? null) as RangeComparator | null, range),
  };
}

export async function reportSummaries(userId: string, where?: ReturnType<typeof and>, limit = 50, offset = 0, order: 'newest' | 'oldest' = 'newest'): Promise<LabReport[]> {
  const rows = await db
    .select({
      rep: labReports,
      lab: laboratories,
      cnt: sql<number>`(select count(*)::int from lab_results x where x.report_id = ${labReports.id})`,
      out: sql<number>`(select count(*)::int from lab_results x where x.report_id = ${labReports.id} and x.status in ('above','below'))`,
    })
    .from(labReports)
    .leftJoin(laboratories, eq(laboratories.id, labReports.laboratoryId))
    .where(where ? and(eq(labReports.userId, userId), where) : eq(labReports.userId, userId))
    .orderBy(order === 'newest' ? desc(labReports.collectedAt) : asc(labReports.collectedAt), desc(labReports.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.map(({ rep, lab, cnt, out }) => ({
    id: rep.id,
    title: rep.title,
    reportType: rep.reportType as LabReport['reportType'],
    collectedAt: rep.collectedAt,
    laboratory: lab ? { id: lab.id, name: lab.name, address: lab.address, phone: lab.phone, website: lab.website, sourceDocumentId: lab.sourceDocumentId } : null,
    documentId: rep.documentId,
    specialistId: rep.specialistId,
    patientNameOnDocument: rep.patientNameOnDocument,
    labComment: rep.labComment,
    resultCount: cnt,
    outOfRangeCount: out,
    createdAt: rep.createdAt,
  }));
}

/** Previous measurement of the same biomarker before a given date (for report tables). */
export async function previousValues(userId: string, keys: string[], beforeDate: string, tx: Tx | typeof db = db) {
  if (!keys.length) return new Map<string, ResultRow>();
  const rows = await tx
    .select()
    .from(labResults)
    .where(and(eq(labResults.userId, userId), sql`${labResults.collectedAt} < ${beforeDate}`, sql`coalesce(${labResults.biomarkerId}, ${labResults.customKey}) in ${keys}`))
    .orderBy(desc(labResults.collectedAt));
  const map = new Map<string, ResultRow>();
  for (const r of rows) if (!map.has(resultKey(r))) map.set(resultKey(r), r);
  return map;
}

