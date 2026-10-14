// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createSyncEngine } from '../../src/store/sync-engine'
import { initialStoreState, type StoreState } from '../../src/store/useStore'
import { createBrowserPlatform } from '../../src/platform/browser'
import { configureUx, ux } from '../../src/platform/ux'
afterEach(() => vi.useRealTimers())
it('creates a sync closure with injected state, storage and API while UX has no browser surfaces', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
  const old = ux(); configureUx({ ...old, window: null, document: null })
  const browser = createBrowserPlatform(); configureUx({ ...old, window: null, document: null })
  const saved = new Map<string, string>()
  const platform = { ...browser, kv: { get: (key: string) => saved.get(key) ?? null, set: (key: string, value: string) => { saved.set(key, value) }, remove: (key: string) => { saved.delete(key) }, subscribe: () => () => {} } }
  let state: StoreState = { ...initialStoreState(platform.kv), update() {} }
  const api = vi.fn().mockResolvedValue({ ok: true, rev: 1, wid: 'synthetic-write' })
  const engine = createSyncEngine(patch => { state = { ...state, ...patch } }, () => state, { platform, api, prompts: { askAddDeviceData: async () => false, toast() {} } })
  state = { ...state, ...engine.actions, user: { id: 'synthetic-user' }, ready: true }
  try {
    state.update(draft => { draft.restSec = 120 })
    expect(JSON.parse(saved.get('gym_state_v1')!).restSec).toBe(120)
    await state.pushState()
    expect(JSON.parse(api.mock.calls[0]![1]!.body as string).state.restSec).toBe(120)
    expect(state.sync.status).toBe('ok')
  } finally { engine.dispose(); configureUx(old) }
  expect(vi.getTimerCount()).toBe(0)
})
it('importing the engine installs no listeners and reads no browser storage', async () => {
  vi.resetModules()
  const get = vi.spyOn(Storage.prototype, 'getItem')
  const doc = vi.spyOn(document, 'addEventListener')
  const win = vi.spyOn(window, 'addEventListener')
  try {
    await import('../../src/store/sync-engine')
    expect(get).not.toHaveBeenCalled()
    expect(doc).not.toHaveBeenCalled()
    expect(win).not.toHaveBeenCalled()
  } finally { get.mockRestore(); doc.mockRestore(); win.mockRestore() }
})
it('KV owner notifications protect accounts without any browser storage event', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
  const old = ux(); const browser = createBrowserPlatform(); configureUx({ ...old, window: null, document: null })
  const map = new Map<string, string>([['gym_owner', 'account-a'], ['gym_user', JSON.stringify({ id: 'account-a' })], ['gym_state_v1', JSON.stringify({ workouts: [{ id: 'account-a-workout' }] })]])
  let notification: ((key: string | null) => void) | undefined
  let subscribed = false
  const kv = { get: (key: string) => map.get(key) ?? null, set: (key: string, value: string) => { map.set(key, value) }, remove: (key: string) => { map.delete(key) }, subscribe: (listener: (key: string | null) => void) => { notification = listener; subscribed = true; return () => { subscribed = false } } }
  const platform = { ...browser, kv }; let state: StoreState = { ...initialStoreState(kv), update() {} }
  const api = vi.fn().mockResolvedValue({ ok: true, rev: 8 })
  const engine = createSyncEngine(patch => { state = { ...state, ...patch } }, () => state, { platform, api, prompts: { askAddDeviceData: async () => false, toast() {} } })
  state = { ...state, ...engine.actions, ready: true }
  try {
    expect(subscribed).toBe(true)
    kv.set('gym_owner', 'account-b'); kv.set('gym_state_owner', 'account-b'); kv.set('gym_state_wid', 'b-write')
    kv.set('gym_user', JSON.stringify({ id: 'account-b' })); kv.set('gym_sync', JSON.stringify({ rev: 7, ts: 200 }))
    kv.set('gym_state_v1', JSON.stringify({ _ts: 200, workouts: [{ id: 'account-b-workout' }] }))
    notification!('gym_owner')
    expect(state.S.workouts.map((w: any) => w.id)).toEqual(['account-b-workout'])
    expect(state.user?.id).toBe('account-b')
    state.update(s => { s.restSec = 120 }); await state.pushState()
    expect(JSON.parse(api.mock.calls[0]![1]!.body as string).state.workouts.map((w: any) => w.id)).toEqual(['account-b-workout'])
    expect(JSON.parse(kv.get('gym_state_v1')!).workouts.map((w: any) => w.id)).toEqual(['account-b-workout'])
  } finally { engine.dispose(); configureUx(old) }
  expect(subscribed).toBe(false)
})
it.each(['throw', 'reject'])('a %s from injected stopTimers does not prevent sign-out', async mode => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); localStorage.clear()
  const platform = createBrowserPlatform(); let state: StoreState = { ...initialStoreState(platform.kv), update() {} }
  const api = vi.fn().mockResolvedValue({ ok: true, rev: 1 })
  const engine = createSyncEngine(patch => { state = { ...state, ...patch } }, () => state, { platform, api, prompts: { askAddDeviceData: async () => false, toast() {}, stopTimers() { if (mode === 'throw') throw new Error('timer unavailable'); return Promise.reject(new Error('timer unavailable')) } } })
  state = { ...state, ...engine.actions, user: { id: 'synthetic-user' }, ready: true }
  try {
    await state.signOut()
    expect(api.mock.calls.some(([path]) => path === '/api/logout')).toBe(true)
    expect(state.user).toBeNull()
  } finally { engine.dispose() }
})
