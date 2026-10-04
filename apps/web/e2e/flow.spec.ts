import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { register, startDemo } from './helpers';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/pdfs', import.meta.url));

test('main flow: register → upload PDF → processing → review → confirm → biomarker chart', async ({ page }) => {
  await register(page);
  // onboarding
  await expect(page.getByRole('dialog', { name: /Добре дошъл/ })).toBeVisible();
  await page.getByRole('button', { name: 'Качи първото си изследване' }).click();
  await page.waitForURL('**/app/upload');

  await page.getByLabel('Избери PDF файл').setInputFiles(path.join(FIXTURES, 'demo-2025-01-15-alpha.pdf'));
  await expect(page.getByText('Качване')).toBeVisible();
  // real processing by the worker → automatic redirect to review
  await page.waitForURL('**/app/review/**', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Провери резултатите' })).toBeVisible();
  await expect(page.getByText(/Открихме 33 показателя/)).toBeVisible();
  await page.getByRole('button', { name: 'Потвърди и запази' }).click();

  await page.waitForURL('**/app/reports/**');
  await expect(page.getByText('Изследването е добавено към твоята здравна история.').first()).toBeVisible();

  await page.getByRole('link', { name: 'Пикочна киселина' }).first().click();
  await expect(page.getByRole('heading', { name: /Пикочна киселина/ })).toBeVisible();
  await expect(page.getByText('Качи поне две изследвания, за да видиш тенденцията.')).toBeVisible();

  // second report → chart appears
  await page.goto('/app/upload');
  await page.getByLabel('Избери PDF файл').setInputFiles(path.join(FIXTURES, 'demo-2025-06-15-alpha.pdf'));
  await page.waitForURL('**/app/review/**', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Потвърди и запази' }).click();
  await page.waitForURL('**/app/reports/**');
  await page.goto('/app/biomarkers/uric_acid');
  await expect(page.getByRole('figure', { name: /Графика: Пикочна киселина/ })).toBeVisible();
  await expect(page.getByText('Стойността се е увеличила с 14,1% спрямо предходното измерване.')).toBeVisible();
  // accessible table alternative
  await page.getByRole('radio', { name: 'Таблица' }).click();
  await expect(page.getByRole('cell', { name: /356/ }).first()).toBeVisible();
});

test('invalid file shows a clear Bulgarian error', async ({ page }) => {
  await register(page);
  await page.goto('/app/upload');
  await page.getByLabel('Избери PDF файл').setInputFiles(path.join(FIXTURES, 'encrypted.pdf'));
  await expect(page.getByText('PDF файлът е защитен с парола')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Опитай отново' })).toBeVisible();
});

test('global search finds a biomarker by partial Bulgarian name and by abbreviation', async ({ page }) => {
  await startDemo(page);
  await page.keyboard.press('Control+k');
  const box = page.getByRole('textbox', { name: 'Търсене' });
  await box.fill('пикочна');
  await expect(page.getByRole('button', { name: /Пикочна киселина/ })).toBeVisible();
  await box.fill('TSH');
  await page.getByRole('button', { name: /TSH/ }).first().click();
  await expect(page).toHaveURL(/biomarkers\/tsh/);
});

test('compare two reports', async ({ page }) => {
  await startDemo(page);
  await page.goto('/app/compare');
  await expect(page.getByRole('columnheader', { name: 'Промяна' })).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Глюкоза' })).toBeVisible();
});

test('add a specialist and link it to a report', async ({ page }) => {
  await startDemo(page);
  await page.goto('/app/specialists?new=1');
  await page.getByLabel('Име *').fill('Д-р Тест Тестов');
  await page.getByLabel('Специалност *').fill('Нефролог');
  await page.getByLabel('Телефон').fill('+359 000 000 999');
  await page.getByRole('button', { name: 'Запази' }).click();
  await expect(page.getByRole('link', { name: /Д-р Тест Тестов/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Обади се' }).first()).toBeVisible();
});

test('dark mode applies and persists', async ({ page }) => {
  await startDemo(page);
  await page.goto('/app/settings');
  await page.getByRole('radio', { name: 'Тъмна' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('private pages are not indexable', async ({ page }) => {
  await startDemo(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  const robots = await (await page.request.get('/robots.txt')).text();
  expect(robots).toContain('Disallow: /app');
});
