import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@lang/core': r('../../packages/core/src/index.ts') } },
  server: {
    /**
     * Pin the port, and fail rather than move.
     *
     * All study progress lives in IndexedDB, which is scoped per origin. If
     * Vite quietly fell back to 5174 because 5173 was busy, the app would open
     * against an empty database and look exactly as though months of reviews
     * had been lost. Failing to start is much the kinder outcome.
     */
    port: 5173,
    strictPort: true,
    // content/ lives outside the app root; let Vite read it for the ?raw glob.
    fs: { allow: [r('../..')] },
  },
});
