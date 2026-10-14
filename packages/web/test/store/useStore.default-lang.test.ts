import { describe, expect, it } from 'vitest'
import { freshState, DEF } from '../../src/store/useStore'

describe('instance default language', () => {
  it('a fresh copy is marked as not having picked a language; DEF is not', () => {
    expect(freshState().langAuto).toBe(true)
    expect(DEF.langAuto).toBeUndefined()
  })
})
