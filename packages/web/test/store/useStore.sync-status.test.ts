import './sync-clock'
// @vitest-environment happy-dom

/* What the store tells the screens about the server (`sync`, `syncNow`, `unsyncedChanges`), and
   the rule that signing out never loses a change silently: it refuses while anything is
   owed, keeps the owed copy aside when told to go ahead anyway, and brings it back on the next
   sign-in to the same server and account. Signing in again to the account this copy already
   belongs to merges instead of asking. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync-api', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
const { toast, stopRest, abandonWork } = vi.hoisted(() => ({ toast: vi.fn(), stopRest: vi.fn(), abandonWork: vi.fn() }))
vi.mock('../../src/store/useUI', () => ({ useUI: { getState: () => ({ toast, stopRest, abandonWork }) } }))

import { api } from './sync-api'
import { DEF as typed_DEF, useStore as typed_useStore } from './sync-store'
const DEF: any = typed_DEF
const useStore: any = typed_useStore

const clone: any = (value: any) => JSON.parse(JSON.stringify(value))
const workout: any = (id: any, d: any = '2026-09-01') => ({ id, d, start: 1, entries: [] })
const routine: any = (id: any, reps: any = 10) => ({ id, name: id, ex: [{ id: 'bench', sets: 3, reps }] })
const httpError: any = (status: any, data: any = {}) => Object.assign(new Error(data.error || 'HTTP ' + status), { status, data })
const netError: any = () => new TypeError('Failed to fetch')
const ids: any = (xs: any) => (xs || []).map((x: any) => x.id)
const puts: any = () => api.mock.calls.filter(([, o]: any) => o?.method === 'PUT').map(([, o]: any) => JSON.parse(o.body))
const paths: any = () => api.mock.calls.map(([p, o]: any) => (o?.method || 'GET') + ' ' + p)
const USER: any = { id: 'user-1', name: 'One' }
const fresh: any = { offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: null }
const signedIn: any = (S: any, extra: any = {}) => useStore.setState({ S, user: USER, ready: true, sync: { ...fresh }, ...extra })

// config goes back to null as well: a boot test leaves a pre-sign-in copy behind (no `coach`
// key), and setUser re-asks /api/config for such a copy (#249), which would take the next test's
// queued answer meant for its pull.
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('gym_owner', USER.id)
  api.mockReset(); toast.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh }, config: null })
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false, sync: { ...fresh }, config: null })
})

describe('sync status', () => {
  it('ok, with the time, once a check finds this device and the server in step — and that time is kept', async () => {
    const S: any = { ...clone(DEF), _ts: 100, workouts: [workout('w1')] }
    signedIn(S)
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ rev: 1 })
    window.dispatchEvent(new Event('online'))   // the rev check the poll and a focus also run
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('ok'))

    expect(paths()).toEqual(['GET /api/data/rev'])
    const { sync } = useStore.getState()
    expect(sync.status).toBe('ok')
    expect(sync.lastSynced).toBeGreaterThan(0)
    expect(Number(localStorage.getItem('gym_synced_at'))).toBe(sync.lastSynced)
  })

  it('offline, error with the HTTP status, and refused — each from the failure that caused it', async () => {
    const S: any = { ...clone(DEF), _ts: 500, workouts: [workout('w1')] }
    signedIn(S)
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))

    api.mockRejectedValueOnce(netError())
    await useStore.getState().pushState()
    expect(useStore.getState().sync).toMatchObject({ status: 'offline', pending: true, lastError: { status: 0, code: 'network' } })

    api.mockRejectedValueOnce(httpError(500))
    await useStore.getState().pushState()
    expect(useStore.getState().sync).toMatchObject({ status: 'error', offline: false, pending: true, lastError: { status: 500, code: 'http' } })

    api.mockRejectedValueOnce(httpError(502))
    await useStore.getState().pushState()
    expect(useStore.getState().sync.lastError).toEqual({ status: 502, code: 'http' })   // a new code is news

    api.mockRejectedValueOnce(httpError(401))
    await useStore.getState().pushState()
    expect(useStore.getState().sync).toMatchObject({ status: 'auth', auth: true, pending: true, lastError: { status: 401, code: 'auth' } })
    expect(localStorage.getItem('gym_dirty')).toBe('1')

    api.mockResolvedValueOnce({ ok: true, rev: 2 })
    await useStore.getState().pushState()
    expect(useStore.getState().sync).toMatchObject({ status: 'ok', auth: false, offline: false, pending: false, lastError: null })
  })

  it('a refused rev check or pull says so and leaves the copy, the marker and the user alone', async () => {
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockRejectedValueOnce(httpError(401))
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('auth'))
    expect(useStore.getState().sync.status).toBe('auth')
    expect(useStore.getState().user).toEqual(USER)
    expect(JSON.parse(localStorage.getItem('gym_sync') || 'null')).toEqual({ rev: 1, ts: 100 })
  })

  it('pending when a change is owed and nothing has failed yet; local without an account', () => {
    signedIn({ ...clone(DEF), _ts: 100 }, { sync: { ...fresh, pending: true } })
    useStore.getState().setUser(USER)   // any update recomputes it
    expect(useStore.getState().sync.status).toBe('pending')
    useStore.getState().setUser(null)
    expect(useStore.getState().sync.status).toBe('local')
  })

  it('syncNow sends the change waiting in the debounce, checks the server, and answers with the result', async () => {
    vi.useFakeTimers()
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockImplementation(async (path: any, o: any) => (o?.method === 'PUT' ? { ok: true, rev: 2 } : { state: { ...clone(useStore.getState().S), _rev: 2 }, rev: 2 }))
    useStore.getState().update((s: any) => { s.restSec = 30 })

    const result: any = await useStore.getState().syncNow()

    expect(paths()).toEqual(['PUT /api/data', 'GET /api/data'])
    expect(result).toMatchObject({ status: 'ok', pending: false })
    expect(result.lastSynced).toBeGreaterThan(0)
  })

  it('syncNow without an account answers local and asks nothing', async () => {
    expect(await useStore.getState().syncNow()).toMatchObject({ status: 'local' })
    expect(api).not.toHaveBeenCalled()
  })
})

describe('the web boot', () => {
  const boot: any = async (me: any, user: any = USER) => {
    api.mockImplementation(async (path: any) => {
      if (path === '/api/config') return { allow_guest: true }
      if (path === '/api/me') return me()
      throw new Error('unexpected ' + path)
    })
    useStore.setState({ user, ready: false })
    await useStore.getState().boot()
  }

  it('a session that ended goes back to sign-in, keeps the copy with its owner, and says why', async () => {
    useStore.setState({ S: { ...clone(DEF), _ts: 100, workouts: [workout('w1')] } })
    await boot(() => { throw httpError(401) })
    expect(useStore.getState().user).toBeNull()
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1'])
    expect(localStorage.getItem('gym_owner')).toBe(USER.id)
    expect(useStore.getState().sync).toMatchObject({ status: 'auth', lastError: { status: 401 } })
    useStore.getState().setGuest(true)   // "Continue without account"
    expect(useStore.getState().sync.status).toBe('local')
  })

  it('a reload after that still says so while the copy owes its account changes — not once a guest chose to go on', async () => {
    useStore.setState({ S: { ...clone(DEF), _ts: 100, workouts: [workout('w1')] } })
    localStorage.setItem('gym_dirty', '1')
    await boot(() => { throw httpError(401) }, null)
    expect(useStore.getState().sync).toMatchObject({ status: 'auth', pending: true, lastError: { status: 401 } })

    useStore.getState().setGuest(true)
    await boot(() => { throw httpError(401) }, null)
    expect(useStore.getState().sync.status).toBe('local')
  })

  it('a reload with nothing owed is simply signed out', async () => {
    useStore.setState({ S: { ...clone(DEF), _ts: 100, workouts: [workout('w1')] } })
    await boot(() => { throw httpError(401) }, null)
    expect(useStore.getState().sync.status).toBe('local')
  })

  it('a page in front that answers for the server is an error, not a sign-out', async () => {
    await boot(() => { throw Object.assign(new Error('not openGym data'), { status: 200, code: 'bad-response' }) })
    expect(useStore.getState().user).toEqual(USER)
    expect(useStore.getState().sync).toMatchObject({ status: 'error', lastError: { status: 200, code: 'bad-response' } })
  })
})

describe('signing out never loses a change silently', () => {
  const owedCopy: any = () => {
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ rev: 1 })   // a check in step: the fingerprint of rev 1 is taken
    window.dispatchEvent(new Event('online'))
  }

  it('refuses while a change is owed, says how many, and wipes nothing', async () => {
    owedCopy()
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('ok'))
    useStore.getState().update((s: any) => { s.workouts.push(workout('w2', '2026-09-02')); s.restSec = 60 })
    api.mockReset()
    api.mockRejectedValue(netError())

    const r: any = await useStore.getState().signOut()

    expect(r).toEqual({ owed: true, count: 2 })
    expect(useStore.getState().user).toEqual(USER)
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w2'])
    expect(JSON.parse(localStorage.getItem('gym_state_v1') || 'null').workouts).toHaveLength(2)
    expect(paths()).toEqual(['PUT /api/data'])   // the retry, and no /api/logout
  })

  it('goes ahead once the retry lands', async () => {
    owedCopy()
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('ok'))
    useStore.getState().update((s: any) => { s.workouts.push(workout('w2', '2026-09-02')) })
    api.mockReset()
    api.mockResolvedValue({ ok: true, rev: 2 })
    expect(await useStore.getState().signOut()).toEqual({ owed: false })
    expect(useStore.getState().user).toBeNull()
    expect(paths()).toEqual(['PUT /api/data', 'POST /api/logout'])
  })

  it('"sign out anyway" keeps the owed copy aside and brings it back on the next sign-in to this account', async () => {
    owedCopy()
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('ok'))
    useStore.getState().update((s: any) => { s.workouts.push(workout('w2', '2026-09-02')) })
    api.mockReset()
    api.mockRejectedValue(netError())

    const r: any = await useStore.getState().signOut({ force: true })
    expect(r).toEqual({ owed: true, count: 1, stashed: true })
    expect(useStore.getState().user).toBeNull()
    expect(useStore.getState().S.workouts).toEqual([])
    const stash: any = JSON.parse(localStorage.getItem('gym_stash') || 'null')
    expect(Object.values(stash).map((e: any) => [e.uid, ids(e.state.workouts)])).toEqual([[USER.id, ['w1', 'w2']]])
    expect(await useStore.getState().keptChanges()).toEqual([{ server: location.origin, uid: USER.id, name: 'One', at: expect.any(Number) }])

    // Another account signs in here first: the stash is not theirs.
    api.mockReset()
    api.mockResolvedValue({ state: { ...clone(DEF), _ts: 50, workouts: [workout('b1')], _rev: 4 }, rev: 4 })
    useStore.getState().setUser({ id: 'user-2', name: 'Two' })
    await useStore.getState().adoptProfile(async () => false)
    expect(ids(useStore.getState().S.workouts)).toEqual(['b1'])
    expect(localStorage.getItem('gym_stash')).not.toBeNull()
    await useStore.getState().signOut()

    // The account comes back — the stash is merged into what the server has, and pushed.
    api.mockReset()
    api.mockImplementation(async (path: any, o: any) => (o?.method === 'PUT' ? { ok: true, rev: 3 } : { state: { ...clone(DEF), _ts: 200, workouts: [workout('w1'), workout('w-phone', '2026-09-03')], _rev: 2 }, rev: 2 }))
    useStore.getState().setUser(USER)
    await useStore.getState().adoptProfile(async () => false)

    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w2', 'w-phone'])
    expect(puts().at(-1).baseRev).toBe(2)
    expect(ids(puts().at(-1).state.workouts)).toEqual(['w1', 'w2', 'w-phone'])
    expect(localStorage.getItem('gym_stash')).toBeNull()
    expect(await useStore.getState().keptChanges()).toEqual([])
  })

  it('"sign out everywhere" follows the same rule, before it asks the server for anything', async () => {
    owedCopy()
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('ok'))
    useStore.getState().update((s: any) => { s.workouts.push(workout('w2', '2026-09-02')) })
    api.mockReset()
    api.mockRejectedValue(netError())
    expect(await useStore.getState().signOutAll()).toEqual({ owed: true, count: 1 })
    expect(paths()).toEqual(['PUT /api/data'])
    expect(useStore.getState().user).toEqual(USER)
  })

  it('a workout running with nothing owed is kept on this device and back on the next sign-in', async () => {
    owedCopy()
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('ok'))
    useStore.getState().update((s: any) => { s.active = { id: 'run', start: 5, entries: [{ id: 'squat', sets: [{ w: 100, r: 5, done: true }] }] } })
    api.mockReset()
    api.mockResolvedValue({ ok: true, rev: 1 })
    expect(useStore.getState().unsyncedChanges().owed).toBe(false)
    expect(await useStore.getState().signOut()).toEqual({ owed: false })
    expect(useStore.getState().S.active).toBeNull()
    const stash: any = Object.values(JSON.parse(localStorage.getItem('gym_stash') || 'null'))
    expect(stash.map((e: any) => [e.uid, e.state.active?.id, ids(e.state.workouts)])).toEqual([[USER.id, 'run', []]])

    api.mockReset()
    api.mockImplementation(async (path: any, o: any) => (o?.method === 'PUT' ? { ok: true, rev: 3 } : { state: { ...clone(DEF), _ts: 200, workouts: [workout('w1')], _rev: 2 }, rev: 2 }))
    useStore.getState().setUser(USER)
    await useStore.getState().adoptProfile(async () => false)
    expect(useStore.getState().S.active?.id).toBe('run')
    expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(true)
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1'])
    expect(localStorage.getItem('gym_stash')).toBeNull()
  })

  it('stops the rest and the hold before the logout request, so the push can still be called off', async () => {
    owedCopy()
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('ok'))
    api.mockReset(); stopRest.mockClear(); abandonWork.mockClear()
    api.mockResolvedValue({ ok: true, rev: 1 })
    await useStore.getState().signOut()
    expect(stopRest).toHaveBeenCalledTimes(1)
    expect(abandonWork).toHaveBeenCalledTimes(1)
    const logout: any = api.mock.calls.findIndex(([p]: any) => p === '/api/logout')
    expect(stopRest.mock.invocationCallOrder[0]).toBeLessThan(api.mock.invocationCallOrder[logout])

    owedCopy()
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('ok'))
    api.mockReset(); stopRest.mockClear()
    api.mockResolvedValue({ ok: true, rev: 1 })
    await useStore.getState().signOutAll()
    const all: any = api.mock.calls.findIndex(([p]: any) => p === '/api/logout/all')
    expect(stopRest.mock.invocationCallOrder[0]).toBeLessThan(api.mock.invocationCallOrder[all])
  })

  it('unsyncedChanges says nothing is owed when nothing is', async () => {
    owedCopy()
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('ok'))
    expect(useStore.getState().unsyncedChanges()).toEqual({ owed: false, count: 0 })
  })
})

describe('a sign-out the server did not answer', () => {
  // A copy in step with the server: nothing owed, so the sign-out goes ahead at once.
  const inStep: any = async () => {
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ rev: 1 })
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(useStore.getState().sync.status).toBe('ok'))
    api.mockReset()
  }

  // The session cookie is HttpOnly: only the server's answer to /api/logout takes it out of the
  // browser. A sign-out that could not reach the server left it there, still valid, and the next
  // boot's /api/me signed the browser back in with no passkey — on a shared computer, into the
  // account the last person signed out of.
  it('a sign-out the server never heard is finished on the next boot, and until then nothing signs the browser back in', async () => {
    await inStep()
    api.mockRejectedValue(netError())
    expect(await useStore.getState().signOut()).toEqual({ owed: false })
    expect(useStore.getState().user).toBeNull()
    expect(localStorage.getItem('gym_logout_owed')).toBe('1')

    // Still unreachable: the old session is not even asked about.
    api.mockReset()
    api.mockImplementation(async (path: any, o: any) => {
      if (path === '/api/config') return { allow_guest: true }
      if (path === '/api/logout') throw httpError(502)
      if (path === '/api/me') return { user: USER }
      throw new Error('unexpected ' + path)
    })
    useStore.setState({ ready: false, config: null })
    await useStore.getState().boot()
    expect(paths()).toEqual(['GET /api/config', 'POST /api/logout'])
    expect(useStore.getState().user).toBeNull()
    expect(useStore.getState().ready).toBe(true)
    expect(localStorage.getItem('gym_logout_owed')).toBe('1')

    // The server answers again: the logout goes first, and /api/me finds nobody.
    api.mockReset()
    api.mockImplementation(async (path: any) => {
      if (path === '/api/config') return { allow_guest: true }
      if (path === '/api/logout') return { ok: true }
      if (path === '/api/me') throw httpError(401)
      throw new Error('unexpected ' + path)
    })
    useStore.setState({ ready: false, config: null })
    await useStore.getState().boot()
    expect(paths()).toEqual(['GET /api/config', 'POST /api/logout', 'GET /api/me'])
    expect(useStore.getState().user).toBeNull()
    expect(localStorage.getItem('gym_logout_owed')).toBeNull()
  })

  it('signing in again replaces the cookie a failed sign-out left behind, so the next boot asks /api/me as usual', async () => {
    await inStep()
    api.mockRejectedValue(netError())
    await useStore.getState().signOut()
    expect(localStorage.getItem('gym_logout_owed')).toBe('1')
    useStore.getState().setUser(USER)   // a passkey or password sign-in
    expect(localStorage.getItem('gym_logout_owed')).toBeNull()
  })
})

describe('signing in again to the account this copy belongs to', () => {
  // A browser whose session ended mid-week: the copy is still here with its owner and owes the
  // server a workout, a routine edit and a setting.
  const sessionEnded: any = () => {
    useStore.setState({ S: { ...clone(DEF), _ts: 300, restSec: 60, routines: [routine('push', 15), routine('new-plan', 8)], workouts: [workout('w1'), workout('w-week', '2026-09-18')] }, ready: true })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    localStorage.setItem('gym_dirty', '1')
  }
  const server: any = { ...clone(DEF), _ts: 200, restSec: 90, routines: [routine('push', 10)], workouts: [workout('w1'), workout('w-phone', '2026-09-17')], _rev: 2 }

  it('merges what it kept with what the server has, and pushes — no question asked', async () => {
    sessionEnded()
    api.mockResolvedValueOnce({ state: clone(server), rev: 2 }).mockResolvedValueOnce({ ok: true, rev: 3 })
    const ask: any = vi.fn(async () => false)
    useStore.getState().setUser(USER)
    const r: any = await useStore.getState().adoptProfile(ask)

    expect(ask).not.toHaveBeenCalled()
    expect(r).toMatchObject({ adopted: true, merged: true })
    const S: any = useStore.getState().S
    expect(ids(S.workouts)).toEqual(['w1', 'w-phone', 'w-week'])
    expect(ids(S.routines).sort()).toEqual(['new-plan', 'push'])
    expect(S.restSec).toBe(60)
    expect(puts()).toHaveLength(1)
    expect(puts()[0].baseRev).toBe(2)
    expect(localStorage.getItem('gym_dirty')).toBeNull()
  })

  it('a copy with nothing of its own since its revision takes the server\'s as it is', async () => {
    useStore.setState({ S: { ...clone(DEF), _ts: 100, workouts: [workout('w1'), workout('gone', '2026-09-02')] }, ready: true })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ state: clone(server), rev: 2 })
    useStore.getState().setUser(USER)
    await useStore.getState().adoptProfile(async () => false)
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w-phone'])   // deleted elsewhere: stays deleted
    expect(puts()).toHaveLength(0)
  })

  it('a copy without an owner (a guest joining an account) still gets the question', async () => {
    localStorage.removeItem('gym_owner')
    useStore.setState({ S: { ...clone(DEF), _ts: 900, workouts: [workout('guest', '2026-09-11')] }, ready: true })
    api.mockResolvedValueOnce({ state: clone(server), rev: 2 })
    const ask: any = vi.fn(async () => false)
    useStore.getState().setUser(USER)
    await useStore.getState().adoptProfile(ask)
    expect(ask).toHaveBeenCalledWith({ workouts: 1, bodyweight: 0, customEx: 0 })
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w-phone'])
  })
})

describe('another account signing in on a copy that still owes the first', () => {
  const twosServer: any = async (path: any, o: any) => (o?.method === 'PUT' ? { ok: true, rev: 5 } : { state: { ...clone(DEF), _ts: 50, workouts: [workout('b1')], _rev: 4 }, rev: 4 })

  it('keeps what the first account was owed aside for it — nothing of it goes into the new account — and gives it back when that account returns', async () => {
    signedIn({ ...clone(DEF), _ts: 300, workouts: [workout('w1'), workout('w-week', '2026-09-18')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    localStorage.setItem('gym_dirty', '1')

    api.mockImplementation(twosServer)
    useStore.getState().setUser({ id: 'user-2', name: 'Two' })
    await useStore.getState().adoptProfile(async () => false)

    expect(ids(useStore.getState().S.workouts)).toEqual(['b1'])
    expect(puts()).toHaveLength(0)
    expect(await useStore.getState().keptChanges()).toEqual([{ server: location.origin, uid: USER.id, name: 'One', at: expect.any(Number) }])
    expect(await useStore.getState().signOut()).toEqual({ owed: false })

    api.mockReset()
    api.mockImplementation(async (path: any, o: any) => (o?.method === 'PUT' ? { ok: true, rev: 3 } : { state: { ...clone(DEF), _ts: 200, workouts: [workout('w1')], _rev: 2 }, rev: 2 }))
    useStore.getState().setUser(USER)
    await useStore.getState().adoptProfile(async () => false)
    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w-week'])
    expect(ids(puts().at(-1).state.workouts)).toEqual(['w1', 'w-week'])
    expect(await useStore.getState().keptChanges()).toEqual([])
  })

  it('on a device with no room for a second copy beside the first, the copy makes room for what it owed', async () => {
    const S: any = { ...clone(DEF), _ts: 300, workouts: [workout('w1'), { ...workout('w-week', '2026-09-18'), note: 'x'.repeat(20000) }] }
    localStorage.setItem('gym_state_v1', JSON.stringify(S))
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    localStorage.setItem('gym_dirty', '1')
    signedIn(S)
    // A quota: room for one copy of this profile and a little more, never for two.
    const used: any = () => Object.keys(localStorage).reduce((n: any, k: any) => n + k.length + (localStorage.getItem(k) || '').length, 0)
    const quota: any = used() + 5000
    const setItem: any = localStorage.setItem.bind(localStorage)
    const full: any = vi.spyOn(localStorage, 'setItem').mockImplementation((k: any, v: any) => {
      const prev: any = localStorage.getItem(k)
      if (used() - (prev == null ? 0 : k.length + prev.length) + k.length + String(v).length > quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      return setItem(k, v)
    })
    try {
      api.mockImplementation(twosServer)
      // GM local-data safety exception: retain the only copy instead of deleting it to make room.
      expect(() => useStore.getState().setUser({ id: 'user-2', name: 'Two' })).toThrow(/switch was refused/)
    } finally { full.mockRestore() }

    expect(ids(useStore.getState().S.workouts)).toEqual(['w1', 'w-week'])
    expect(await useStore.getState().keptChanges()).toEqual([])
    expect(ids(JSON.parse(localStorage.getItem('gym_state_v1')!).workouts)).toEqual(['w1', 'w-week'])
    expect(useStore.getState().user).toBeNull()
  })

  it('names the first account, also when its session had already ended, and says when the kept changes move', async () => {
    useStore.getState().setUser(USER)
    useStore.setState({ S: { ...clone(DEF), _ts: 300, workouts: [workout('w1'), workout('w-week', '2026-09-18')] }, ready: true })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    localStorage.setItem('gym_dirty', '1')
    useStore.getState().setUser(null)   // what the boot does when the server ended the session

    const before: any = useStore.getState().keptRev
    api.mockImplementation(twosServer)
    useStore.getState().setUser({ id: 'user-2', name: 'Two' })
    await useStore.getState().adoptProfile(async () => false)
    expect(await useStore.getState().keptChanges()).toEqual([{ server: location.origin, uid: USER.id, name: 'One', at: expect.any(Number) }])
    expect(useStore.getState().keptRev).toBeGreaterThan(before)

    const listed: any = useStore.getState().keptRev
    api.mockReset()
    api.mockImplementation(async (path: any, o: any) => (o?.method === 'PUT' ? { ok: true, rev: 3 } : { state: { ...clone(DEF), _ts: 200, workouts: [workout('w1')], _rev: 2 }, rev: 2 }))
    useStore.getState().setUser(USER)
    await useStore.getState().adoptProfile(async () => false)
    expect(await useStore.getState().keptChanges()).toEqual([])
    expect(useStore.getState().keptRev).toBeGreaterThan(listed)
  })

  it('a copy that owes nothing is replaced as before, with nothing kept', async () => {
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockImplementation(twosServer)
    useStore.getState().setUser({ id: 'user-2', name: 'Two' })
    await useStore.getState().adoptProfile(async () => false)
    expect(ids(useStore.getState().S.workouts)).toEqual(['b1'])
    expect(await useStore.getState().keptChanges()).toEqual([])
  })
})
