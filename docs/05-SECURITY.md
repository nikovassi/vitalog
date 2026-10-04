# 05 · Модел на сигурност

Цел: OWASP ASVS 5.0 Level 2 + GDPR чл. 32. Заплахи, които моделираме: чужд потребител (IDOR), откраднат cookie, CSRF, злонамерен PDF, credential stuffing, изтичане през логове, публичен линк към документ, вътрешен достъп (support/admin), злоупотреба с AI/OCR ресурси.

## Authentication

| Механизъм | Реализация |
|---|---|
| Пароли | **Argon2id** m=19456 KiB, t=2, p=1 (OWASP). Мин. 10 символа, списък с често срещани пароли. Пароли никога не стигат до логове/frontend storage. |
| Сесии | 256-bit случаен token в cookie `__Host-vl_session` (prod) / `vl_session` (dev): `HttpOnly; Secure; SameSite=Lax; Path=/`. В DB се пази само **SHA-256 hash**. Idle timeout 30 мин, absolute 12 ч. Нов token при login и след MFA. |
| Device/session management | Списък на активни сесии (устройство, последна активност), „Излез от това устройство“, „Излез от всички“. |
| Email verification | Еднократен token (hash в DB), 24 ч. В production качването изисква потвърден email (`REQUIRE_EMAIL_VERIFICATION`). |
| Password reset | Token 256-bit, hash в DB, 30 мин, еднократен; след смяна → всички сесии се прекратяват. Отговорът е еднакъв, независимо дали email съществува (няма user enumeration). |
| MFA | TOTP (RFC 6238), secret криптиран (AES-256-GCM); 10 recovery codes (Argon2id hash). Login минава в `mfa_pending` сесия, която няма достъп до данни. |
| Lockout | 5 грешни опита → 15 мин заключване на акаунта + rate limit по IP. |
| Step-up („sudo“) | Export на всички данни, изтриване на акаунт, изключване на 2FA изискват повторна парола (валидна 10 мин). |

## Authorization

- Всяка заявка към здравни данни минава през `requireUser` и **всяка DB заявка е филтрирана по `user_id` от сесията** (никога от URL/body). Ресурси на друг потребител връщат `404` (не `403`) – без потвърждение за съществуване.
- Роли: `user`, `support`, `admin`, `superadmin`. Admin endpoints връщат **само метаданни** (брой, статус, размер, грешка-код). Няма route, през който admin да чете стойности на резултати. Промяна на роля → audit log.
- Share links: само read-only, само избраните показатели и период, с изтичане, отнемане, брояч на достъпа. Token-ът (256-bit) се пази като hash. Документи **не** се споделят по подразбиране.

## CSRF, XSS, injection

- CSRF: SameSite=Lax + **synchronizer token** (`X-CSRF-Token` header ⇔ стойност в сесията) за всяка не-GET заявка + проверка на `Origin`.
- XSS: React escaping, никакъв `dangerouslySetInnerHTML`; строг CSP (`default-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- SQL injection: само параметризирани заявки (Drizzle); `LIKE` шаблоните се escape-ват.
- Входни данни: Zod валидация на всеки body/query/params.

## Файлове (OWASP File Upload)

1. Само PDF: проверка на **magic bytes** (`%PDF-`) + `file-type`, не на разширението/Content-Type.
2. Лимит 15 MB (`MAX_UPLOAD_MB`), ≤ 30 страници, encrypted PDF се отхвърля с ясно съобщение.
3. Името на файла в storage е UUID; оригиналното име се пази санитизирано само като метаданни.
4. **App-level envelope encryption**: всеки потребител има DEK (32 байта), криптиран с master KEK (`ENCRYPTION_KEK` / KMS). Файловете са AES-256-GCM. Изтриване на акаунта = изтриване на DEK → crypto-shredding и в backup-ите.
5. Storage е private. **Няма публични URL адреси.** Изтегляне/преглед само чрез `POST /api/documents/:id/url` → **подписан временен URL** (HMAC-SHA256, 5 мин, обвързан с потребителя и документа) → API стриймва декриптирания файл с `Content-Disposition`, `Cache-Control: no-store`, `Content-Security-Policy: sandbox`.
6. Парсването е в **отделен worker процес** с таймаут; pdf.js без eval (`isEvalSupported:false`), без шрифтове/скриптове.
7. Дубликати: SHA-256 на съдържанието (per user) → „Този файл вече е качен.“

## Rate limiting и разходи

Глобално 300 req/мин/IP · auth 10/мин/IP · upload 20/час/потребител · **месечна квота за обработка** (`MONTHLY_PROCESSING_LIMIT`, по подразбиране 50 документа) · AI заявки само при съгласие и с отделна квота · usage tracking в `usage_counters`.

## Логове и audit

- Audit log (`audit_logs`): login, logout, failed login, upload, view, download, edit, delete, share, revoke, export, password reset, MFA промени, role промени. Пази: актьор, действие, тип/ID на ресурса, IP (пресечен /24), user agent, време. **Без медицински стойности.**
- Application логове: pino с redaction на `cookie`, `authorization`, `x-csrf-token`, тела на заявки не се логват.

## Backup & DR

Виж [07-DEPLOYMENT.md](07-DEPLOYMENT.md#backup--disaster-recovery).

## Финален security review

Резултатите от прегледа и автоматизираните тестове: [08-REVIEW.md](08-REVIEW.md).
