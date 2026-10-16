// @vitest-environment happy-dom

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ server: null, calls: [], ask: null, signedIn: false }))

vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))
// The question a resumed adoption asks (useStore resumeAdoption): the sign-in's own sheet.
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: extras => h.ask(extras) }))

const BASE = 'https://gym.example.com'
const USER = { id: 'u1', name: 'andi' }
const clone = v => JSON.parse(JSON.stringify(v))
const workout = (id, d) => ({ id, d, start: 1, end: 2, entries: [] })
const res = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => JSON.parse(body),
  text: async () => body,
})
const json = (status, body) => res(status, JSON.stringify(body))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ids = xs => (xs || []).map(x => x.id)
const deferred = () => { let resolve; const p = new Promise(r => { resolve = r }); return { p, resolve } }

function installFetch() {
  h.calls = []
  globalThis.fetch = window.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    h.calls.push({ url: String(url), method })
    const route = String(url).startsWith(BASE) ? String(url).slice(BASE.length) : String(url)
    if (route.startsWith('/api/')) return h.server(route, method, init)
    return res(404, '{}')
  })
}
function serverWith(doc) {
  const srv = { doc: clone(doc), puts: [] }
  h.server = (path, method, init) => {
    if (path === '/api/me') return h.signedIn ? json(200, { user: USER }) : json(401, { error: 'signed out' })
    if (path === '/api/config') return json(200, { invite_only: false, allow_guest: true })
    if (path === '/api/pair/redeem') return json(200, { token: 'TOKEN', user: USER })
    if (path === '/api/data/rev') return json(200, { rev: srv.doc._rev })
    if (path === '/api/data' && method === 'GET') return json(200, { state: clone(srv.doc), rev: srv.doc._rev })
    if (path === '/api/data' && method === 'PUT') {
      const body = JSON.parse(init.body)
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

const TWELVE = Array.from({ length: 12 }, (_, i) => workout('s' + i, `2026-09-${String(i + 1).padStart(2, '0')}`))
const SERVER = { _ts: 1000, _rev: 5, unit: 'kg', workouts: TWELVE, routines: [], bodyweight: [] }
let DEF
beforeAll(async () => { DEF = (await import('./useStore.js')).DEF })
function localPhone() {
  localStorage.clear()
  const S = { ...clone(DEF), _ts: 5000, workouts: [workout('phone-1', '2026-09-20')] }
  localStorage.setItem('gym_state_v1', JSON.stringify(S))
  localStorage.setItem('gym_guest', '1')
}

async function signIn(store, ask) {
  h.signedIn = true
  store.getState().setUser(USER, { adopt: true })
  return store.getState().adoptProfile(ask)
}

let stores = []
async function freshStore() {
  vi.resetModules()
  const { useStore } = await import('./useStore.js')
  stores.push(useStore)
  return useStore
}
// Everything that used to start a sync while the question was open: the poll's check on a
// resume, a pull, a push, a change on its debounce.
async function everySyncTrigger(useStore) {
  window.dispatchEvent(new Event('focus'))
  await useStore.getState().pullState()
  await useStore.getState().pushState()
  useStore.getState().update(s => { s.restSec = 75 })
  await sleep(1700)
}

beforeEach(() => { installFetch(); h.ask = null; h.signedIn = false })
afterEach(async () => {
  window.dispatchEvent(new Event('pagehide'))
  await sleep(20)
  for (const s of stores) s.setState({ user: null, ready: false })
  stores = []
  localStorage.clear()
})

describe('signing in: nothing syncs while the question is open', () => {
  it('a pull, a push, the poll and a debounced change in the window write nothing, and Keep leaves all twelve', async () => {
    localPhone()
    const srv = serverWith(SERVER)
    const useStore = await freshStore()
    await useStore.getState().boot()
    const answer = deferred()
    const ask = vi.fn(() => answer.p)
    const adopting = signIn(useStore, ask)
    while (!ask.mock.calls.length) await sleep(5)

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
    useStore.getState().update(s => { s.workouts.push(workout('after', '2026-09-25')) })
    await useStore.getState().pushState()
    expect(srv.puts.at(-1).baseRev).toBe(5)
    expect(ids(srv.doc.workouts)).toHaveLength(13)
  })

  it('Keep takes the server\'s copy as it is when the question closes, not as it was when it opened', async () => {
    localPhone()
    const srv = serverWith(SERVER)
    const useStore = await freshStore()
    await useStore.getState().boot()
    const answer = deferred()
    const ask = vi.fn(() => answer.p)
    const adopting = signIn(useStore, ask)
    while (!ask.mock.calls.length) await sleep(5)
    // another device logs a workout meanwhile
    srv.doc = { ...srv.doc, workouts: [...srv.doc.workouts, workout('web-new', '2026-09-26')], _ts: 6000, _rev: 6 }

    answer.resolve(false)
    await adopting
    expect(ids(useStore.getState().S.workouts)).toContain('web-new')
    expect(JSON.parse(localStorage.getItem('gym_sync')).rev).toBe(6)
    expect(srv.puts).toHaveLength(0)
  })

  it('Add them merges into the server\'s current copy and pushes against its revision', async () => {
    localPhone()
    const srv = serverWith(SERVER)
    const useStore = await freshStore()
    await useStore.getState().boot()
    const answer = deferred()
    const ask = vi.fn(() => answer.p)
    const adopting = signIn(useStore, ask)
    while (!ask.mock.calls.length) await sleep(5)
    srv.doc = { ...srv.doc, workouts: [...srv.doc.workouts, workout('web-new', '2026-09-26')], _ts: 6000, _rev: 6 }

    answer.resolve(true)
    await adopting
    expect(srv.puts).toHaveLength(1)
    expect(srv.puts[0].baseRev).toBe(6)
    expect(ids(srv.doc.workouts).sort()).toEqual([...ids(TWELVE), 'phone-1', 'web-new'].sort())
  })

  it('closed with the question open, the next start asks again and pushes nothing before the answer', async () => {
    localPhone()
    const srv = serverWith(SERVER)
    let useStore = await freshStore()
    await useStore.getState().boot()
    const first = vi.fn(() => new Promise(() => {}))   // never answered: the app is killed
    signIn(useStore, first)
    while (!first.mock.calls.length) await sleep(5)
    await sleep(900)
    for (const s of stores) s.setState({ user: null, ready: false })

    const answer = deferred()
    h.ask = vi.fn(() => answer.p)
    h.signedIn = true
    useStore = await freshStore()
    await useStore.getState().boot()
    while (!h.ask.mock.calls.length) await sleep(5)
    expect(h.ask).toHaveBeenCalledWith(expect.objectContaining({ workouts: 1 }))
    await everySyncTrigger(useStore)
    expect(srv.puts).toHaveLength(0)

    answer.resolve(false)
    while (localStorage.getItem('gym_adopt')) await sleep(5)
    await sleep(20)
    expect(srv.puts).toHaveLength(0)
    expect(ids(srv.doc.workouts)).toHaveLength(12)
    expect(ids(useStore.getState().S.workouts)).toEqual(ids(TWELVE))
  })
})
