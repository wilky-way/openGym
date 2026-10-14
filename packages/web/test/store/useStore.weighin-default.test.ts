// @vitest-environment happy-dom
// v1.3.11: "Weigh in before workouts" starts off for a profile created from nothing. A profile
// that already exists keeps what it had: one saved with the switch on stays on, and one saved
// before the setting existed (no key) still reads as on through DEF and `!== false`.
import { describe, expect, it } from 'vitest'


import { freshState, DEF, restoredStateFor, restartedState, useStore } from '../../src/store/useStore'

describe('weigh-in default', () => {
  it('a fresh profile starts with the weigh-in off', () => {
    expect(freshState().weighIn).toBe(false)
  })

  it('DEF keeps it on, so an existing profile without the key is not changed under it', () => {
    expect(DEF.weighIn).toBe(true)
    const old = { workouts: [{ id: 'w1' }], routines: [] }         // written before the setting existed
    const S = restoredStateFor({ workouts: [], routines: [], bodyweight: [], customEx: [] }, old)
    expect(S!.weighIn).toBe(true)
    const off = restoredStateFor({ workouts: [], routines: [], bodyweight: [], customEx: [] }, { ...old, weighIn: false })
    expect(off!.weighIn).toBe(false)
  })
})

describe('exercise animations default', () => {
  it('a fresh profile starts with Small animations, the thumbnail on the workout screen', () => {
    expect(freshState().gifSize).toBe('mini')
  })

  it('DEF keeps Full, so an existing profile without the key is not changed under it', () => {
    expect(DEF.gifSize).toBe('full')
    const S = restoredStateFor({ workouts: [], routines: [], bodyweight: [], customEx: [] }, { workouts: [{ id: 'w1' }], routines: [] })
    expect(S!.gifSize).toBe('full')
  })
})

// A reset, or another account signing in on this device, starts a new profile: the same new
// defaults as a first run, in the language already on screen, and the reset keeps its stamps.
describe('starting over', () => {
  it('restartedState keeps a language nobody picked yet marked as such', () => {
    expect(restartedState({ lang: 'ar', langAuto: true })).toMatchObject({ lang: 'ar', langAuto: true, weighIn: false, gifSize: 'mini' })
  })

})
