import './sync-clock'
// @vitest-environment happy-dom

/* Structural Balance's per-role exercise choices (S.balanceOverrides) through the store's own
   sync paths. Each choice carries the time it was made, and "Use default exercise" is a stamped
   clear rather than a delete, so a conflict keeps whichever device chose last — a clear included —
   instead of handing the whole map to the copy that happened to be newer. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync-api', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('../../src/store/useUI', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from './sync-api'
import { DEF as typed_DEF, useStore as typed_useStore } from './sync-store'
const DEF: any = typed_DEF
const useStore: any = typed_useStore
import { withOverride as typed_withOverride } from '@opengym/core/structuralBalance'
const withOverride: any = typed_withOverride

const DIPS: any = 'poliquin:dips'
const PULLUPS: any = 'atg:pullups'
const clone: any = (value: any) => JSON.parse(JSON.stringify(value))
const httpError: any = (status: any, data: any = {}) => Object.assign(new Error(data.error || 'HTTP ' + status), { status, data })
const netError: any = () => new TypeError('Failed to fetch')
const puts: any = () => api.mock.calls.filter(([, o]: any) => o?.method === 'PUT').map(([, o]: any) => JSON.parse(o.body))
const USER: any = { id: 'user-1', name: 'One' }
const fresh: any = { offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: null }
const signedIn: any = (S: any) => useStore.setState({ S, user: USER, ready: true, sync: { ...fresh } })
// What the screen's "Change exercise" and "Use default exercise" write.
const choose: any = (key: any, id: any) => useStore.getState().update((s: any) => { s.balanceOverrides = withOverride(s.balanceOverrides, key, id) })

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gym_owner', USER.id)
  api.mockReset(); toast.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh } })
})
afterEach(() => {
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh } })
})

describe('a role chosen here and a conflict with the other device', () => {
  it('keeps the choice and the clear made here over the older ones in a newer copy', async () => {
    const shared: any = { ...clone(DEF), _ts: 100, balanceOverrides: { [PULLUPS]: { id: '0017', _ts: 90 } } }
    signedIn(clone(shared))
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    choose(DIPS, '0009')
    choose(PULLUPS, null)
    // The other device logged a set after that, and had picked the dips machine long before.
    const there: any = { ...clone(shared), _ts: Date.now() + 60_000, restSec: 45, workouts: [{ id: 'w9', d: '2026-09-20', start: 1, entries: [] }] }
    there.balanceOverrides[DIPS] = { id: '0251', _ts: 50 }
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: { ...there, _rev: 2 } }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pushState()

    expect(puts()).toHaveLength(2)
    for (const S of [puts()[1].state, useStore.getState().S]) {
      expect(S.restSec).toBe(45)                                   // settings: the newer copy
      expect(S.workouts.map((w: any) => w.id)).toEqual(['w9'])
      expect(S.balanceOverrides[DIPS].id).toBe('0009')             // chosen here, later
      expect(S.balanceOverrides[PULLUPS].id).toBe(null)            // cleared here, later
    }
  })

  it('takes the other device\'s choice when it was made after the one here', async () => {
    signedIn({ ...clone(DEF), _ts: 100 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    choose(DIPS, '0009')
    const mine: any = useStore.getState().S.balanceOverrides[DIPS]._ts
    const there: any = { ...clone(DEF), _ts: 50, balanceOverrides: { [DIPS]: { id: '2364', _ts: mine + 1_000 } } }
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: { ...there, _rev: 2 } }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pushState()

    expect(puts()[1].state.balanceOverrides[DIPS].id).toBe('2364')
    expect(useStore.getState().S.balanceOverrides[DIPS].id).toBe('2364')
  })
})

describe('a role chosen before a forced sign-out', () => {
  it('is kept aside and comes back on the next sign-in over the server\'s older choice', async () => {
    signedIn({ ...clone(DEF), _ts: 100 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ rev: 1 })   // a check in step: the fingerprint of rev 1 is taken
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('ok'))

    choose(DIPS, '0009')
    const chosen: any = clone(useStore.getState().S.balanceOverrides[DIPS])
    expect(useStore.getState().unsyncedChanges()).toEqual({ owed: true, count: 1 })

    api.mockReset()
    api.mockRejectedValue(netError())
    expect(await useStore.getState().signOut({ force: true })).toMatchObject({ owed: true, stashed: true })
    expect(useStore.getState().S.balanceOverrides).toEqual({})

    const server: any = { ...clone(DEF), _ts: 50, _rev: 2, balanceOverrides: { [DIPS]: { id: '0251', _ts: 20 }, [PULLUPS]: { id: '0017', _ts: 30 } } }
    api.mockReset()
    api.mockImplementation(async (path: any, o: any) => (o?.method === 'PUT' ? { ok: true, rev: 3 } : { state: clone(server), rev: 2 }))
    useStore.getState().setUser(USER)
    await useStore.getState().adoptProfile(async () => false)

    for (const S of [useStore.getState().S, puts().at(-1).state]) {
      expect(S.balanceOverrides[DIPS]).toEqual(chosen)
      expect(S.balanceOverrides[PULLUPS]).toEqual({ id: '0017', _ts: 30 })
    }
  })
})
