import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const FIX = (f: string) => fileURLToPath(new URL(`../../../fixtures/pdfs/${f}`, import.meta.url));

test('own data: start → upload PDF → processed in the browser → review → confirm → chart; persists after reload', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', (r) => { if (r.method() !== 'GET') outbound.push(`${r.method()} ${r.url()}`); });
  // device-only profile (works with and without cloud sync configured)
  await page.goto('./start');
  await page.getByLabel('Как да те наричаме?').fill('Николай');
  await page.getByLabel(/Разбирам/).check();
  await page.getByRole('button', { name: 'Започни' }).click();
  await page.waitForURL('**/app');
  await page.getByRole('button', { name: 'Качи първото си изследване' }).first().click();

  await page.getByLabel('Избери PDF файл').setInputFiles(FIX('demo-2025-01-15-alpha.pdf'));
  await page.waitForURL('**/review/**', { timeout: 60_000 });
  await expect(page.getByText(/Открихме 33 показателя/)).toBeVisible();
  await page.getByRole('button', { name: 'Потвърди и запази' }).click();
  await page.waitForURL('**/reports/**');
  await expect(page.getByText('Изследването е добавено към твоята здравна история.').first()).toBeVisible();

  await page.goto('./app/upload');
  await page.getByLabel('Избери PDF файл').setInputFiles(FIX('demo-2026-02-01-gamma.pdf'));
  await page.waitForURL('**/review/**', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Потвърди и запази' }).click();
  await page.waitForURL('**/reports/**');

  await page.goto('./app/biomarkers/uric_acid');
  await expect(page.getByRole('figure', { name: /Графика: Пикочна киселина/ })).toBeVisible();
  // 6.2 mg/dL × 59.48 = 368.8 µmol/L vs 312 → +18.2%
  await expect(page.getByText('Стойността се е увеличила с 18,2% спрямо предходното измерване.')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: /Пикочна киселина/ })).toBeVisible();
  await page.goto('./app/reports');
  await expect(page.getByText('2 изследвания')).toBeVisible();
  // nothing was POSTed anywhere: all processing is local
  expect(outbound).toEqual([]);
});

test('duplicate and invalid files show clear errors', async ({ page }) => {
  await page.goto('./start');
  await page.getByLabel('Как да те наричаме?').fill('Тест');
  await page.getByLabel(/Разбирам/).check();
  await page.getByRole('button', { name: 'Започни' }).click();
  await page.waitForURL('**/app');
  await page.goto('./app/upload');
  await page.getByLabel('Избери PDF файл').setInputFiles(FIX('not-a-pdf.pdf'));
  await expect(page.getByText('Файлът не е валиден PDF')).toBeVisible();
  await page.goto('./app/upload');
  await page.getByLabel('Избери PDF файл').setInputFiles(FIX('encrypted.pdf'));
  await expect(page.getByText('PDF файлът е защитен с парола')).toBeVisible({ timeout: 30_000 });
});

test('demo: seeded by parsing synthetic PDFs in the browser', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: /Разгледай демо/ }).click();
  await page.waitForURL('**/app', { timeout: 90_000 });
  await expect(page.getByRole('heading', { name: /Николай/ })).toBeVisible();
  await expect(page.getByText(/5 изследвания/)).toBeVisible();
  await expect(page.getByText('Имаш непроверени данни.')).toBeVisible({ timeout: 30_000 });
  await page.goto('./app/documents');
  await page.getByRole('button', { name: 'Преглед' }).first().click();
  // desktop: embedded viewer; phones: open in a new tab
  await expect(page.locator('iframe').or(page.getByRole('link', { name: 'Отвори в нов раздел' })).first()).toBeVisible();
});

test('scanned PDF: OCR runs in the browser and uncertain values are flagged', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('./start');
  await page.getByLabel('Как да те наричаме?').fill('OCR');
  await page.getByLabel(/Разбирам/).check();
  await page.getByRole('button', { name: 'Започни' }).click();
  await page.waitForURL('**/app');
  await page.goto('./app/upload');
  await page.getByLabel('Избери PDF файл').setInputFiles(FIX('scanned-bg.pdf'));
  await expect(page.getByText('Разпознаване на сканиран текст')).toBeVisible({ timeout: 30_000 });
  await page.waitForURL('**/review/**', { timeout: 150_000 });
  await expect(page.getByText('Документът е сканиран')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Нужна е твоята проверка/ })).toBeVisible();
});
