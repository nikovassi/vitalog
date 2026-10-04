# Vitalog

**Лабораторните ти резултати, подредени във времето.** Качваш PDF с резултати от лаборатория, Vitalog извлича показателите, ти ги проверяваш и всеки показател получава история и графика – с референтните граници на самата лаборатория.

> Тази платформа организира и визуализира предоставени медицински данни. Тя не поставя диагнози и не заменя консултацията с квалифициран медицински специалист.

🔗 **Демо (статично, синтетични данни):** https://nikovassi.github.io/vitalog/

Демото на GitHub Pages е изцяло в браузъра: записан snapshot на синтетичен профил, без сървър, без качване на файлове и без реални данни. Пълното приложение (API, база данни, обработка на PDF, криптирано хранилище) **не се хоства** в GitHub Pages – виж [Deployment](#deployment).

## Какво прави

- **Качване на PDF** (drag & drop, от телефона) → асинхронна обработка с **реален прогрес** (страници)
- **Извличане**: текстов слой (pdf.js) → **OCR** за сканирани документи (Tesseract `bul+eng`, на нашия сървър) → парсери по формат на лаборатория → (по избор, със съгласие) AI структуриране
- **Задължителен преглед**: нищо не се записва без потвърждение; несигурните стойности са първи, с извлечения текст и поле за корекция
- **Нормализация**: BG/EN имена и съкращения → един показател; `35,0` / `35.0` / `umol/l` / `μmol/L`; конверсии **само** по точни правила (напр. пикочна киселина mg/dL × 59,48)
- **Графики** с референтната зона на лабораторията (стъпаловидна, ако лабораториите се различават), събития върху графиката, таблица като алтернатива, периоди 3м–всички
- **Сравнение** на две изследвания, **тенденции** без оценка („+12% спрямо предходното измерване“)
- **Хронология, документи, специалисти** (обади се / email / карта), бележки, любими, търсене (Ctrl+K)
- **Експорт**: CSV, пълен JSON, **FHIR R4 Bundle**, PDF медицинско обобщение; **временни линкове за лекар** (избрани данни, изтичане, отнемане)
- **Сигурност**: Argon2id, сървърни сесии, CSRF, TOTP 2FA, криптиране на файловете с ключ за всеки потребител, audit log, rate limits, квоти
- **GDPR**: изрично съгласие, export, реално изтриване (crypto-shredding), минимизация – виж [docs/06-GDPR.md](docs/06-GDPR.md)
- **Mobile-first**, light/dark, WCAG 2.1 AA (axe тестове), без хоризонтален overflow от 320 до 1920 px

## Документация

| | |
|---|---|
| [01 Проучване](docs/01-RESEARCH.md) | Guava, Apple Health, MyChart, Function, InsideTracker… UX практики, регулации, OCR, LOINC, конверсии |
| [02 Архитектура](docs/02-ARCHITECTURE.md) | Stack, компоненти, PDF pipeline, parser архитектура, confidence |
| [03 UX и design system](docs/03-UX.md) | Навигация, екрани, език, токени, достъпност |
| [04 Модел на данните](docs/04-DATA-MODEL.md) | Таблици, релации, biomarker модел, FHIR съответствие |
| [05 Сигурност](docs/05-SECURITY.md) | Auth, authz, CSRF/XSS, файлове, rate limits, audit |
| [06 GDPR](docs/06-GDPR.md) | Правно основание, права, ⚖️ какво изисква юридическа проверка |
| [07 Deployment](docs/07-DEPLOYMENT.md) | Сравнение на доставчици, production архитектура, backup/DR, checklist |
| [08 Финален преглед](docs/08-REVIEW.md) | Security, медицински данни, UX – резултати и отворени въпроси |

## Структура

```
apps/api        Fastify API + worker (Node 20, TypeScript, Drizzle, PostgreSQL, pg-boss)
apps/web        React 19 + Vite + Tailwind v4 + Recharts (SPA, mobile-first)
packages/shared модели, Zod схеми, каталог на показателите, единици, статус/тенденция
packages/parser PDF текст, OCR, формати на лаборатории, нормализация, AI providers
fixtures/pdfs   синтетични PDF fixtures (генерирани, без реални данни)
deploy/         Dockerfile-и, Caddyfile, docker-compose.prod.yml
docs/           проучване, архитектура, сигурност, GDPR, deployment
```

## Стартиране (локално)

Изисквания: Node.js ≥ 20.10, Docker (за PostgreSQL).

```bash
npm install
cp .env.example .env
```

Попълни секретите в `.env` (никога не ги commit-вай):

```bash
openssl rand -base64 32
```
→ `ENCRYPTION_KEK`

```bash
openssl rand -base64 48
```
→ `URL_SIGNING_SECRET`

```bash
npm run db:up
npm run db:seed
npm run dev
```

- Frontend: http://localhost:5173 (Vite проксира `/api` към API на :4000 – същия origin, first-party cookies)
- API: http://127.0.0.1:4000 · worker: отделен процес (`npm run worker -w @vitalog/api`)
- Демо профил от seed: `SEED_DEMO_EMAIL` / `SEED_DEMO_PASSWORD` от `.env`. Или бутонът „Разгледай демо“ (изолиран синтетичен профил, изтича след 24 ч).
- Имейлите (потвърждение, смяна на парола) се печатат в конзолата на API при `EMAIL_PROVIDER=console`.

## Конфигурация

Всички променливи са описани в [`.env.example`](.env.example). Най-важните:

| Променлива | Значение |
|---|---|
| `DATABASE_URL` | PostgreSQL 16 |
| `ENCRYPTION_KEK` | 32 байта base64 – master ключ, който криптира ключовете на потребителите (production: KMS) |
| `URL_SIGNING_SECRET` | HMAC за временните подписани линкове към файлове |
| `STORAGE_DRIVER` | `local` (dev) или `s3` (S3-съвместим private bucket в ЕС) |
| `OCR_PROVIDER` | `tesseract` (self-hosted, bul+eng) или `none` |
| `AI_PROVIDER` | `none` (по подразбиране) · `openai` (OpenAI-съвместим: OpenAI / Azure OpenAI EU / Mistral EU) · `anthropic` · `mock` (само тестове) |
| `MAX_UPLOAD_MB`, `MAX_PDF_PAGES`, `MONTHLY_PROCESSING_LIMIT`, `MONTHLY_AI_LIMIT` | защита от злоупотреби и разходи |
| `REQUIRE_EMAIL_VERIFICATION` | в production `true` |
| `SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS` | изтичане на сесиите |

**AI provider.** AI само структурира таблицата; никога не тълкува. Изпраща се текст без имена/ЕГН/адреси, изходът се валидира със Zod, всяка стойност трябва да присъства буквално в документа (иначе се маркира), и всичко минава през човешки преглед. Изисква отделно съгласие на потребителя. API ключове – само в backend.

**OCR provider.** Tesseract.js в worker процеса; в Docker image-а езиковите данни са вградени (няма изтегляния при работа). Абстракцията `OcrProvider` позволява Azure Document Intelligence (EU) или PaddleOCR.

**Нов формат на лаборатория:** `packages/parser/src/formats/<лаборатория>.ts` с `detect()` и `parse()` + регистрация в `formats/registry.ts`. Общият парсер покрива всяка таблица „име · стойност · единица · диапазон“.

## Тестове

```bash
npm test
```
Unit (shared, parser с PDF fixtures, web компоненти) + API интеграционни тестове (изискват `npm run db:up`; ползват отделна база `vitalog_test` – създай я веднъж):

```bash
docker compose exec db psql -U vitalog -c "create database vitalog_test"
```

OCR тест върху сканиран PDF (изтегля езиковите данни при първо пускане):

```bash
RUN_OCR_TESTS=1 npm test -w @vitalog/parser
```

E2E, достъпност (axe, light + dark) и responsive (320–1920 px) – при пуснат `npm run dev` и база със seed:

```bash
npx playwright install chromium
npm run test:e2e
```

Синтетичните PDF fixtures се генерират с `npm run fixtures`.

| Набор | Какво покрива |
|---|---|
| shared (23) | парсване на числа, единици, alias съвпадения, статус, промяна |
| parser (33 + OCR) | всички fixtures: BG/EN, формат с кодове, US единици, много страници, сканиран, криптиран, повреден, не-PDF, без резултати, нечетливи стойности, дубликати, липсваща дата/единица/диапазон, AI халюцинации |
| API (58) | auth, lockout, rate limit, CSRF, **IDOR матрица (един потребител не може да достъпи данни на друг)**, роли, audit без медицински стойности, upload валидиране, задължителен преглед, audit trail, интегритет на данните, споделяне, експорти, изтриване, демо |
| web (6) | статуси без „само цвят“, неутрален език, range bar |
| E2E (16) | основен flow с реална обработка, грешки, търсене, сравнение, специалисти, dark mode, noindex, a11y, overflow, мобилна навигация, tap върху графика |

## Deployment

Пълно описание: [docs/07-DEPLOYMENT.md](docs/07-DEPLOYMENT.md). Накратко: EU-суверенен хостинг (**Scaleway**, алтернатива OVHcloud) – управляван PostgreSQL, private S3 storage, контейнери за API и worker, Caddy за статичния frontend и HTTPS, Secret/Key Manager.

```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

**GitHub Pages** се използва само за статичното демо (`.github/workflows/pages.yml`, синтетични данни). Еднократно: *Settings → Pages → Source: GitHub Actions*. Snapshot-ът се обновява с `npm run static-demo:snapshot`.

## Сигурност и GDPR – накратко

Виж [05](docs/05-SECURITY.md), [06](docs/06-GDPR.md) и [08](docs/08-REVIEW.md). Преди production задължително: DPIA, DPA с доставчиците, юридически преглед на съгласията и privacy policy, решение за възрастовата граница (14 г. в България), KMS за ключовете, penetration test. Секрети не се пазят в репото; `.env` е в `.gitignore`.

## Production checklist

Виж [docs/07-DEPLOYMENT.md → Production checklist](docs/07-DEPLOYMENT.md#production-checklist).

## Данни

Всички данни в репото (fixtures, демо профил, лаборатории, лекари, пациент) са **синтетични и измислени**. Референтните диапазони в тях са тестови стойности, отпечатани в измислени документи – не са медицински препоръки. Каталогът с показатели не съдържа референтни стойности.
