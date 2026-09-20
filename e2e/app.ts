import { expect, type Page } from '@playwright/test';

/**
 * Driving the real app.
 *
 * Every awkward detail of doing that lives here rather than in the specs, so
 * a spec reads as the rule it is checking.
 */

/** Open the app and wait until the path is actually on screen. */
export async function openPath(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.unit').first().waitFor();
}

/**
 * The sections currently expanded, named as their control names them.
 *
 * Reading the state off the accessible names rather than off a class keeps
 * the assertion honest: if the label stops saying what the control does, a
 * screen reader user loses the same information the test does.
 */
export async function openSections(page: Page): Promise<string[]> {
  return page
    .locator('.unit[data-open="true"] .unit-toggle')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
}

/** Expand a closed section by tapping its card. */
export async function openSection(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^Open ${name},`) }).click();
}

/**
 * Study a lesson to the end of its round, answering Good every time.
 *
 * Each pass waits for the next card *or* the summary, and only then decides
 * which it is looking at. Asking whether a card is on screen without waiting
 * first is the trap here: between one answer and the next render there is a
 * moment where neither is present, so the loop exits mid-session, and the
 * failure surfaces far away as "the summary never appeared". Both times that
 * happened it looked like a bug in the app rather than a race in the test -
 * once locally, once on a slower CI runner that a sleep would have papered
 * over.
 */
export async function studyLesson(page: Page, lesson: string): Promise<number> {
  await page.getByRole('button', { name: new RegExp(`^${lesson},`) }).click();
  await page.getByRole('button', { name: /^Start/ }).click();

  const reveal = page.getByRole('button', { name: 'Show answer' });
  const summary = page.getByRole('button', { name: 'Back to the path' });

  let answered = 0;
  // Bounded rather than while(true): a session is capped, so a loop that does
  // not end is itself a failure and should be reported as one.
  for (let i = 0; i < 40; i++) {
    await expect(
      reveal.or(summary),
      'the session showed neither another card nor its summary',
    ).toBeVisible();
    if (await summary.isVisible()) break;
    await reveal.click();
    await page.getByRole('button', { name: /^Good/ }).click();
    answered++;
  }

  await summary.click();
  await page.locator('.unit').first().waitFor();
  expect(answered, 'the session answered no cards at all').toBeGreaterThan(0);
  return answered;
}

/** Cards that carry an answer, read straight out of the app's own database. */
export async function answeredCardCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('hebrew-trainer');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<{ fsrs: { last_review?: number } }[]>((resolve) => {
      const request = database.transaction('cards').objectStore('cards').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    database.close();
    return rows.filter((row) => row.fsrs.last_review !== undefined).length;
  });
}
