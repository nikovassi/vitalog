/**
 * Unit handling. Two strictly separated operations:
 *  1. canonicalizeUnit – purely syntactic spelling normalization ("umol/l" → "µmol/L").
 *     Only spellings that denote the *same* unit are merged.
 *  2. conversions – numeric conversion, only via explicit per-biomarker rules
 *     (see biomarkers.ts). Never applied implicitly.
 */

/** Spelling variants → canonical spelling. Keys are compared after compactUnit(). */
const UNIT_SPELLINGS: Record<string, string> = {
  'umol/l': 'µmol/L',
  'µmol/l': 'µmol/L',
  'mkmol/l': 'µmol/L',
  'мкмол/л': 'µmol/L',
  'mmol/l': 'mmol/L',
  'ммол/л': 'mmol/L',
  'nmol/l': 'nmol/L',
  'нмол/л': 'nmol/L',
  'pmol/l': 'pmol/L',
  'пмол/л': 'pmol/L',
  'mmol/mol': 'mmol/mol',
  'mg/dl': 'mg/dL',
  'мг/дл': 'mg/dL',
  'mg/l': 'mg/L',
  'мг/л': 'mg/L',
  'g/l': 'g/L',
  'г/л': 'g/L',
  'g/dl': 'g/dL',
  'ng/ml': 'ng/mL',
  'нг/мл': 'ng/mL',
  'µg/l': 'µg/L',
  'ug/l': 'µg/L',
  'pg/ml': 'pg/mL',
  'pg': 'pg',
  'пг': 'pg',
  'fl': 'fL',
  'фл': 'fL',
  'u/l': 'U/L',
  'е/л': 'U/L',
  'iu/l': 'IU/L',
  'iu/ml': 'IU/mL',
  'mu/l': 'mU/L',
  'miu/l': 'mIU/L',
  'µiu/ml': 'µIU/mL',
  'uiu/ml': 'µIU/mL',
  'µu/ml': 'µIU/mL',
  'uu/ml': 'µIU/mL',
  'mm/h': 'mm/h',
  'mm/hr': 'mm/h',
  'мм/ч': 'mm/h',
  '%': '%',
  'l/l': 'L/L',
  'л/л': 'L/L',
  '10^9/l': '10⁹/L',
  '10*9/l': '10⁹/L',
  'x10^9/l': '10⁹/L',
  'x10*9/l': '10⁹/L',
  '10e9/l': '10⁹/L',
  '10⁹/l': '10⁹/L',
  'g/l(10^9)': '10⁹/L',
  'giga/l': '10⁹/L',
  '10^12/l': '10¹²/L',
  '10*12/l': '10¹²/L',
  'x10^12/l': '10¹²/L',
  'x10*12/l': '10¹²/L',
  '10e12/l': '10¹²/L',
  '10¹²/l': '10¹²/L',
  'tera/l': '10¹²/L',
  'ml/min/1.73m2': 'mL/min/1.73m²',
  'ml/min/1,73m2': 'mL/min/1.73m²',
  'ml/min/1.73m²': 'mL/min/1.73m²',
  'ml/min/1,73m²': 'mL/min/1.73m²',
  'ml/min': 'mL/min',
};

/** Remove whitespace, unify micro signs (µ U+00B5, μ U+03BC) and lowercase. */
export function compactUnit(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, '')
    .replace(/[μµ]/g, 'µ')
    .toLowerCase();
}

/** Returns the canonical spelling, or null if the unit is not recognised. */
export function canonicalizeUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = compactUnit(raw);
  if (!key) return null;
  return UNIT_SPELLINGS[key] ?? null;
}

/**
 * Units that are exactly the same quantity under different names (identity, factor 1).
 * 1 µIU/mL = 1 mIU/L = 1 mU/L (micro per milli = milli per litre);
 * 1 ng/mL = 1 µg/L; 1 U/L = 1 IU/L (IUB enzyme unit).
 * 10⁹/L is sometimes written G/L – handled via spellings above.
 */
const IDENTITY_GROUPS: string[][] = [
  ['µIU/mL', 'mIU/L', 'mU/L'],
  ['ng/mL', 'µg/L'],
  ['U/L', 'IU/L'],
];

export function areIdenticalUnits(a: string, b: string): boolean {
  if (a === b) return true;
  return IDENTITY_GROUPS.some((g) => g.includes(a) && g.includes(b));
}

export interface ParsedNumber {
  value: number;
  comparator: '<' | '<=' | '>' | '>=' | null;
}

/**
 * Parse a lab value as printed. Accepts "35", "35,0", "35.0", "< 0,5", "≤5", "1 234,5".
 * Rejects anything ambiguous (e.g. "1,234" could be 1.234 or 1234 → treated as 1.234 only
 * because BG labs use comma decimals; thousands separators must be spaces). Returns null if
 * the text is not a clean number – the caller then flags the value as unreadable.
 */
export function parseLabNumber(raw: string): ParsedNumber | null {
  let s = raw.trim().replace(/ /g, ' ');
  let comparator: ParsedNumber['comparator'] = null;
  const cmp = s.match(/^(<=|>=|≤|≥|<|>)\s*/);
  if (cmp) {
    const c = cmp[1]!;
    comparator = c === '≤' ? '<=' : c === '≥' ? '>=' : (c as ParsedNumber['comparator']);
    s = s.slice(cmp[0].length);
  }
  // thousands separated by a single space: "1 234,5"
  if (/^\d{1,3}( \d{3})+([.,]\d+)?$/.test(s)) s = s.replace(/ /g, '');
  if (!/^[+-]?\d+([.,]\d+)?$/.test(s)) return null;
  const value = Number(s.replace(',', '.'));
  if (!Number.isFinite(value)) return null;
  return { value, comparator };
}

/** Number of decimals as printed – used to avoid inventing precision when displaying. */
export function printedDecimals(raw: string): number {
  const m = raw.match(/[.,](\d+)\s*$/);
  return m ? m[1]!.length : 0;
}
