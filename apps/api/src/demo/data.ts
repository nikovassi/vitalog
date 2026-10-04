import type { LabPdfSpec, LabRow } from './lab-pdf';

/**
 * SYNTHETIC demo history. Every value, range, lab, patient and doctor below is invented
 * test data. Reference ranges here are fixture values printed on fictional lab documents –
 * they are not medical guidance and are never used outside the demo.
 */

export const DEMO_PATIENT = 'Николай Тестов (синтетичен пациент)';

export const DEMO_LABS = {
  alpha: { name: 'Синтетична лаборатория „Алфа“', address: 'ул. Примерна 1, София (демо адрес)', phone: '+359 000 000 101', website: 'www.alpha-lab.example' },
  beta: { name: 'Синтетична лаборатория „Бета“', address: 'бул. Тестов 22, Пловдив (демо адрес)', phone: '+359 000 000 202' },
  gamma: { name: 'Synthetic Lab Gamma', address: '1 Example Street (demo address)', phone: '+359 000 000 303', website: 'www.gamma-lab.example' },
} as const;

/** Five collection dates (ISO) → five reports. */
export const DEMO_DATES = ['2025-01-15', '2025-06-15', '2025-10-10', '2026-02-01', '2026-09-12'] as const;

interface Marker {
  bg: string;
  en: string;
  code: string;
  unit: string;
  range: string;
  section: 'cbc' | 'bio' | 'lip' | 'thy' | 'vit';
  /** values per date index (null = not measured that time). Strings as printed. */
  v: Array<string | null>;
  /** Optional US-unit version for the English lab (report 4). */
  us?: { unit: string; range: string; v: string };
}

const M: Marker[] = [
  // Кръвна картина
  { bg: 'Левкоцити', en: 'WBC', code: '1001', unit: '10^9/L', range: '3,5 - 10,5', section: 'cbc', v: ['6,2', '5,8', null, null, '6,9'] },
  { bg: 'Еритроцити', en: 'RBC', code: '1002', unit: '10^12/L', range: '4,2 - 5,8', section: 'cbc', v: ['4,92', '5,01', null, null, '4,88'] },
  { bg: 'Хемоглобин', en: 'Hemoglobin', code: '1003', unit: 'g/L', range: '130 - 175', section: 'cbc', v: ['148', '151', null, null, '146'] },
  { bg: 'Хематокрит', en: 'Hematocrit', code: '1004', unit: 'L/L', range: '0,40 - 0,52', section: 'cbc', v: ['0,44', '0,45', null, null, '0,43'] },
  { bg: 'MCV', en: 'MCV', code: '1005', unit: 'fL', range: '80 - 99', section: 'cbc', v: ['89', '90', null, null, '88'] },
  { bg: 'MCH', en: 'MCH', code: '1006', unit: 'pg', range: '27 - 33', section: 'cbc', v: ['30,1', '30,2', null, null, '29,9'] },
  { bg: 'MCHC', en: 'MCHC', code: '1007', unit: 'g/L', range: '320 - 360', section: 'cbc', v: ['337', '335', null, null, '339'] },
  { bg: 'Тромбоцити', en: 'Platelets', code: '1008', unit: '10^9/L', range: '150 - 400', section: 'cbc', v: ['245', '262', null, null, '238'] },
  { bg: 'Неутрофили %', en: 'Neutrophils %', code: '1009', unit: '%', range: '40 - 75', section: 'cbc', v: ['58', '61', null, null, '56'] },
  { bg: 'Лимфоцити %', en: 'Lymphocytes %', code: '1010', unit: '%', range: '20 - 45', section: 'cbc', v: ['32', '29', null, null, '34'] },
  { bg: 'Моноцити %', en: 'Monocytes %', code: '1011', unit: '%', range: '2 - 10', section: 'cbc', v: ['7', '7,5', null, null, '6,8'] },
  { bg: 'Еозинофили %', en: 'Eosinophils %', code: '1012', unit: '%', range: '0 - 6', section: 'cbc', v: ['2,5', '2,1', null, null, '2,8'] },
  { bg: 'Базофили %', en: 'Basophils %', code: '1013', unit: '%', range: '0 - 1,5', section: 'cbc', v: ['0,5', '0,4', null, null, '0,4'] },
  { bg: 'СУЕ', en: 'ESR', code: '1014', unit: 'mm/h', range: '2 - 15', section: 'cbc', v: ['6', '8', null, null, '7'] },
  // Биохимия
  { bg: 'Глюкоза', en: 'Glucose', code: '2001', unit: 'mmol/L', range: '3,9 - 6,1', section: 'bio', v: ['5,4', '5,7', '6,3', null, '5,5'], us: { unit: 'mg/dL', range: '70 - 99', v: '97' } },
  { bg: 'Гликиран хемоглобин HbA1c', en: 'HbA1c', code: '2002', unit: '%', range: '4,0 - 5,6', section: 'bio', v: ['5,5', null, '5,7', null, '5,6'] },
  { bg: 'Креатинин', en: 'Creatinine', code: '2003', unit: 'umol/l', range: '62 - 106', section: 'bio', v: ['88', '91', '86', null, '93'] },
  { bg: 'Урея', en: 'Urea', code: '2004', unit: 'mmol/L', range: '2,8 - 7,2', section: 'bio', v: ['5,1', '4,8', '5,4', null, '5,0'] },
  { bg: 'Пикочна киселина', en: 'Uric acid', code: '2005', unit: 'µmol/l', range: '202 - 416', section: 'bio', v: ['312', '356', '338', null, '371'], us: { unit: 'mg/dL', range: '3.4 - 7.0', v: '6.2' } },
  { bg: 'АСАТ', en: 'AST', code: '2006', unit: 'U/L', range: '< 40', section: 'bio', v: ['24', '27', '22', null, '29'] },
  { bg: 'АЛАТ', en: 'ALT', code: '2007', unit: 'U/L', range: '< 41', section: 'bio', v: ['31', '44', '35', null, '38'] },
  { bg: 'ГГТ', en: 'GGT', code: '2008', unit: 'U/L', range: '< 60', section: 'bio', v: ['28', '33', '30', null, '26'] },
  { bg: 'Общ билирубин', en: 'Total bilirubin', code: '2009', unit: 'µmol/L', range: '5 - 21', section: 'bio', v: ['12,4', '14,1', '11,8', null, '13,2'] },
  { bg: 'C-реактивен протеин', en: 'CRP', code: '2010', unit: 'mg/L', range: '< 5', section: 'bio', v: ['1,2', '0,8', '2,4', null, '1,1'] },
  // Липиди
  { bg: 'Общ холестерол', en: 'Total cholesterol', code: '3001', unit: 'mmol/L', range: '< 5,2', section: 'lip', v: ['5,6', '5,9', '5,4', null, '5,1'], us: { unit: 'mg/dL', range: '< 200', v: '209' } },
  { bg: 'LDL холестерол', en: 'LDL cholesterol', code: '3002', unit: 'mmol/L', range: '< 3,0', section: 'lip', v: ['3,7', '4,1', '3,6', null, '3,3'], us: { unit: 'mg/dL', range: '< 116', v: '135' } },
  { bg: 'HDL холестерол', en: 'HDL cholesterol', code: '3003', unit: 'mmol/L', range: '> 1,0', section: 'lip', v: ['1,3', '1,2', '1,3', null, '1,4'], us: { unit: 'mg/dL', range: '> 39', v: '52' } },
  { bg: 'Триглицериди', en: 'Triglycerides', code: '3004', unit: 'mmol/L', range: '< 1,7', section: 'lip', v: ['1,5', '1,9', '1,4', null, '1,3'], us: { unit: 'mg/dL', range: '< 150', v: '124' } },
  // Щитовидна жлеза
  { bg: 'TSH', en: 'TSH', code: '4001', unit: 'mIU/L', range: '0,27 - 4,2', section: 'thy', v: ['2,1', null, '2,6', null, '2,3'], us: { unit: 'µIU/mL', range: '0.27 - 4.20', v: '2.9' } },
  { bg: 'FT4', en: 'Free T4', code: '4002', unit: 'pmol/L', range: '12 - 22', section: 'thy', v: [null, null, '15,8', null, '16,1'], us: { unit: 'pmol/L', range: '12.0 - 22.0', v: '15.2' } },
  { bg: 'Анти-TPO', en: 'Anti-TPO', code: '4003', unit: 'IU/mL', range: '< 34', section: 'thy', v: [null, null, '12', null, null], us: { unit: 'IU/mL', range: '< 34', v: '14' } },
  // Витамини и минерали
  { bg: 'Витамин D (25-OH)', en: '25-OH Vitamin D', code: '5001', unit: 'nmol/L', range: '75 - 250', section: 'vit', v: ['48', '86', '71', null, '79'] },
  { bg: 'Витамин B12', en: 'Vitamin B12', code: '5002', unit: 'pmol/L', range: '145 - 569', section: 'vit', v: ['310', null, '295', null, '330'] },
  { bg: 'Желязо', en: 'Iron', code: '5003', unit: 'µmol/L', range: '6 - 35', section: 'vit', v: ['18', '21', null, null, '19'] },
  { bg: 'Феритин', en: 'Ferritin', code: '5004', unit: 'ng/mL', range: '30 - 400', section: 'vit', v: ['95', '102', null, null, '110'] },
];

const SECTION_TITLES: Record<Marker['section'], string> = {
  cbc: 'Хематология',
  bio: 'Клинична химия',
  lip: 'Липиден профил',
  thy: 'Хормони на щитовидната жлеза',
  vit: 'Витамини и минерали',
};

function flagFor(value: string, range: string): string | undefined {
  const v = Number(value.replace(',', '.'));
  const r = range.replace(/,/g, '.');
  let m = r.match(/^([\d.]+)\s*-\s*([\d.]+)$/);
  if (m) return v < +m[1]! ? 'L' : v > +m[2]! ? 'H' : undefined;
  m = r.match(/^<\s*([\d.]+)$/);
  if (m) return v > +m[1]! ? 'H' : undefined;
  m = r.match(/^>\s*([\d.]+)$/);
  if (m) return v < +m[1]! ? 'L' : undefined;
  return undefined;
}

function rowsFor(index: number, style: 'alpha' | 'beta'): { rows: LabRow[]; sections: Record<number, string> } {
  const rows: LabRow[] = [];
  const sections: Record<number, string> = {};
  let lastSection = '';
  for (const m of M) {
    const value = m.v[index];
    if (!value) continue;
    if (m.section !== lastSection) {
      sections[rows.length] = SECTION_TITLES[m.section];
      lastSection = m.section;
    }
    rows.push({ code: style === 'beta' ? m.code : undefined, name: m.bg, value, unit: m.unit, range: m.range, flag: flagFor(value, m.range) });
  }
  return { rows, sections };
}

const fmt = (iso: string) => iso.split('-').reverse().join('.');

/** PDF specs for the 5 demo reports (also used as parser fixtures). */
export function demoReportSpecs(): Array<{ date: string; title: string; spec: LabPdfSpec }> {
  const out: Array<{ date: string; title: string; spec: LabPdfSpec }> = [];
  DEMO_DATES.forEach((date, i) => {
    if (i === 3) {
      const rows: LabRow[] = M.filter((m) => m.us).map((m) => ({ name: m.en, value: m.us!.v, unit: m.us!.unit, range: m.us!.range, flag: flagFor(m.us!.v, m.us!.range) }));
      out.push({
        date,
        title: 'Хормонални изследвания',
        spec: { style: 'gamma', lab: DEMO_LABS.gamma, patientName: 'Nikolay Testov (synthetic patient)', collectedAt: date, rows, comment: 'Synthetic sample comment: sample received in good condition.' },
      });
      return;
    }
    const style = i === 2 ? 'beta' : 'alpha';
    const { rows, sections } = rowsFor(i, style);
    out.push({
      date,
      title: 'Кръвни изследвания',
      spec: {
        style,
        lab: style === 'beta' ? DEMO_LABS.beta : DEMO_LABS.alpha,
        patientName: DEMO_PATIENT,
        collectedAt: fmt(date),
        printedAt: fmt(date),
        rows,
        sections,
        rowsPerPage: 22,
      },
    });
  });
  return out;
}

export { DEMO_EVENTS, DEMO_SPECIALISTS } from '@vitalog/shared';

/** A newer upload still waiting for review (one unreadable value, one unknown biomarker). */
export const DEMO_PENDING_SPEC: LabPdfSpec = {
  style: 'alpha', lab: DEMO_LABS.alpha, patientName: DEMO_PATIENT, collectedAt: '01.10.2026',
  rows: [
    { name: 'Глюкоза', value: '5,3', unit: 'mmol/L', range: '3,9 - 6,1' },
    { name: 'Пикочна киселина', value: '3?4', unit: 'µmol/L', range: '202 - 416' },
    { name: 'LDL холестерол', value: '3,1', flag: 'H', unit: 'mmol/L', range: '< 3,0' },
    { name: 'HDL холестерол', value: '1,4', unit: 'mmol/L', range: '> 1,0' },
    { name: 'Феритин', value: '104', unit: 'ng/mL', range: '30 - 400' },
    { name: 'Хомоцистеин', value: '11,2', unit: 'µmol/L', range: '5 - 15' },
  ],
};

export const DEMO_EXTRA_DOCS = [
  { file: 'demo-outpatient-2025-09-05.pdf', name: 'Амбулаторен лист – ендокринолог (демо).pdf', category: 'outpatient_sheet' as const, date: '2025-09-05', title: 'Амбулаторен лист (синтетичен)', paragraphs: ['Синтетичен документ за демонстрация на секцията „Документи“.', 'Не съдържа реални медицински данни.'] },
  { file: 'demo-discharge-2024-11-20.pdf', name: 'Епикриза (демо).pdf', category: 'discharge_summary' as const, date: '2024-11-20', title: 'Епикриза (синтетична)', paragraphs: ['Синтетичен документ за демонстрация.'] },
];
