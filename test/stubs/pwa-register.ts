/**
 * Stand-in for the `virtual:pwa-register/react` module that vite-plugin-pwa
 * injects at build time. Vitest doesn't run that plugin, so the real virtual
 * module never exists under test - alias to this instead of pulling the
 * whole PWA build pipeline into the test config.
 */
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as [boolean, (v: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (v: boolean) => void],
    updateServiceWorker: async () => {},
  };
}
