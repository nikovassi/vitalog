# 09 · Безплатен облак: Supabase + GitHub Pages

Версията в GitHub Pages може да пази данните в облака **безплатно** чрез Supabase (Free план, регион Франкфурт). Обработката на PDF остава в браузъра, а в облака отиват **само криптирани данни**.

## Защо Supabase (проучване, октомври 2026)

| Платформа | Безплатно | ЕС | Бележка |
|---|---|---|---|
| **Supabase Free** ✅ | 500 MB база, 1 GB файлове, 5 GB трафик, 50 000 потребители | Франкфурт | Проектът „заспива“ след 7 дни без активност → решено с ежедневна проверка (`keepalive.yml`) |
| Neon (Auth + Storage) | 1 GB база, 5 GB файлове | Франкфурт | Новият backend е GA от 17.09.2026 – по-малко проверен; добра резерва |
| Oracle Cloud Always Free | 4 ядра / 24 GB VM | Франкфурт | Подходящ за пълната сървърна версия; изисква карта и поддръжка на сървъра |
| Firebase Spark | — | Auth е само в САЩ; Storage вече е платен | ❌ |
| Koyeb / Render / AWS | — | — | Безплатното е премахнато, „спи“ или изтрива базата след 30 дни ❌ |

Очакван обем: 20 PDF/месец ≈ 10 MB/месец → около 1% от безплатния лимит годишно.

Източници: supabase.com/pricing, supabase.com/docs/guides/platform/free-project-pausing, supabase.com/docs/guides/auth/auth-smtp, neon.com/pricing, docs.oracle.com (Always Free), firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024, koyeb.com/blog (Mistral).

## Как работи сигурността (zero-knowledge)

```
парола ──PBKDF2-SHA256, 600 000 итерации──► ключ₁ ─┐
код за възстановяване ──PBKDF2──────────────► ключ₂ ─┼─► „опаковани“ копия на ключа за данни ──► Supabase
случаен 256-битов ключ за данни (DEK) ─────────────┘
DEK ──AES-256-GCM──► всички резултати (JSON) и всеки PDF ──► Supabase (само шифър)
```

- Supabase **никога** не получава паролата, кода за възстановяване или ключа за данни. Персоналът на Supabase, изтекла база или backup показват само нечетими байтове.
- Row Level Security: всеки потребител вижда само своя ред и своята папка с файлове (тестове: друг потребител и анонимни посетители получават празен резултат).
- На устройството ключът се пази като неекспортируем `CryptoKey`; при „Изход“ се изтрива.
- **Забравена парола:** смяната през имейл е възможна, но данните се отключват **само с кода за възстановяване**. Без паролата и без кода данните не могат да бъдат възстановени – от никого. Това е цената на пълната поверителност.

## Настройка (еднократно, ~10 минути)

### 1. Създай проект в Supabase
1. Регистрация на https://supabase.com (безплатно, без карта).
2. **New project** → име `vitalog` → **Region: Central EU (Frankfurt)** → генерирай парола за базата (не ти трябва в приложението; запази я в мениджър за пароли).

### 2. Създай таблиците и правилата за достъп
Supabase → **SQL Editor** → постави цялото съдържание на [`supabase/migrations/0001_vitalog.sql`](../supabase/migrations/0001_vitalog.sql) → **Run**.

### 3. Настрой входа
Supabase → **Authentication → URL Configuration**:
- Site URL: `https://nikovassi.github.io/vitalog/`
- Redirect URLs: `https://nikovassi.github.io/vitalog/login` и `https://nikovassi.github.io/vitalog/reset`

**Authentication → Providers → Email**: минимална дължина на паролата `10`.

> Вграденият имейл на Supabase изпраща писма **само до членове на екипа на проекта** (2 на час). За ползване само от теб това е достатъчно – регистрирай се със същия имейл, с който си влязъл в Supabase. За други потребители: **Authentication → SMTP Settings** с безплатен доставчик (Brevo – 300 писма/ден, Resend – 3000/месец).

### 4. Свържи сайта
Supabase → **Project Settings → API**: копирай **Project URL** и **anon / publishable key** (публични стойности – сигурността е в RLS и криптирането).

GitHub → `nikovassi/vitalog` → **Settings → Secrets and variables → Actions → Variables** → **New repository variable**:
- `SUPABASE_URL` = Project URL
- `SUPABASE_ANON_KEY` = anon key

След това: **Actions → Pages → Run workflow** (или всеки следващ push). Сайтът вече показва „Създай акаунт“ / „Вход“. Ежедневната проверка (`Supabase keep-alive`) тръгва автоматично.

## Локално тестване

```bash
npx supabase start -x realtime,studio,edge-runtime,logflare,vector,imgproxy,supavisor,postgres-meta
```
Миграцията се прилага автоматично. После build с `VITE_SUPABASE_URL=http://127.0.0.1:54321` и `VITE_SUPABASE_ANON_KEY` от `npx supabase status`, и:
```bash
cd apps/web && E2E_SUPABASE_URL=http://127.0.0.1:54321 E2E_SUPABASE_ANON_KEY=<anon> npx playwright test -c playwright.local.config.ts
```

## Ограничения

- Няма споделяне с лекар чрез линк и PDF обобщение (изискват сървър) – използвай експорта.
- Едновременна работа от две устройства: последната промяна печели; при конфликт приложението моли за презареждане.
- GitHub Pages домейнът `nikovassi.github.io` е общ за всичките ти проекти; данните в облака са криптирани, но ключът на устройството е в браузърното хранилище на този домейн. За най-висока сигурност – собствен домейн.
