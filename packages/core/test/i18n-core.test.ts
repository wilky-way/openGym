import { beforeEach, describe, expect, it } from 'vitest'
import { LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, DATE_LOCALES, DERIVED_LOCALES,
  RTL_LANGS, baseLang, derivePack, dateLocale, getLang, getVersion, t, _setLangState,
  exerciseNameClass, exerciseNameFor, exerciseNameSearchText, CASED_NAME_LANGS } from '../src/i18n-core.js'
beforeEach(() => _setLangState('en', {}, null, null))
describe('baseLang', () => {
  it('leaves every other language as itself', () => {
    expect(baseLang('en')).toBe('en')
    expect(baseLang('nonsense')).toBe('nonsense')
  })
})
describe('derivePack', () => {
  it('returns the pack untouched for a language that is not derived', () => {
    const pack = { a: 'English steps' }
    expect(derivePack('en', pack)).toBe(pack)
  })
  it('passes a null pack through', () => { expect(derivePack('en', null)).toBe(null) })
})
describe('exerciseNameClass', () => {
  const bench = { id: '0025', n: 'barbell bench press' }
  const custom = { id: 'custom-1', n: 'my own press' }
  it('title-cases only while the English fallback is showing', () => {
    expect(exerciseNameClass(bench)).toBe('capitalize')
  })
  it('decides per exercise, so an untranslated one in a partial pack keeps its casing', () => {
    expect(exerciseNameClass(custom)).toBe('capitalize')
    expect(exerciseNameClass(undefined)).toBe('capitalize')
  })
})
it('offers English only, formats en-US, and ignores stale persisted language switches', () => {
  expect(LANGS).toEqual({ en: 'English' })
  expect(DATE_LOCALES).toEqual({ en: 'en-US' })
  expect(DERIVED_LOCALES).toEqual({})
  expect(RTL_LANGS.size).toBe(0)
  expect(INSTR_LANGS).toEqual(['en'])
  expect(EXERCISE_NAME_LANGS).toEqual([])
  expect(CASED_NAME_LANGS).toEqual([])
  const before = getVersion()
  const version = _setLangState('de', {Hello: 'unused'}, null, {'0025':'unused'}, false, true)
  expect(version).toBe(before + 1)
  expect(getLang()).toBe('en')
  expect(dateLocale()).toBe('en-US')
  expect(t('Hello')).toBe('Hello')
  expect(exerciseNameFor({id:'0025',n:'barbell bench press'})).toBe('barbell bench press')
  expect(exerciseNameSearchText({id:'0025',n:'barbell bench press'})).toBe('barbell bench press')
})
it('fills repeated placeholders and preserves missing ones exactly', () => {
  expect(t('{0} · {0} · {1}', 'A')).toBe('A · A · {1}')
  expect(t('{0}:{1}:{2}:{3}', 0, false, null, undefined)).toBe('0:false:null:undefined')
  expect(exerciseNameFor(null)).toBe('')
})
