// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserPlatform } from '../../src/platform/browser'
import { browserObjectStore } from '../../src/platform/storage'
import { IDBFactory } from 'fake-indexeddb'
import { initializeStore, useStore, clone, DEF } from '../../src/store/useStore'
import { initializeSyncEngine } from '../../src/store/sync-engine'
import {guardedStoreUpdate} from '../../src/lib/guarded-update'
import { initializePublicActions } from '../../src/store/public-actions'
import { mergeStates } from '@opengym/core/sync-merge'
import type { ProgrammeDefinition } from '@opengym/core/programme-engine-types'
import type { PublicActionServices } from '../../src/store/public-actions'
const custom = { id: 'synthetic-custom-library', n: 'Synthetic custom press', eq: 'dumbbell', custom: true }
const definition = (id = 'synthetic-library'): ProgrammeDefinition => ({ id, name: 'Synthetic', unit: 'kg', weeks: [{ index: 1, days: [{ key: 'd1', sessions: [{ routineSnapshot: { name: 'Synthetic day', ex: [{ id: custom.id, sets: 3, reps: 8, weight: 100 }] } }] }] }] })
const entry = () => ({ definition: definition(), n: 1, versionId: 'sha256:synthetic-v1', level: 'Valid' })
const options = { cycleId: 'synthetic-cycle', today: '2026-10-13', now: 300 }
let platform: ReturnType<typeof createBrowserPlatform>, dispose: () => void, services: PublicActionServices
beforeEach(() => {
  localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
  platform = createBrowserPlatform(); platform.objects = browserObjectStore(new IDBFactory())
  platform.transport = { fetch: vi.fn(async () => new Response(JSON.stringify(entry()))) }
  initializeStore(platform)
  dispose = initializeSyncEngine({ platform, api: vi.fn().mockResolvedValue({ rev: 1 }), prompts: { askAddDeviceData: async () => false, toast() {} } })
  useStore.setState({ S: { ...clone(DEF), customEx: [custom] }, user: { id: 'synthetic-user' } })
  services = { platform, toast: vi.fn() }; initializePublicActions(services)
})
afterEach(() => { dispose(); vi.useRealTimers() })
describe('W08 actions compose with the existing public store', () => {
  it.each([undefined, {}])('does not add a TM seed to a rule-free activation with tm=%j', async tm => {
    const resolver = vi.fn(() => ({ press: 120 }))
    initializePublicActions({ ...services, materializeTmSeed: resolver })
    const cycle = await useStore.getState().activateLibraryProgramme('synthetic-library', { ...options, tm })
    expect(Object.hasOwn(cycle, 'tmSeed')).toBe(false)
    expect(Object.hasOwn(JSON.parse(platform.kv.get('gym_state_v1')!).programmes.cycles[0], 'tmSeed')).toBe(false)
    expect(resolver).not.toHaveBeenCalled()
  })
  it.each(['fixed', 'history'])('retains %s TM seeds when the preview passes an empty TM map', kind => {
    const d = { ...definition(), tmSeeds: { press: kind === 'fixed' ? { value: 100, unit: 'kg' as const } : { fromE1rm: { pct: .9 } } } }
    const resolver = vi.fn(() => ({ press: 120 }))
    if (kind === 'history') initializePublicActions({ ...services, materializeTmSeed: resolver })
    const cycle = useStore.getState().startProgramme(d, { ...options, tm: {} })
    expect(cycle.tmSeed).toEqual({ press: kind === 'fixed' ? 100 : 120 })
    expect(cycle.tm).toEqual(cycle.tmSeed)
    expect(resolver).toHaveBeenCalledTimes(kind === 'history' ? 1 : 0)
  })
  it('retains legacy action identities and installs programme actions without a second engine', () => {
    const before = useStore.getState()
    initializePublicActions(services)
    expect(useStore.getState().update).toBe(before.update)
    expect(useStore.getState().signOut).toBe(before.signOut)
    expect(useStore.getState().saveHistoryEdit).toBe(before.saveHistoryEdit)
  })
  it('installs the exact fetched body, marker and cycle in one stamped persisted update', async () => {
    useStore.setState({ready: true})
    vi.useFakeTimers({toFake: ['Date', 'setTimeout', 'clearTimeout']})
    const pushed = vi.spyOn(useStore.getState(), 'pushState').mockResolvedValue(undefined)
    useStore.getState().S.programmes.offloaded = { 'synthetic-library': { versionId: 'sha256:old', at: 100 } }
    const update = vi.spyOn(useStore.getState(), 'update')
    const cycle = await useStore.getState().activateLibraryProgramme('synthetic-library', options)
    const S = useStore.getState().S, saved = JSON.parse(platform.kv.get('gym_state_v1')!)
    expect(update).toHaveBeenCalledTimes(1)
    expect(cycle.id).toBe(options.cycleId)
    expect(S.programmes.definitions[0]).toMatchObject(entry().definition)
    expect(S.programmes.installed['synthetic-library']).toMatchObject({ versionId: entry().versionId })
    expect(S.programmes.installed['synthetic-library'].at).toBeGreaterThan(S.programmes.offloaded['synthetic-library'].at)
    expect(saved).toEqual(S)
    await vi.advanceTimersByTimeAsync(1500)
    expect(pushed).toHaveBeenCalledOnce() // omitted push retains the real updater's default cloud sync
    pushed.mockClear()
    guardedStoreUpdate(() => true, draft => { draft.checkIn = false }, {push: false})
    await vi.advanceTimersByTimeAsync(1500)
    expect(pushed).not.toHaveBeenCalled()
    expect(JSON.parse(platform.kv.get('gym_state_v1')!).checkIn).toBe(false)
    const replay: any = mergeStates(S, { ...clone(DEF), programmes: { ...clone(DEF.programmes), offloaded: S.programmes.offloaded } })
    expect(replay.programmes.definitions).toHaveLength(1)
    expect(S.routines[0].ex[0].id).toBe(custom.id)
  })
  it('activates a persisted cached body offline and toasts an uncached refusal without writes', async () => {
    await useStore.getState().getLibraryProgramme('synthetic-library')
    platform.transport.fetch = vi.fn().mockRejectedValue(new TypeError('offline'))
    await useStore.getState().activateLibraryProgramme('synthetic-library', options)
    const before = JSON.stringify(useStore.getState().S), saved = platform.kv.get('gym_state_v1')
    await expect(useStore.getState().activateLibraryProgramme('synthetic-missing', options)).rejects.toMatchObject({ code: 'offline-uncached' })
    expect(JSON.stringify(useStore.getState().S)).toBe(before)
    expect(platform.kv.get('gym_state_v1')).toBe(saved)
    expect(services.toast).toHaveBeenCalledWith(expect.stringContaining('not saved on this device'))
  })
  it('does not install anything on invalid activation or with an open workout', async () => {
    useStore.getState().S.active = { id: 'open', entries: [] }
    const before = clone(useStore.getState().S)
    await expect(useStore.getState().activateLibraryProgramme('synthetic-library', options)).rejects.toThrow('Finish the current workout')
    expect(useStore.getState().S).toEqual(before)
    expect(platform.kv.get('gym_state_v1')).toBeNull()
    useStore.getState().S.active = null
    expect(() => useStore.getState().startProgramme({ ...definition(), weeks: [] }, options)).toThrow()
    expect(useStore.getState().S.programmes.cycles).toEqual([])
  })
  it('rechecks account ownership and the current workout after fetching', async () => {
    let resolve!: (response: Response) => void
    platform.transport.fetch = vi.fn(() => new Promise<Response>(r => { resolve = r }))
    const pending = useStore.getState().activateLibraryProgramme('synthetic-library', options)
    await vi.waitFor(() => expect(platform.transport.fetch).toHaveBeenCalled())
    useStore.setState({ user: { id: 'changed-account' } }); resolve(new Response(JSON.stringify(entry())))
    await expect(pending).rejects.toMatchObject({ code: 'scope-changed' })
    expect(useStore.getState().S.programmes.cycles).toEqual([])
  })
  it('refuses if a workout opens while a library body is in flight', async () => {
    let resolve!: (response: Response) => void
    platform.transport.fetch = vi.fn(() => new Promise<Response>(r => { resolve = r }))
    const pending = useStore.getState().activateLibraryProgramme('synthetic-library', options)
    await vi.waitFor(() => expect(platform.transport.fetch).toHaveBeenCalled())
    useStore.getState().S.active = { id: 'new-open', entries: [] }
    resolve(new Response(JSON.stringify(entry())))
    await expect(pending).rejects.toThrow('Finish the current workout')
    expect(useStore.getState().S.active.id).toBe('new-open')
    expect(useStore.getState().S.programmes.definitions).toEqual([])
  })
  it('refuses an exhausted manifest clock without committing an activation', async () => {
    useStore.getState().S.programmes.installed = { 'synthetic-library': { versionId: 'sha256:old', at: Number.MAX_SAFE_INTEGER } }
    const before = clone(useStore.getState().S)
    await expect(useStore.getState().activateLibraryProgramme('synthetic-library', options)).rejects.toThrow('clock is exhausted')
    expect(useStore.getState().S).toEqual(before)
    expect(platform.kv.get('gym_state_v1')).toBeNull()
  })
  it('does not commit a throwing or invalid seed resolver', () => {
    const d = { ...definition(), tmSeeds: { press: { fromE1rm: { pct: .9 } } } }
    const before = clone(useStore.getState().S)
    initializePublicActions({ ...services, materializeTmSeed() { throw new Error('seed failure') } })
    expect(() => useStore.getState().startProgramme(d, options)).toThrow('seed failure')
    initializePublicActions({ ...services, materializeTmSeed: () => ({ press: Infinity }) })
    expect(() => useStore.getState().startProgramme(d, options)).toThrow('positive finite')
    expect(useStore.getState().S).toEqual(before)
  })
  it('starts, pauses, resumes, switches and ends while preserving logs', () => {
    useStore.getState().S.workouts = [{ id: 'prior', d: '2026-10-12', entries: [] }]
    const logs = clone(useStore.getState().S.workouts)
    useStore.getState().startProgramme(definition(), options)
    expect(useStore.getState().pauseProgramme(options.cycleId, options)).toBe(true)
    expect(useStore.getState().S.programmes.cycles[0].status).toBe('paused')
    expect(useStore.getState().resumeProgramme(options.cycleId, options)).toBe(true)
    expect(useStore.getState().S.programmes.cycles[0].status).toBe('active')
    useStore.getState().switchProgramme(options.cycleId, definition('synthetic-next'), { ...options, cycleId: 'next' })
    expect(useStore.getState().S.programmes.cycles.map((c: any) => c.status)).toEqual(['archived', 'active'])
    expect(useStore.getState().endProgramme('next', options).status).toBe('archived')
    expect(useStore.getState().S.workouts).toEqual(logs)
  })
  it('freezes athlete and explicit seeds and never recomputes them on resume', () => {
    const d = { ...definition(), tmSeeds: { press: { value: 100, unit: 'kg' } } }
    const cycle = useStore.getState().startProgramme(d, { ...options, tm: { press: 110 } })
    expect(cycle.tmSeed).toEqual({ press: 110 }); expect(cycle.tm).toEqual(cycle.tmSeed)
    useStore.getState().pauseProgramme(options.cycleId, options)
    useStore.getState().S.workouts.push({ id: 'later', d: '2026-10-14', entries: [] })
    useStore.getState().resumeProgramme(options.cycleId, options)
    expect(useStore.getState().S.programmes.cycles[0].tmSeed).toEqual({ press: 110 })
  })
  it('fails closed for from-e1rm without P5 and freezes the injected result before K12 activation', () => {
    const d = { ...definition(), tmSeeds: { press: { fromE1rm: { pct: .9 } } } }
    const before = clone(useStore.getState().S)
    expect(() => useStore.getState().startProgramme(d, options)).toThrow('training max history')
    expect(useStore.getState().S).toEqual(before)
    const materializeTmSeed = vi.fn(({ state, index }: any) => {
      expect(state.programmes.cycles).toEqual([])
      expect(index[custom.id]).toEqual(custom)
      state.workouts.push({ id: 'hook-mutated-copy' })
      return { press: index[custom.id].eq === 'dumbbell' ? 120 : 100 }
    })
    initializePublicActions({ ...services, materializeTmSeed })
    const cycle = useStore.getState().startProgramme(d, options)
    expect(cycle.tmSeed).toEqual({ press: 120 })
    expect(useStore.getState().S.workouts).toEqual([])
    expect(materializeTmSeed).toHaveBeenCalledTimes(1)
  })
  it('permits inspection of an Invalid library entry while refusing its activation', async () => {
    platform.transport.fetch = vi.fn(async () => new Response(JSON.stringify({ ...entry(), level: 'Invalid' })))
    expect((await useStore.getState().getLibraryProgramme('synthetic-library')).level).toBe('Invalid')
    await expect(useStore.getState().activateLibraryProgramme('synthetic-library', options)).rejects.toMatchObject({ code: 'invalid-programme' })
    expect(useStore.getState().S.programmes.cycles).toEqual([])
  })
  it('keeps the previous durable document when activation cannot persist', () => {
    useStore.getState().update(() => {}, false)
    const prior = JSON.stringify(useStore.getState().S)
    const original = platform.kv.set.bind(platform.kv)
    platform.kv.set = (key, value) => { if (key === 'gym_state_v1') throw new Error('quota'); original(key, value) }
    useStore.getState().startProgramme(definition(), options)
    expect(platform.kv.get('gym_state_v1')).toBe(prior)
    expect(useStore.getState().S.programmes.cycles).toHaveLength(1)
    expect(platform.kv.get('gym_dirty')).toBe('1')
  })
})
