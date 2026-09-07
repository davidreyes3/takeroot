import '@testing-library/jest-dom/vitest';

/**
 * Provide `window.localStorage` when the DOM environment lacks it.
 *
 * This project's jsdom build does not expose Storage on the window, so
 * browser code that legitimately uses localStorage would appear broken under
 * test while working fine in every real browser. Rather than contort the
 * component around a test-only gap, give the test environment the API a
 * browser actually has.
 *
 * The implementations are installed on `Storage.prototype` so that
 * `vi.spyOn(Storage.prototype, 'getItem')` still works - that is how tests
 * simulate private browsing and blocked site data.
 *
 * Guarded on `window` so the Node-environment core tests are untouched.
 */
if (typeof window !== 'undefined' && !window.localStorage) {
  const backing = new Map<string, string>();

  const proto = (typeof Storage !== 'undefined' ? Storage.prototype : {}) as Storage;
  proto.getItem = (key: string) => (backing.has(key) ? (backing.get(key) as string) : null);
  proto.setItem = (key: string, value: string) => void backing.set(String(key), String(value));
  proto.removeItem = (key: string) => void backing.delete(String(key));
  proto.clear = () => backing.clear();
  proto.key = (index: number) => [...backing.keys()][index] ?? null;
  Object.defineProperty(proto, 'length', { get: () => backing.size, configurable: true });

  Object.defineProperty(window, 'localStorage', {
    value: Object.create(proto) as Storage,
    configurable: true,
  });
}
