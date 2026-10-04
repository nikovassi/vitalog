import { describe, expect, it } from 'vitest';
import {
  BIOMARKERS, canonicalizeUnit, computeChange, computeStatus, describeChange, getBiomarker,
  matchBiomarker, parseLabNumber, toDisplayUnit, areIdenticalUnits,
} from '../src';

describe('parseLabNumber', () => {
  it.each([
    ['35', 35, null], ['35,0', 35, null], ['35.0', 35, null], ['< 0,5', 0.5, '<'],
    ['≥5', 5, '>='], ['1 234,5', 1234.5, null], ['-2,1', -2.1, null],
  ])('%s', (raw, value, cmp) => {
    expect(parseLabNumber(raw)).toEqual({ value, comparator: cmp });
  });
  it.each(['4?2', 'отрицателен', '35 µmol/L', '', '1.2.3', '12a'])('rejects %s', (raw) => {
    expect(parseLabNumber(raw)).toBeNull();
  });
});

describe('units', () => {
  it('canonicalizes spelling only', () => {
    expect(canonicalizeUnit('umol/l')).toBe('µmol/L');
    expect(canonicalizeUnit('μmol/L')).toBe('µmol/L'); // greek mu
    expect(canonicalizeUnit('µmol/l')).toBe('µmol/L'); // micro sign
    expect(canonicalizeUnit(' mmol / l ')).toBe('mmol/L');
    expect(canonicalizeUnit('x10^9/L')).toBe('10⁹/L');
    expect(canonicalizeUnit('furlongs')).toBeNull();
  });
  it('treats only true identities as identical', () => {
    expect(areIdenticalUnits('µIU/mL', 'mIU/L')).toBe(true);
    expect(areIdenticalUnits('mg/dL', 'mmol/L')).toBe(false);
  });
});

describe('biomarker catalog', () => {
  it('matches aliases across languages to one biomarker', () => {
    for (const name of ['Uric Acid', 'Uric acid', 'Пикочна киселина', 'UA', 'URIC']) {
      expect(matchBiomarker(name)?.id).toBe('uric_acid');
    }
  });
  it('does not guess on unknown names', () => {
    expect(matchBiomarker('Пикочна')).toBeUndefined();
    expect(matchBiomarker('Unknown marker')).toBeUndefined();
  });
  it('contains no reference ranges', () => {
    expect(BIOMARKERS.every((b) => b.referenceRange === null)).toBe(true);
  });
  it('converts only via explicit rules', () => {
    const ua = getBiomarker('uric_acid')!;
    expect(toDisplayUnit(ua, 5, 'mg/dL')).toEqual({ value: 297.4, unit: 'µmol/L' });
    expect(toDisplayUnit(ua, 42, 'umol/l')).toEqual({ value: 42, unit: 'µmol/L' });
    const tsh = getBiomarker('tsh')!;
    expect(toDisplayUnit(tsh, 2.1, 'µIU/mL')).toEqual({ value: 2.1, unit: 'mIU/L' });
    const vitd = getBiomarker('vit_d')!;
    expect(toDisplayUnit(vitd, 30, 'ng/mL')).toBeNull();
  });
});

describe('computeStatus', () => {
  const r = (low: number | null, high: number | null) => ({ low, high, text: null, source: 'laboratory' as const });
  it('uses the lab range', () => {
    expect(computeStatus(42, null, r(35, 52))).toBe('in_range');
    expect(computeStatus(53, null, r(35, 52))).toBe('above');
    expect(computeStatus(34.9, null, r(35, 52))).toBe('below');
    expect(computeStatus(52, null, r(35, 52))).toBe('in_range');
  });
  it('returns unknown without a range', () => {
    expect(computeStatus(42, null, null)).toBe('unknown');
    expect(computeStatus(42, null, r(null, null))).toBe('unknown');
  });
  it('handles censored values conservatively', () => {
    expect(computeStatus(0.5, '<', r(null, 5))).toBe('in_range');
    expect(computeStatus(0.5, '<', r(1, 5))).toBe('below');
    expect(computeStatus(10, '>', r(null, 5))).toBe('above');
    expect(computeStatus(3, '<', r(1, 5))).toBe('unknown');
  });
});

describe('computeChange', () => {
  it('describes numbers, not health', () => {
    const c = computeChange(42, 35);
    expect(c.direction).toBe('up');
    expect(c.percent).toBe(20);
    expect(describeChange(c)).toBe('Стойността се е увеличила с 20% спрямо предходното измерване.');
    expect(computeChange(5.1, 5.0).direction).toBe('stable');
    expect(computeChange(1, 0).percent).toBeNull();
  });
});
