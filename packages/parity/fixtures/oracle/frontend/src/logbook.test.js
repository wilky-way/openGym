import { describe, expect, it } from 'vitest'
import { contrastRows } from '../scripts/check-logbook-contrast.mjs'
import { applyAccent } from './lib/accent.js'

describe('the Logbook palette remains readable', () => {
  it('measures AA text contrast on the page, every surface, current rows, and tinted fills', () => {
    for (const row of contrastRows()) for (const mode of ['light', 'dark']) {
      expect(row[mode], `${mode}: ${row.pair}`).toBeGreaterThanOrEqual(row.need)
    }
  })
  it.each(['lime', '#ffff00'])('prevents a saved %s accent overriding Logbook', value => {
    const props = new Map([['--acc', '#ffff00'], ['--on-acc', '#ffffff']])
    const el = { dataset: { skin: 'logbook', accent: 'custom' }, style: { removeProperty: k => props.delete(k) } }
    applyAccent(el, value, 'light')
    expect(el.dataset.accent).toBeUndefined()
    expect(props.size).toBe(0)
  })
})
