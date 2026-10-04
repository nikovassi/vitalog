import { expect, test } from '@playwright/test';
import { APP_PAGES, startDemo } from './helpers';

const WIDTHS = [320, 375, 390, 430, 768, 1024, 1440, 1920];

test('no horizontal overflow at any breakpoint', async ({ page }) => {
  test.setTimeout(240_000);
  await startDemo(page);
  const problems: string[] = [];
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    for (const url of ['/', ...APP_PAGES]) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(150);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (over > 1) problems.push(`${w}px ${url}: +${over}px`);
    }
  }
  expect(problems).toEqual([]);
});

test('touch targets in the mobile navigation are at least 44px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await startDemo(page);
  const nav = page.getByRole('navigation', { name: 'Основна навигация' }).last();
  for (const link of await nav.getByRole('link').all()) {
    const box = await link.boundingBox();
    expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(44);
  }
});
