// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { browserKeyValueStore } from '../src/platform/storage'

it('browser storage is usable, visible on window, and separates local from session data', () => {
  const kv = browserKeyValueStore(window)
  localStorage.clear()
  sessionStorage.clear()
  kv.set('runtime-check', 'local')
  sessionStorage.setItem('runtime-check', 'session')
  expect(window.localStorage.getItem('runtime-check')).toBe('local')
  expect(window.sessionStorage.getItem('runtime-check')).toBe('session')
  kv.remove('runtime-check')
  expect(kv.get('runtime-check')).toBeNull()
  expect(sessionStorage.getItem('runtime-check')).toBe('session')
})
