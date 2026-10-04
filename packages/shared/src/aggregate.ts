import { canonicalizeUnit, parseLabNumber } from './units';
import { getBiomarker, normalizeAliasKey } from './biomarkers';
import { computeStatus, rangeToDisplayUnit, toDisplayUnit } from './status';
import { computeChange } from './trend';
import type { LabResult, RangeComparator, ReferenceRange, ResultSource, ResultStatus } from './models';
import type { BiomarkerSummary, SeriesPoint } from './api-types';

/**
 * Pure aggregation logic shared by the API (PostgreSQL rows) and the in-browser local mode
 * (IndexedDB records). Any change here applies to both, so results are identical.
 */

/** A stored measurement – the shape of a lab_results row. */
export interface ResultRecord {
  id: string;
  reportId: string | null;
  biomarkerId: string | null;
  customKey: string | null;
  originalName: string;
  valueText: string;
  valueNumeric: number | null;
  valueComparator: string | null;
  unit: string | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  rangeText: string | null;
  rangeSource: 'laboratory' | 'user' | null;
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
type ResultRow = ResultRecord;
type Row = ResultRecord & { labName?: string | null };

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

