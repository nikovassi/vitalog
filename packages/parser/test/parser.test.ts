import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MockProvider, NoopOcr, ProcessingError, TesseractOcr, parseLines, parseRange, parseResultLine,
  processPdf, redactForAi, REVIEW_THRESHOLD, type TextLine,
} from '../src';

const FIXTURES = path.resolve(__dirname, '../../../fixtures/pdfs');
const load = async (f: string) => new Uint8Array(await readFile(path.join(FIXTURES, f)));
const run = async (f: string, extra: Partial<Parameters<typeof processPdf>[1]> = {}) =>
  processPdf(await load(f), { maxPages: 30, ocr: new NoopOcr(), ...extra });
const line = (cells: string[], page = 1, confidence = 1): TextLine => ({ page, cells, text: cells.join(' '), confidence, y: 0 });

describe('parseRange', () => {
  it.each([
    ['35 - 52', 35, 52], ['35–52', 35, 52], ['3,9 - 6,1', 3.9, 6.1], ['(0.27 - 4.20)', 0.27, 4.2],
    ['< 5,2', null, 5.2], ['<5.2', null, 5.2], ['до 5,2', null, 5.2], ['> 1,0', 1, null], ['0,27 ÷ 4,2', 0.27, 4.2],
  ])('%s', (raw, low, high) => {
    expect(parseRange(raw)).toMatchObject({ low, high, source: 'laboratory' });
  });
  it('rejects reversed or textual ranges instead of guessing', () => {
    expect(parseRange('52 - 35')).toBeNull();
    expect(parseRange('отрицателен')).toBeNull();
  });
});

describe('parseResultLine', () => {
  it('normalizes value and unit spellings without changing the value', () => {
    for (const [v, u] of [['35,0', 'µmol/L'], ['35.0', 'umol/L'], ['35', 'µmol/l'], ['35', 'μmol/L']]) {
      const c = parseResultLine(line(['Uric acid', v!, u!, '202 - 416']))!;
      expect(c.biomarkerId).toBe('uric_acid');
      expect(c.valueNumeric).toBe(35);
      expect(c.valueText).toBe(v); // original kept
      expect(c.unit).toBe('µmol/L');
    }
  });
  it('handles value+unit in one cell and trailing flags', () => {
    const c = parseResultLine(line(['Глюкоза', '6,3 H', 'mmol/L', '3,9 - 6,1']))!;
    expect(c.valueNumeric).toBe(6.3);
    const d = parseResultLine({ page: 1, cells: [], text: 'Пикочна киселина 42 µmol/L 35 - 52', confidence: 1, y: 0 })!;
    expect(d).toMatchObject({ biomarkerId: 'uric_acid', valueNumeric: 42, unit: 'µmol/L' });
  });
  it('marks unreadable values and never invents a number', () => {
    const c = parseResultLine(line(['Пикочна киселина', '4?2', 'µmol/L', '202 - 416']))!;
    expect(c.valueNumeric).toBeNull();
    expect(c.issues).toContain('unreadable_value');
    expect(c.confidence).toBeLessThan(REVIEW_THRESHOLD);
  });
  it('does not merge an absolute count into a percentage biomarker', () => {
    const c = parseResultLine(line(['Neutrophils', '3,6', '10^9/L', '2,0 - 7,0']))!;
    expect(c.biomarkerId).toBeNull();
    expect(c.issues).toContain('unknown_biomarker');
  });
  it('flags a likely decimal error', () => {
    const c = parseResultLine(line(['Калий', '42', 'mmol/L', '3,5 - 5,1']))!;
    expect(c.issues).toContain('value_range_mismatch');
  });
  it('ignores header and metadata lines', () => {
    expect(parseResultLine(line(['Дата на вземане', '15.01.2025']))).toBeNull();
    expect(parseResultLine(line(['Тел.', '+359 000 000 101']))).toBeNull();
    expect(parseResultLine(line(['Показател', 'Резултат', 'Единици']))).toBeNull();
  });
  it('lowers confidence for low OCR confidence', () => {
    const c = parseResultLine(line(['Глюкоза', '5,4', 'mmol/L', '3,9 - 6,1'], 1, 0.6))!;
    expect(c.issues).toContain('ocr_low_confidence');
    expect(c.confidence).toBeLessThan(REVIEW_THRESHOLD);
  });
});

describe('PDF fixtures (text layer)', () => {
  it('BG lab "Алфа": all values, date, lab, patient', async () => {
    const r = await run('demo-2025-01-15-alpha.pdf');
    expect(r.usedOcr).toBe(false);
    expect(r.candidates.length).toBe(33);
    expect(r.meta).toMatchObject({ collectedAt: '2025-01-15', laboratoryName: 'Синтетична лаборатория „Алфа“', patientName: 'Николай Тестов (синтетичен пациент)' });
    const ua = r.candidates.find((c) => c.biomarkerId === 'uric_acid')!;
    expect(ua).toMatchObject({ valueNumeric: 312, unit: 'µmol/L', referenceRange: { low: 202, high: 416 } });
    expect(r.candidates.every((c) => c.confidence >= REVIEW_THRESHOLD)).toBe(true);
  });

  it('lab-specific format "Бета" is detected and keeps lab codes', async () => {
    const r = await run('demo-2025-10-10-beta.pdf');
    expect(r.meta.formatId).toBe('synthetic-beta-v1');
    expect(r.candidates).toHaveLength(19);
    expect(r.candidates.find((c) => c.biomarkerId === 'glucose')).toMatchObject({ labCode: '2001', valueNumeric: 6.3 });
  });

  it('English lab with US units keeps original units', async () => {
    const r = await run('english-us-units.pdf');
    expect(r.meta.collectedAt).toBe('2025-03-20');
    expect(r.candidates.find((c) => c.biomarkerId === 'glucose')).toMatchObject({ valueNumeric: 102, unit: 'mg/dL' });
    expect(r.candidates.find((c) => c.biomarkerId === 'hgb')).toMatchObject({ valueNumeric: 14.6, unit: 'g/dL' });
  });

  it('multi-page PDF keeps page numbers', async () => {
    const r = await run('multipage-bg.pdf');
    expect(r.pageCount).toBeGreaterThan(2);
    expect(new Set(r.candidates.map((c) => c.page)).size).toBeGreaterThan(2);
    expect(r.candidates).toHaveLength(33);
  });

  it('edge cases are flagged, not fixed', async () => {
    const r = await run('edge-cases.pdf');
    expect(r.meta.collectedAt).toBeNull(); // missing date → user must enter it
    const issues = (name: string) => r.candidates.filter((c) => c.originalName === name).map((c) => c.issues);
    expect(issues('Пикочна киселина')[0]).toContain('unreadable_value');
    expect(issues('Измислен показател XYZ')[0]).toContain('unknown_biomarker');
    expect(issues('Креатинин')[0]).toContain('missing_range');
    expect(issues('Глюкоза')[0]).toContain('missing_unit');
    expect(issues('Глюкоза')[1]).toContain('duplicate');
    expect(r.candidates.find((c) => c.originalName === 'CRP')).toMatchObject({ valueNumeric: 0.5, valueComparator: '<' });
    // uncertain rows come first
    expect(r.candidates[0]!.confidence).toBeLessThan(REVIEW_THRESHOLD);
  });

  it.each([
    ['encrypted.pdf', 'encrypted_pdf'],
    ['corrupted.pdf', 'invalid_pdf'],
    ['not-a-pdf.pdf', 'invalid_pdf'],
    ['scanned-bg.pdf', 'no_text'], // without OCR
    ['no-results.pdf', 'unrecognized_document'],
  ])('%s → %s', async (file, code) => {
    await expect(run(file)).rejects.toMatchObject({ code });
    await expect(run(file)).rejects.toBeInstanceOf(ProcessingError);
  });

  it('rejects documents over the page limit', async () => {
    await expect(processPdf(await load('multipage-bg.pdf'), { maxPages: 2, ocr: new NoopOcr() })).rejects.toMatchObject({ code: 'too_many_pages' });
  });

  it('reports real per-page progress', async () => {
    const updates: string[] = [];
    await run('multipage-bg.pdf', { onProgress: (p) => void updates.push(`${p.stage}:${p.pagesDone ?? ''}`) });
    expect(updates).toContain('extracting_text:1');
    expect(updates.at(-1)).toBe('validating:');
  });
});

describe('AI structuring safeguards', () => {
  it('flags AI values that are not in the source text', async () => {
    const ai = new MockProvider({
      collectedAt: '2025-01-01',
      laboratoryName: null,
      results: [
        { name: 'Измислен показател XYZ', value: '12,5', unit: 'mmol/L', referenceRange: '10 - 20', page: 1 },
        { name: 'Глюкоза', value: '9,9', unit: 'mmol/L', referenceRange: '3,9 - 6,1', page: 1 }, // hallucinated
      ],
    });
    // edge-cases has low average confidence → AI is consulted
    const r = await run('edge-cases.pdf', { ai });
    expect(ai.calls).toBe(1);
    expect(r.usedAi).toBe(true);
    const hallucinated = r.candidates.find((c) => c.valueText === '9,9')!;
    expect(hallucinated.issues).toContain('not_found_in_source');
    expect(hallucinated.confidence).toBeLessThan(REVIEW_THRESHOLD);
    const real = r.candidates.find((c) => c.valueText === '12,5')!;
    expect(real.issues).not.toContain('not_found_in_source');
  });

  it('is not called for clean documents', async () => {
    const ai = new MockProvider();
    await run('demo-2025-01-15-alpha.pdf', { ai });
    expect(ai.calls).toBe(0);
  });

  it('redacts direct identifiers before sending text', () => {
    const out = redactForAi('Пациент: Иван Тестов\nЕГН: 0000000000\nГлюкоза 5,4 mmol/L\nтест 1234567890 a@b.com');
    expect(out).not.toContain('Иван');
    expect(out).toContain('Глюкоза 5,4');
    expect(out).toContain('[ID]');
    expect(out).toContain('[EMAIL]');
  });
});

describe('parseLines (format registry)', () => {
  it('falls back to the generic parser', () => {
    const r = parseLines([line(['Глюкоза', '5,4', 'mmol/L', '3,9 - 6,1'])]);
    expect(r.meta.formatId).toBe('generic-table');
    expect(r.candidates).toHaveLength(1);
  });
});

// OCR downloads Tesseract language data on first run → opt-in
describe.runIf(process.env.RUN_OCR_TESTS === '1')('OCR (scanned PDF)', () => {
  it('extracts results from an image-only PDF and flags uncertain rows', async () => {
    const ocr = new TesseractOcr({ cachePath: path.resolve(__dirname, '../../../storage/tessdata') });
    try {
      const r = await run('scanned-bg.pdf', { ocr });
      expect(r.usedOcr).toBe(true);
      expect(r.meta.collectedAt).toBe('2025-06-15');
      expect(r.candidates.length).toBeGreaterThan(20);
      expect(r.candidates.some((c) => c.confidence < REVIEW_THRESHOLD)).toBe(true);
    } finally {
      await ocr.terminate();
    }
  }, 120_000);
});
