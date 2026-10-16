import './sync-clock'
// @vitest-environment happy-dom

/* Two devices, one account: the server refuses a push over a document this device never saw
   (409 with the current copy), the store merges and pushes again; a pull adopts, pushes or
   merges by comparing the server revision and its own marker; nothing pushes before boot has
   pulled; coming back to the tab pulls. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sync-api', () => ({ api: vi.fn() }))
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('../../src/store/useUI', () => ({ useUI: { getState: () => ({ toast }) } }))

import { api } from './sync-api'
import { DEF as typed_DEF, useStore as typed_useStore } from './sync-store'
const DEF: any = typed_DEF
const useStore: any = typed_useStore
import { activate as typed_activate } from '@opengym/core/programme'
const activate: any = typed_activate
import { stampPut as typed_stampPut } from '@opengym/core/server-stamp'
const stampPut: any = typed_stampPut
import { editCompletedSession as typed_editCompletedSession } from '@opengym/core/session-edit'
const editCompletedSession: any = typed_editCompletedSession

const clone: any = (value: any) => JSON.parse(JSON.stringify(value))
const routine: any = (id: any) => ({ id, name: id, ex: [] })
const workout: any = (id: any, d: any = '2026-09-01') => ({ id, d, start: 1, entries: [] })
const httpError: any = (status: any, data: any) => Object.assign(new Error(data?.error || 'HTTP ' + status), { status, data })
const sync: any = () => JSON.parse(localStorage.getItem('gym_sync') || 'null')
const puts: any = () => api.mock.calls.filter(([, o]: any) => o?.method === 'PUT').map(([, o]: any) => JSON.parse(o.body))
const gets: any = () => api.mock.calls.filter(([, o]: any) => !o)
const signedIn: any = (S: any, extra: any = {}) => useStore.setState({ S, user: { id: 'user-1' }, ready: true, ...extra })

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
  useStore.setState({ S: clone(DEF), user: null, ready: false })
})

describe('pull against a revisioned server', () => {
  it.each(['revisioned', 'first', 'legacy'])('advances a week closed by remote finished logs on a clean %s pull', async (mode: any) => {
    const local: any = clone(DEF)
    const def: any = { id: 'synthetic', name: 'Synthetic', unit: local.unit, weeks: [1, 2].map((index: any) => ({ index, days: [{ key: 'd1', sessions: [{ routineSnapshot: { name: 'D1', ex: [] } }] }] })) }
    activate(local, def, { cycleId: 'c', today: '2026-10-12', now: 10 })
    local._ts = 100
    signedIn(local)
    if (mode === 'revisioned') localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    const remote: any = clone(local)
    remote._ts = 200
    remote.workouts.push({ id: 'remote-log', d: '2026-10-12', start: 20, programmeInstance: { cycleId: 'c', instanceId: 'c:w1d1' }, entries: [{ occurrenceId: 'c:w1d1', sets: [{ done: true }] }] })
    api.mockResolvedValueOnce({ state: remote, ...(mode === 'legacy' ? {} : { rev: 2 }) }).mockResolvedValueOnce({ ok: true, rev: 3 })
    await useStore.getState().pullState()
    expect(useStore.getState().S.queue.ids).toEqual(['c-w2d1'])
    expect(useStore.getState().S.programmes.cycles[0].weekIndex).toBe(2)
    expect(puts()).toHaveLength(1)
    expect(puts()[0].state.queue.ids).toEqual(['c-w2d1'])
    if (mode !== 'legacy') expect(puts()[0].baseRev).toBe(2)
  })

  it('survives an unforked stamped writer, clean fork pull, and the fork phone’s next push', async () => {
    const programme: any = { version: 1, fork: 'wilky/1', definitions: [{ id: 'synthetic' }], cycles: [{ id: 'cycle', occurrences: [] }] }
    const local: any = { ...clone(DEF), _ts: 100, programmes: programme }
    // v1.4.0 mergeStates starts from its newer copy: no programmes key or edited.programmes.
    const staleMerge: any = { ...clone(DEF), _ts: 200, sound: false }
    delete staleMerge.programmes
    stampPut(local, staleMerge, { stamped: true, overRead: true, now: 200 })
    expect(staleMerge.programmes).toEqual(programme)

    signedIn(local)
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ state: staleMerge, rev: 2 })
    await useStore.getState().pullState()
    expect(useStore.getState().S.programmes).toEqual(programme)
    api.mockResolvedValueOnce({ ok: true, rev: 3 })
    await useStore.getState().pushState()
    expect(puts().at(-1).state.programmes).toEqual(programme)
  })

  it('clean-adopts an unforked server document without dropping local programs', async () => {
    const local: any = { ...clone(DEF), _ts: 100, programmes: { version: 2, definitions: [{ id: 'synthetic' }], cycles: [] } }
    const remote: any = { ...clone(DEF), _ts: 200 }
    delete remote.programmes
    signedIn(local)
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ state: remote, rev: 2 })
    await useStore.getState().pullState()
    expect(useStore.getState().S.programmes.definitions).toEqual(local.programmes.definitions)
    expect(useStore.getState().S.programmes.version).toBe(2)
  })

  it('adopts the server copy when only the server moved, and records its revision', async () => {
    const local: any = { ...clone(DEF), _ts: 100, workouts: [workout('w1')], active: { id: 'running' } }
    signedIn(local)
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: 200, workouts: [workout('w1'), workout('w2')], _rev: 2 }, rev: 2 })

    await useStore.getState().pullState()

    expect(puts()).toHaveLength(0)
    expect(useStore.getState().S.workouts.map((w: any) => w.id)).toEqual(['w1', 'w2'])
    expect(useStore.getState().S._ts).toBe(200)
    expect(useStore.getState().S.active).toEqual({ id: 'running' })
    expect(sync()).toEqual({ rev: 2, ts: 200 })
  })

  it('does nothing when neither side moved', async () => {
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: 100, workouts: [workout('w1')], _rev: 1 }, rev: 1 })

    await useStore.getState().pullState()

    expect(api).toHaveBeenCalledTimes(1)
    expect(useStore.getState().S.workouts.map((w: any) => w.id)).toEqual(['w1'])
  })

  it('pushes when only this device changed', async () => {
    signedIn({ ...clone(DEF), _ts: 150, workouts: [workout('w1')], restSec: 75 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: 100, workouts: [workout('w1')], _rev: 1 }, rev: 1 })
    api.mockResolvedValueOnce({ ok: true, rev: 2 })

    await useStore.getState().pullState()

    expect(puts()).toHaveLength(1)
    expect(puts()[0].baseRev).toBe(1)
    expect(puts()[0].state.restSec).toBe(75)
    expect(sync()).toEqual({ rev: 2, ts: 150 })
  })

  // The report: desktop adopted rev 1, the phone logged a workout (rev 2), the desktop changed a
  // setting. One PUT, against rev 2, carrying both.
  it('merges and pushes once against the server revision when both sides changed', async () => {
    signedIn({ ...clone(DEF), _ts: 300, workouts: [workout('w1')], restSec: 75 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: 200, workouts: [workout('w1'), workout('from-phone', '2026-09-02')], _rev: 2 }, rev: 2 })
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pullState()

    expect(gets()).toHaveLength(1)
    expect(puts()).toHaveLength(1)
    expect(puts()[0].baseRev).toBe(2)
    expect(puts()[0].state.workouts.map((w: any) => w.id)).toEqual(['w1', 'from-phone'])
    expect(puts()[0].state.restSec).toBe(75)
    expect(useStore.getState().S.workouts.map((w: any) => w.id)).toEqual(['w1', 'from-phone'])
    expect(sync().rev).toBe(3)
    expect(sync().ts).toBe(useStore.getState().S._ts)
    expect(localStorage.getItem('gym_dirty')).toBeNull()
  })

  it('a first pull with a newer server copy adopts it and starts the marker', async () => {
    signedIn(clone(DEF))
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: 50, routines: [routine('r')], _rev: 5 }, rev: 5 })

    await useStore.getState().pullState()

    expect(puts()).toHaveLength(0)
    expect(useStore.getState().S.routines.map((r: any) => r.id)).toEqual(['r'])
    expect(sync()).toEqual({ rev: 5, ts: 50 })
  })

  it('a first pull with a newer local copy pushes it against the server revision', async () => {
    signedIn({ ...clone(DEF), _ts: 500, routines: [routine('local')] })
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: 50, routines: [routine('remote')], _rev: 5 }, rev: 5 })
    api.mockResolvedValueOnce({ ok: true, rev: 6 })

    await useStore.getState().pullState()

    expect(puts()).toHaveLength(1)
    expect(puts()[0].baseRev).toBe(5)
    expect(sync()).toEqual({ rev: 6, ts: 500 })
  })

  it('a 401 on pull leaves the copy, the marker and the user alone', async () => {
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('w1')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockRejectedValueOnce(httpError(401, { error: 'not signed in' }))

    await useStore.getState().pullState()

    expect(useStore.getState().user).toEqual({ id: 'user-1' })
    expect(useStore.getState().S.workouts.map((w: any) => w.id)).toEqual(['w1'])
    expect(sync()).toEqual({ rev: 1, ts: 100 })
    expect(localStorage.getItem('gym_dirty')).toBeNull()
    expect(useStore.getState().sync).toMatchObject({ status: 'auth', auth: true, lastError: { status: 401 } })
  })
})

describe('push against a revisioned server', () => {
  it('sends the marker revision as baseRev and records the one it gets back', async () => {
    signedIn({ ...clone(DEF), _ts: 120, routines: [routine('r')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 4, ts: 100 }))
    api.mockResolvedValueOnce({ ok: true, rev: 5 })

    await useStore.getState().pushState()

    expect(puts()[0].baseRev).toBe(4)
    expect(sync()).toEqual({ rev: 5, ts: 120 })
  })

  it('a 409 merges the server copy it carries and pushes again against that revision', async () => {
    signedIn({ ...clone(DEF), _ts: 300, workouts: [workout('w1')], restSec: 75 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: { ...clone(DEF), _ts: 200, workouts: [workout('w1'), workout('w2')], _rev: 2 } }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pushState()

    expect(puts()).toHaveLength(2)
    expect(puts()[0].baseRev).toBe(1)
    expect(puts()[1].baseRev).toBe(2)
    expect(puts()[1].state.workouts.map((w: any) => w.id)).toEqual(['w1', 'w2'])
    expect(puts()[1].state.restSec).toBe(75)
    expect(useStore.getState().S.workouts.map((w: any) => w.id)).toEqual(['w1', 'w2'])
    expect(sync().rev).toBe(3)
    expect(localStorage.getItem('gym_dirty')).toBeNull()
  })

  it('gives up after two conflicts in a row and leaves the copy dirty for the next pull', async () => {
    signedIn({ ...clone(DEF), _ts: 300, workouts: [workout('w1')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    const conflict: any = (rev: any) => httpError(409, { error: 'conflict', rev, state: { ...clone(DEF), _ts: 200, workouts: [workout('w' + rev)], _rev: rev } })
    api.mockRejectedValueOnce(conflict(2)).mockRejectedValueOnce(conflict(3)).mockRejectedValueOnce(conflict(4))

    await useStore.getState().pushState()

    expect(puts()).toHaveLength(3)
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    expect(useStore.getState().S.workouts.map((w: any) => w.id).sort()).toEqual(['w1', 'w2', 'w3'])
  })

  it('a replace meant for the server goes without a baseRev, the change after it with one', async () => {
    vi.useFakeTimers()
    signedIn({ ...clone(DEF), _ts: 100, routines: [routine('old')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 4, ts: 100 }))
    api.mockResolvedValueOnce({ ok: true, rev: 5 }).mockResolvedValueOnce({ ok: true, rev: 6 })

    useStore.getState().replaceState({ ...clone(DEF), routines: [routine('imported')] }, true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(puts()).toHaveLength(1)
    expect('baseRev' in puts()[0]).toBe(false)
    expect(sync().rev).toBe(5)

    useStore.getState().update((s: any) => { s.restSec = 45 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(puts()).toHaveLength(2)
    expect(puts()[1].baseRev).toBe(5)
  })

  it('a push asked for during a push runs once after it, and the caller waits for it', async () => {
    signedIn({ ...clone(DEF), _ts: 100, routines: [routine('r')] })
    let release: any
    api.mockImplementationOnce(() => new Promise((r: any) => { release = () => r({ ok: true, rev: 1 }) }))
    api.mockResolvedValue({ ok: true, rev: 2 })

    const first: any = useStore.getState().pushState()
    useStore.getState().update((s: any) => { s.restSec = 30 }, false)
    const second: any = useStore.getState().pushState()
    const third: any = useStore.getState().pushState()
    expect(puts()).toHaveLength(1)
    release()
    await Promise.all([first, second, third])

    expect(puts()).toHaveLength(2)
    expect(puts()[1].state.restSec).toBe(30)
    expect(sync().rev).toBe(2)
  })

  it('a server without revisions drops the marker', async () => {
    signedIn({ ...clone(DEF), _ts: 100, routines: [routine('r')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 4, ts: 100 }))
    api.mockResolvedValueOnce({ ok: true })

    await useStore.getState().pushState()

    expect(localStorage.getItem('gym_sync')).toBeNull()
  })
})

describe('ordering', () => {
  it('a change made before boot is through does not push until it is', async () => {
    vi.useFakeTimers()
    useStore.setState({ S: clone(DEF), user: { id: 'user-1' }, ready: false })
    api.mockResolvedValue({ ok: true, rev: 1 })

    useStore.getState().update((s: any) => { s.restSec = 30 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(puts()).toHaveLength(0)

    // what boot does last, on every path
    useStore.setState({ ready: true })
    useStore.getState().update((s: any) => { s.restSec = 45 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(puts()).toHaveLength(1)
    expect(puts()[0].state.restSec).toBe(45)
  })

  // The change lands while the server copy is still on its way: it is merged into that copy
  // rather than overwritten by it, and the merge is what boot pushes.
  it('boot keeps a change made during its pull and pushes the merge', async () => {
    vi.useFakeTimers()
    localStorage.setItem('gym_user', JSON.stringify({ id: 'user-1' }))
    useStore.setState({ S: clone(DEF), user: { id: 'user-1' }, ready: false })
    api.mockImplementation(async (path: any, opts: any) => {
      if (path === '/api/config') return { allow_guest: true }
      if (path === '/api/me') return { user: { id: 'user-1', name: 'One' } }
      if (path === '/api/data' && !opts) {
        useStore.getState().update((s: any) => { s.restSec = 30 })   // a change while the pull is in flight
        return { state: { ...clone(DEF), _ts: 10, routines: [routine('r')], _rev: 1 }, rev: 1 }
      }
      return { ok: true, rev: 2 }
    })

    const boot: any = useStore.getState().boot()
    await vi.advanceTimersByTimeAsync(10)
    await boot
    await vi.advanceTimersByTimeAsync(2000)

    expect(puts()).toHaveLength(1)
    expect(puts()[0].baseRev).toBe(1)
    expect(puts()[0].state.restSec).toBe(30)
    expect(puts()[0].state.routines.map((r: any) => r.id)).toEqual(['r'])
    expect(useStore.getState().S.restSec).toBe(30)
    expect(useStore.getState().S.routines.map((r: any) => r.id)).toEqual(['r'])
    expect(useStore.getState().ready).toBe(true)
  })

  it('a pull sends a push still waiting in the debounce first', async () => {
    vi.useFakeTimers()
    signedIn({ ...clone(DEF), _ts: 100, routines: [routine('r')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockImplementation(async (path: any, opts: any) => opts ? { ok: true, rev: 2 } : { state: { ...clone(DEF), _ts: 100, routines: [routine('r')], _rev: 2 }, rev: 2 })

    useStore.getState().update((s: any) => { s.restSec = 30 })   // arms the 1.5 s push
    const pull: any = useStore.getState().pullState()
    await vi.advanceTimersByTimeAsync(10)
    await pull

    expect(api.mock.calls[0][1]?.method).toBe('PUT')
    expect(api.mock.calls[1][1]).toBeUndefined()
    expect(puts()).toHaveLength(1)
    expect(sync().rev).toBe(2)
  })

  it('coming back to the tab pulls, not twice within 15 s, and going online always does', async () => {
    vi.useFakeTimers()
    signedIn({ ...clone(DEF), _ts: 100, routines: [routine('r')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValue({ state: { ...clone(DEF), _ts: 100, routines: [routine('r')], _rev: 1 }, rev: 1 })
    const visible: any = () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    }

    await vi.advanceTimersByTimeAsync(16000)   // clear of any pull an earlier test made
    visible()
    await vi.advanceTimersByTimeAsync(10)
    expect(gets()).toHaveLength(1)

    window.dispatchEvent(new Event('focus'))
    visible()
    await vi.advanceTimersByTimeAsync(10)
    expect(gets()).toHaveLength(1)

    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(10)
    expect(gets()).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(16000)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(10)
    expect(gets()).toHaveLength(3)

    useStore.setState({ user: null })
    await vi.advanceTimersByTimeAsync(16000)
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(10)
    expect(gets()).toHaveLength(3)
  })
})

/* A workout edited after it was logged (lib/session-edit.js), on its way between devices. The
   edit is an ordinary change of the copy — owed, pushed, merged on a 409 — and carries the time
   of the edit, so the merge keeps it over the old version by id, whichever copy is newer as a
   whole (lib/sync-merge.js). */
describe('an edited workout between devices', () => {
  const lift: any = (w: any) => ({ id: 'sq', target: { mode: 'reps' }, sets: [{ w, r: 5, done: true }] })
  const logged: any = (w: any = 40) => ({ ...workout('w1'), end: 2, entries: [lift(w)], prs: [] })
  const weightsIn: any = (state: any) => state.workouts.map((x: any) => [x.id, x.entries[0]?.sets[0]?.w])
  const edit: any = (w: any) => {
    useStore.getState().update((s: any) => { editCompletedSession(s, 'w1') })
    useStore.getState().update((s: any) => { s.active.entries[0].sets[0].w = w })
    return useStore.getState().saveHistoryEdit()
  }

  it('an edit saved offline reaches the server with the next push, over a server that moved meanwhile', async () => {
    vi.useFakeTimers()
    signedIn({ ...clone(DEF), _ts: 100, workouts: [logged()] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    edit(50)
    await useStore.getState().pushState()
    expect(localStorage.getItem('gym_dirty')).toBe('1')
    expect(useStore.getState().S.active).toBeNull()

    // Meanwhile a phone logged another workout. Its copy is newer as a whole and still holds
    // the workout as it was before the edit.
    const phone: any = { ...clone(DEF), _ts: Date.now() + 60000, workouts: [logged(), { ...workout('w2', '2026-09-02'), entries: [lift(45)] }], _rev: 2 }
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: phone }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })
    await useStore.getState().pushState()

    expect(weightsIn(puts().at(-1).state)).toEqual([['w1', 50], ['w2', 45]])
    expect(puts().at(-1).baseRev).toBe(2)
    expect(weightsIn(useStore.getState().S)).toEqual([['w1', 50], ['w2', 45]])
    expect(localStorage.getItem('gym_dirty')).toBeNull()
  })

  it('edited on one device while another still holds the old copy: the edit replaces it there too', async () => {
    // The other device: the old copy, and a setting changed after the edit was made elsewhere.
    signedIn({ ...clone(DEF), _ts: Date.now() + 60000, workouts: [logged()], restSec: 75 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    const edited: any = { ...logged(50), _ts: Date.now() }
    const server: any = { ...clone(DEF), _ts: Date.now(), workouts: [edited], _rev: 2 }

    // Its push meets the edit on the server.
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: server }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })
    await useStore.getState().pushState()
    expect(weightsIn(puts().at(-1).state)).toEqual([['w1', 50]])
    expect(puts().at(-1).state.restSec).toBe(75)

    // And a pull that finds both sides changed merges the same way.
    useStore.getState().update((s: any) => { s.workouts = [logged()]; s.restSec = 60 }, false)
    api.mockResolvedValueOnce({ state: { ...server, _rev: 4 }, rev: 4 })
    api.mockResolvedValueOnce({ ok: true, rev: 5 })
    await useStore.getState().pullState()
    expect(weightsIn(useStore.getState().S)).toEqual([['w1', 50]])
    expect(useStore.getState().S.restSec).toBe(60)
  })

  it('an edit of a workout another device deleted: kept as a draft when the deletion arrived first', async () => {
    vi.useFakeTimers()
    signedIn({ ...clone(DEF), _ts: 100, workouts: [logged()] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockResolvedValueOnce({ ok: true, rev: 2 })
    useStore.getState().update((s: any) => { editCompletedSession(s, 'w1') })
    useStore.getState().update((s: any) => { s.active.entries[0].sets[0].w = 50 })
    await useStore.getState().pushState()   // the draft is where the server has it: nothing owed

    // The phone deletes the workout; this device learns of it while its editor is open.
    api.mockResolvedValueOnce({ state: { ...clone(DEF), _ts: Date.now() + 60000, workouts: [], _rev: 3 }, rev: 3 })
    await useStore.getState().pullState()
    expect(useStore.getState().S.workouts).toEqual([])

    expect(() => useStore.getState().saveHistoryEdit()).toThrow('deleted on another device')
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(50)
    expect(useStore.getState().S.workouts).toEqual([])
    useStore.getState().discardHistoryEdit()
    expect(useStore.getState().S.active).toBeNull()
  })

  it('an edit of a workout another device deleted: saved first, it comes back edited rather than lost', async () => {
    vi.useFakeTimers()
    signedIn({ ...clone(DEF), _ts: 100, workouts: [logged()] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    edit(50)
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: { ...clone(DEF), _ts: Date.now() + 60000, workouts: [], _rev: 2 } }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pushState()

    expect(weightsIn(puts().at(-1).state)).toEqual([['w1', 50]])
    expect(weightsIn(useStore.getState().S)).toEqual([['w1', 50]])
  })
})

describe('removals and settings across a conflict', () => {
  it('a workout deleted on the other device stays deleted when this one comes back with a change', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10000)
    // A deleted W through the store (update records when), then pushed.
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('W'), workout('keep')] })
    useStore.getState().update((s: any) => { s.workouts = s.workouts.filter((w: any) => w.id !== 'W') }, false)
    const fromA: any = clone(useStore.getState().S)
    expect(fromA.deleted).toEqual({ workouts: { W: 10000 } })

    // B was offline with W still there and logged a setting change later.
    vi.setSystemTime(20000)
    localStorage.clear()
    api.mockReset()
    signedIn({ ...clone(DEF), _ts: 100, workouts: [workout('W'), workout('keep')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    useStore.getState().update((s: any) => { s.restSec = 45 }, false)
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: { ...fromA, _rev: 2 } }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pushState()

    expect(puts().at(-1).state.workouts.map((w: any) => w.id)).toEqual(['keep'])
    expect(puts().at(-1).state.restSec).toBe(45)
    expect(useStore.getState().S.workouts.map((w: any) => w.id)).toEqual(['keep'])
  })

  it('a day of the plan set offline survives the other device syncing something later', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10000)
    signedIn({ ...clone(DEF), _ts: 100 })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    useStore.getState().update((s: any) => { s.week = { ...s.week, 3: ['upperB'] } }, false)
    // the other device logged a weigh-in after it (its copy is newer as a whole)
    const other: any = { ...clone(DEF), _ts: 50000, bodyweight: [{ d: '2026-09-05', w: 80, t: 50000 }], _rev: 2 }
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: other }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pushState()

    const sent: any = puts().at(-1).state
    expect(sent.week).toEqual({ 3: ['upperB'] })
    expect(sent.bodyweight.map((e: any) => e.d)).toEqual(['2026-09-05'])
  })
})

describe('a rotation pass a merge leaves complete', () => {
  it('starts its next pass, as the finish that completed it would have', async () => {
    vi.useFakeTimers()
    const now: any = Date.parse('2026-09-12T10:00:00')
    vi.setSystemTime(now)
    const plan: any = {
      routines: [routine('a'), routine('b')],
      rotation: { id: 'rot', sequence: ['a', 'b'], label: '' },
      queue: { ids: ['a', 'b'], since: now - 5 * 86400000, startsOn: '2026-09-07', label: '', rotationId: 'rot' },
    }
    const done: any = (id: any, d: any) => ({ id: 'w-' + id, d, start: now - 86400000, routineIds: [id], routineId: id, name: id, entries: [] })
    // this device trained A, the other trained B: each copy alone still has a session to go
    signedIn({ ...clone(DEF), ...clone(plan), _ts: 300, workouts: [done('a', '2026-09-10')] })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
    api.mockRejectedValueOnce(httpError(409, { error: 'conflict', rev: 2, state: { ...clone(DEF), ...clone(plan), _ts: 200, workouts: [done('b', '2026-09-11')], _rev: 2 } }))
    api.mockResolvedValueOnce({ ok: true, rev: 3 })

    await useStore.getState().pushState()

    const q: any = puts().at(-1).state.queue
    expect(q.ids).toEqual(['a', 'b'])
    expect(q.startsOn).toBe('2026-09-12')
    expect(q.since).toBeGreaterThanOrEqual(now)
  })
})
