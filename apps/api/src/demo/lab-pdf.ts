import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Generator for SYNTHETIC laboratory PDFs (fixtures + demo documents).
 * Every document is clearly marked as test data; labs and patients are fictional.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// src/demo → ../../assets ; bundled dist → ../assets
export const FONT_DIR = [path.resolve(here, '../../assets/fonts'), path.resolve(here, '../assets/fonts')].find((p) => existsSync(p))!;
export const FONT_REGULAR = path.join(FONT_DIR, 'DejaVuSans.ttf');
export const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

export interface LabRow {
  code?: string;
  name: string;
  value: string;
  flag?: string;
  unit?: string;
  range?: string;
  comment?: string;
}

export interface LabPdfSpec {
  style: 'alpha' | 'beta' | 'gamma';
  lab: { name: string; address?: string; phone?: string; website?: string };
  patientName: string;
  collectedAt: string; // as printed
  printedAt?: string;
  rows: LabRow[];
  /** Section headings inserted before the row with this index. */
  sections?: Record<number, string>;
  comment?: string;
  rowsPerPage?: number;
  userPassword?: string;
  footerNote?: string;
}

const MARK_BG = 'СИНТЕТИЧНИ ТЕСТОВИ ДАННИ – НЕ Е РЕАЛЕН МЕДИЦИНСКИ ДОКУМЕНТ';
const MARK_EN = 'SYNTHETIC TEST DATA – NOT A REAL MEDICAL DOCUMENT';

export function renderLabPdf(spec: LabPdfSpec): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: { Title: `${spec.lab.name} – synthetic`, Author: 'Vitalog fixtures', Subject: MARK_EN },
      ...(spec.userPassword ? { userPassword: spec.userPassword, ownerPassword: `${spec.userPassword}-owner` } : {}),
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('r', FONT_REGULAR);
    doc.registerFont('b', FONT_BOLD);

    const en = spec.style === 'gamma';
    const cols =
      spec.style === 'beta'
        ? { code: 40, name: 85, value: 300, flag: 352, unit: 392, range: 465 }
        : en
          ? { name: 40, value: 250, flag: 310, unit: 335, range: 420 }
          : { name: 40, value: 260, flag: 318, unit: 340, range: 430 };

    const header = () => {
      doc.font('b').fontSize(13).fillColor('#111').text(spec.lab.name, 40, 40);
      if (spec.style === 'beta') doc.font('r').fontSize(7).fillColor('#888').text('SYNTHLAB-BETA · формат v1', 40, 58);
      doc.font('r').fontSize(9).fillColor('#333');
      let y = 72;
      if (spec.lab.address) { doc.text(`${en ? 'Address' : 'Адрес'}: ${spec.lab.address}`, 40, y); y += 13; }
      if (spec.lab.phone) { doc.text(`${en ? 'Phone' : 'Тел.'}: ${spec.lab.phone}`, 40, y); y += 13; }
      if (spec.lab.website) { doc.text(spec.lab.website, 40, y); y += 13; }
      doc.fontSize(8).fillColor('#a33').text(en ? MARK_EN : MARK_BG, 40, y + 2);
      y += 22;
      doc.fontSize(10).fillColor('#111');
      doc.text(`${en ? 'Patient' : 'Пациент'}: ${spec.patientName}`, 40, y);
      doc.text(`${en ? 'Collected' : 'Дата на вземане'}: ${spec.collectedAt}`, 320, y);
      y += 15;
      if (spec.printedAt) { doc.text(`${en ? 'Printed' : 'Отпечатан'}: ${spec.printedAt}`, 320, y); y += 15; }
      y += 10;
      doc.font('b').fontSize(9);
      if (spec.style === 'beta') {
        doc.text('Код', cols.code!, y).text('Изследване', cols.name, y).text('Резултат', cols.value, y)
          .text('Флаг', cols.flag, y).text('Мерна ед.', cols.unit, y).text('Реф. стойности', cols.range, y);
      } else if (en) {
        doc.text('Test', cols.name, y).text('Result', cols.value, y).text('Flag', cols.flag, y).text('Units', cols.unit, y).text('Reference interval', cols.range, y);
      } else {
        doc.text('Показател', cols.name, y).text('Резултат', cols.value, y).text('Единици', cols.unit, y).text('Референтни граници', cols.range, y);
      }
      y += 14;
      doc.moveTo(40, y).lineTo(555, y).strokeColor('#bbb').stroke();
      return y + 6;
    };

    const perPage = spec.rowsPerPage ?? 30;
    let y = header();
    let onPage = 0;
    spec.rows.forEach((row, i) => {
      if (onPage >= perPage) {
        doc.addPage();
        y = header();
        onPage = 0;
      }
      const section = spec.sections?.[i];
      if (section) {
        doc.font('b').fontSize(10).fillColor('#0e5d57').text(section, 40, y + 4);
        y += 20;
      }
      doc.font('r').fontSize(9.5).fillColor('#111');
      if (spec.style === 'beta' && row.code) doc.text(row.code, cols.code!, y);
      doc.text(row.name, cols.name, y, { width: cols.value - cols.name - 10, lineBreak: false });
      doc.font(row.flag ? 'b' : 'r').text(row.value, cols.value, y, { lineBreak: false });
      doc.font('r');
      if (row.flag) doc.text(row.flag, cols.flag, y, { lineBreak: false });
      if (row.unit) doc.text(row.unit, cols.unit, y, { lineBreak: false });
      if (row.range) doc.text(row.range, cols.range, y, { lineBreak: false });
      if (row.comment) doc.fontSize(8).fillColor('#555').text(row.comment, 500, y, { lineBreak: false });
      y += 17;
      onPage++;
    });

    if (spec.comment) {
      doc.font('r').fontSize(9).fillColor('#333').text(`${en ? 'Comment' : 'Коментар'}: ${spec.comment}`, 40, y + 14, { width: 515 });
    }
    if (spec.footerNote) doc.fontSize(8).fillColor('#777').text(spec.footerNote, 40, 790, { lineBreak: false });
    doc.end();
  });
}

/** A plain non-lab document (e.g. outpatient sheet) for demo documents. */
export function renderTextPdf(title: string, paragraphs: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: title, Subject: MARK_EN } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('r', FONT_REGULAR).registerFont('b', FONT_BOLD);
    doc.font('b').fontSize(15).text(title);
    doc.font('r').fontSize(8).fillColor('#a33').text(MARK_BG).moveDown();
    doc.fillColor('#111').fontSize(11);
    for (const p of paragraphs) doc.text(p).moveDown(0.6);
    doc.end();
  });
}

/** Wrap PNG page images into an image-only PDF (simulates a scanned document). */
export function imagesToPdf(pngs: Buffer[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    for (const png of pngs) {
      doc.addPage({ size: 'A4', margin: 0 });
      doc.image(png, 0, 0, { width: 595.28, height: 841.89 });
    }
    doc.end();
  });
}
