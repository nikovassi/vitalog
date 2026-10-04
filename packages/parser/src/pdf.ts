import { ProcessingError, type OcrProvider, type TextLine } from './types';

/**
 * PDF text extraction with pdf.js. Runs in the worker process only.
 * Security: eval disabled, no font loading, no scripting; page count capped by caller.
 */

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;
function pdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

/** Horizontal gap (in PDF points) that starts a new cell. */
const CELL_GAP = 12;
/** Vertical tolerance when grouping text runs into one line. */
const LINE_TOLERANCE = 3;

export interface OpenedPdf {
  pageCount: number;
  getPageLines(n: number): Promise<TextLine[]>;
  renderPagePng(n: number, scale?: number): Promise<Buffer>;
  destroy(): Promise<void>;
}

export async function openPdf(data: Uint8Array, maxPages: number): Promise<OpenedPdf> {
  if (!isPdf(data)) throw new ProcessingError('invalid_pdf');
  const lib = await pdfjs();
  let doc: Awaited<ReturnType<typeof lib.getDocument>['promise']>;
  try {
    doc = await lib.getDocument({
      data: new Uint8Array(data), // pdf.js detaches the buffer it receives
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      verbosity: 0,
    }).promise;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'PasswordException') throw new ProcessingError('encrypted_pdf');
    throw new ProcessingError('invalid_pdf', (err as Error).message);
  }
  if (doc.numPages > maxPages) {
    await doc.destroy();
    throw new ProcessingError('too_many_pages');
  }
  return {
    pageCount: doc.numPages,
    async getPageLines(n) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const runs: Run[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [, , , , x, y] = item.transform as number[];
        runs.push({ str: item.str, x: x!, y: y!, w: item.width });
      }
      page.cleanup();
      return groupRuns(runs, n);
    },
    async renderPagePng(n, scale = 2.5) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      // Use pdf.js' own Node canvas factory (@napi-rs/canvas, version pinned by pdf.js)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const factory = (doc as any).canvasFactory;
      const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page.render({ canvasContext: context, viewport, canvas } as any).promise;
      const png: Buffer = canvas.toBuffer('image/png');
      factory.destroy({ canvas, context });
      page.cleanup();
      return png;
    },
    destroy: () => doc.destroy(),
  };
}

export function isPdf(data: Uint8Array): boolean {
  // "%PDF-" may be preceded by up to 1024 bytes of junk per spec, but we require it at 0
  // (OWASP: verify magic bytes, be strict).
  return data.length > 5 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46 && data[4] === 0x2d;
}

interface Run { str: string; x: number; y: number; w: number }

function groupRuns(runs: Run[], page: number): TextLine[] {
  // PDF y grows upward: sort top→bottom, then left→right
  runs.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: Run[][] = [];
  for (const r of runs) {
    const row = rows.find((rw) => Math.abs(rw[0]!.y - r.y) <= LINE_TOLERANCE);
    if (row) row.push(r);
    else rows.push([r]);
  }
  return rows
    .map((row) => {
      row.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let current = '';
      let lastEnd = -Infinity;
      for (const r of row) {
        const gap = r.x - lastEnd;
        if (current && gap > CELL_GAP) {
          cells.push(current.trim());
          current = r.str;
        } else {
          current += (current && gap > 1 && !current.endsWith(' ') && !r.str.startsWith(' ') ? ' ' : '') + r.str;
        }
        lastEnd = r.x + r.w;
      }
      if (current.trim()) cells.push(current.trim());
      return { page, text: cells.join(' '), cells, confidence: 1, y: row[0]!.y };
    })
    .filter((l) => l.text.trim().length > 0);
}

/** Convert OCR output to TextLines, splitting cells at large word gaps (pixels). */
export function ocrLinesToTextLines(
  lines: Awaited<ReturnType<OcrProvider['recognize']>>,
  page: number,
  gapPx = 40,
): TextLine[] {
  return lines.map((l) => {
    const cells: string[] = [];
    let current = '';
    let lastEnd = -Infinity;
    for (const w of l.words) {
      if (current && w.x0 - lastEnd > gapPx) {
        cells.push(current);
        current = w.text;
      } else current = current ? `${current} ${w.text}` : w.text;
      lastEnd = w.x1;
    }
    if (current) cells.push(current);
    return { page, text: cells.join(' '), cells, confidence: l.confidence, y: l.y };
  });
}
