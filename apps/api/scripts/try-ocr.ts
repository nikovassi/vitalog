import { readFile } from 'node:fs/promises';
import { processPdf, TesseractOcr } from '@vitalog/parser';
const ocr = new TesseractOcr({ cachePath: '../../storage/tessdata' });
const t = Date.now();
const r = await processPdf(new Uint8Array(await readFile('../../fixtures/pdfs/' + (process.argv[2] ?? 'scanned-bg.pdf'))), { maxPages: 30, ocr, onProgress: (p) => console.log(JSON.stringify(p)) });
console.log(r.usedOcr, r.candidates.length, JSON.stringify(r.meta), (Date.now() - t) + 'ms');
for (const c of r.candidates) console.log(`  ${c.biomarkerId ?? '??'} | ${c.originalName} | ${c.valueText} | ${c.unit} | ${c.referenceRange?.text} | ${c.confidence} ${c.issues}`);
await ocr.terminate();
