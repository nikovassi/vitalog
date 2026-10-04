import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { APP_PAGES, startDemo } from './helpers';

test.describe('accessibility (WCAG 2.1 A/AA via axe-core)', () => {
  test('public pages', async ({ page }) => {
    for (const url of ['/', '/login', '/register']) {
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
      expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${url}: ${v.id} ${v.nodes[0]?.target}`)).toEqual([]);
    }
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`app pages – ${theme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await startDemo(page);
      const problems: string[] = [];
      for (const url of APP_PAGES) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(300);
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).exclude('.recharts-wrapper').analyze();
        for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) problems.push(`${url}: ${v.id} → ${v.nodes.slice(0, 2).map((n) => n.target).join(' | ')}`);
      }
      expect(problems).toEqual([]);
    });
  }

  test('keyboard: skip link and focus are visible', async ({ page }) => {
    await startDemo(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Към съдържанието' })).toBeFocused();
  });
});
