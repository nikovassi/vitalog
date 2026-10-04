# 07 · Production архитектура и deployment

> GitHub е само source control. **Медицинската част не се хоства в GitHub Pages** или друг статичен хостинг без контрол върху данните. Условията на доставчиците се променят – проверете актуалните DPA/сертификати преди подписване.

## Сравнение на доставчиците (обобщение от проучването)

| Доставчик | EU residency | За health данни | Решение |
|---|---|---|---|
| **Scaleway** (Париж/Амстердам) | Да, EU компания | HDS сертифициран, SecNumCloud | ✅ **Препоръка** |
| **OVHcloud** (FR/DE/PL) | Да, EU компания | HDS (дейности 1–6) | ✅ Алтернатива |
| AWS eu-central-1 | Да (US компания) | Зрял, KMS; Textract **не чете кирилица** | ✅ при нужда от мащаб; OCR остава наш |
| Azure (EU региони) | Да (US компания) | Document Intelligence + OpenAI Data Zone EUR | ⚠️ ако искаме облачен OCR/AI под една EU граница |
| Supabase (Frankfurt) | Да (US компания) | ISO 27001, DPA, RLS | ⚠️ добър MVP; US CLOUD Act → DPF/SCC |
| Firebase | Auth **без** EU residency | — | ❌ |
| Vercel | Control plane/логове в САЩ | — | ⚠️ само за статичния frontend, без PHI |
| Cloudflare R2 (`jurisdiction=eu`) | Данни в ЕС | US компания | ⚠️ възможен storage |
| Hetzner | Да | Без HDS | ⚠️ евтин, всичко сами |

**Избор: EU-суверенен stack (Scaleway, с OVHcloud като резерва).** Премахва риска от трансфери (Schrems II / оспорване на DPF), предлага управлявани Postgres и S3-съвместим storage, Key Manager и Secret Manager, контейнери – без vendor lock-in (всичко е стандартно: Docker, Postgres, S3).

## Целева архитектура (Scaleway fr-par)

```
           Internet ──HTTPS──►  Load Balancer (TLS) / Caddy
                                   │  static SPA (Dockerfile.web) + /api → API
                     ┌─────────────┴──────────────┐
             Serverless Containers / Kapsule (private network)
              api (2+ replicas)           worker (1..N, CPU/RAM limits)
                     │                           │
         Managed PostgreSQL 16 (HA, encrypted, PITR backups, private network only)
         Object Storage (private bucket, SSE, versioning, lifecycle)   ← файлове, вече криптирани от приложението
         Key Manager (KEK)   Secret Manager (DB URL, URL_SIGNING_SECRET, SMTP)
         Cockpit (метрики/логове, без PHI)   Transactional Email (EU)
```

| Компонент | Как |
|---|---|
| Frontend | `deploy/Dockerfile.web` → Caddy: статичните файлове + security headers + reverse proxy `/api`. Един домейн → first-party cookies. |
| Backend | `deploy/Dockerfile.api` (`node dist/server.js`), non-root, healthcheck, ≥2 реплики. `TRUST_PROXY=true` зад LB. |
| Worker | Същият image, `node dist/worker.js`. Отделни ресурсни лимити; хоризонтално мащабиране (pg-boss разпределя задачите). Tesseract данните са вградени в image-а – няма изтегляния по време на работа. |
| Migrations | `node dist/migrate.js` като еднократна задача при всеки deploy. |
| Database | Managed PostgreSQL, само в private network, TLS, encryption at rest, автоматични backups + PITR. |
| Storage | `STORAGE_DRIVER=s3`, private bucket (block public access), без публични ACL. Инсталирайте `@aws-sdk/client-s3` в API image-а. |
| Secrets | Secret Manager → env. **KEK** – в Key Manager; за production заменете `lib/crypto.ts` wrap/unwrap с KMS извиквания (интерфейсът е изолиран). |
| Domain/HTTPS | Caddy (Let's Encrypt) или LB сертификат; HSTS preload. |
| Email | EU доставчик с DPA (Scaleway TEM, Brevo). Имейлите съдържат само линкове. |
| Monitoring | Метрики + логове (pino JSON). Логовете са redacted: без cookies, CSRF, тела на заявки, медицински стойности. Алармите: 5xx, неуспешни задачи, неуспешни логини. |

Single-VM вариант: `deploy/docker-compose.prod.yml` (Caddy + API + worker + migrate) с управляван Postgres/S3 или локални volumes.

## Backup & disaster recovery

| Какво | Как | RPO/RTO цел |
|---|---|---|
| PostgreSQL | Managed автоматични дневни backups (криптирани) + PITR 7–30 дни | RPO ≤ 5 мин, RTO ≤ 2 ч |
| Документи | Versioning на bucket + репликация в втори EU регион (напр. nl-ams); lifecycle за изтрити версии ≤ 30 дни | RPO ≤ 1 ч |
| Ключове | KEK в Key Manager с резервно копие според политиката на доставчика | — |
| Restore процедура | 1) Нова DB от PITR; 2) `node dist/migrate.js`; 3) насочване на API към новата DB; 4) проверка с `GET /api/health` и тестов профил; 5) post-mortem. Упражнение – на тримесечие. |
| Изтриване и backups | Изтрит потребител → DEK унищожен → копията му в backups не могат да бъдат декриптирани (crypto-shredding). Редовете в DB backups изтичат с ретенцията. |

## Production checklist

- [ ] Нови стойности за `ENCRYPTION_KEK` (KMS) и `URL_SIGNING_SECRET`; нито един dev default (конфигурацията отказва да стартира без тях в production).
- [ ] `NODE_ENV=production`, `REQUIRE_EMAIL_VERIFICATION=true`, `TRUST_PROXY=true`, `APP_ORIGIN=https://<домейн>`.
- [ ] `STORAGE_DRIVER=s3`, private bucket, SSE, versioning.
- [ ] Managed Postgres само в private network; отделен потребител с минимални права.
- [ ] `EMAIL_PROVIDER=smtp` с EU доставчик и DPA.
- [ ] `AI_PROVIDER=none` или EU endpoint с DPA + zero data retention; ⚖️ преглед.
- [ ] `DEMO_MODE_ENABLED` – решение (демото е изолирано и изтича след 24 ч).
- [ ] Rate limits зад LB (`TRUST_PROXY`), WAF/bot защита на `/api/auth/*` и `/api/uploads`.
- [ ] Антивирусно сканиране на качените файлове (ClamAV sidecar) и PDF sanitization (CDR) – препоръчително.
- [ ] Penetration test и външен security review.
- [ ] Всички ⚖️ точки от [06-GDPR.md](06-GDPR.md).
- [ ] Backups + тест на restore. Мониторинг и аларми.
- [ ] `npm audit`, Dependabot/Renovate, image scanning (Trivy).
