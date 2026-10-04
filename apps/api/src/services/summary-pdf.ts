import PDFDocument from 'pdfkit';
import {
  DISCLAIMER, describeChange, formatDate, formatNumber, formatRange, STATUS_LABELS, STATUS_SYMBOL,
  type BiomarkerSummary, type SeriesPoint, type Specialist,
} from '@vitalog/shared';
import { FONT_BOLD, FONT_REGULAR } from '../demo/lab-pdf';

/**
 * "Медицинско обобщение" PDF. Contains ONLY the sections and biomarkers the user selected.
 * Factual: values, lab ranges, changes. No interpretation.
 */
export interface SummaryInput {
  patientName: string | null;
  from: string | null;
  to: string | null;
  biomarkers: Array<{ summary: BiomarkerSummary; series: SeriesPoint[] }>;
  includeCharts: boolean;
  includeHistory: boolean;
  specialists: Specialist[] | null;
  documents: Array<{ name: string; documentDate: string | null; category: string }> | null;
}

const C = { ink: '#1E2329', muted: '#5B6470', accent: '#0E7C74', amber: '#B45309', line: '#D9DEE3', band: '#E3F3F1' };

export function renderSummaryPdf(d: SummaryInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'Медицинско обобщение', Creator: 'Vitalog' }, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('r', FONT_REGULAR).registerFont('b', FONT_BOLD);
    const W = doc.page.width - 96;

    doc.font('b').fontSize(20).fillColor(C.ink).text('Медицинско обобщение');
    doc.moveDown(0.3).font('r').fontSize(10).fillColor(C.muted);
    if (d.patientName) doc.text(`Пациент: ${d.patientName}`);
    doc.text(`Период: ${d.from ? formatDate(d.from) : 'от началото'} – ${d.to ? formatDate(d.to) : 'днес'}`);
    doc.text(`Генерирано: ${formatDate(new Date().toISOString())} · Vitalog`);
    doc.moveDown(0.6).fontSize(8.5).fillColor(C.muted).text(DISCLAIMER, { width: W });
    doc.moveDown(1);

    if (d.biomarkers.length) {
      section(doc, 'Последни резултати');
      table(doc, W, ['Показател', 'Последна стойност', 'Дата', 'Реф. диапазон', 'Статус', 'Промяна'], [0.24, 0.17, 0.13, 0.16, 0.17, 0.13],
        d.biomarkers.map(({ summary: s }) => [
          s.name,
          s.latest ? `${s.latest.valueText} ${s.latest.unit ?? ''}` : '—',
          formatDate(s.latest?.date),
          s.latest ? formatRange(s.latest.rangeLow, s.latest.rangeHigh, s.latest.rangeText) : '—',
          s.latest ? `${STATUS_SYMBOL[s.latest.status]} ${STATUS_LABELS[s.latest.status].replace('референтния ', '')}` : '—',
          s.change?.percent != null ? `${s.change.percent > 0 ? '+' : ''}${formatNumber(s.change.percent, 1)}%` : '—',
        ]));
      doc.moveDown(1);
    }

    for (const { summary: s, series } of d.biomarkers) {
      if (!d.includeCharts && !d.includeHistory) break;
      if (doc.y > doc.page.height - 260) doc.addPage();
      section(doc, `${s.name}${s.unit ? ` (${s.unit})` : ''}`);
      if (s.change) doc.font('r').fontSize(9.5).fillColor(C.muted).text(describeChange(s.change)).moveDown(0.4);
      if (d.includeCharts && series.filter((p) => p.displayValue !== null).length >= 2) chart(doc, W, series);
      if (d.includeHistory) {
        table(doc, W, ['Дата', 'Стойност', 'Реф. диапазон', 'Статус', 'Лаборатория'], [0.16, 0.2, 0.2, 0.2, 0.24],
          [...series].reverse().map((p) => [formatDate(p.date), `${p.valueText} ${p.unit ?? ''}`, formatRange(p.rangeLow, p.rangeHigh, p.rangeText), `${STATUS_SYMBOL[p.status]} ${STATUS_LABELS[p.status].replace('референтния ', '')}`, p.laboratoryName ?? (p.source === 'manual' ? 'Ръчно въведен' : '—')]));
      }
      doc.moveDown(1);
    }

    if (d.specialists?.length) {
      if (doc.y > doc.page.height - 160) doc.addPage();
      section(doc, 'Специалисти');
      table(doc, W, ['Име', 'Специалност', 'Клиника', 'Последен преглед'], [0.3, 0.25, 0.27, 0.18],
        d.specialists.map((s) => [s.name, s.specialty, s.clinic ?? '—', formatDate(s.lastVisitAt)]));
      doc.moveDown(1);
    }
    if (d.documents?.length) {
      if (doc.y > doc.page.height - 160) doc.addPage();
      section(doc, 'Документи');
      table(doc, W, ['Документ', 'Дата'], [0.75, 0.25], d.documents.map((x) => [x.name, formatDate(x.documentDate)]));
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      doc.font('r').fontSize(8).fillColor(C.muted).text(`Стр. ${i + 1} от ${range.count}`, 48, doc.page.height - 36, { width: W, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.font('b').fontSize(13).fillColor(C.accent).text(title, 48);
  doc.moveDown(0.3);
}

function table(doc: PDFKit.PDFDocument, width: number, head: string[], cols: number[], rows: string[][]) {
  const x0 = 48;
  const widths = cols.map((c) => c * width);
  const drawRow = (cells: string[], bold: boolean) => {
    const h = Math.max(...cells.map((c, i) => doc.font(bold ? 'b' : 'r').fontSize(8.5).heightOfString(c, { width: widths[i]! - 6 }))) + 6;
    if (doc.y + h > doc.page.height - 56) doc.addPage();
    const y = doc.y;
    let x = x0;
    cells.forEach((c, i) => {
      doc.font(bold ? 'b' : 'r').fontSize(8.5).fillColor(bold ? C.muted : C.ink).text(c, x + 3, y + 3, { width: widths[i]! - 6 });
      x += widths[i]!;
    });
    doc.moveTo(x0, y + h).lineTo(x0 + width, y + h).strokeColor(C.line).lineWidth(0.5).stroke();
    doc.x = x0;
    doc.y = y + h;
  };
  drawRow(head, true);
  for (const r of rows) drawRow(r, false);
}

/** Vector line chart with the lab reference band (latest range) – no rasterization. */
function chart(doc: PDFKit.PDFDocument, width: number, series: SeriesPoint[]) {
  const pts = series.filter((p) => p.displayValue !== null);
  const h = 120;
  const x0 = 78;
  const y0 = doc.y + 6;
  const w = width - 40;
  const last = pts[pts.length - 1]!;
  // Same unit everywhere → plot raw values with the lab band; otherwise converted values, no band
  const sameUnit = pts.every((p) => p.unit === last.unit && p.value !== null);
  const val = (p: SeriesPoint) => (sameUnit ? p.value! : p.displayValue!);
  const vals = pts.map(val);
  const band = sameUnit ? [last.rangeLow, last.rangeHigh] : [null, null];
  const all = [...vals, ...(band.filter((v) => v !== null) as number[])];
  let min = Math.min(...all);
  let max = Math.max(...all);
  const pad = (max - min || Math.abs(max) || 1) * 0.15;
  min -= pad;
  max += pad;
  const t0 = Date.parse(pts[0]!.date);
  const t1 = Date.parse(last.date);
  const X = (d: string) => x0 + (t1 === t0 ? w / 2 : ((Date.parse(d) - t0) / (t1 - t0)) * w);
  const Y = (v: number) => y0 + h - ((v - min) / (max - min)) * h;
  if (band[0] !== null || band[1] !== null) {
    const top = Y(band[1] ?? max);
    const bottom = Y(band[0] ?? min);
    doc.rect(x0, top, w, bottom - top).fill(C.band);
  }
  doc.moveTo(x0, y0 + h).lineTo(x0 + w, y0 + h).strokeColor(C.line).lineWidth(0.5).stroke();
  doc.font('r').fontSize(7).fillColor(C.muted);
  doc.text(formatNumber(max, 2), 48, Y(max) - 3, { width: 26, align: 'right' });
  doc.text(formatNumber(min, 2), 48, Y(min) - 6, { width: 26, align: 'right' });
  doc.moveTo(X(pts[0]!.date), Y(vals[0]!));
  pts.forEach((p) => doc.lineTo(X(p.date), Y(val(p))));
  doc.strokeColor(C.accent).lineWidth(1.5).stroke();
  pts.forEach((p) => {
    const out = p.status === 'above' || p.status === 'below';
    doc.circle(X(p.date), Y(val(p)), 2.8).fill(out ? C.amber : C.accent);
    doc.font('r').fontSize(6.5).fillColor(C.muted).text(formatDate(p.date), X(p.date) - 22, y0 + h + 4, { width: 44, align: 'center', lineBreak: false });
  });
  doc.x = 48;
  doc.y = y0 + h + 20;
}
