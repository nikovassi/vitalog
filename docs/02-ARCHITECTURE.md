# 02 · Архитектура

## Принципи

1. **Здравните данни са специална категория.** Private by default, least privilege, всичко минава през authz проверка на сървъра.
2. **Платформата организира данни – не интерпретира.** Няма диагнози, няма „добре/лошо“, само факти: стойност, диапазон на лабораторията, промяна.
3. **Нищо извлечено не е истина, докато потребителят не го потвърди.** Извличането създава *кандидати*; потвърждението създава *резултати*.
4. **Оригиналът е свещен.** Пазим оригиналния текст, стойност, единица и диапазон. Нормализацията е допълнителна колона, никога замяна.
5. **Сменяеми доставчици.** Storage, OCR, AI, email, queue – зад интерфейси.

## Избор на stack

| Слой | Избор | Защо |
|---|---|---|
| Frontend | **React 19 + TypeScript + Vite**, Tailwind CSS v4, Recharts, Lucide, React Hook Form + Zod, TanStack Query, TanStack Virtual, React Router | SPA зад login – SSR/SEO не е нужен за личната част; Vite е бърз и прост. Шрифтовете са **self-hosted** (без Google Fonts → без изтичане на IP към трети страни). |
| Backend | **Node.js 20 + Fastify + Zod** | Един език (TS) с frontend → споделени схеми и biomarker каталог. Fastify е бърз, със зрели security плъгини. |
| Database | **PostgreSQL 16 + Drizzle ORM** | Релационни данни, транзакции, параметризирани заявки (SQL injection), миграции в SQL. |
| Queue | **pg-boss** (опашка в Postgres) | Без допълнителна инфраструктура (Redis). Retry, backoff, dead-letter. |
| Storage | `StorageProvider`: `LocalEncryptedStorage` (dev) / `S3Storage` (prod, S3-съвместим) | Всички файлове се криптират на ниво приложение (AES-256-GCM, envelope encryption с per-user ключ), преди да стигнат до диска/bucket-а. |
| PDF текст | **pdfjs-dist** | Позиции на текста → реконструкция на редове/таблици, номер на страница. |
| OCR | `OcrProvider`: `TesseractOcr` (bul+eng, self-hosted), `NoopOcr`; готово за Azure Document Intelligence (EU) | Сканираните PDF не са изключение в БГ лабораториите. |
| AI | `AIProvider`: `MockProvider`, `OpenAICompatibleProvider` (OpenAI / Azure OpenAI EU Data Zone / Mistral EU), `AnthropicProvider` | **Изключено по подразбиране**. Изисква отделно съгласие. Само структурира – валидира се със Zod и минава през human review. |
| Auth | Собствена: Argon2id, server-side сесии (HttpOnly cookie), TOTP MFA, email verification, password reset | Пълен контрол и EU residency; Firebase Auth няма EU residency. |

Сравнение на cloud доставчиците и обосновка за production → [07-DEPLOYMENT.md](07-DEPLOYMENT.md).

## Компоненти

```
                 ┌──────────────── Browser (SPA, mobile-first) ───────────────┐
                 │ React · TanStack Query · Recharts · noindex · CSP strict   │
                 └───────────────▲──────────────────────────────┬─────────────┘
                                 │ HTTPS, cookie session + CSRF │
┌────────────────────────────────┴──────────────────────────────▼─────────────┐
│ API (Fastify)                                                               │
│  auth · sessions · mfa │ reports · results · biomarkers · trends │ documents │
│  specialists · notes · events │ uploads │ exports (CSV/JSON/FHIR/PDF)        │
│  share-links │ notifications │ account (export/delete) │ admin (metadata)    │
│  ── middleware: helmet/CSP, rate-limit, CSRF, requireUser, audit, quotas ── │
└──────┬──────────────────────┬──────────────────────────────┬────────────────┘
       │ SQL (Drizzle)        │ enqueue job                  │ encrypt/decrypt
┌──────▼──────┐        ┌──────▼──────────────────────┐ ┌─────▼──────────────┐
│ PostgreSQL  │◄───────┤ Worker (отделен процес)     │ │ Private storage    │
│ + pg-boss   │        │ 1 text extraction (pdfjs)   │ │ (local / S3, EU)   │
└─────────────┘        │ 2 OCR ако няма текст        │ └────────────────────┘
                       │ 3 lab format parsers        │
                       │ 4 AI structuring (опция)    │
                       │ 5 normalization + validation│
                       │ 6 candidates → "Чака преглед"│
                       └─────────────────────────────┘
```

## PDF pipeline (async)

```
Upload ─► проверки (auth, квота, размер ≤ 15MB, %PDF magic bytes, page count ≤ 30)
       ─► криптирай + запиши (име = UUID) ─► document + processing_job(status=queued)
       ─► queue ─► worker:
            extracting_text  (pdfjs, по страници)
            ocr              (само ако текстът е < праг; Tesseract bul+eng)
            parsing          (registry: detect() → най-висок score; иначе GenericTableParser)
            ai_structuring   (само ако е включено + съгласие + parser confidence е нисък)
            normalizing      (aliases → biomarker; unit canonicalization; число „35,0“ → 35.0)
            validating       (confidence, дубликати, липсваща дата/единица)
       ─► status = review_required ─► notification „Резултатът е готов за преглед“
User review ─► confirm ─► lab_report + lab_results (транзакция) + audit_log
```

Прогресът е **реален**: worker-ът записва `stage` и `progress` (страница X от N) в `processing_jobs`, frontend-ът ги чете (polling на 1.5s). Няма симулиран прогрес.

### Parser архитектура (разширяемост)

```ts
interface LabFormatParser {
  id: string;                       // "generic-table", "synthetic-lab-bg-v1"…
  detect(doc: ExtractedDocument): number;     // 0..1 – колко е сигурен, че е този формат
  parse(doc: ExtractedDocument): ParsedReport; // кандидати + метаданни
}
```

Нов лабораторен формат = нов файл в `packages/parser/src/formats/` + регистрация. Generic парсерът работи с всеки PDF, в който редовете са „име · стойност · единица · диапазон“ (BG/EN, `35,0` и `35.0`, `35-52`, `35 – 52`, `< 5.2`, `> 1.0`).

### Нормализация

- `Biomarker` каталог (`packages/shared/src/biomarkers.ts`): id, canonicalName, bgName, aliases, category, canonicalUnit, supportedUnits, conversions, loinc, description, source.
- Съвпадение по нормализиран alias (lowercase, без интервали/пунктуация, µ/u унифицирани). **Няма fuzzy съвпадение без потвърждение** – ако alias не е точен, кандидатът остава „Непознат показател“ и потребителят избира.
- Единици: само синтактична канонизация (`umol/l` → `µmol/L`) и конверсии, описани изрично в каталога (по молекулна маса). Конверсията се използва **само за показване в графиката**, когато единиците на един показател се различават; оригиналът се пази.
- **Референтни диапазони идват само от документа или от потребителя.** Каталогът не съдържа „нормални стойности“.

### Confidence

Изчислява се от: парсване на числото (чисто/с OCR артефакти), наличие на единица, наличие на диапазон, alias match (точен/няма), консистентност (стойност vs диапазон по порядък), OCR confidence на думата. `< 0.85` → маркира се „Провери“; `< 0.6` или неразчетено → „Не успяхме да разчетем този резултат“ с извлечения текст и поле за редакция. Score-ът не се показва числово.

## Модули на кода

```
packages/shared   – типове (модели), Zod схеми за API, biomarker каталог, units, status/trend логика
packages/parser   – pdf text, OCR, formats, normalizer, confidence, AI providers (чисти функции, тествани с fixtures)
apps/api          – Fastify, DB схема (Drizzle), auth, routes, worker, storage, crypto, audit, exports, seed
apps/web          – SPA
fixtures/pdfs     – синтетични PDF fixtures (генерирани със scripts/generate-fixtures.mjs)
docs/             – проучване, архитектура, UX, данни, сигурност, GDPR, deployment
```

## Бъдещи интеграции (без блокиране)

- `lab_results.source` ∈ `pdf | manual | import | device` + `source_ref` → Apple Health / Health Connect / FHIR / уреди се добавят като нов source.
- FHIR export (`GET /api/export/fhir`) вече връща Bundle (Patient, DiagnosticReport, Observation, Organization, Practitioner, DocumentReference, Provenance) – виж [04-DATA-MODEL.md](04-DATA-MODEL.md).
- `timeline_events` е общ модел за изследвания, прегледи, медикаменти, ваксини, образна диагностика.
- Публичен каталог на специалисти: отделна таблица `directory_practitioners` (не е създадена – няма надежден източник на данни).
