import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@lang/core': r('./packages/core/src/index.ts') } },
  test: {
    globals: true,
    include: ['packages/**/*.test.ts', 'apps/**/*.test.{ts,tsx}'],
    environmentMatchGlobs: [['apps/**', 'jsdom']],
    setupFiles: ['./vitest.setup.ts'],
  },
});
