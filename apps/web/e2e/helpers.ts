import type { Page } from '@playwright/test';

export async function startDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Разгледай демо/ }).click();
  await page.waitForURL('**/app');
  await page.getByRole('heading', { name: /Николай/ }).waitFor();
}

export async function register(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Как да те наричаме?').fill('Николай');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Парола').fill('e2e long passphrase 2026');
  await page.getByLabel(/Съгласен съм Vitalog/).check();
  await page.getByLabel(/Разбирам, че Vitalog не поставя диагнози/).check();
  await page.getByRole('button', { name: 'Създай акаунт' }).click();
  await page.waitForURL('**/app');
  return email;
}

export const APP_PAGES = ['/app', '/app/reports', '/app/biomarkers', '/app/biomarkers/uric_acid', '/app/trends', '/app/timeline', '/app/documents', '/app/specialists', '/app/settings', '/app/upload', '/app/results/new', '/app/summary', '/app/share', '/app/compare'];
