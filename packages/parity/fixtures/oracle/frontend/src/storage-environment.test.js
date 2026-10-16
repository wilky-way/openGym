// @vitest-environment happy-dom
import { expect, it } from 'vitest'

it('browser storage is usable, visible on window, and separates local from session data', () => {
  localStorage.clear()
  sessionStorage.clear()
  localStorage.setItem('runtime-check', 'local')
  sessionStorage.setItem('runtime-check', 'session')
  expect(window.localStorage.getItem('runtime-check')).toBe('local')
  expect(window.sessionStorage.getItem('runtime-check')).toBe('session')
  localStorage.removeItem('runtime-check')
  expect(localStorage.getItem('runtime-check')).toBeNull()
  expect(sessionStorage.getItem('runtime-check')).toBe('session')
})
