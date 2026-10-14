import { configureUx, createBrowserUx } from '../src/platform/ux'
// @vitest-environment happy-dom
// The sign-in question about entries logged while signed out: a count of one reads in the
// singular ("1 workout and 1 weigh-in"), per noun, in English and in the packs.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { _setLangState } from '@opengym/core/i18n-core'
import { addDeviceDataMessage, addDeviceSetupMessage } from '../src/sheets'
const de: any= {}
const ru: any= {}

afterEach(() : any => _setLangState('en', null, null, null))

describe('addDeviceDataMessage', () : any => {
  it('says "1 workout and 1 weigh-in", not "1 workouts and 1 weigh-ins"', () : any => {
    _setLangState('en', null, null, null)
    expect(addDeviceDataMessage(1, 1)).toMatch(/^1 workout and 1 weigh-in were logged/)
    expect(addDeviceDataMessage(1, 3)).toMatch(/^1 workout and 3 weigh-ins were logged/)
    expect(addDeviceDataMessage(4, 1)).toMatch(/^4 workouts and 1 weigh-in were logged/)
    expect(addDeviceDataMessage(2, 5)).toMatch(/^2 workouts and 5 weigh-ins were logged/)
    expect(addDeviceDataMessage(0, 2)).toMatch(/^0 workouts and 2 weigh-ins were logged/)
  })

  it('uses the singular sentences of the language packs', () : any => {
    _setLangState('de', de, null, null)
    expect(addDeviceDataMessage(1, 1)).toMatch(/^1 workout and 1 weigh-in were logged/)
    expect(addDeviceDataMessage(1, 2)).toMatch(/^1 workout and 2 weigh-ins were logged/)
    expect(addDeviceDataMessage(3, 1)).toMatch(/^3 workouts and 1 weigh-in were logged/)
    _setLangState('ru', ru, null, null)
    expect(addDeviceDataMessage(1, 1)).toMatch(/^1 workout and 1 weigh-in were logged/)
  })

  it('a plan made while signed out has words of its own', () : any => {
    _setLangState('en', null, null, null)
    expect(addDeviceSetupMessage(1)).toMatch(/^1 routine was made on this device/)
    expect(addDeviceSetupMessage(3)).toMatch(/^3 routines were made on this device/)
    expect(addDeviceSetupMessage(0)).toMatch(/^Your plan, notes or gym cards/)
    _setLangState('de', de, null, null)
    expect(addDeviceSetupMessage(2)).toMatch(/^2 routines were made on this device/)
  })
})

// Fixed synthetic date and injected DOM keep the twin independent of the host.
beforeEach(() : any => { configureUx(createBrowserUx()); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z')) })
afterEach(() : any => vi.useRealTimers())
