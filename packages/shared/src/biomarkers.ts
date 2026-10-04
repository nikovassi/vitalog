import type { Biomarker, BiomarkerCategory, UnitConversion } from './models';

/**
 * Normalized biomarker catalog.
 *
 * Rules (see docs/04-DATA-MODEL.md):
 * - NO reference ranges here. Ranges come from the lab document or the user.
 * - Conversions only where the factor follows from molecular weight / definition and is
 *   published in SI conversion tables (sources in docs/01-RESEARCH.md §5).
 * - LOINC only where the code was verified against loinc.org for the canonical unit's
 *   property (mass vs. moles); otherwise null.
 * - Descriptions say what is measured, never what a value means for the person.
 */

const SI_TABLE = 'SI conversion tables (MSD Manual; Laboklin) – виж docs/01-RESEARCH.md';
const CATALOG = 'Vitalog catalog v1';

function conv(from: string, to: string, factor: number): UnitConversion[] {
  return [
    { from, to, factor, source: SI_TABLE },
    { from: to, to: from, factor: 1 / factor, source: SI_TABLE },
  ];
}

type Def = Omit<Biomarker, 'referenceRange' | 'source' | 'conversionRules' | 'supportedUnits' | 'loinc'> & {
  supportedUnits?: string[];
  conversionRules?: UnitConversion[];
  loinc?: string | null;
};

function b(def: Def): Biomarker {
  return {
    ...def,
    supportedUnits: def.supportedUnits ?? [def.unit],
    conversionRules: def.conversionRules ?? [],
    loinc: def.loinc ?? null,
    referenceRange: null,
    source: CATALOG,
  };
}

export const BIOMARKERS: Biomarker[] = [
  // ── Кръвна картина ────────────────────────────────────────────────
  b({ id: 'wbc', canonicalName: 'White blood cells', bgName: 'Левкоцити', aliases: ['WBC', 'Leukocytes', 'Левкоцити', 'Левк', 'Бели кръвни клетки', 'White blood cell count'], category: 'blood_count', unit: '10⁹/L', description: 'Брой бели кръвни клетки в единица обем кръв.' }),
  b({ id: 'rbc', canonicalName: 'Red blood cells', bgName: 'Еритроцити', aliases: ['RBC', 'Erythrocytes', 'Еритроцити', 'Ер', 'Червени кръвни клетки', 'Red blood cell count'], category: 'blood_count', unit: '10¹²/L', description: 'Брой червени кръвни клетки в единица обем кръв.' }),
  b({ id: 'hgb', canonicalName: 'Hemoglobin', bgName: 'Хемоглобин', aliases: ['HGB', 'Hb', 'Hemoglobin', 'Haemoglobin', 'Хемоглобин', 'Хб'], category: 'blood_count', unit: 'g/L', supportedUnits: ['g/L', 'g/dL'], conversionRules: conv('g/dL', 'g/L', 10), loinc: '718-7', description: 'Количество хемоглобин – белтъкът в червените кръвни клетки, който пренася кислород.' }),
  b({ id: 'hct', canonicalName: 'Hematocrit', bgName: 'Хематокрит', aliases: ['HCT', 'Hct', 'Hematocrit', 'Haematocrit', 'Хематокрит'], category: 'blood_count', unit: 'L/L', supportedUnits: ['L/L', '%'], conversionRules: conv('L/L', '%', 100), description: 'Дял на червените кръвни клетки от общия обем кръв.' }),
  b({ id: 'mcv', canonicalName: 'Mean corpuscular volume', bgName: 'Среден обем на еритроцита', aliases: ['MCV', 'Mean corpuscular volume', 'Среден обем на еритроцита', 'Среден еритроцитен обем'], category: 'blood_count', unit: 'fL', description: 'Среден обем на една червена кръвна клетка.' }),
  b({ id: 'mch', canonicalName: 'Mean corpuscular hemoglobin', bgName: 'Средно съдържание на хемоглобин', aliases: ['MCH', 'Mean corpuscular hemoglobin', 'Средно съдържание на хемоглобин в еритроцита', 'Средно съдържание на хемоглобин'], category: 'blood_count', unit: 'pg', description: 'Средно количество хемоглобин в една червена кръвна клетка.' }),
  b({ id: 'mchc', canonicalName: 'Mean corpuscular hemoglobin concentration', bgName: 'Средна концентрация на хемоглобин', aliases: ['MCHC', 'Mean corpuscular hemoglobin concentration', 'Средна концентрация на хемоглобин в еритроцита', 'Средна концентрация на хемоглобин'], category: 'blood_count', unit: 'g/L', supportedUnits: ['g/L', 'g/dL'], conversionRules: conv('g/dL', 'g/L', 10), description: 'Средна концентрация на хемоглобин в червените кръвни клетки.' }),
  b({ id: 'rdw', canonicalName: 'Red cell distribution width', bgName: 'Ширина на разпределение на еритроцитите', aliases: ['RDW', 'RDW-CV', 'Red cell distribution width', 'Ширина на разпределение на еритроцитите'], category: 'blood_count', unit: '%', description: 'Степен на вариация в размера на червените кръвни клетки.' }),
  b({ id: 'plt', canonicalName: 'Platelets', bgName: 'Тромбоцити', aliases: ['PLT', 'Platelets', 'Platelet count', 'Тромбоцити', 'Тр'], category: 'blood_count', unit: '10⁹/L', description: 'Брой тромбоцити в единица обем кръв.' }),
  b({ id: 'neut_pct', canonicalName: 'Neutrophils %', bgName: 'Неутрофили %', aliases: ['NEU%', 'NEUT%', 'Neutrophils %', 'Neutrophils', 'Неутрофили %', 'Неутрофили', 'Гранулоцити %'], category: 'blood_count', unit: '%', description: 'Дял на неутрофилите от белите кръвни клетки.' }),
  b({ id: 'lymph_pct', canonicalName: 'Lymphocytes %', bgName: 'Лимфоцити %', aliases: ['LYM%', 'LYMPH%', 'Lymphocytes %', 'Lymphocytes', 'Лимфоцити %', 'Лимфоцити'], category: 'blood_count', unit: '%', description: 'Дял на лимфоцитите от белите кръвни клетки.' }),
  b({ id: 'mono_pct', canonicalName: 'Monocytes %', bgName: 'Моноцити %', aliases: ['MON%', 'MONO%', 'Monocytes %', 'Monocytes', 'Моноцити %', 'Моноцити'], category: 'blood_count', unit: '%', description: 'Дял на моноцитите от белите кръвни клетки.' }),
  b({ id: 'eos_pct', canonicalName: 'Eosinophils %', bgName: 'Еозинофили %', aliases: ['EOS%', 'Eosinophils %', 'Eosinophils', 'Еозинофили %', 'Еозинофили'], category: 'blood_count', unit: '%', description: 'Дял на еозинофилите от белите кръвни клетки.' }),
  b({ id: 'baso_pct', canonicalName: 'Basophils %', bgName: 'Базофили %', aliases: ['BAS%', 'BASO%', 'Basophils %', 'Basophils', 'Базофили %', 'Базофили'], category: 'blood_count', unit: '%', description: 'Дял на базофилите от белите кръвни клетки.' }),
  b({ id: 'esr', canonicalName: 'Erythrocyte sedimentation rate', bgName: 'СУЕ', aliases: ['ESR', 'СУЕ', 'Erythrocyte sedimentation rate', 'Скорост на утаяване на еритроцитите'], category: 'inflammation', unit: 'mm/h', description: 'Скорост, с която червените кръвни клетки се утаяват за един час.' }),

  // ── Глюкоза и метаболизъм ────────────────────────────────────────
  b({ id: 'glucose', canonicalName: 'Glucose', bgName: 'Глюкоза', aliases: ['GLU', 'Glucose', 'Fasting glucose', 'Глюкоза', 'Кръвна захар', 'Глюкоза на гладно'], category: 'glucose_metabolism', unit: 'mmol/L', supportedUnits: ['mmol/L', 'mg/dL'], conversionRules: conv('mg/dL', 'mmol/L', 0.0555), loinc: '14749-6', description: 'Концентрация на глюкоза в кръвта.' }),
  b({ id: 'hba1c', canonicalName: 'Hemoglobin A1c', bgName: 'Гликиран хемоглобин (HbA1c)', aliases: ['HbA1c', 'HBA1C', 'A1c', 'Hemoglobin A1c', 'Glycated hemoglobin', 'Гликиран хемоглобин', 'Гликиран хемоглобин HbA1c'], category: 'glucose_metabolism', unit: '%', supportedUnits: ['%'], loinc: '4548-4', description: 'Дял на хемоглобина, свързан с глюкоза (NGSP %). Стойности в mmol/mol (IFCC) се водят отделно.' }),
  b({ id: 'insulin', canonicalName: 'Insulin', bgName: 'Инсулин', aliases: ['Insulin', 'INS', 'Инсулин', 'Инсулин на гладно'], category: 'glucose_metabolism', unit: 'µIU/mL', supportedUnits: ['µIU/mL', 'mIU/L', 'mU/L'], description: 'Концентрация на хормона инсулин в кръвта.' }),

  // ── Бъбречни показатели ─────────────────────────────────────────
  b({ id: 'creatinine', canonicalName: 'Creatinine', bgName: 'Креатинин', aliases: ['CREA', 'CREAT', 'Creatinine', 'Креатинин'], category: 'kidney', unit: 'µmol/L', supportedUnits: ['µmol/L', 'mg/dL'], conversionRules: conv('mg/dL', 'µmol/L', 88.42), loinc: '14682-9', description: 'Концентрация на креатинин в кръвта.' }),
  b({ id: 'urea', canonicalName: 'Urea', bgName: 'Урея', aliases: ['UREA', 'Urea', 'Урея', 'Карбамид'], category: 'kidney', unit: 'mmol/L', description: 'Концентрация на урея в кръвта. (BUN се води като отделен показател.)' }),
  b({ id: 'uric_acid', canonicalName: 'Uric acid', bgName: 'Пикочна киселина', aliases: ['UA', 'URIC', 'Uric acid', 'Urate', 'Пикочна киселина', 'Урати'], category: 'kidney', unit: 'µmol/L', supportedUnits: ['µmol/L', 'mg/dL'], conversionRules: conv('mg/dL', 'µmol/L', 59.48), loinc: '14933-6', description: 'Концентрация на пикочна киселина в кръвта.' }),
  b({ id: 'egfr', canonicalName: 'eGFR', bgName: 'eGFR (изчислена гломерулна филтрация)', aliases: ['eGFR', 'GFR', 'eGFR CKD-EPI', 'Изчислена гломерулна филтрация', 'Гломерулна филтрация', 'eGFR (CKD-EPI)'], category: 'kidney', unit: 'mL/min/1.73m²', description: 'Изчислена от лабораторията скорост на гломерулна филтрация. Формулата зависи от лабораторията.' }),

  // ── Чернодробни показатели ──────────────────────────────────────
  b({ id: 'ast', canonicalName: 'AST', bgName: 'АСАТ', aliases: ['AST', 'ASAT', 'GOT', 'SGOT', 'АСАТ', 'Аспартат аминотрансфераза', 'Aspartate aminotransferase'], category: 'liver', unit: 'U/L', supportedUnits: ['U/L', 'IU/L'], description: 'Активност на ензима аспартат аминотрансфераза.' }),
  b({ id: 'alt', canonicalName: 'ALT', bgName: 'АЛАТ', aliases: ['ALT', 'ALAT', 'GPT', 'SGPT', 'АЛАТ', 'Аланин аминотрансфераза', 'Alanine aminotransferase'], category: 'liver', unit: 'U/L', supportedUnits: ['U/L', 'IU/L'], description: 'Активност на ензима аланин аминотрансфераза.' }),
  b({ id: 'ggt', canonicalName: 'GGT', bgName: 'ГГТ', aliases: ['GGT', 'Gamma-GT', 'γ-GT', 'ГГТ', 'Гама-глутамил трансфераза', 'Гама ГТ'], category: 'liver', unit: 'U/L', supportedUnits: ['U/L', 'IU/L'], description: 'Активност на ензима гама-глутамил трансфераза.' }),
  b({ id: 'alp', canonicalName: 'Alkaline phosphatase', bgName: 'Алкална фосфатаза', aliases: ['ALP', 'Alkaline phosphatase', 'Алкална фосфатаза', 'АФ'], category: 'liver', unit: 'U/L', supportedUnits: ['U/L', 'IU/L'], description: 'Активност на ензима алкална фосфатаза.' }),
  b({ id: 'bili_total', canonicalName: 'Total bilirubin', bgName: 'Общ билирубин', aliases: ['TBIL', 'T-BIL', 'Total bilirubin', 'Bilirubin total', 'Общ билирубин', 'Билирубин общ'], category: 'liver', unit: 'µmol/L', description: 'Концентрация на общия билирубин в кръвта.' }),
  b({ id: 'bili_direct', canonicalName: 'Direct bilirubin', bgName: 'Директен билирубин', aliases: ['DBIL', 'D-BIL', 'Direct bilirubin', 'Bilirubin direct', 'Директен билирубин', 'Билирубин директен', 'Свързан билирубин'], category: 'liver', unit: 'µmol/L', description: 'Концентрация на директния (свързан) билирубин в кръвта.' }),
  b({ id: 'total_protein', canonicalName: 'Total protein', bgName: 'Общ белтък', aliases: ['TP', 'Total protein', 'Общ белтък'], category: 'liver', unit: 'g/L', description: 'Общо количество белтъци в серума.' }),
  b({ id: 'albumin', canonicalName: 'Albumin', bgName: 'Албумин', aliases: ['ALB', 'Albumin', 'Албумин'], category: 'liver', unit: 'g/L', description: 'Концентрация на белтъка албумин в серума.' }),

  // ── Липиден профил ──────────────────────────────────────────────
  b({ id: 'chol_total', canonicalName: 'Total cholesterol', bgName: 'Общ холестерол', aliases: ['CHOL', 'TC', 'Total cholesterol', 'Cholesterol', 'Общ холестерол', 'Холестерол', 'Холестерол общ'], category: 'lipids', unit: 'mmol/L', supportedUnits: ['mmol/L', 'mg/dL'], conversionRules: conv('mg/dL', 'mmol/L', 0.02586), loinc: '14647-2', description: 'Концентрация на общия холестерол в кръвта.' }),
  b({ id: 'ldl', canonicalName: 'LDL cholesterol', bgName: 'LDL холестерол', aliases: ['LDL', 'LDL-C', 'LDL cholesterol', 'LDL-холестерол', 'LDL холестерол', 'Холестерол LDL', 'LDL-Chol'], category: 'lipids', unit: 'mmol/L', supportedUnits: ['mmol/L', 'mg/dL'], conversionRules: conv('mg/dL', 'mmol/L', 0.02586), description: 'Концентрация на холестерола в LDL липопротеините (изчислен или директен – според лабораторията).' }),
  b({ id: 'hdl', canonicalName: 'HDL cholesterol', bgName: 'HDL холестерол', aliases: ['HDL', 'HDL-C', 'HDL cholesterol', 'HDL-холестерол', 'HDL холестерол', 'Холестерол HDL', 'HDL-Chol'], category: 'lipids', unit: 'mmol/L', supportedUnits: ['mmol/L', 'mg/dL'], conversionRules: conv('mg/dL', 'mmol/L', 0.02586), description: 'Концентрация на холестерола в HDL липопротеините.' }),
  b({ id: 'triglycerides', canonicalName: 'Triglycerides', bgName: 'Триглицериди', aliases: ['TG', 'TRIG', 'Triglycerides', 'Триглицериди'], category: 'lipids', unit: 'mmol/L', supportedUnits: ['mmol/L', 'mg/dL'], conversionRules: conv('mg/dL', 'mmol/L', 0.01129), description: 'Концентрация на триглицеридите в кръвта.' }),

  // ── Щитовидна жлеза ─────────────────────────────────────────────
  b({ id: 'tsh', canonicalName: 'TSH', bgName: 'TSH (тиреостимулиращ хормон)', aliases: ['TSH', 'Thyrotropin', 'Тиреостимулиращ хормон', 'ТСХ'], category: 'thyroid', unit: 'mIU/L', supportedUnits: ['mIU/L', 'µIU/mL', 'mU/L'], loinc: '3016-3', description: 'Концентрация на тиреостимулиращия хормон.' }),
  b({ id: 'ft4', canonicalName: 'Free T4', bgName: 'Свободен T4 (FT4)', aliases: ['FT4', 'fT4', 'Free T4', 'Free thyroxine', 'Свободен тироксин', 'Свободен Т4', 'FT4 (свободен тироксин)'], category: 'thyroid', unit: 'pmol/L', description: 'Концентрация на свободния тироксин.' }),
  b({ id: 'ft3', canonicalName: 'Free T3', bgName: 'Свободен T3 (FT3)', aliases: ['FT3', 'fT3', 'Free T3', 'Free triiodothyronine', 'Свободен трийодтиронин', 'Свободен Т3'], category: 'thyroid', unit: 'pmol/L', description: 'Концентрация на свободния трийодтиронин.' }),
  b({ id: 'anti_tpo', canonicalName: 'Anti-TPO antibodies', bgName: 'Анти-TPO антитела', aliases: ['Anti-TPO', 'TPO Ab', 'TPOAb', 'Анти-ТПО', 'Анти-TPO', 'Антитела срещу тиреоидна пероксидаза'], category: 'thyroid', unit: 'IU/mL', description: 'Ниво на антитела срещу тиреоидната пероксидаза.' }),

  // ── Хормони ─────────────────────────────────────────────────────
  b({ id: 'testosterone', canonicalName: 'Testosterone', bgName: 'Тестостерон', aliases: ['Testosterone', 'TESTO', 'Тестостерон', 'Тестостерон общ', 'Total testosterone'], category: 'hormones', unit: 'nmol/L', description: 'Концентрация на хормона тестостерон.' }),
  b({ id: 'cortisol', canonicalName: 'Cortisol', bgName: 'Кортизол', aliases: ['Cortisol', 'Кортизол', 'Кортизол сутрешен'], category: 'hormones', unit: 'nmol/L', description: 'Концентрация на хормона кортизол. Зависи от часа на вземане на пробата.' }),
  b({ id: 'prolactin', canonicalName: 'Prolactin', bgName: 'Пролактин', aliases: ['PRL', 'Prolactin', 'Пролактин'], category: 'hormones', unit: 'mIU/L', supportedUnits: ['mIU/L', 'ng/mL'], description: 'Концентрация на хормона пролактин. Единиците mIU/L и ng/mL не се конвертират автоматично (зависят от метода).' }),
  b({ id: 'estradiol', canonicalName: 'Estradiol', bgName: 'Естрадиол', aliases: ['E2', 'Estradiol', 'Oestradiol', 'Естрадиол'], category: 'hormones', unit: 'pmol/L', description: 'Концентрация на хормона естрадиол.' }),

  // ── Витамини ────────────────────────────────────────────────────
  b({ id: 'vit_d', canonicalName: '25-OH Vitamin D', bgName: 'Витамин D (25-OH)', aliases: ['25-OH Vitamin D', 'Vitamin D', '25(OH)D', '25-OH-D', 'Витамин D', 'Витамин D (25-OH)', '25-OH витамин D', 'Витамин Д'], category: 'vitamins', unit: 'nmol/L', supportedUnits: ['nmol/L', 'ng/mL'], description: 'Концентрация на 25-хидрокси витамин D. Единиците nmol/L и ng/mL се водят отделно.' }),
  b({ id: 'vit_b12', canonicalName: 'Vitamin B12', bgName: 'Витамин B12', aliases: ['B12', 'Vitamin B12', 'Cobalamin', 'Витамин B12', 'Витамин В12', 'Кобаламин'], category: 'vitamins', unit: 'pmol/L', supportedUnits: ['pmol/L', 'pg/mL'], description: 'Концентрация на витамин B12.' }),
  b({ id: 'folate', canonicalName: 'Folate', bgName: 'Фолиева киселина', aliases: ['Folate', 'Folic acid', 'Фолиева киселина', 'Фолат'], category: 'vitamins', unit: 'nmol/L', supportedUnits: ['nmol/L', 'ng/mL'], description: 'Концентрация на фолат (витамин B9).' }),

  // ── Минерали и електролити ──────────────────────────────────────
  b({ id: 'iron', canonicalName: 'Iron', bgName: 'Желязо', aliases: ['Fe', 'Iron', 'Serum iron', 'Желязо', 'Серумно желязо'], category: 'minerals', unit: 'µmol/L', description: 'Концентрация на желязо в серума.' }),
  b({ id: 'ferritin', canonicalName: 'Ferritin', bgName: 'Феритин', aliases: ['FERR', 'Ferritin', 'Феритин'], category: 'minerals', unit: 'µg/L', supportedUnits: ['µg/L', 'ng/mL'], description: 'Концентрация на феритин – белтък, който съхранява желязо.' }),
  b({ id: 'sodium', canonicalName: 'Sodium', bgName: 'Натрий', aliases: ['Na', 'Sodium', 'Натрий'], category: 'minerals', unit: 'mmol/L', description: 'Концентрация на натрий в серума.' }),
  b({ id: 'potassium', canonicalName: 'Potassium', bgName: 'Калий', aliases: ['K', 'Potassium', 'Калий'], category: 'minerals', unit: 'mmol/L', description: 'Концентрация на калий в серума.' }),
  b({ id: 'calcium', canonicalName: 'Calcium', bgName: 'Калций', aliases: ['Ca', 'Calcium', 'Калций', 'Калций общ', 'Total calcium'], category: 'minerals', unit: 'mmol/L', description: 'Концентрация на общия калций в серума.' }),
  b({ id: 'magnesium', canonicalName: 'Magnesium', bgName: 'Магнезий', aliases: ['Mg', 'Magnesium', 'Магнезий'], category: 'minerals', unit: 'mmol/L', description: 'Концентрация на магнезий в серума.' }),

  // ── Възпалителни показатели ─────────────────────────────────────
  b({ id: 'crp', canonicalName: 'C-reactive protein', bgName: 'CRP (C-реактивен протеин)', aliases: ['CRP', 'C-reactive protein', 'C-реактивен протеин', 'С-реактивен протеин', 'СРП', 'hs-CRP', 'hsCRP'], category: 'inflammation', unit: 'mg/L', description: 'Концентрация на C-реактивния протеин. hs-CRP и CRP може да са различни методи – проверете документа.' }),
];

export const CATEGORY_LABELS: Record<BiomarkerCategory, string> = {
  blood_count: 'Кръвна картина',
  liver: 'Чернодробни показатели',
  kidney: 'Бъбречни показатели',
  lipids: 'Липиден профил',
  glucose_metabolism: 'Глюкоза и метаболизъм',
  thyroid: 'Щитовидна жлеза',
  hormones: 'Хормони',
  vitamins: 'Витамини',
  minerals: 'Минерали',
  inflammation: 'Възпалителни показатели',
  other: 'Други',
};

export const CATEGORY_ORDER: BiomarkerCategory[] = [
  'blood_count', 'glucose_metabolism', 'lipids', 'kidney', 'liver', 'thyroid',
  'hormones', 'vitamins', 'minerals', 'inflammation', 'other',
];

const byId = new Map(BIOMARKERS.map((bm) => [bm.id, bm]));

export function getBiomarker(id: string | null | undefined): Biomarker | undefined {
  return id ? byId.get(id) : undefined;
}

/** Normalize a name for exact alias matching: case, spacing, punctuation, Latin/Cyrillic lookalikes are NOT merged. */
export function normalizeAliasKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[μµ]/g, 'µ')
    .replace(/[\s\-_.,:;()[\]'"*]+/g, '')
    .trim();
}

const aliasIndex = new Map<string, string>();
for (const bm of BIOMARKERS) {
  for (const name of [bm.canonicalName, bm.bgName, ...bm.aliases]) {
    const key = normalizeAliasKey(name);
    const existing = aliasIndex.get(key);
    if (existing && existing !== bm.id) {
      throw new Error(`Alias collision: "${name}" → ${existing} and ${bm.id}`);
    }
    aliasIndex.set(key, bm.id);
  }
}

/** Exact alias lookup. Returns undefined rather than guessing. */
export function matchBiomarker(name: string): Biomarker | undefined {
  const id = aliasIndex.get(normalizeAliasKey(name));
  return id ? byId.get(id) : undefined;
}

/** Find an explicit conversion rule for a biomarker, if any. */
export function findConversion(biomarker: Biomarker, from: string, to: string): UnitConversion | undefined {
  return biomarker.conversionRules.find((r) => r.from === from && r.to === to);
}
