import './sync-clock'
// @vitest-environment happy-dom

/* A second tab of the same browser while the owner of the copy changes in the first (QA round 2,
   2026-10-06). The sign-out wrote its wiped copy while the owner key still named the account, so
   the idle tab joined its whole copy of the account into it: the next guest saw it, and the next
   profile created there uploaded it. A device-link sign-in to another account did the same. And a
   guest tab left open put its workout, routine and default settings into the account after "Keep
   profile as is". Each "tab" is a fresh import of the store sharing one localStorage; the browser's
   storage events are replayed in the order the writes happened, as the browser delivers them. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h: any = vi.hoisted(() => ({ api: null, toasts: [] }))
vi.mock('./sync-api', () => ({ api: (...a: any[]) => h.api(...a), setRemoteAuth: () => {} }))
vi.mock('../../src/store/useUI', () => ({ useUI: { getState: () => ({ toast: (m: any) => h.toasts.push(m), stopRest: () => {}, abandonWork: () => {} }) } }))

const clone: any = (v: any) => JSON.parse(JSON.stringify(v))
const w: any = (id: any, d: any = '2026-09-01') => ({ id, d, start: 1, end: 2, entries: [] })
const routine: any = (id: any) => ({ id, name: id, exercises: [] })
const ids: any = (st: any) => (st?.workouts || []).map((x: any) => x.id).sort()
const httpError: any = (status: any, data: any) => Object.assign(new Error(data?.error || 'HTTP ' + status), { status, data })
const saved: any = () => JSON.parse(localStorage.getItem('gym_state_v1') || 'null')

let DEF: any
let OWNER: any = 'o0'

/* The browser's storage events, per tab. Each tab's 'storage' listeners are kept apart (openTab),
   and every write is told to every other tab at once, while the writer goes on: the other tab sees
   storage as it is at that write, which is when the browser's event reaches a quick tab. A tab in
   the middle of its own action (act) or handler hears of writes once it is done. */
let tabs: any = []
let writer: any = null
const realSet: any = Storage.prototype.setItem
const realRemove: any = Storage.prototype.removeItem
const pump: any = () => {
  for (let again: any = true; again;) {
    again = false
    for (const t of tabs) {
      if (t.busy || !t.inbox.length) continue
      const ev: any = t.inbox.shift()
      const prev: any = writer
      writer = t; t.busy++
      try { for (const l of t.ls) l(new StorageEvent('storage', { ...ev, storageArea: localStorage })) } finally { t.busy--; writer = prev }
      again = true
    }
  }
}
const emit: any = (key: any, newValue: any) => {
  for (const t of tabs) if (t !== writer) t.inbox.push({ key, newValue })
  pump()
}
beforeEach(() => {
  Storage.prototype.setItem = function (this: Storage, k: any, v: any) { realSet.call(this, k, v); emit(k, String(v)) }
  Storage.prototype.removeItem = function (k: any) { realRemove.call(this, k); emit(k, null) }
})
afterEach(() => {
  Storage.prototype.setItem = realSet
  Storage.prototype.removeItem = realRemove
})
// `fn` run as tab `t`: its writes are the ones the others hear of.
async function act(t: any, fn: any) {
  const tab: any = tabs.find((x: any) => x.store === t)
  tab.busy++; writer = tab
  try { return await fn() } finally { tab.busy--; writer = null; pump() }
}

async function openTab(user: any) {
  vi.resetModules()
  const tab: any = { store: null, ls: [], inbox: [], busy: 0 }
  const add: any = window.addEventListener
  window.addEventListener = function (type: any, l: any, o: any) { if (type === 'storage') tab.ls.push(l); else add.call(this, type, l, o) }
  try {
    const m: any = await import('./sync-store')
    DEF = m.DEF
    tab.store = m.useStore
  } finally { window.addEventListener = add }
  tabs.push(tab)
  tab.store.setState({ user: user ?? null, ready: true })
  return tab.store
}

function server(doc: any) {
  const s: any = { doc: doc ? clone(doc) : null }
  h.api = async (path: any, opts: any = {}) => {
    const method: any = opts.method || 'GET'
    const body: any = opts.body ? JSON.parse(opts.body) : undefined
    if (method === 'GET' && path === '/api/data/rev') return { rev: s.doc?._rev || 0 }
    if (method === 'GET' && path === '/api/data') return { state: s.doc ? clone(s.doc) : null, rev: s.doc?._rev || 0 }
    if (method === 'PUT' && path === '/api/data') {
      const curRev: any = s.doc?._rev || 0
      if (body.baseRev != null && body.baseRev !== curRev) throw httpError(409, { error: 'conflict', rev: curRev, state: clone(s.doc) })
      delete body.state.active
      body.state._rev = curRev + 1
      s.doc = body.state
      return { ok: true, rev: body.state._rev }
    }
    if (method === 'POST' && path.startsWith('/api/logout')) return { ok: true }
    throw new Error('unexpected ' + method + ' ' + path)
  }
  return s
}
const account: any = () => ({
  ...clone(DEF), _ts: 100, restSec: 120, accent: 'sky',
  workouts: [w('x1'), w('x2', '2026-09-02'), w('x3', '2026-09-03')],
  routines: [routine('xr')], bodyweight: [{ d: '2026-09-01', w: 80, t: 1 }],
})
const savedCopy: any = (doc: any, rev: any) => {
  const S: any = clone(doc); delete S._rev
  localStorage.setItem('gym_state_v1', JSON.stringify(S))
  localStorage.setItem('gym_sync', JSON.stringify({ rev, ts: S._ts }))
}

beforeEach(async () => {
  localStorage.clear()
  OWNER = 'o' + (Number(OWNER.slice(1)) + 1)
  DEF = (await import('./sync-store')).DEF
})
afterEach(() => {
  for (const t of tabs) t.store.setState({ user: null, ready: false })
  tabs = []
  localStorage.clear()
})

describe('a second tab while the first one changes owner', () => {
  it('sign-out with a second tab open leaves nothing of the account in the browser', async () => {
    DEF = (await import('./sync-store')).DEF
    const srv: any = server({ ...account(), _rev: 1 })
    localStorage.setItem('gym_owner', OWNER)
    savedCopy(srv.doc, 1)
    const A: any = await openTab({ id: OWNER, name: 'Xavi' })
    const B: any = await openTab({ id: OWNER, name: 'Xavi' })
    expect(ids(B.getState().S)).toEqual(['x1', 'x2', 'x3'])

    const r: any = await act(A, () => A.getState().signOut())
    expect(r.owed).toBe(false)

    expect(ids(saved())).toEqual([])
    expect(saved().routines).toEqual([])
    expect(saved().bodyweight).toEqual([])
    expect(ids(B.getState().S)).toEqual([])
    expect(B.getState().user).toBeNull()
    // The next guest here, in either tab or a new one, starts empty.
    const G: any = await openTab(null)
    expect(ids(G.getState().S)).toEqual([])
    await act(B, () => B.getState().update((s: any) => { s.restSec = 45 }))
    expect(ids(saved())).toEqual([])
    expect(saved().routines).toEqual([])
  })

  it('a device-link sign-in to another account with a second tab open copies nothing of the old account', async () => {
    DEF = (await import('./sync-store')).DEF
    const srv: any = server({ ...account(), _rev: 1 })
    localStorage.setItem('gym_owner', OWNER)
    savedCopy(srv.doc, 1)
    const A: any = await openTab({ id: OWNER, name: 'Xavi' })
    const B: any = await openTab({ id: OWNER, name: 'Xavi' })
    const yan: any = { ...clone(DEF), _ts: 50, workouts: [w('yW1', '2026-09-05')], _rev: 4 }
    srv.doc = yan   // the server now answers as Yan's account

    await act(A, () => A.getState().setUser({ id: 'Y-' + OWNER, name: 'Yan' }, { adopt: true }))
    // The question counts nothing of Xavi's as this device's own work.
    const pre: any = JSON.parse(localStorage.getItem('gym_adopt') || 'null').pre
    expect(pre.workouts || []).toEqual([])
    expect(pre.routines || []).toEqual([])
    expect(ids(saved())).toEqual([])
    expect(ids(B.getState().S)).toEqual([])

    await act(A, () => A.getState().adoptProfile(async () => false))   // "Keep profile as is"
    expect(ids(srv.doc)).toEqual(['yW1'])
    expect(srv.doc.routines || []).toEqual([])
    expect(ids(saved())).toEqual(['yW1'])
    await act(B, () => B.getState().update((s: any) => { s.bodyweight = [...(s.bodyweight || []), { d: '2026-09-06', w: 70, t: Date.now() }] }))
    await act(A, () => A.getState().pushState())
    expect(ids(srv.doc)).toEqual(['yW1'])
    expect(srv.doc.routines || []).toEqual([])
    expect((srv.doc.bodyweight || []).some((e: any) => e.w === 80)).toBe(false)
  })

  it('a guest tab left open after "Keep profile as is" puts none of the guest copy into the account', async () => {
    DEF = (await import('./sync-store')).DEF
    const srv: any = server({ ...account(), _rev: 3 })
    localStorage.setItem('gym_state_v1', JSON.stringify({
      ...clone(DEF), _ts: Date.now(), restSec: 90, accent: 'lime',
      workouts: [w('gW1', '2026-09-04')], routines: [routine('Guest Routine')],
    }))
    const A: any = await openTab(null)
    const B: any = await openTab(null)

    await act(A, () => A.getState().setUser({ id: OWNER, name: 'Xavi' }, { adopt: true }))
    // B, a guest until now, holds nothing while the question is open and writes nothing.
    expect(ids(B.getState().S)).toEqual([])
    await act(B, () => B.getState().update((s: any) => { s.bodyweight = [{ d: '2026-09-06', w: 60, t: Date.now() }] }))
    expect(ids(saved())).toEqual(['gW1'])   // still the guest copy the question is about

    await act(A, () => A.getState().adoptProfile(async () => false))   // "Keep profile as is"
    expect(ids(srv.doc)).toEqual(['x1', 'x2', 'x3'])
    // B now holds the account's copy as it is, and its next change joins the account normally.
    expect(ids(B.getState().S)).toEqual(['x1', 'x2', 'x3'])
    expect(B.getState().S.restSec).toBe(120)
    await act(B, () => B.getState().update((s: any) => { s.bodyweight = [...(s.bodyweight || []), { d: '2026-09-07', w: 81, t: Date.now() }] }))
    A.setState({ ready: true })
    await act(A, () => A.getState().pushState())
    expect(ids(srv.doc)).toEqual(['x1', 'x2', 'x3'])
    expect((srv.doc.routines || []).map((r: any) => r.id)).toEqual(['xr'])
    expect(srv.doc.restSec).toBe(120)
    expect(srv.doc.accent).toBe('sky')
    expect(srv.doc.bodyweight.map((e: any) => e.w).sort()).toEqual([80, 81])
    // The producer attempted during the incomplete owner handover is aborted before it creates a change.
    const stash: any = JSON.parse(localStorage.getItem('gym_stash') || '{}')
    expect(Object.values(stash).some((e: any) => (e.state.bodyweight || []).some((b: any) => b.w === 60))).toBe(false)
  })
})

// RC review 2026-10-07: a guest tab left open while the other tab created a profile went blank
// until that tab saved something, and one mid-workout jumped to the sign-in screen with its
// workout gone from view (it had gone into the account) and nothing said.
describe('a guest tab while the other tab signs in or creates a profile', () => {
  const running: any = () => ({ id: 'act1', start: Date.now() - 600000, entries: [{ id: 'bench', sets: [{ w: 60, r: 5, done: true }] }] })
  const guestCopy: any = (active: any) => ({ ...clone(DEF), _ts: Date.now(), workouts: [w('gW1', '2026-09-04')], active })
  // The tab shows the workout (HashRouter). RC verify 2026-10-07: the toast also came up in a tab
  // on another screen that never showed it, and told the workout tab to go elsewhere.
  beforeEach(() => { location.hash = '#/workout' })
  afterEach(() => { location.hash = '' })

  it('a profile created in the other tab shows in the guest tab at once, and the workout with it', async () => {
    DEF = (await import('./sync-store')).DEF
    const srv: any = server(null)
    localStorage.setItem('gym_state_v1', JSON.stringify(guestCopy(running())))
    localStorage.setItem('gym_guest', '1')
    const A: any = await openTab(null)
    const B: any = await openTab(null)
    expect(B.getState().S.active?.id).toBe('act1')
    h.toasts = []
    // Register (views/Login.jsx): setUser without a question, then the push of this copy.
    await act(A, () => A.getState().setUser({ id: OWNER, name: 'Nova' }))
    expect(ids(B.getState().S)).toEqual(['gW1'])          // not blank
    expect(B.getState().S.active?.id).toBe('act1')
    await vi.waitFor(() => expect(h.toasts).toContain('Signed in from another tab. Your workout came along, keep going here.'))
    expect(h.toasts).toContain('Signed in from another tab. Your workout came along, keep going here.')
    await act(A, () => A.getState().pushState())
    expect(ids(srv.doc)).toEqual(['gW1'])
    // B follows the sign-in once the copy is the account's and in step with the server.
    expect(B.getState().user?.id).toBe(OWNER)
    expect(B.getState().S.active?.id).toBe('act1')
  })

  it('a sign-in to an existing account: the guest tab gets the account, the running workout included, once it is answered', async () => {
    DEF = (await import('./sync-store')).DEF
    const srv: any = server({ ...account(), _rev: 3 })
    localStorage.setItem('gym_state_v1', JSON.stringify(guestCopy(running())))
    localStorage.setItem('gym_guest', '1')
    const A: any = await openTab(null)
    const B: any = await openTab(null)
    h.toasts = []
    await act(A, () => A.getState().setUser({ id: OWNER, name: 'Xavi' }, { adopt: true }))
    await vi.waitFor(() => expect(h.toasts).toContain('Signed in from another tab. Your workout came along, keep going here.'))
    expect(h.toasts).toContain('Signed in from another tab. Your workout came along, keep going here.')
    expect(B.getState().user).toBe(null)                      // nothing taken while the question is open
    await act(A, () => A.getState().adoptProfile(async () => false))   // "Keep profile as is"
    expect(ids(srv.doc)).toEqual(['x1', 'x2', 'x3'])
    expect(A.getState().S.active?.id).toBe('act1')
    expect(ids(B.getState().S)).toEqual(['x1', 'x2', 'x3'])
    expect(B.getState().S.active?.id).toBe('act1')
    expect(B.getState().user?.id).toBe(OWNER)
  })

  it('a guest tab on another screen is not told about a workout it does not show', async () => {
    DEF = (await import('./sync-store')).DEF
    server(null)
    localStorage.setItem('gym_state_v1', JSON.stringify(guestCopy(running())))
    localStorage.setItem('gym_guest', '1')
    location.hash = '#/stats'
    const A: any = await openTab(null)
    const B: any = await openTab(null)
    h.toasts = []
    await act(A, () => A.getState().setUser({ id: OWNER, name: 'Nova' }))
    await vi.dynamicImportSettled()
    expect(h.toasts.some((m: any) => /another tab/.test(m))).toBe(false)
    expect(B.getState().S.active?.id).toBe('act1')
  })

  it('a new profile with nothing in it: the other tab takes it without waiting for a save', async () => {
    DEF = (await import('./sync-store')).DEF
    server(null)
    localStorage.setItem('gym_state_v1', JSON.stringify({ ...clone(DEF), _ts: Date.now(), restSec: 75 }))
    const A: any = await openTab(null)
    const B: any = await openTab(null)
    await act(A, () => A.getState().setUser({ id: OWNER, name: 'Empty' }, { adopt: true }))
    await act(A, () => A.getState().adoptProfile(async () => true))
    expect(B.getState().S.restSec).toBe(75)
    expect(localStorage.getItem('gym_state_owner')).toBe(OWNER)
  })
})

