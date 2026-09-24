import { test, expect } from '@playwright/test';
import { openPath, openSection } from './app.js';

/**
 * Screenshots, for looking at.
 *
 * Deliberately *not* pixel comparisons. Font rasterisation differs between
 * this machine and a CI runner, so a committed baseline would fail for
 * reasons that have nothing to do with the app, and the usual answer to that
 * - a tolerance wide enough to pass - is also wide enough to miss the kind of
 * defect worth catching. So these render the states worth looking at and
 * assert only what can be asserted honestly: that nothing threw.
 *
 * `npm run shots` writes them to e2e/shots/, which is gitignored.
 */

const OUT = 'e2e/shots';

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test(`the path, as it first opens (${scheme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));

      await openPath(page);
      await page.screenshot({ path: `${OUT}/path-fresh-${scheme}.png`, fullPage: true });

      // The header bar and one closed card, big enough to judge the details.
      await page.locator('.unit').first().screenshot({ path: `${OUT}/section-open-${scheme}.png` });
      await page.locator('.unit').nth(2).screenshot({ path: `${OUT}/section-closed-${scheme}.png` });

      expect(errors).toEqual([]);
    });

    test(`one lesson, from preview to summary and back (${scheme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));

      await openPath(page);
      await page.getByRole('button', { name: /^Pronouns,/ }).click();
      await page.getByRole('button', { name: /^Start/ }).waitFor();
      await page.screenshot({ path: `${OUT}/preview-${scheme}.png`, fullPage: true });

      await page.getByRole('button', { name: /^Start/ }).click();
      const reveal = page.getByRole('button', { name: 'Show answer' });
      const summary = page.getByRole('button', { name: 'Back to the path' });
      await reveal.waitFor();
      await page.screenshot({ path: `${OUT}/card-${scheme}.png` });

      // Easy on a new card goes straight to Review, so some of the lesson
      // comes back mastered and some only started: both ring colours.
      for (let i = 0; i < 40; i++) {
        await expect(reveal.or(summary)).toBeVisible();
        if (await summary.isVisible()) break;
        await reveal.click();
        if (i === 0) await page.screenshot({ path: `${OUT}/card-revealed-${scheme}.png` });
        await page.getByRole('button', { name: i % 2 === 0 ? /^Easy/ : /^Again/ }).click();
      }
      await page.screenshot({ path: `${OUT}/summary-${scheme}.png`, fullPage: true });

      await summary.click();
      await page.locator('.unit').first().waitFor();
      await page.screenshot({ path: `${OUT}/path-started-${scheme}.png`, fullPage: true });
      await page.locator('.unit').first().screenshot({ path: `${OUT}/section-started-${scheme}.png` });

      expect(errors).toEqual([]);
    });
  });
}

test('the path with a second section opened', async ({ page }) => {
  await openPath(page);
  await openSection(page, 'animals');
  await page.screenshot({ path: `${OUT}/path-two-open.png`, fullPage: true });
  expect(await page.locator('.unit[data-open="true"]').count()).toBe(2);
});
