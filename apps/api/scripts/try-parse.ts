import { readFile } from 'node:fs/promises';
import { processPdf, NoopOcr } from '@vitalog/parser';
const dir = '/home/nikolay-vasilev/projects/vitalog/fixtures/pdfs/';
for (const f of process.argv.slice(2)) {
  try {
    const r = await processPdf(new Uint8Array(await readFile(dir + f)), { maxPages: 30, ocr: new NoopOcr() });
    console.log(`\n== ${f}: ${r.candidates.length} cands, meta=`, JSON.stringify(r.meta));
    for (const c of r.candidates) console.log(`  ${c.biomarkerId ?? '??'} | ${c.originalName} | ${c.valueText}→${c.valueNumeric} ${c.valueComparator ?? ''} | ${c.unit} | ${c.referenceRange ? c.referenceRange.low + '..' + c.referenceRange.high : '-'} | p${c.page} | ${c.confidence} ${c.issues.join(',')}`);
  } catch (e) { console.log(`\n== ${f}: ERROR ${(e as any).code ?? e}`); }
}
