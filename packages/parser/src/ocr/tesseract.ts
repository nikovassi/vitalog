import type { OcrLine, OcrProvider } from '../types';

/**
 * Self-hosted OCR (Tesseract, bul+eng). Runs inside our worker – document images never leave
 * our infrastructure. In production set TESSERACT_LANG_PATH to a local copy of
 * tessdata_best (bul.traineddata, eng.traineddata) so nothing is fetched at runtime.
 */
export class TesseractOcr implements OcrProvider {
  id = 'tesseract';
  private worker: Promise<import('tesseract.js').Worker> | null = null;

  constructor(private opts: { langs?: string; langPath?: string; cachePath?: string } = {}) {}

  private getWorker() {
    this.worker ??= import('tesseract.js').then(({ createWorker }) =>
      createWorker(this.opts.langs ?? 'bul+eng', 1, {
        ...(this.opts.langPath ? { langPath: this.opts.langPath } : {}),
        ...(this.opts.cachePath ? { cachePath: this.opts.cachePath } : {}),
        logger: () => {},
      }),
    );
    return this.worker;
  }

  async recognize(png: Buffer): Promise<OcrLine[]> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(png, {}, { blocks: true });
    const lines: OcrLine[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const words = line.words
            .filter((w) => w.text.trim())
            .map((w) => ({ text: w.text.trim(), x0: w.bbox.x0, x1: w.bbox.x1, confidence: w.confidence / 100 }));
          if (!words.length) continue;
          const minConf = Math.min(...words.map((w) => w.confidence));
          lines.push({ words, y: line.bbox.y0, confidence: (line.confidence / 100 + minConf) / 2 });
        }
      }
    }
    return lines.sort((a, b) => a.y - b.y);
  }

  async terminate() {
    if (this.worker) await (await this.worker).terminate();
    this.worker = null;
  }
}

/** Used when OCR is disabled: scanned PDFs fail with a clear "no_text" message. */
export class NoopOcr implements OcrProvider {
  id = 'none';
  async recognize(): Promise<OcrLine[]> {
    return [];
  }
}
