import { expect, test } from '@playwright/test';
import { startDemo } from './helpers';

test('mobile: bottom navigation with upload button on every main section', async ({ page }) => {
  await startDemo(page);
  for (const url of ['/app', '/app/reports', '/app/biomarkers', '/app/settings']) {
    await page.goto(url);
    await expect(page.getByRole('link', { name: 'Качи изследване' }).last()).toBeVisible();
  }
  await page.getByRole('link', { name: 'Качи изследване' }).last().click();
  await expect(page.getByRole('button', { name: 'Избери файл' })).toBeVisible();
});

test('mobile: tap a chart point shows its value', async ({ page }) => {
  await startDemo(page);
  await page.goto('/app/biomarkers/uric_acid');
  const fig = page.getByRole('figure', { name: /Графика/ });
  await expect(fig).toBeVisible();
  const dot = fig.locator('.recharts-line-dots circle').last();
  await dot.tap({ force: true });
  await expect(page.getByText(/µmol\/L/).first()).toBeVisible();
});

test('mobile: report table becomes cards', async ({ page }) => {
  await startDemo(page);
  await page.goto('/app/reports');
  await page.getByRole('link', { name: /Кръвни изследвания/ }).first().click();
  await expect(page.locator('table').first()).toBeHidden();
  await expect(page.getByRole('listitem').filter({ hasText: 'Глюкоза' }).first()).toBeVisible();
});
