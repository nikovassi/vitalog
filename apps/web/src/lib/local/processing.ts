/**
 * In-browser PDF pipeline for local mode: the same @vitalog/parser code as the server
 * (text layer → OCR for scanned pages → lab formats → normalization → confidence),
 * running entirely on the user's device.
 */
import { processPdf, setPdfjsLoader, TesseractOcr, type PdfJs, type PipelineResult, type ProgressUpdate } from '@vitalog/parser';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export const MAX_UPLOAD_MB = 15;
export const MAX_PDF_PAGES = 30;

setPdfjsLoader(async () => {
  const lib = (await import('pdfjs-dist')) as unknown as PdfJs;
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  return lib;
});

/**
 * OCR (Tesseract, Bulgarian + English) runs in a web worker in this browser. The OCR engine
 * and the language data are downloaded from a public CDN the first time a scanned document is
 * processed – only the program files are downloaded, the document itself never leaves the device.
 */
let ocr: TesseractOcr | null = null;
const getOcr = () => (ocr ??= new TesseractOcr({ langs: 'bul+eng' }));

export function processInBrowser(bytes: Uint8Array, onProgress: (p: ProgressUpdate) => void): Promise<PipelineResult> {
  return processPdf(bytes, { maxPages: MAX_PDF_PAGES, ocr: getOcr(), ai: null, onProgress });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
