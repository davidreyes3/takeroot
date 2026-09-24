import { test, expect } from '@playwright/test';
import { openPath, openSection, openSections, studyLesson, answeredCardCount } from './app.js';

/**
 * The path, in a real browser.
 *
 * What is worth testing here is only what jsdom cannot reach: a session that
 * writes through Dexie into real IndexedDB, and a genuine page reload reading
 * it back. The collapse rules themselves are proved far more cheaply in
 * PathScreen.test.tsx, and are not repeated.
 */

/**
 * Where the open section's card sits in the viewport. Arriving on the path
 * scrolls it to the top, so this is its scroll margin - not the hundreds of
 * pixels of sections above it.
 */
async function openSectionTop(page: import('@playwright/test').Page, name: string): Promise<number> {
  const box = await page.locator('.unit', { has: page.getByRole('button', { name: `Collapse ${name}` }) }).boundingBox();
  return box?.y ?? Number.NaN;
}

test('opens the section you were last working in, scrolled to, and still does after a reload', async ({ page }) => {
  await openPath(page);
  expect(await openSections(page)).toEqual([expect.stringContaining('people')]);

  await openSection(page, 'animals');
  const answered = await studyLesson(page, 'Pets and farm animals 1');
  expect(await answeredCardCount(page)).toBe(answered);

  // Coming out of a session rebuilds the path from scratch, so this is the
  // stored answers talking, not a leftover piece of component state.
  expect(await openSections(page)).toEqual([expect.stringContaining('animals')]);
  // Unit 4: three sections sit above it, so an unscrolled page would put it
  // far down the screen.
  expect(await openSectionTop(page, 'animals')).toBeLessThan(40);

  await page.reload();
  await page.locator('.unit').first().waitFor();
  expect(await openSections(page)).toEqual([expect.stringContaining('animals')]);
  expect(await openSectionTop(page, 'animals')).toBeLessThan(40);
});

test('says what is inside a closed section without needing it opened', async ({ page }) => {
  await openPath(page);
  // Not "people": with no history at all that is the section the path opens
  // on, so it has no Open control to read.
  const closed = page.getByRole('button', { name: /^Open greetings,/ });
  await expect(closed).toContainText('Hello and goodbye');
  await expect(closed).toContainText('Good wishes');
  await expect(closed).toHaveAttribute('aria-label', /0 of 16 words mastered/);
});

test('opens a section tapped anywhere on its card, not only on its title', async ({ page }) => {
  await openPath(page);
  // The lesson list at the foot of the card is as much of the target as the
  // bar is - on a phone, the whole card is what a thumb lands on.
  await page.getByRole('button', { name: /^Open greetings,/ }).getByText('Good wishes').click();
  expect(await openSections(page)).toContainEqual(expect.stringContaining('greetings'));
});

test('closes an open section from its header bar', async ({ page }) => {
  await openPath(page);
  await page.getByRole('button', { name: /^Collapse people,/ }).click();
  expect(await openSections(page)).toEqual([]);
  await expect(page.getByRole('button', { name: /^Open people,/ })).toBeVisible();
});

test('leaves a section open while you pick a lesson inside it', async ({ page }) => {
  // The failure this guards against is a tap meant for a lesson collapsing
  // the section out from under the finger reaching for it.
  await openPath(page);
  await page.getByRole('button', { name: /^Pronouns,/ }).click();
  await expect(page.getByRole('button', { name: /^Start/ })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  expect(await openSections(page)).toEqual([expect.stringContaining('people')]);
});

test('gives the header bar a target a finger can actually hit', async ({ page }) => {
  await openPath(page);
  const bar = page.locator('.unit[data-open="true"] .unit-bar').first();
  const box = await bar.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
