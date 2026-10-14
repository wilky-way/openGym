import './sync-clock'
// @vitest-environment happy-dom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h: any = vi.hoisted(() => ({ server: null, calls: [], ask: null, signedIn: false }))

vi.mock('../../src/store/useUI', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))
// The question a resumed adoption asks (useStore resumeAdoption): the sign-in's own sheet.
vi.mock('./sync-prompts', () => ({ askAddDeviceData: (extras: any) => h.ask(extras) }))

const BASE: any = 'https://gym.example.com'
const USER: any = { id: 'u1', name: 'andi' }
const clone: any = (v: any) => JSON.parse(JSON.stringify(v))
const workout: any = (id: any, d: any) => ({ id, d, start: 1, end: 2, entries: [] })
const res: any = (status: any, body: any) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k: any) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => JSON.parse(body),
  text: async () => body,
})
const json: any = (status: any, body: any) => res(status, JSON.stringify(body))
const ids: any = (xs: any) => (xs || []).map((x: any) => x.id)
const deferred: any = () => { let resolve: any; const p: any = new Promise((r: any) => { resolve = r }); return { p, resolve } }

function installFetch() {
  h.calls = [];
  (globalThis as any).fetch = (window as any).fetch = vi.fn(async (url: any, init: any = {}) => {
    const method: any = (init.method || 'GET').toUpperCase()
    h.calls.push({ url: String(url), method })
    const route: any = new URL(String(url), BASE).pathname
    if (route.startsWith('/api/')) return h.server(route, method, init)
    return res(404, '{}')
  })
}
function serverWith(doc: any) {
  const srv: any = { doc: clone(doc), puts: [] }
  h.server = (path: any, method: any, init: any) => {
    if (path === '/api/me') return h.signedIn ? json(200, { user: USER }) : json(401, { error: 'signed out' })
    if (path === '/api/config') return json(200, { invite_only: false, allow_guest: true })
    if (path === '/api/pair/redeem') return json(200, { token: 'TOKEN', user: USER })
    if (path === '/api/data/rev') return json(200, { rev: srv.doc._rev })
    if (path === '/api/data' && method === 'GET') return json(200, { state: clone(srv.doc), rev: srv.doc._rev })
    if (path === '/api/data' && method === 'PUT') {
      const body: any = JSON.parse(init.body)
      srv.puts.push(body)
      if (body.baseRev != null && body.baseRev !== srv.doc._rev) return json(409, { error: 'conflict', rev: srv.doc._rev, state: clone(srv.doc) })
      srv.doc = { ...body.state, _rev: srv.doc._rev + 1 }
      delete srv.doc.active
      return json(200, { ok: true, rev: srv.doc._rev })
    }
    return json(404, { error: 'not found' })
  }
  return srv
}

const TWELVE: any = Array.from({ length: 12 }, (_: any, i: any) => workout('s' + i, `2026-09-${String(i + 1).padStart(2, '0')}`))
const SERVER: any = { _ts: 1000, _rev: 5, unit: 'kg', workouts: TWELVE, routines: [], bodyweight: [] }
let DEF: any
beforeAll(async () => { DEF = (await import('./sync-store')).DEF })
function localPhone() {
  localStorage.clear()
  const S: any = { ...clone(DEF), _ts: 5000, workouts: [workout('phone-1', '2026-09-20')] }
  localStorage.setItem('gym_state_v1', JSON.stringify(S))
  localStorage.setItem('gym_guest', '1')
}

async function signIn(store: any, ask: any) {
  h.signedIn = true
  store.getState().setUser(USER, { adopt: true })
  return store.getState().adoptProfile(ask)
}

let stores: any = []
async function freshStore() {
  vi.resetModules()
  const { useStore } = await import('./sync-store')
  stores.push(useStore)
  return useStore
}
// Everything that used to start a sync while the question was open: the poll's check on a
// resume, a pull, a push, a change on its debounce.
async function everySyncTrigger(useStore: any) {
  window.dispatchEvent(new Event('focus'))
  await useStore.getState().pullState()
  await useStore.getState().pushState()
  useStore.getState().update((s: any) => { s.restSec = 75 })
  await vi.advanceTimersByTimeAsync(1700)   // execute the actual 1500ms debounce while held
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] }); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); installFetch(); h.ask = null; h.signedIn = false })
afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'))
  await vi.advanceTimersByTimeAsync(0)
  for (const s of stores) s.setState({ user: null, ready: false })
  stores = []
  localStorage.clear()
})

describe('signing in: nothing syncs while the question is open', () => {
  it('a pull, a push, the poll and a debounced change in the window write nothing, and Keep leaves all twelve', async () => {
    localPhone()
    const srv: any = serverWith(SERVER)
    const useStore: any = await freshStore()
    await useStore.getState().boot()
    const answer: any = deferred()
    const ask: any = vi.fn(() => answer.p)
    const adopting: any = signIn(useStore, ask)
    await vi.waitFor(() => expect(ask).toHaveBeenCalled())

    await everySyncTrigger(useStore)
    expect(srv.puts).toHaveLength(0)
    expect(ids(srv.doc.workouts)).toHaveLength(12)

    answer.resolve(false)   // Keep profile as is
    await adopting
    expect(srv.puts).toHaveLength(0)
    expect(ids(srv.doc.workouts)).toHaveLength(12)
    expect(ids(useStore.getState().S.workouts)).toEqual(ids(TWELVE))
    expect(localStorage.getItem('gym_adopt')).toBeNull()
    // and sync is back: the next change goes to the server as usual
    useStore.getState().update((s: any) => { s.workouts.push(workout('after', '2026-09-25')) })
    await useStore.getState().pushState()
    expect(srv.puts.at(-1).baseRev).toBe(5)
    expect(ids(srv.doc.workouts)).toHaveLength(13)
  })

  it('Keep takes the server\'s copy as it is when the question closes, not as it was when it opened', async () => {
    localPhone()
    const srv: any = serverWith(SERVER)
    const useStore: any = await freshStore()
    await useStore.getState().boot()
    const answer: any = deferred()
    const ask: any = vi.fn(() => answer.p)
    const adopting: any = signIn(useStore, ask)
    await vi.waitFor(() => expect(ask).toHaveBeenCalled())
    // another device logs a workout meanwhile
    srv.doc = { ...srv.doc, workouts: [...srv.doc.workouts, workout('web-new', '2026-09-26')], _ts: 6000, _rev: 6 }

    answer.resolve(false)
    await adopting
    expect(ids(useStore.getState().S.workouts)).toContain('web-new')
    expect(JSON.parse(localStorage.getItem('gym_sync') || 'null').rev).toBe(6)
    expect(srv.puts).toHaveLength(0)
  })

  it('Add them merges into the server\'s current copy and pushes against its revision', async () => {
    localPhone()
    const srv: any = serverWith(SERVER)
    const useStore: any = await freshStore()
    await useStore.getState().boot()
    const answer: any = deferred()
    const ask: any = vi.fn(() => answer.p)
    const adopting: any = signIn(useStore, ask)
    await vi.waitFor(() => expect(ask).toHaveBeenCalled())
    srv.doc = { ...srv.doc, workouts: [...srv.doc.workouts, workout('web-new', '2026-09-26')], _ts: 6000, _rev: 6 }

    answer.resolve(true)
    await adopting
    expect(srv.puts).toHaveLength(1)
    expect(srv.puts[0].baseRev).toBe(6)
    expect(ids(srv.doc.workouts).sort()).toEqual([...ids(TWELVE), 'phone-1', 'web-new'].sort())
  })

  it('closed with the question open, the next start asks again and pushes nothing before the answer', async () => {
    localPhone()
    const srv: any = serverWith(SERVER)
    let useStore: any = await freshStore()
    await useStore.getState().boot()
    const first: any = vi.fn(() => new Promise(() => {}))   // never answered: the app is killed
    signIn(useStore, first)
    await vi.waitFor(() => expect(first).toHaveBeenCalled())
    // The unanswered adoption is already in flight; closing needs no elapsed wall time.
    for (const s of stores) s.setState({ user: null, ready: false })

    const answer: any = deferred()
    h.ask = vi.fn(() => answer.p)
    h.signedIn = true
    useStore = await freshStore()
    await useStore.getState().boot()
    await vi.waitFor(() => expect(h.ask).toHaveBeenCalled())
    expect(h.ask).toHaveBeenCalledWith(expect.objectContaining({ workouts: 1 }))
    await everySyncTrigger(useStore)
    expect(srv.puts).toHaveLength(0)

    answer.resolve(false)
    await vi.waitFor(() => { expect(localStorage.getItem('gym_adopt')).toBeNull(); expect(ids(useStore.getState().S.workouts)).toEqual(ids(TWELVE)) })
    await vi.advanceTimersByTimeAsync(0)
    expect(srv.puts).toHaveLength(0)
    expect(ids(srv.doc.workouts)).toHaveLength(12)
    expect(ids(useStore.getState().S.workouts)).toEqual(ids(TWELVE))
  })
})
