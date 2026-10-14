import './sync-clock'
// @vitest-environment happy-dom

/* A sign-in whose adoption could not read the server (a 502, a dropped connection) holds sync. A
   sign-out in that state counted nothing as owed and wiped the guest's workouts and whatever was
   logged during the hold, with nothing stashed. (QA 2026-10-06, also in v1.3.9.) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync-api', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('../../src/store/useUI', () => ({ useUI: { getState: () => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }) } }))
vi.mock('./sync-prompts', () => ({ askAddDeviceData: async () => true }))

import { api } from './sync-api'
import { DEF as typed_DEF, useStore as typed_useStore } from './sync-store'
const DEF: any = typed_DEF
const useStore: any = typed_useStore

const clone: any = (v: any) => JSON.parse(JSON.stringify(v))
const w: any = (id: any, d: any = '2026-09-01') => ({ id, d, start: 1, end: 2, entries: [] })
const ids: any = (xs: any) => (xs || []).map((x: any) => x.id).sort()
const badGateway: any = () => Object.assign(new Error('HTTP 502'), { status: 502 })

beforeEach(() => { localStorage.clear(); api.mockReset(); useStore.setState({ S: { ...clone(DEF), _ts: 1 }, user: null, ready: true }) })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false }) })

describe('signing out while a sign-in is held', () => {
  it('asks first, keeps the guest\'s and the held copy\'s workouts, and adds them back on the next sign-in', async () => {
    useStore.getState().update((s: any) => { s.workouts = [w('g1'), w('g2', '2026-09-02')] })
    const U: any = { id: 'u1', name: 'Olga' }
    useStore.getState().setUser(U, { adopt: true })
    api.mockRejectedValueOnce(badGateway())
    await expect(useStore.getState().adoptProfile(async () => true)).rejects.toThrow()
    useStore.getState().update((s: any) => { s.workouts.push(w('h1', '2026-09-03')) })   // trains during the hold

    expect(useStore.getState().unsyncedChanges().owed).toBe(true)
    api.mockResolvedValue({ ok: true })
    const asked: any = await useStore.getState().signOut()
    expect(asked.owed).toBe(true)
    expect(ids(useStore.getState().S.workouts)).toEqual(['g1', 'g2', 'h1'])   // nothing wiped yet
    const forced: any = await useStore.getState().signOut({ force: true })
    expect(forced.stashed).toBe(true)
    const stash: any = (Object.values(JSON.parse(localStorage.getItem('gym_stash') || 'null'))[0] as any)
    expect(ids(stash.state.workouts)).toEqual(['g1', 'g2', 'h1'])

    // back as the same account: the server's profile, with the kept workouts added to it
    const server: any = { ...clone(DEF), _ts: 50, restSec: 70, workouts: [w('w1', '2026-08-01')], _rev: 3 }
    api.mockReset()
    api.mockImplementation(async (p: any, o: any) => (o?.method === 'PUT' ? { ok: true, rev: 4 } : { state: clone(server), rev: 3 }))
    useStore.getState().setUser(U, { adopt: true })
    await useStore.getState().adoptProfile(async () => false)
    const S: any = useStore.getState().S
    expect(ids(S.workouts)).toEqual(['g1', 'g2', 'h1', 'w1'])
    expect(S.restSec).toBe(70)   // the account's settings
  })
})
