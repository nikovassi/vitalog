/**
 * Generates SYNTHETIC parser fixtures into /fixtures/pdfs. No real patient data.
 * Run: npm run fixtures
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPdf } from '@vitalog/parser';
import { imagesToPdf, renderLabPdf, renderTextPdf } from '../src/demo/lab-pdf';
import { DEMO_LABS, demoReportSpecs } from '../src/demo/data';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/pdfs');

async function main() {
  await mkdir(OUT, { recursive: true });
  const write = (name: string, data: Buffer | Uint8Array) => writeFile(path.join(OUT, name), data);

  // 1–5: the demo history in three different lab formats (BG alpha, BG beta w/ codes, EN gamma US units)
  for (const { date, spec } of demoReportSpecs()) {
    await write(`demo-${date}-${spec.style}.pdf`, await renderLabPdf(spec));
  }

  // Multi-page: header repeated on every page
  const multi = demoReportSpecs()[0]!.spec;
  await write('multipage-bg.pdf', await renderLabPdf({ ...multi, rowsPerPage: 8 }));

  // Edge cases: unreadable value, unknown biomarker, absolute neutrophils (must not merge
  // with %), qualitative value, censored value, missing unit, missing range, duplicate,
  // likely decimal error, missing date.
  await write(
    'edge-cases.pdf',
    await renderLabPdf({
      style: 'alpha',
      lab: { name: 'Синтетична лаборатория „Делта“' },
      patientName: 'Тестов Пациент (синтетичен)',
      collectedAt: '',
      rows: [
        { name: 'Пикочна киселина', value: '4?2', unit: 'µmol/L', range: '202 - 416' },
        { name: 'Измислен показател XYZ', value: '12,5', unit: 'mmol/L', range: '10 - 20' },
        { name: 'Neutrophils', value: '3,6', unit: '10^9/L', range: '2,0 - 7,0' },
        { name: 'CRP', value: '< 0,5', unit: 'mg/L', range: '< 5' },
        { name: 'Глюкоза', value: '5,2', range: '3,9 - 6,1' },
        { name: 'Креатинин', value: '90', unit: 'µmol/L' },
        { name: 'Глюкоза', value: '5,3', unit: 'mmol/L', range: '3,9 - 6,1' },
        { name: 'Калий', value: '42', unit: 'mmol/L', range: '3,5 - 5,1' },
        { name: 'TSH', value: '2,1', unit: 'mIU/L', range: '0,27 - 4,2' },
      ],
    }),
  );

  // Scanned: render the first demo report to images and wrap them in an image-only PDF
  const textPdf = await renderLabPdf(demoReportSpecs()[1]!.spec);
  const opened = await openPdf(new Uint8Array(textPdf), 10);
  const pngs: Buffer[] = [];
  for (let n = 1; n <= opened.pageCount; n++) pngs.push(await opened.renderPagePng(n, 2.5));
  await opened.destroy();
  await write('scanned-bg.pdf', await imagesToPdf(pngs));

  // Not a lab report
  await write('no-results.pdf', await renderTextPdf('Амбулаторен лист (синтетичен)', [
    'Това е синтетичен документ без лабораторни стойности.',
    'Пациентът е посетил кабинета за консултация. Няма приложени изследвания.',
  ]));

  // Password-protected
  await write('encrypted.pdf', await renderLabPdf({ ...demoReportSpecs()[0]!.spec, userPassword: 'test-only' }));

  // Corrupted / wrong type
  const good = await renderLabPdf(demoReportSpecs()[0]!.spec);
  await write('corrupted.pdf', good.subarray(0, 900));
  await write('not-a-pdf.pdf', Buffer.from('<html><body>This is not a PDF</body></html>'));

  // English, different lab, US units only
  await write('english-us-units.pdf', await renderLabPdf({
    style: 'gamma',
    lab: DEMO_LABS.gamma,
    patientName: 'Test Patient (synthetic)',
    collectedAt: '2025-03-20',
    rows: [
      { name: 'Glucose', value: '102', flag: 'H', unit: 'mg/dL', range: '70 - 99' },
      { name: 'Creatinine', value: '1.01', unit: 'mg/dL', range: '0.70 - 1.30' },
      { name: 'Uric acid', value: '5.9', unit: 'mg/dL', range: '3.4 - 7.0' },
      { name: 'Total cholesterol', value: '188', unit: 'mg/dL', range: '< 200' },
      { name: 'HDL cholesterol', value: '48', unit: 'mg/dL', range: '> 39' },
      { name: 'Hemoglobin', value: '14.6', unit: 'g/dL', range: '13.2 - 17.1' },
    ],
  }));

  console.log(`Fixtures written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
