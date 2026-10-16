import { Storage } from 'happy-dom'

// Node 25+ supplies its own localStorage. Vitest preserves existing globals
// unless they are on its DOM override list, so happy-dom tests can inherit an
// undefined (or disk-backed) Node store. Give each DOM test file browser storage.
if (typeof document !== 'undefined') {
  for (const key of ['localStorage', 'sessionStorage']) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: new Storage()
    })
  }
}
