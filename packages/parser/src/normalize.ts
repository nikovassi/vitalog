import {
  areIdenticalUnits, canonicalizeUnit, matchBiomarker, parseLabNumber,
  type Biomarker, type CandidateIssue, type RangeComparator, type ReferenceRange,
} from '@vitalog/shared';
import type { DraftCandidate, TextLine } from './types';

/**
 * Turns one table row into a candidate result. Conservative by design: every doubt becomes
 * an "issue" that the review screen surfaces; nothing is silently corrected.
 */

const RANGE_RE = {
  between: /^\(?\s*(-?\d+(?:[.,]\d+)?)\s*(?:-|–|—|÷|\.\.|до)\s*(-?\d+(?:[.,]\d+)?)\s*\)?$/i,
  below: /^\(?\s*(?:<|<=|≤|до|under|up to)\s*(\d+(?:[.,]\d+)?)\s*\)?$/i,
  above: /^\(?\s*(?:>|>=|≥|над|над\s|above|over)\s*(\d+(?:[.,]\d+)?)\s*\)?$/i,
};

const num = (s: string) => Number(s.replace(',', '.'));

export function parseRange(raw: string | null | undefined): ReferenceRange | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(RANGE_RE.between);
  if (m) {
    const low = num(m[1]!);
    const high = num(m[2]!);
    if (low > high) return null; // malformed – never swap silently
    return { low, high, text: s, source: 'laboratory' };
  }
  m = s.match(RANGE_RE.below);
  if (m) return { low: null, high: num(m[1]!), text: s, source: 'laboratory' };
  m = s.match(RANGE_RE.above);
  if (m) return { low: num(m[1]!), high: null, text: s, source: 'laboratory' };
  return null;
}

/** Words that mark a line as header/metadata, never a result row. */
const STOP_WORDS = /^(дата|date|тел|tel|phone|егн|адрес|address|пациент|patient|име|name|лекар|doctor|стр\.?|page|страница|възраст|age|пол|sex|изследване|показател|test|parameter|резултат|result|единици|units?|референтни|reference|код|code|бр\.|№|лаборатория|laboratory|лабораторията|подпис|signature|взет|collected|отпечатан|printed|издаден|issued|коментар|comment)\b/i;

const FLAG_RE = /^(H|L|HH|LL|\*|↑|↓|!|H\*|L\*|\+|-)$/;
const DIGITS_RE = /\d/;
const LETTERS_RE = /[A-Za-zА-Яа-я]{2,}/;
const LAB_CODE_RE = /^(?:\[?[A-Z]{0,3}\d{2,6}\]?|\d{1,4}\.)$/;
const QUALITATIVE_RE = /^(отрицателен|отрицателна|положителен|положителна|negative|positive|neg|pos|норма|следи|traces?)$/i;

export interface LineParseOptions {
  /** Explicit column indexes, for format-specific parsers. */
  columns?: { code?: number; name: number; value: number; unit?: number; range?: number; comment?: number };
}

export function parseResultLine(line: TextLine, opts: LineParseOptions = {}): DraftCandidate | null {
  const cells = line.cells.length > 1 ? line.cells.map((c) => c.trim()).filter(Boolean) : splitSpaced(line.text);
  if (cells.length < 2) return null;

  let code: string | null = null;
  let name: string;
  let valueCell: string;
  let unitCell: string | null = null;
  let rangeCell: string | null = null;
  let comment: string | null = null;

  if (opts.columns) {
    const c = opts.columns;
    name = cells[c.name] ?? '';
    valueCell = cells[c.value] ?? '';
    code = c.code !== undefined ? cells[c.code] ?? null : null;
    unitCell = c.unit !== undefined ? cells[c.unit] ?? null : null;
    rangeCell = c.range !== undefined ? cells[c.range] ?? null : null;
    comment = c.comment !== undefined ? cells[c.comment] ?? null : null;
  } else {
    let i = 0;
    if (LAB_CODE_RE.test(cells[0]!) && cells[1] && LETTERS_RE.test(cells[1])) {
      code = cells[0]!.replace(/[[\].]/g, '');
      i = 1;
    }
    // name = first cell with letters; value = first later cell containing digits
    name = cells[i]!;
    const valueIdx = cells.findIndex((c, idx) => idx > i && (DIGITS_RE.test(c) || QUALITATIVE_RE.test(c)));
    if (valueIdx < 0) return null;
    // cells between name and value that are not flags belong to the name ("Холестерол" "LDL")
    const between = cells.slice(i + 1, valueIdx).filter((c) => !FLAG_RE.test(c));
    if (between.length) name = [name, ...between].join(' ');
    valueCell = cells[valueIdx]!;
    const rest = cells.slice(valueIdx + 1).filter((c) => !FLAG_RE.test(c));
    for (const c of rest) {
      if (!unitCell && !parseRange(c) && (canonicalizeUnit(c) || looksLikeUnit(c))) unitCell = c;
      else if (!rangeCell && parseRange(c)) rangeCell = c;
      else if (!rangeCell && /\d/.test(c)) {
        // "35 - 52 µmol/L" combined cell
        const split = splitRangeAndUnit(c);
        if (split) {
          rangeCell = split.range;
          unitCell ??= split.unit;
        }
      } else if (!comment && LETTERS_RE.test(c)) comment = c;
    }
    // value and unit glued: "42 µmol/L"
    const glued = valueCell.match(/^([<>≤≥]?\s*[\d.,? ]+?)\s+(\S+)$/);
    if (glued && !unitCell && (canonicalizeUnit(glued[2]!) || looksLikeUnit(glued[2]!))) {
      valueCell = glued[1]!.trim();
      unitCell = glued[2]!;
    }
    // trailing flag glued to value: "53 H"
    const flag = valueCell.match(/^(.*\d)\s*(H|L|\*|↑|↓)$/);
    if (flag) valueCell = flag[1]!;
  }

  name = name.replace(/\s*[:*]+\s*$/, '').trim();
  if (!LETTERS_RE.test(name) || STOP_WORDS.test(name) || name.length > 80) return null;
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(valueCell.trim())) return null; // a date, not a value

  const issues: CandidateIssue[] = [];
  const parsed = parseLabNumber(valueCell);
  const qualitative = !parsed && QUALITATIVE_RE.test(valueCell.trim());
  if (!parsed && !qualitative) issues.push('unreadable_value');

  const unitCanonical = unitCell ? canonicalizeUnit(unitCell) : null;
  const unit = unitCanonical ?? (unitCell ? unitCell.trim() : null);
  if (!unitCell && !qualitative) issues.push('missing_unit');
  else if (unitCell && !unitCanonical) issues.push('unknown_unit');

  const range = parseRange(rangeCell);
  if (!range && !qualitative) issues.push('missing_range');

  let biomarker: Biomarker | undefined = matchBiomarker(name);
  if (biomarker && unitCanonical && !biomarker.supportedUnits.some((u) => areIdenticalUnits(u, unitCanonical))) {
    // e.g. "Neutrophils" reported as an absolute count (10⁹/L) vs. the % biomarker → don't merge
    biomarker = undefined;
  }
  if (!biomarker) issues.push('unknown_biomarker');

  if (parsed && range && isOrderOfMagnitudeOff(parsed.value, range)) issues.push('value_range_mismatch');

  // Reject rows that are clearly not results: no unit, no range, no known biomarker
  if (!biomarker && !range && !unitCanonical) return null;

  if (line.confidence < 0.85) issues.push('ocr_low_confidence');

  return {
    biomarkerId: biomarker?.id ?? null,
    originalName: name,
    rawLine: line.text.slice(0, 400),
    valueText: valueCell.trim(),
    valueNumeric: parsed?.value ?? null,
    valueComparator: (parsed?.comparator ?? null) as RangeComparator | null,
    unit,
    referenceRange: range,
    labCode: code,
    labComment: comment,
    page: line.page,
    confidence: scoreConfidence(issues, line.confidence),
    issues,
  };
}

/** Internal confidence score 0..1. Weights are heuristics, documented in docs/02-ARCHITECTURE.md. */
export function scoreConfidence(issues: CandidateIssue[], ocrConfidence = 1): number {
  const penalty: Record<CandidateIssue, number> = {
    unreadable_value: 0.3,
    not_found_in_source: 0.4,
    unknown_biomarker: 0.7,
    value_range_mismatch: 0.6,
    unknown_unit: 0.8,
    missing_unit: 0.8,
    ocr_low_confidence: 0.85,
    duplicate: 0.8,
    missing_range: 0.97,
  };
  let score = Math.min(1, ocrConfidence / 0.95);
  for (const i of new Set(issues)) score *= penalty[i];
  return Math.round(score * 100) / 100;
}

export const REVIEW_THRESHOLD = 0.85;

/** Flag likely decimal errors (e.g. "42" vs range 3.5–5.2 when "4,2" was meant). */
function isOrderOfMagnitudeOff(value: number, range: ReferenceRange): boolean {
  const ref = range.high ?? range.low;
  if (!ref || value === 0) return false;
  const ratio = Math.abs(value / ref);
  // A decimal-point slip changes a value 10×; 8× is the "please double-check" threshold.
  return ratio > 8 || ratio < 0.125;
}

function looksLikeUnit(s: string): boolean {
  return /^[a-zA-Zµμ%°/^*·.\d²³⁹¹⁰-]{1,16}$/.test(s) && /[a-zA-Zµμ%]/.test(s) && s.includes('/') ;
}

function splitRangeAndUnit(c: string): { range: string; unit: string | null } | null {
  const m = c.match(/^(.*?\d)\s+([^\d\s][^\s]*)$/);
  if (m && parseRange(m[1]!)) return { range: m[1]!, unit: m[2]! };
  return null;
}

/** For lines without detected cell gaps: split on 2+ spaces, else heuristically. */
function splitSpaced(text: string): string[] {
  const byGaps = text.split(/\s{2,}|\t/).map((s) => s.trim()).filter(Boolean);
  if (byGaps.length >= 2) return byGaps;
  // "Пикочна киселина 42 µmol/L 35 - 52" → name | value | unit | range
  const m = text.match(/^(.+?)\s+([<>≤≥]?\s*\d[\d.,?]*)\s*(H|L|\*|↑|↓)?\s+(\S+)?\s*(.*)$/);
  if (!m) return [text];
  return [m[1]!, m[2]!, m[4] ?? '', m[5] ?? ''].filter(Boolean);
}

/** Mark duplicates (same biomarker twice in one document). Keeps both – the user decides. */
export function markDuplicates(cands: DraftCandidate[]): DraftCandidate[] {
  const seen = new Map<string, number>();
  return cands.map((c) => {
    const key = c.biomarkerId ?? `name:${c.originalName.toLowerCase()}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n === 0) return c;
    return { ...c, issues: [...c.issues, 'duplicate'], confidence: Math.round(c.confidence * 80) / 100 };
  });
}
