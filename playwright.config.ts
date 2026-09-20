import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests, and the screenshots that go with them.
 *
 * These exist because the layer below them cannot see certain things. Vitest
 * with jsdom proves the rules; only a real browser proves that a real session
 * writes to real IndexedDB and that the path still opens where you left off
 * after a reload - and only a screenshot shows that a chevron is pointing the
 * wrong way or that a list is wrapping badly.
 *
 * The whole suite is one phone-sized Chromium. The app is local-first and
 * has no backend, so there is nothing a second browser would exercise that
 * the unit tests do not already cover; cross-browser is a cost to pay when
 * there is a reason, not by default.
 */
export default defineConfig({
  testDir: './e2e',
  /* Each spec gets a fresh browser context, so its IndexedDB starts empty -
     which means specs must not depend on each other's study history. */
  fullyParallel: true,
  /* A flaky browser test must never be the reason a good commit fails to
     publish. Locally a retry would only hide a real failure from me. */
  retries: process.env.CI ? 2 : 0,
  /* One worker in CI: the runner is small and a starved browser is the
     classic source of timeouts that look like bugs. Spread rather than
     `: undefined`, which exactOptionalPropertyTypes rejects - locally the
     absence of the key is what lets Playwright pick its own default. */
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    /* Phone-sized, because that is where this app is actually used. */
    ...devices['Pixel 7'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    /* The dev port is pinned (see CLAUDE.md); reuse whatever is already
       there rather than failing on a server I did not start. */
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
