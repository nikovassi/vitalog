import { openPdf, ocrLinesToTextLines } from './pdf';
import { selectParser } from './formats/registry';
import { extractMeta, parseDate } from './meta';
import { markDuplicates, parseResultLine, REVIEW_THRESHOLD } from './normalize';
import { redactForAi, type AIProvider } from './ai/provider';
import {
  ProcessingError,
  type DraftCandidate, type ExtractedDocument, type OcrProvider, type ParsedReport, type ProgressUpdate, type TextLine,
} from './types';

export interface PipelineOptions {
  maxPages: number;
  ocr: OcrProvider;
  /** Only passed when AI is configured AND the user consented. */
  ai?: AIProvider | null;
  onProgress?: (p: ProgressUpdate) => Promise<void> | void;
  /** Minimum characters of real text per page before we fall back to OCR. */
  minTextCharsPerPage?: number;
}

export interface PipelineResult extends ParsedReport {
  pageCount: number;
  usedOcr: boolean;
  usedAi: boolean;
}

/**
 * PDF → text (→ OCR) → format parser → (AI, optional) → validation.
 * Progress updates reflect real work (pages processed), never a simulated timer.
 */
export async function processPdf(data: Uint8Array, opts: PipelineOptions): Promise<PipelineResult> {
  const report = async (p: ProgressUpdate) => opts.onProgress?.(p);
  const pdf = await openPdf(data, opts.maxPages);
  try {
    const total = pdf.pageCount;
    await report({ stage: 'extracting_text', stageProgress: 0, pagesTotal: total, pagesDone: 0 });
    const lines: TextLine[] = [];
    const pagesNeedingOcr: number[] = [];
    for (let n = 1; n <= total; n++) {
      const pageLines = await pdf.getPageLines(n);
      const chars = pageLines.reduce((a, l) => a + l.text.replace(/\s/g, '').length, 0);
      if (chars < (opts.minTextCharsPerPage ?? 40)) pagesNeedingOcr.push(n);
      else lines.push(...pageLines);
      await report({ stage: 'extracting_text', stageProgress: Math.round((n / total) * 100), pagesTotal: total, pagesDone: n });
    }

    let usedOcr = false;
    if (pagesNeedingOcr.length) {
      if (opts.ocr.id === 'none') {
        if (!lines.length) throw new ProcessingError('no_text');
      } else {
        usedOcr = true;
        await report({ stage: 'ocr', stageProgress: 0, pagesTotal: pagesNeedingOcr.length, pagesDone: 0 });
        let done = 0;
        for (const n of pagesNeedingOcr) {
          try {
            const png = await pdf.renderPagePng(n);
            const ocrLines = await opts.ocr.recognize(png, n);
            lines.push(...ocrLinesToTextLines(ocrLines, n));
          } catch (err) {
            throw new ProcessingError('ocr_failed', (err as Error).message);
          }
          done++;
          await report({ stage: 'ocr', stageProgress: Math.round((done / pagesNeedingOcr.length) * 100), pagesTotal: pagesNeedingOcr.length, pagesDone: done });
        }
        if (!lines.length) throw new ProcessingError('no_text');
      }
    }
    lines.sort((a, b) => a.page - b.page);

    const doc: ExtractedDocument = { pageCount: total, lines, usedOcr };
    await report({ stage: 'parsing', stageProgress: 0 });
    const parser = selectParser(doc);
    let parsed = parser.parse(doc);
    await report({ stage: 'parsing', stageProgress: 100 });

    let usedAi = false;
    if (opts.ai && needsAi(parsed)) {
      await report({ stage: 'ai_structuring', stageProgress: 0 });
      try {
        parsed = await structureWithAi(doc, parsed, opts.ai);
        usedAi = true;
      } catch {
        // AI is an optional helper: fall back to the deterministic result
      }
      await report({ stage: 'ai_structuring', stageProgress: 100 });
    }

    await report({ stage: 'normalizing', stageProgress: 100 });
    await report({ stage: 'validating', stageProgress: 0 });
    if (!parsed.candidates.length) {
      throw new ProcessingError(doc.lines.length === 0 ? 'no_text' : 'unrecognized_document');
    }
    // Uncertain rows first on the review screen
    parsed.candidates.sort((a, b) => Number(a.confidence >= REVIEW_THRESHOLD) - Number(b.confidence >= REVIEW_THRESHOLD));
    await report({ stage: 'validating', stageProgress: 100 });
    return { ...parsed, pageCount: total, usedOcr, usedAi };
  } finally {
    await pdf.destroy();
  }
}

function needsAi(parsed: ParsedReport): boolean {
  if (parsed.candidates.length < 3) return true;
  const uncertain = parsed.candidates.filter((c) => c.confidence < REVIEW_THRESHOLD).length;
  return uncertain / parsed.candidates.length > 0.25;
}

/**
 * AI output is re-parsed by our own normalizer, and every value must literally appear in the
 * document text on a line that also contains the name – otherwise it is flagged.
 */
async function structureWithAi(doc: ExtractedDocument, fallback: ParsedReport, ai: AIProvider): Promise<ParsedReport> {
  const text = doc.lines.map((l) => l.cells.join('  |  ')).join('\n');
  const out = await ai.structure(redactForAi(text));
  const sourceLines = doc.lines.map((l) => l.text.toLowerCase());
  const candidates: DraftCandidate[] = [];
  for (const r of out.results) {
    const line: TextLine = {
      page: r.page ?? 1,
      text: [r.name, r.value, r.unit, r.referenceRange].filter(Boolean).join('  '),
      cells: [r.name, r.value, r.unit ?? '', r.referenceRange ?? ''].filter((c) => c !== ''),
      confidence: 1,
      y: 0,
    };
    const cand = parseResultLine(line, { columns: { name: 0, value: 1, unit: r.unit ? 2 : undefined, range: r.referenceRange ? (r.unit ? 3 : 2) : undefined } });
    if (!cand) continue;
    const valueKey = r.value.trim().toLowerCase();
    const nameKey = r.name.trim().toLowerCase();
    const found = sourceLines.some((l) => l.includes(nameKey) && l.includes(valueKey));
    if (!found) {
      cand.issues.push('not_found_in_source');
      cand.confidence = Math.min(cand.confidence, 0.4);
    }
    cand.rawLine = `[AI] ${line.text}`;
    candidates.push(cand);
  }
  if (!candidates.length) return fallback;
  const marked = markDuplicates(candidates);
  const meta = extractMeta(doc, marked, `${fallback.meta.formatId}+ai`);
  if (!meta.collectedAt && out.collectedAt) meta.collectedAt = parseDate(out.collectedAt);
  if (!meta.laboratoryName && out.laboratoryName) meta.laboratoryName = out.laboratoryName;
  return { meta, candidates: marked };
}

/** Parse already-extracted lines (used by tests and by future import sources). */
export function parseLines(lines: TextLine[]): ParsedReport {
  const doc: ExtractedDocument = { pageCount: Math.max(1, ...lines.map((l) => l.page)), lines, usedOcr: false };
  return selectParser(doc).parse(doc);
}
