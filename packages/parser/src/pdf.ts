import { ProcessingError, type OcrProvider, type TextLine } from './types';

/**
 * PDF text extraction with pdf.js. Runs in the API worker process (Node) or – in the
 * GitHub Pages local mode – in the user's browser (the browser build is injected with
 * setPdfjsLoader). Security: no eval, no font loading, no XFA/scripting; page cap by caller.
 */

// pdf.js 6 needs Promise.withResolvers (Node ≥ 22). Tiny polyfill for older local Node.
const P = Promise as unknown as { withResolvers?: () => unknown };
P.withResolvers ??= function withResolvers<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

// …and ArrayBuffer.prototype.transferToFixedLength (Node ≥ 21) – without it pages render blank.
const AB = ArrayBuffer.prototype as unknown as { transferToFixedLength?: (len?: number) => ArrayBuffer };
AB.transferToFixedLength ??= function transferToFixedLength(this: ArrayBuffer, len?: number) {
  const n = len ?? this.byteLength;
  const out = new ArrayBuffer(n);
  new Uint8Array(out).set(new Uint8Array(this, 0, Math.min(n, this.byteLength)));
  return out;
};

export type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
// Node default: the legacy build (path in a variable so browser bundlers don't include it)
const NODE_BUILD = 'pdfjs-dist/legacy/build/pdf.mjs';
let loader: () => Promise<PdfJs> = () => import(/* @vite-ignore */ NODE_BUILD) as Promise<PdfJs>;
let pdfjsPromise: Promise<PdfJs> | null = null;
/** Browsers inject their own pdf.js build (with its web worker). */
export function setPdfjsLoader(fn: () => Promise<PdfJs>) {
  loader = fn;
  pdfjsPromise = null;
}
function pdfjs(): Promise<PdfJs> {
  pdfjsPromise ??= loader();
  return pdfjsPromise;
}

/** Horizontal gap (in PDF points) that starts a new cell. */
const CELL_GAP = 12;
/** Vertical tolerance when grouping text runs into one line. */
const LINE_TOLERANCE = 3;

export interface OpenedPdf {
  pageCount: number;
  getPageLines(n: number): Promise<TextLine[]>;
  renderPagePng(n: number, scale?: number): Promise<Uint8Array>;
  destroy(): Promise<void>;
}

export async function openPdf(data: Uint8Array, maxPages: number): Promise<OpenedPdf> {
  if (!isPdf(data)) throw new ProcessingError('invalid_pdf');
  const lib = await pdfjs();
  let doc: Awaited<ReturnType<typeof lib.getDocument>['promise']>;
  // pdf.js ≥ 6 never uses eval (CVE-2024-4367 class of issues); fonts/XFA/scripting stay disabled
  const bytes = new Uint8Array(data);
  const load = () => lib.getDocument({
    data: new Uint8Array(bytes), // pdf.js detaches the buffer it receives
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    verbosity: 0,
  });
  const task = load();
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy();
    const name = (err as { name?: string }).name;
    if (name === 'PasswordException') throw new ProcessingError('encrypted_pdf');
    throw new ProcessingError('invalid_pdf', (err as Error).message);
  }
  if (doc.numPages > maxPages) {
    await task.destroy();
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
      // A fresh document per rendered page: pdf.js 6 stalls on a second sequential render of
      // the same document in Node. Only used for OCR of scanned pages, so the cost is small.
      const t = load();
      try {
        const d = await t.promise;
        const page = await d.getPage(n);
        const viewport = page.getViewport({ scale });
        // pdf.js' own canvas factory: @napi-rs/canvas in Node, <canvas> in browsers
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const factory = (d as any).canvasFactory;
        const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await page.render({ canvasContext: context, viewport, canvas } as any).promise;
        return typeof canvas.toBuffer === 'function'
          ? (canvas.toBuffer('image/png') as Uint8Array)
          : new Uint8Array(await (await new Promise<Blob>((res, rej) => canvas.toBlob((b: Blob | null) => (b ? res(b) : rej(new Error('render failed'))), 'image/png'))).arrayBuffer());
      } finally {
        await t.destroy();
      }
    },
    destroy: () => task.destroy(),
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
