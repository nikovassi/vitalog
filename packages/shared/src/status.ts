import type { Biomarker, RangeComparator, ReferenceRange, ResultStatus } from './models';
import { areIdenticalUnits, canonicalizeUnit } from './units';
import { findConversion } from './biomarkers';

/**
 * Compare a value with the laboratory's own reference range. Purely arithmetic.
 * A censored value ("< 0.5") gets a status only when it is unambiguous.
 */
export function computeStatus(
  value: number | null,
  comparator: RangeComparator | null,
  range: ReferenceRange | null,
): ResultStatus {
  if (value === null || !range || (range.low === null && range.high === null)) return 'unknown';
  const { low, high } = range;
  if (comparator === null) {
    if (low !== null && value < low) return 'below';
    if (high !== null && value > high) return 'above';
    return 'in_range';
  }
  // "< x": true value lies below x
  if (comparator === '<' || comparator === '<=') {
    if (low !== null && value <= low) return 'below';
    if (high !== null && value <= high && (low === null || value > low)) return low === null ? 'in_range' : 'unknown';
    return 'unknown';
  }
  // "> x": true value lies above x
  if (high !== null && value >= high) return 'above';
  if (low !== null && value >= low && high === null) return 'in_range';
  return 'unknown';
}

export const STATUS_LABELS: Record<ResultStatus, string> = {
  in_range: 'В референтния диапазон',
  above: 'Над референтния диапазон',
  below: 'Под референтния диапазон',
  unknown: 'Няма референтен диапазон',
};

export const STATUS_SHORT: Record<ResultStatus, string> = {
  in_range: 'В диапазона',
  above: 'Над диапазона',
  below: 'Под диапазона',
  unknown: 'Без диапазон',
};

export const STATUS_SYMBOL: Record<ResultStatus, string> = {
  in_range: '✓',
  above: '↑',
  below: '↓',
  unknown: '–',
};

/**
 * Convert a value to the biomarker's display unit, only through an identity or an explicit
 * catalog rule. Returns null when no safe conversion exists – callers must then keep the
 * series separate instead of plotting mixed units.
 */
export function toDisplayUnit(
  biomarker: Biomarker,
  value: number | null,
  unit: string | null,
): { value: number; unit: string } | null {
  if (value === null || !unit) return null;
  const canonical = canonicalizeUnit(unit) ?? unit;
  if (areIdenticalUnits(canonical, biomarker.unit)) return { value, unit: biomarker.unit };
  const rule = findConversion(biomarker, canonical, biomarker.unit);
  if (!rule) return null;
  return { value: roundSig(value * rule.factor, 4), unit: biomarker.unit };
}

/** Convert a range with the same rule as the value; null if not convertible. */
export function rangeToDisplayUnit(biomarker: Biomarker, range: ReferenceRange | null, unit: string | null): ReferenceRange | null {
  if (!range) return null;
  const conv = (v: number | null) => (v === null ? null : toDisplayUnit(biomarker, v, unit)?.value ?? NaN);
  const low = conv(range.low);
  const high = conv(range.high);
  if (Number.isNaN(low) || Number.isNaN(high)) return null;
  return { ...range, low: low as number | null, high: high as number | null };
}

function roundSig(n: number, digits: number): number {
  if (n === 0) return 0;
  const d = Math.ceil(Math.log10(Math.abs(n)));
  const p = digits - d;
  const m = Math.pow(10, p);
  return Math.round(n * m) / m;
}
