// Node 22+ ships a global `localStorage`/`sessionStorage` that throws
// ("localStorage.getItem is not a function") unless the process was started
// with --localstorage-file, and this jsdom/vitest combination's own
// window.localStorage isn't usable here either (same symptom). Rather than
// depend on either, install a tiny in-memory Storage polyfill directly, on
// both globalThis and window, for jsdom-environment test files. Plain
// 'node' environment files have no `window` and are unaffected.
if (typeof window !== 'undefined') {
  class MemoryStorage implements Storage {
    private store = new Map<string, string>();
    getItem(key: string) {
      return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string) {
      this.store.set(key, String(value));
    }
    removeItem(key: string) {
      this.store.delete(key);
    }
    clear() {
      this.store.clear();
    }
    key(index: number) {
      return Array.from(this.store.keys())[index] ?? null;
    }
    get length() {
      return this.store.size;
    }
  }

  for (const target of [globalThis, window]) {
    Object.defineProperty(target, 'localStorage', {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(target, 'sessionStorage', {
      value: new MemoryStorage(),
      configurable: true,
      writable: true,
    });
  }
}
