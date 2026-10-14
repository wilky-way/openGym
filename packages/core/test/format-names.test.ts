import { afterEach, describe, expect, it } from 'vitest'
import { exerciseNameText } from '../src/format.js'
import { _setLangState } from '../src/i18n-core.js'

// A toast, a dialog title, the timed-set label and the Stats picker show an exercise name as
// plain text, with no element to carry the CSS title-casing. They have to come out cased the way
// the same name reads in the list next to them.
describe('exerciseNameText', () => {
  const bench = { id: '0025', n: 'barbell bench press' }
  const custom = { id: 'custom-1', n: 'my own press' }
  afterEach(() => _setLangState('en', {}, null, null))

  it('title-cases an English name and a custom one', () => {
    expect(exerciseNameText(bench)).toBe('Barbell Bench Press')
    expect(exerciseNameText(custom)).toBe('My Own Press')
  })




})

// QA 1.3.9: the accent swatches' screen-reader names were the internal keys ("lime", "sky").
describe('ACCENT_NAMES', () => {
  it('names every accent in English', async () => {
    const { ACCENTS, ACCENT_NAMES } = await import('../src/format.js')
    expect(Object.keys(ACCENT_NAMES).sort()).toEqual(Object.keys(ACCENTS).sort())
    for (const name of Object.values(ACCENT_NAMES)) expect(name).toBeTruthy()
  })
})
