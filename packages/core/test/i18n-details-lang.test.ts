import { describe, expect, it, vi } from 'vitest'
describe('a language switch while the details load', () => {
  it('keeps the descriptions of one language from landing under another', async () => {
    vi.resetModules()
    const core = await import('../src/i18n-core.js')
    const ex = { id: '9999', st: [] }
    core._setLangState('de', {}, null, null, true, false)
    expect(core._setDetails({9999:['Lift.']}, {9999:'A lift.'}, {9999:'unused'}, 'de')).toBe(false)
    expect(core.descFor(ex)).toBe('A lift.')
    core._setLangState('fr', {}, null, null, true, false)
    expect(core._setDetails(null, null, {9999:'unused'}, 'fr')).toBe(false)
    expect(core.descFor(ex)).toBe('A lift.')
    expect(core.instrFor(ex)).toEqual(['Lift.'])
    expect(core._setDetails(null, null, null, 'en')).toBe(true)
  })
})
