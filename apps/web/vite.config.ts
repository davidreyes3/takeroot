import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * GitHub Pages serves a project site from a subdirectory
 * (davidreyes3.github.io/takeroot/), so built asset URLs have to be prefixed.
 * Only the Pages build sets this; local dev and preview stay at the root.
 */
const base = process.env['GITHUB_PAGES'] === 'true' ? '/takeroot/' : '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      // The service worker is regenerated on every build; the app is told
      // about a waiting update instead of hijacking the page unprompted.
      registerType: 'prompt',
      injectRegister: null,
      manifest: {
        id: base,
        name: 'takeroot',
        short_name: 'takeroot',
        description: 'Spaced-repetition Hebrew vocabulary practice.',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#0b1120',
        theme_color: '#0b1120',
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: `${base}icons/icon-maskable-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: `${base}icons/icon-maskable-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // content/ markdown is bundled into the JS at build time (via the
        // ?raw glob), not fetched at runtime, so there's nothing else here
        // that needs a custom runtime caching strategy yet.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
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
