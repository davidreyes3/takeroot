import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@lang/core': r('../../packages/core/src/index.ts') } },
  server: {
    // content/ lives outside the app root; let Vite read it for the ?raw glob.
    fs: { allow: [r('../..')] },
  },
});
