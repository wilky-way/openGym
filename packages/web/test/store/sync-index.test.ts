// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeStore, useStore, DEF } from '../../src/store/useStore'
import { initializeSyncEngine } from '../../src/store/sync-engine'
import { createBrowserPlatform } from '../../src/platform/browser'
import { editCompletedSession } from '@opengym/core/session-edit'
import { EXIDX } from '@opengym/core/exercises'
const assisted = { id: 'synthetic-assisted-sync', n: 'Synthetic assistance', eq: 'assisted', assisted: true, custom: true }
const cardio = { id: 'synthetic-cardio-sync', n: 'Single arm press', eq: 'dumbbell', custom: true }
const entry = (w: number) => ({ id: assisted.id, target: { mode: 'reps' }, sets: [{ w, r: 8, done: true }] })
const record = (id: string, d: string, w: number) => ({ id, d, start: 1, end: 2, entries: [entry(w)] })
let dispose: () => void
let api: any
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); localStorage.clear()
  const platform = createBrowserPlatform(); initializeStore(platform)
  api = vi.fn().mockResolvedValue({ ok: true, rev: 2 })
  dispose = initializeSyncEngine({ platform, api, prompts: { askAddDeviceData: async () => false, toast() {} } })
})
afterEach(() => { dispose(); vi.useRealTimers() })
describe('each sync caller passes a real owned index', () => {
  it('persistence creates the index from the saved custom exercises', () => {
    useStore.getState().update(s => { s.customEx = [assisted] }, false)
    expect(useStore.getState().index[assisted.id]).toEqual(assisted)
    expect(EXIDX[assisted.id]).toBeUndefined()
  })
  it('sync hydration creates its index from the KV document', () => {
    localStorage.setItem('gym_state_v1', JSON.stringify({ ...structuredClone(DEF), customEx: [assisted] }))
    initializeSyncEngine({ platform: createBrowserPlatform(), api, prompts: { askAddDeviceData: async () => false, toast() {} } })
    expect(useStore.getState().index[assisted.id]).toEqual(assisted)
  })
  it('owner handover creates its index from the adopted saved copy', () => {
    const saved = { ...structuredClone(DEF), customEx: [assisted] }
    localStorage.setItem('gym_owner', 'next-user'); localStorage.setItem('gym_state_owner', 'next-user')
    localStorage.setItem('gym_state_v1', JSON.stringify(saved)); localStorage.setItem('gym_state_wid', 'next-write')
    window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, key: 'gym_owner', newValue: 'next-user' }))
    expect(useStore.getState().index[assisted.id]).toEqual(assisted)
  })
  it('same-owner saved-copy adoption creates its index from the joined document', () => {
    const saved = { ...structuredClone(DEF), _ts: 200, customEx: [assisted] }
    localStorage.setItem('gym_state_v1', JSON.stringify(saved)); localStorage.setItem('gym_state_wid', 'next-write')
    window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, key: 'gym_state_wid', newValue: 'next-write' }))
    expect(useStore.getState().index[assisted.id]).toEqual(assisted)
  })
  it('setUnit recomputes custom-bell cached volume with its real index', () => {
    useStore.setState({ S: { ...structuredClone(DEF), customEx: [cardio], workouts: [{ id: 'w', vol: 999, entries: [{ id: cardio.id, target: { dbLoad: 'each' }, sets: [{ w: 10, r: 8, done: true }] }] }] } })
    useStore.getState().setUnit('lb')
    expect(useStore.getState().S.workouts[0].entries[0].sets[0].w).toBe(22)
    expect(useStore.getState().S.workouts[0].vol).toBe(176)
  })
  it('carryActive recomputes custom-bell volume when adopting another unit', async () => {
    const S = { ...structuredClone(DEF), _ts: 100, customEx: [cardio], active: { id: 'a', vol: 999, entries: [{ id: cardio.id, target: { dbLoad: 'each' }, sets: [{ w: 10, r: 8, done: true }] }] } }
    useStore.setState({ S, user: { id: 'synthetic-user' }, ready: true })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ state: { ...structuredClone(DEF), _ts: 200, unit: 'lb', unitSet: { at: 200, convert: true }, customEx: [cardio] }, rev: 2 })
    await useStore.getState().pullState()
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(22)
    expect(useStore.getState().S.active.vol).toBe(176)
  })
  it('mergeDocs recomputes custom-bell volume while merging a 409 into another unit', async () => {
    const S = { ...structuredClone(DEF), _ts: 100, customEx: [cardio], workouts: [{ id: 'w', vol: 999, entries: [{ id: cardio.id, target: { dbLoad: 'each' }, sets: [{ w: 10, r: 8, done: true }] }] }] }
    useStore.setState({ S, user: { id: 'synthetic-user' }, ready: true })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409, data: { state: { ...structuredClone(DEF), _ts: 200, unit: 'lb', unitSet: { at: 200, convert: true }, customEx: [cardio] }, rev: 2 } }))
    await useStore.getState().pushState()
    expect(useStore.getState().S.workouts[0].entries[0].sets[0].w).toBe(22)
    expect(useStore.getState().S.workouts[0].vol).toBe(176)
  })
  function editing() {
    const S: any = { ...structuredClone(DEF), customEx: [assisted], workouts: [record('prior', '2026-01-01', 40), record('edit', '2026-01-02', 20), record('later', '2026-01-03', 25)], exWeights: { [assisted.id]: { w: 20, d: '2026-01-02' } } }
    editCompletedSession(S as any, 'edit'); return S
  }
  it('saveHistoryEdit recomputes kept weights using the custom-assisted index', () => {
    const S = editing(); S.active.entries[0].sets[0].w = 30; useStore.setState({ S })
    useStore.getState().saveHistoryEdit()
    expect(useStore.getState().S.exWeights[assisted.id]).toEqual({ w: 25, d: '2026-01-03' })
  })
  it('deleteHistoryEdit recomputes kept weights using the custom-assisted index', () => {
    useStore.setState({ S: editing() }); useStore.getState().deleteHistoryEdit()
    expect(useStore.getState().S.exWeights[assisted.id]).toEqual({ w: 25, d: '2026-01-03' })
  })
})
