import { getBiomarker, type BiomarkerCategory, type ExtractedReportMeta, type ReportType } from '@vitalog/shared';
import type { DraftCandidate, ExtractedDocument, TextLine } from './types';

/** Report-level metadata. Only what is printed – nothing is inferred about the lab or patient. */

const DATE_LABELS: Array<{ re: RegExp; priority: number }> = [
  { re: /(дата\s+(на\s+)?(вземане|пробовземане|взимане)|взет[аo]?\s+на|материал\s+взет|collection\s+date|collected|date\s+collected|sample\s+date)/i, priority: 3 },
  { re: /(дата\s+на\s+изследване|test\s+date|дата\s+на\s+приемане|received)/i, priority: 2 },
  { re: /(^|\s)(дата|date)\s*[:.]/i, priority: 1 },
];

const DATE_VALUE = /(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})|(\d{4})-(\d{2})-(\d{2})/;

export function parseDate(s: string): string | null {
  const m = s.match(DATE_VALUE);
  if (!m) return null;
  let y: number, mo: number, d: number;
  if (m[4]) {
    y = +m[4]; mo = +m[5]!; d = +m[6]!;
  } else {
    d = +m[1]!; mo = +m[2]!; y = +m[3]!;
    if (m[3]!.length === 2) y += 2000;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1950 || y > 2100) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return dt.getUTCDate() === d ? iso : null;
}

function valueAfterLabel(line: TextLine, re: RegExp): string | null {
  const idx = line.cells.findIndex((c) => re.test(c));
  if (idx >= 0) {
    const inCell = line.cells[idx]!.replace(re, '').replace(/^[\s:.-]+/, '').trim();
    if (inCell) return inCell;
    const next = line.cells[idx + 1];
    if (next) return next.trim();
  }
  const m = line.text.match(new RegExp(`${re.source}\\s*[:.-]?\\s*(.+)$`, 'i'));
  return m ? m[m.length - 1]!.trim() : null;
}

export function extractMeta(doc: ExtractedDocument, candidates: DraftCandidate[], formatId: string): ExtractedReportMeta {
  const head = doc.lines.filter((l) => l.page === 1).slice(0, 40);
  const all = doc.lines;

  let collectedAt: string | null = null;
  let bestPriority = 0;
  for (const line of all) {
    for (const { re, priority } of DATE_LABELS) {
      if (priority <= bestPriority || !re.test(line.text)) continue;
      const v = valueAfterLabel(line, re);
      const date = v ? parseDate(v) : parseDate(line.text);
      if (date) {
        collectedAt = date;
        bestPriority = priority;
      }
    }
  }

  const find = (re: RegExp, lines = head) => {
    for (const l of lines) {
      if (re.test(l.text)) {
        const v = valueAfterLabel(l, re);
        if (v) return v.slice(0, 160);
      }
    }
    return null;
  };

  const patientName = find(/(пациент|patient|име на пациента|patient name)\s*[:]/i) ?? find(/^(пациент|patient)\b/i);
  let laboratoryName = find(/(лаборатория|laboratory)\s*[:]/i);
  if (!laboratoryName) {
    const l = head.find((x) => /(лаборатори|laborator|\blab\b)/i.test(x.text) && x.text.length < 120 && !/[:]/.test(x.text));
    laboratoryName = l ? l.text.trim() : null;
  }
  const laboratoryAddress = find(/(адрес|address)\s*[:]/i);
  const phoneRaw = find(/(тел\.?|телефон|phone|tel\.?)\s*[:]/i);
  const laboratoryPhone = phoneRaw?.match(/[+\d][\d\s()/-]{5,}/)?.[0]?.trim() ?? null;
  const web = head.map((l) => l.text.match(/\b((?:https?:\/\/)?(?:www\.)[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?)/i)?.[1]).find(Boolean) ?? null;
  const labComment = find(/(коментар|бележка|comment|note)\s*[:]/i, all);

  const reportType = inferReportType(candidates);
  return {
    collectedAt,
    laboratoryName,
    laboratoryAddress,
    laboratoryPhone,
    laboratoryWebsite: web,
    patientName,
    reportType,
    title: reportType ? REPORT_TYPE_TITLES[reportType] : null,
    labComment,
    formatId,
  };
}

export const REPORT_TYPE_TITLES: Record<ReportType, string> = {
  blood: 'Кръвни изследвания',
  hormones: 'Хормонални изследвания',
  urine: 'Изследване на урина',
  biochemistry: 'Биохимични изследвания',
  mixed: 'Лабораторни изследвания',
  other: 'Лабораторни изследвания',
};

/** Classify by the catalog categories of matched results; only with a clear majority. */
function inferReportType(cands: DraftCandidate[]): ReportType | null {
  const counts = new Map<BiomarkerCategory, number>();
  for (const c of cands) {
    const cat = getBiomarker(c.biomarkerId)?.category;
    if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const hormones = (counts.get('thyroid') ?? 0) + (counts.get('hormones') ?? 0);
  if (hormones / total >= 0.7) return 'hormones';
  const bio = ['liver', 'kidney', 'lipids', 'glucose_metabolism', 'minerals'].reduce((a, k) => a + (counts.get(k as BiomarkerCategory) ?? 0), 0);
  if ((counts.get('blood_count') ?? 0) / total >= 0.7) return 'blood';
  if (bio / total >= 0.7) return 'biochemistry';
  return 'blood';
}
