import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { createClient as create } from '@supabase/supabase-js';
import WebSocket from 'ws';

// Node 20 has no global WebSocket (needed by supabase-js realtime); tests don't use realtime
const createClient = (url: string, key: string) => create(url, key, { auth: { persistSession: false }, realtime: { transport: WebSocket as never } });

/** Runs only against a build with VITE_SUPABASE_URL (local `supabase start` or a real project). */
const SB_URL = process.env.E2E_SUPABASE_URL;
const SB_ANON = process.env.E2E_SUPABASE_ANON_KEY;
test.skip(!SB_URL || !SB_ANON, 'cloud E2E needs E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY');

const FIX = (f: string) => fileURLToPath(new URL(`../../../fixtures/pdfs/${f}`, import.meta.url));
const PASSWORD = 'e2e cloud passphrase 2026';

async function register(page: Page, email: string) {
  await page.goto('./register');
  await page.getByLabel('Как да те наричаме?').fill('Николай');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Парола').fill(PASSWORD);
  await page.getByLabel(/Съгласен съм/).check();
  await page.getByLabel(/Разбирам, че Vitalog/).check();
  await page.getByRole('button', { name: 'Създай акаунт' }).click();
  await page.waitForURL('**/app');
  const code = await page.locator('p.font-mono').innerText();
  await page.getByLabel('Запазих кода на сигурно място').check();
  await page.getByRole('button', { name: 'Запазих го' }).click();
  // then the short onboarding
  await page.getByRole('button', { name: 'По-късно' }).click();
  return code;
}

test('cloud: sign up → upload → only ciphertext stored → another device sees the data → RLS isolates users', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const email = `e2e-${Date.now()}@example.com`;
  const recovery = await register(page, email);
  expect(recovery).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){5}$/);

  await page.goto('./app/upload');
  await page.getByLabel('Избери PDF файл').setInputFiles(FIX('demo-2025-01-15-alpha.pdf'));
  await page.waitForURL('**/review/**', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Потвърди и запази' }).click();
  await page.waitForURL('**/reports/**');
  await expect(page.getByRole('status').filter({ hasText: 'Запазено' })).toBeVisible({ timeout: 15_000 });

  // What the server stores: ciphertext only
  const sb = createClient(SB_URL!, SB_ANON!);
  await sb.auth.signInWithPassword({ email, password: PASSWORD });
  const { data: row } = await sb.from('vitalog_state').select('ciphertext').single();
  expect(row!.ciphertext.length).toBeGreaterThan(1000);
  expect(atob(row!.ciphertext)).not.toMatch(/Пикочна|uric|mmol|312/);
  const uid = (await sb.auth.getUser()).data.user!.id;
  const { data: files } = await sb.storage.from('vitalog-files').list(uid);
  expect(files!.length).toBe(1);
  const { data: blob } = await sb.storage.from('vitalog-files').download(`${uid}/${files![0]!.name}`);
  const head = new TextDecoder().decode((await blob!.arrayBuffer()).slice(0, 5));
  expect(head).not.toBe('%PDF-');

  // Another user cannot read this user's rows or files (RLS)
  const other = createClient(SB_URL!, SB_ANON!);
  await other.auth.signUp({ email: `other-${Date.now()}@example.com`, password: PASSWORD });
  expect((await other.from('vitalog_state').select('*')).data).toEqual([]);
  expect((await other.from('vitalog_keys').select('*')).data).toEqual([]);
  expect((await other.storage.from('vitalog-files').download(`${uid}/${files![0]!.name}`)).error).toBeTruthy();
  // and anonymous visitors get nothing
  const anon = createClient(SB_URL!, SB_ANON!);
  expect((await anon.from('vitalog_state').select('*')).data ?? []).toEqual([]);

  // Second device: fresh browser context, log in → same data, decrypted locally
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto('./login');
  await p2.getByLabel('Email').fill(email);
  await p2.getByLabel('Парола').fill(PASSWORD);
  await p2.getByRole('button', { name: 'Вход', exact: true }).click();
  await p2.waitForURL('**/app');
  await p2.goto('./app/biomarkers/uric_acid');
  await expect(p2.getByText('312').first()).toBeVisible();
  // original PDF is downloaded and decrypted on the device
  await p2.goto('./app/documents');
  await p2.getByRole('button', { name: 'Преглед' }).first().click();
  await expect(p2.locator('iframe').or(p2.getByRole('link', { name: 'Отвори в нов раздел' })).first()).toBeVisible();

  // Log out leaves nothing readable on the device
  await p2.goto('./app/settings');
  await p2.getByRole('button', { name: 'Изход' }).first().click();
  await p2.waitForURL(/\/login/);
  await p2.goto('./app');
  await p2.waitForURL('**/login**');
  await ctx2.close();
});

test('cloud: password changed by email reset → unlock with the recovery code', async ({ page }) => {
  test.setTimeout(180_000);
  const email = `reset-${Date.now()}@example.com`;
  const recovery = await register(page, email);
  await page.goto('./app/results/new');
  await page.getByLabel('Показател *').selectOption('glucose');
  await page.getByLabel('Стойност *').fill('5,4');
  await page.getByRole('button', { name: 'Запази резултата' }).click();
  await page.waitForURL('**/biomarkers/glucose');
  await expect(page.getByRole('status').filter({ hasText: 'Запазено' })).toBeVisible({ timeout: 15_000 });

  // simulate "forgot password": set a new password directly (the email link does the same)
  const sb = createClient(SB_URL!, SB_ANON!);
  await sb.auth.signInWithPassword({ email, password: PASSWORD });
  await sb.auth.updateUser({ password: 'brand new passphrase 99' });

  await page.goto('./app/settings');
  await page.getByRole('button', { name: 'Изход' }).first().click();
  await page.waitForURL(/\/login/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Парола').fill('brand new passphrase 99');
  await page.getByRole('button', { name: 'Вход', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Код за възстановяване' })).toBeVisible();
  await page.getByLabel('Код за възстановяване').fill('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF');
  await page.getByRole('button', { name: 'Отключи данните' }).click();
  await expect(page.getByText('Невалиден код за възстановяване.')).toBeVisible();
  await page.getByLabel('Код за възстановяване').fill(recovery.toLowerCase());
  await page.getByRole('button', { name: 'Отключи данните' }).click();
  await page.waitForURL(/\/app/);
  // a new recovery code is issued
  await expect(page.locator('p.font-mono')).toBeVisible();
  await page.getByLabel('Запазих кода на сигурно място').check();
  await page.getByRole('button', { name: 'Запазих го' }).click();
  await page.goto('./app/biomarkers/glucose');
  await expect(page.getByText('5,4').first()).toBeVisible();
});

test('cloud: delete account removes everything', async ({ page }) => {
  const email = `del-${Date.now()}@example.com`;
  await register(page, email);
  await page.goto('./app/settings');
  await page.getByRole('button', { name: 'Изтрий профила и всички данни' }).click();
  await page.getByLabel(/Напиши/).fill('ИЗТРИЙ');
  await page.getByRole('button', { name: 'Изтрий', exact: true }).click();
  await page.waitForURL(/vitalog\/($|login)/);
  const sb = createClient(SB_URL!, SB_ANON!);
  const { error } = await sb.auth.signInWithPassword({ email, password: PASSWORD });
  expect(error).toBeTruthy();
});
