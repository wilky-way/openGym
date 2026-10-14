import { describe, it, expect, afterEach } from 'vitest'
import { t, tn, _setLangState } from '../src/i18n-core.js'
describe('tn() — plural forms from the pack', () => {
  afterEach(() => _setLangState('en', {}, null, null))
  it('falls back to the English two-form split with no pack', () => {
    _setLangState('en', {}, null, null)
    expect(tn('{0} exercise', '{0} exercises', 1)).toBe('1 exercise')
    expect(tn('{0} exercise', '{0} exercises', 2)).toBe('2 exercises')
    expect(tn('{0} exercise', '{0} exercises', 0)).toBe('0 exercises')
  })
  it('fills every placeholder, not just the count', () => {
    expect(tn('{0} set · {1} work', '{0} sets · {1} work', 2, 3)).toBe('2 sets · 3 work')
    expect(tn('{0} set · {1} work', '{0} sets · {1} work', 1, 0)).toBe('1 set · 0 work')
  })
  it('does not crash when a plural key is read through plain t()', () => {
    expect(t('{0} exercises', 5)).toBe('5 exercises')
    expect(t('{0} exercises', 2)).toBe('2 exercises')
  })
})
