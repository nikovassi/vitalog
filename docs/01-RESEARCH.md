# 01 · Проучване

Дата: 2026-10-04. Целта е да извлечем модели (patterns), а не визуален дизайн. Vitalog има собствена визуална идентичност.

## 1. Продукти

| Продукт | Какво правят добре | Какво избягваме |
|---|---|---|
| **Guava Health** | Качване на PDF/снимка → OCR + AI → резултатите се показват на една графика с данни от портали. Records timeline с филтри по тип. „Visit Prep“ – едностранично обобщение за лекар. Export CSV/PDF по период. | Няма задължителен преглед на извлечените стойности – потребителят сам трябва да „провери числата“. |
| **Apple Health (Health Records)** | Pin на любими лабораторни показатели. Хоризонтален *range bar* – референтна зона + точка за стойността. Trends с неутрален език („обсъдете с лекар“). Споделяне на *обобщение*, не на всички точки. | Потребители се оплакват, когато референтните диапазони изчезват от изгледа. |
| **MyChart (Epic)** | Списък „най-нови първо“ + търсене, сортиране. „!“ до стойности извън диапазона + текст „не винаги е повод за притеснение“. Past Results + графика с филтри (Последни N / Месец / Година / Всички / Custom). | Trend-ът е заровен на две нива („таб в таб“). |
| **Function Health** | Обобщение „X в диапазон / Y извън“ по категории (сърце, бъбреци…). Sparkline за всеки маркер. | Смесване на „оптимални“ с лабораторни граници. Генерични AI диетични съвети. |
| **InsideTracker** | Групиране по категории, web + mobile. | Собствени „optimized zones“ вместо лабораторния диапазон. |
| **Heads Up Health** | Персонализируеми плочки с избрани показатели. Export CSV/PDF/PNG. Редакция/изтриване на ръчни записи. | — |
| **Healthmatters.io** | Три изгледа: Graph / All tests (timeline) / Table (side-by-side). Сравнение на графики. Споделяне с лекар чрез покана. | Разчита на ръчно въвеждане от хора (бавно, скъпо). |
| **PDF „lab reader“ apps** (Bloodwise, Wizey…) | Бърз upload + ясен disclaimer „не е медицинско изделие“. | AI интерпретации и диети без преглед на извлечените данни. |
| **Fasten Health** | FHIR-native, self-hosted, няколко членове на семейството. | — |
| **CommonHealth** | Данни само на устройството, криптирани; съгласие за всяко споделяне. | — |

## 2. UX практики, които прилагаме

1. **Range bar** при всеки резултат: зона на референтния диапазон + маркер + текстов статус (никога само цвят).
2. **Спокоен, неутрален език** при стойност извън диапазона: „Извън референтния диапазон на лабораторията“, а не „Опасно“.
3. **Произход (provenance) на всяка стойност**: лаборатория, дата, документ, страница, начин на въвеждане (PDF / ръчно / импорт), редактирана ли е.
4. **Референтна зона зад графиката**; ако лабораториите имат различни диапазони, зоната се сменя по периоди (step), а не се осреднява.
5. **Sparkline** в списъка с показатели.
6. **Времеви филтри**: 3м / 6м / 1г / 3г / Всички / Custom.
7. **Любими (pin)** – показват се на Dashboard.
8. **Предвидим профил на показател**: стойност → графика → таблица история → референтен диапазон → източници.
9. **Обобщение по категории** на Dashboard („Липиден профил: 1 от 4 извън диапазона“).
10. **Задължителен преглед** след извличане – ниска увереност е подчертана, нищо не се записва без потвърждение.
11. **Audit trail** – оригиналната извлечена стойност се пази винаги.
12. **Лабораторният диапазон е единственият източник** – не налагаме „оптимални“ граници.
13. **Графика + таблица** за всяка визуализация (достъпност и точност).
14. **Бележки и събития** върху графиката (нова диета, медикамент).
15. **Фактологични известия** („Резултатът е готов за преглед“), без интерпретация.

## 3. Информационна архитектура

- Два входа към данните: **по изследване** (документ/дата) и **по показател** (история през всички изследвания) – с взаимни линкове.
- Mobile bottom nav: **Начало · Изследвания · Показатели · Документи · Профил** + централен бутон „Качи“ (FAB), достъпен от всеки екран.
- Опашка за импорт: *Обработва се → Чака преглед → Потвърдено*.
- Timeline групиран по дата с филтри (изследвания, прегледи, бележки/събития).

## 4. Anti-patterns

- Червено навсякъде и панически известия.
- Записване на AI резултати без потвърждение; скриване на източника.
- Чертане на една линия на стойности с различни единици без конверсия.
- Споделяне без изтичане и без отнемане на достъп.
- Disclaimers, скрити в общите условия – слагаме ги в контекст.

## 5. Технологично и регулаторно проучване (резюме)

- **Хостинг (EU)**: Supabase (Frankfurt, ISO 27001, DPA; US компания → DPF + SCC); AWS eu-central-1 (зрял, KMS; **Textract не поддържа кирилица**); Azure (Document Intelligence в EU региони, Azure OpenAI Data Zone EUR); Firebase Auth **няма EU residency** → отпада; Vercel – control plane и логове в САЩ → само за статичен frontend без PHI; Cloudflare R2 с EU jurisdiction; **Scaleway и OVHcloud – EU-суверенни, HDS сертифицирани**; Hetzner – евтин, без HDS.
- **Трансфери**: EU-US DPF е потвърден от Общия съд (Latombe, 03.09.2025), но е обжалваем → EU-суверенен stack премахва риска.
- **GDPR**: чл. 9 → изрично съгласие (версия, време, хеш на текста); чл. 32 → криптиране, достъп, audit, backups; чл. 35 → **DPIA е задължителна**; чл. 30 → регистър на дейностите; чл. 15/17/20 → export + реално изтриване; чл. 33-34 → 72ч уведомяване. В България: КЗЛД; възраст за дигитално съгласие – 14.
- **EU AI Act / MDR**: извличане и визуализация = нисък риск. Интерпретация/съвети могат да превърнат продукта в медицинско изделие (MDR Rule 11). → Продуктът **само извлича, показва и визуализира**.
- **EHDS (Reg. 2025/327)**: прилага се от 2027; лабораторните резултати са приоритетна категория → FHIR export е стратегически.
- **OWASP**: allowlist + magic bytes, лимит на размер, сървърно име, private storage, `Content-Disposition: attachment`, обработка в изолиран worker. ASVS 5.0 L2. **Argon2id m=19456, t=2, p=1**. TOTP + хеширани recovery codes.
- **FHIR R4**: LabReport→DiagnosticReport, LabResult→Observation (valueQuantity/UCUM, referenceRange, interpretation H/L/N), Specialist→Practitioner, Laboratory→Organization, Document→DocumentReference, извличане→Provenance.
- **LOINC (проверени)**: 3084-1 / 14933-6 урат; 2345-7 / 14749-6 глюкоза; 13457-7 LDL изч.; 18262-6 LDL директен; 2085-9 HDL; 3016-3 TSH; 4548-4 HbA1c %; 59261-8 HbA1c IFCC; 2160-0 / 14682-9 креатинин; 718-7 хемоглобин; 2093-3 / 14647-2 холестерол.
- **OCR**: Tesseract `bul+eng` (self-hosted, в EU), PaddleOCR PP-OCRv5 Cyrillic; облачно – Azure Document Intelligence (EU) / Mistral OCR (EU).
- **Конверсии (безопасни, по молекулна маса)**: глюкоза mg/dL×0.0555→mmol/L; холестерол (общ/LDL/HDL) ×0.02586; триглицериди ×0.01129; креатинин ×88.42→µmol/L; пикочна киселина ×59.48→µmol/L; хемоглобин g/dL×10→g/L. Не конвертираме ензими (U/L), имуноанализи (TSH mIU/L) и между различни методи/материали.

## Източници

Guava: guavahealth.com/article/guava-ultimate-guide · Apple: support.apple.com/en-us/HT208680, apple.com/newsroom/2026/09 · MyChart: ucsfmychart.ucsfmedicalcenter.org (TestResults.pdf), my.clevelandclinic.org/resources/test-results-procedures · Function: time.com/7176591 · InsideTracker: insidetracker.com · Heads Up: headsuphealth.com/product · Healthmatters: healthmatters.io · Fasten: github.com/fastenhealth/fasten-onprem · CommonHealth: commonhealth.org/faqs · Supabase: supabase.com/security · AWS Textract FAQ: aws.amazon.com/textract/faqs · Azure data zones: azure.microsoft.com/en-us/blog/enterprise-trust-in-azure-openai-service-strengthened-with-data-zones · Cloudflare R2: developers.cloudflare.com/r2/reference/data-location · OVH HDS: docs.ovhcloud.com (activate-hds-certification) · DPF: iapp.org (Latombe) · EHDS: eur-lex CELEX:32025R0327 · OWASP: cheatsheetseries.owasp.org (File Upload, Password Storage), github.com/OWASP/ASVS v5.0.0 · LOINC: loinc.org/<code> · Tesseract: github.com/tesseract-ocr/tessdata_best · NGSP: ngsp.org/docs/IFCCstd.pdf · Конверсии: msdvetmanual.com (SI conversion factors), tools.laboklin.com.

> Някои vendor факти идват от вторични източници – проверете DPA страниците на доставчиците преди подписване.
