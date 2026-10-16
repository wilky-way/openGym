import './sync-clock'
// @vitest-environment happy-dom

/* QA, v1.3.9 (t9): Settings → kg to lb → "Convert the numbers" on one device while another,
   still in kg, logs a weigh-in. The conversion was not pushed, and the merge knew nothing of
   units: the server ended in kg with the numbers back in kg — and the kept loads still in lb under
   the kg label (55 kg became 121.5 kg). Now the conversion goes to the server at once, and a merge
   brings a copy in the other unit over before anything is compared (lib/sync-merge.js). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync-api', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('../../src/store/useUI', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from './sync-api'
import { DEF as typed_DEF, useStore as typed_useStore } from './sync-store'
const DEF: any = typed_DEF
const useStore: any = typed_useStore
import { convertBodyWeight as typed_convertBodyWeight, convertStateUnit as typed_convertStateUnit, convertWeight as typed_convertWeight } from '@opengym/core/units'
const convertBodyWeight: any = typed_convertBodyWeight
const convertStateUnit: any = typed_convertStateUnit
const convertWeight: any = typed_convertWeight

const clone: any = (v: any) => JSON.parse(JSON.stringify(v))
const TODAY: any = '2026-09-27'
const workout: any = (id: any, w: any) => ({ id, d: '2026-09-20', start: 1, end: 2, entries: [{ id: '0025', sets: [{ w, r: 5, done: true }] }] })
const puts: any = () => api.mock.calls.filter(([, o]: any) => o?.method === 'PUT').map(([, o]: any) => JSON.parse(o.body))
const conflict: any = (state: any, rev: any) => Object.assign(new Error('conflict'), { status: 409, data: { state, rev } })
const signedIn: any = (S: any, rev: any) => {
  localStorage.setItem('gym_sync', JSON.stringify({ rev, ts: S._ts }))
  useStore.setState({ S, user: { id: 'u1' }, ready: true, sync: { offline: false, pending: false, lastSynced: 0 } })
}
// The profile both devices started from: rev 1, in kg.
const KG: any = { ...clone(DEF), _ts: 100, unit: 'kg', workouts: [workout('w1', 60)], bodyweight: [{ d: '2026-09-20', w: 80, t: 50 }], exWeights: { '0025': { w: 55, d: '2026-09-20' } } }

beforeEach(() => { localStorage.clear(); api.mockReset() })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('converting the unit while another device logs in the old one', () => {
  it('the converting device pushes at once, and a kg copy that landed first is converted before the merge', async () => {
    signedIn(clone(KG), 1)
    // the other device's weigh-in, in kg, reached the server first (rev 2)
    const serverKg: any = { ...clone(KG), _ts: 300, bodyweight: [...KG.bodyweight, { d: TODAY, w: 81, t: 300 }], _rev: 2 }
    api.mockRejectedValueOnce(conflict(serverKg, 2))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().setUnit('lb')

    const [first, second] = puts()
    expect(first.baseRev).toBe(1)          // an ordinary conditional push, straight away
    expect(first.state.unit).toBe('lb')
    expect(second.baseRev).toBe(2)
    const S: any = second.state
    expect(S.unit).toBe('lb')
    expect(S.bodyweight.find((b: any) => b.d === TODAY).w).toBe(convertBodyWeight(81, 'kg', 'lb'))
    expect(S.bodyweight.find((b: any) => b.d === '2026-09-20').w).toBe(convertBodyWeight(80, 'kg', 'lb'))
    expect(S.workouts[0].entries[0].sets[0].w).toBe(convertWeight(60, 'kg', 'lb'))
    expect(S.exWeights['0025'].w).toBe(convertWeight(55, 'kg', 'lb'))
    expect(useStore.getState().S.unit).toBe('lb')
  })

  it('the device still in kg merges the converted profile into lb, its own weigh-in converted with it', async () => {
    signedIn(clone(KG), 1)
    // the other device converted and pushed (rev 2); this one logs a weigh-in in kg on rev 1
    const serverLb: any = { ...convertStateUnit(clone(KG), 'lb'), _ts: 200, unitSet: { at: 200, convert: true }, _rev: 2 }
    useStore.getState().update((s: any) => { s.bodyweight.push({ d: TODAY, w: 81, t: Date.now() }) })
    api.mockRejectedValueOnce(conflict(serverLb, 2))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })
    await useStore.getState().pushState()

    const S: any = puts().at(-1).state
    expect(puts().at(-1).baseRev).toBe(2)
    expect(S.unit).toBe('lb')                                                // the later choice holds
    expect(S.bodyweight.find((b: any) => b.d === TODAY).w).toBe(convertBodyWeight(81, 'kg', 'lb'))
    expect(S.workouts[0].entries[0].sets[0].w).toBe(convertWeight(60, 'kg', 'lb'))
    // never the lb number under a kg label, nor the kg number under an lb one
    expect(S.exWeights['0025'].w).toBe(convertWeight(55, 'kg', 'lb'))
    expect(useStore.getState().S.unit).toBe('lb')
  })

  it('a running workout on the device still in kg comes over in lb with the merge', async () => {
    const active: any = { id: 'run', d: TODAY, start: 5, entries: [{ id: '0025', sets: [{ w: 100, r: 5 }] }] }
    signedIn({ ...clone(KG), active }, 1)
    const serverLb: any = { ...convertStateUnit(clone(KG), 'lb'), _ts: 200, unitSet: { at: 200, convert: true }, _rev: 2 }
    useStore.getState().update((s: any) => { s.restSec = 75 })
    api.mockRejectedValueOnce(conflict(serverLb, 2))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })
    await useStore.getState().pushState()
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(convertWeight(100, 'kg', 'lb'))
  })

  it('"Keep the numbers, change the label" relabels the other copy instead of converting it', async () => {
    signedIn(clone(KG), 1)
    const serverLb: any = { ...clone(KG), unit: 'lb', _ts: 200, unitSet: { at: 200, convert: false }, _rev: 2 }
    useStore.getState().update((s: any) => { s.bodyweight.push({ d: TODAY, w: 180, t: Date.now() }) })
    api.mockRejectedValueOnce(conflict(serverLb, 2))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })
    await useStore.getState().pushState()
    const S: any = puts().at(-1).state
    expect(S.unit).toBe('lb')
    expect(S.bodyweight.find((b: any) => b.d === TODAY).w).toBe(180)
    expect(S.exWeights['0025'].w).toBe(55)
  })

  // Review of 771184c9: the history was relabelled, but the running session was converted.
  it('a label-only switch elsewhere relabels the running session too, on a pull and on a merge', async () => {
    const active: any = { id: 'run', d: TODAY, start: 5, entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }] }] }
    const serverLb: any = { ...clone(KG), unit: 'lb', _ts: 200, unitSet: { at: 150, convert: false }, _rev: 2 }
    // a pull with nothing changed here: the server's copy is adopted
    signedIn({ ...clone(KG), active }, 1)
    api.mockResolvedValueOnce({ state: clone(serverLb), rev: 2 })
    await useStore.getState().pullState()
    expect(useStore.getState().S.unit).toBe('lb')
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(100)
    // a merge with a change of this device's own
    signedIn({ ...clone(KG), active }, 1)
    useStore.getState().update((s: any) => { s.restSec = 75 })
    api.mockRejectedValueOnce(conflict(clone(serverLb), 2))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })
    await useStore.getState().pushState()
    expect(useStore.getState().S.unit).toBe('lb')
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(100)
  })
})
