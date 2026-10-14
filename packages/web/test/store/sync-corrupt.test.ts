// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBrowserPlatform } from '../../src/platform/browser'
import { initializeStore, useStore, KEY } from '../../src/store/useStore'
import { initializeSyncEngine } from '../../src/store/sync-engine'
let dispose: () => void
let platform: ReturnType<typeof createBrowserPlatform>
let toast: any
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')); localStorage.clear(); platform = createBrowserPlatform(); toast = vi.fn() })
afterEach(() => { dispose?.(); vi.useRealTimers() })
function boot(raw: string, owner?: string) {
  if (owner) platform.kv.set('gym_owner', owner)
  platform.kv.set(KEY, raw); initializeStore(platform)
  dispose = initializeSyncEngine({ platform, api: async () => ({}), prompts: { askAddDeviceData: async () => false, toast } })
}
it('copies corrupt load bytes before the first save, keeps only the latest, and never copies twice', async () => {
  const old = KEY + '.corrupt-1'; platform.kv.set(old, 'old'); platform.kv.set(KEY + '_corrupt_key', old)
  const raw = '{"broken":\n  \u2603  '; boot(raw)
  expect(useStore.getState().S.lang).toBe('en')
  const writes: [string, string][] = []; const set = platform.kv.set
  platform.kv.set = (key, value) => { writes.push([key, value]); set(key, value) }
  useStore.getState().update(s => { s.restSec = 120 }, false)
  const recovery = platform.kv.get(KEY + '_corrupt_key')!
  expect(recovery).toBe(KEY + '.corrupt-' + Date.now())
  expect(platform.kv.get(recovery)).toBe(raw)
  expect(platform.kv.get(old)).toBeNull()
  expect(writes.findIndex(([key]) => key === recovery)).toBeLessThan(writes.findIndex(([key]) => key === KEY))
  expect(JSON.parse(platform.kv.get(KEY)!).restSec).toBe(120)
  await Promise.resolve(); expect(toast).toHaveBeenCalledWith(expect.stringMatching(/recovery copy was kept/))
  useStore.getState().update(s => { s.restSec = 150 }, false)
  expect(writes.filter(([key]) => key.startsWith(KEY + '.corrupt-'))).toHaveLength(1)
  expect(platform.kv.get(recovery)).toBe(raw)
})
it('a refused recovery copy leaves the original unreadable bytes untouched and retries on a later save', () => {
  const raw = '{not readable'; boot(raw)
  const set = platform.kv.set; let fail = true
  platform.kv.set = (key, value) => { if (fail && key.includes('.corrupt-')) throw new Error('full'); set(key, value) }
  useStore.getState().update(s => { s.restSec = 120 }, false)
  expect(platform.kv.get(KEY)).toBe(raw)
  expect(platform.kv.get('gym_dirty')).toBe('1')
  expect(useStore.getState().S.restSec).toBe(120)
  fail = false; useStore.getState().update(s => { s.restSec = 150 }, false)
  expect(platform.kv.get(platform.kv.get(KEY + '_corrupt_key')!)).toBe(raw)
  expect(JSON.parse(platform.kv.get(KEY)!).restSec).toBe(150)
})
it('a corrupt record above the 5 MiB cap stays untouched when a replacing save is refused', () => {
  const raw = '{' + 'x'.repeat(5 * 1024 * 1024); boot(raw)
  useStore.getState().update(s => { s.restSec = 120 }, false)
  expect(platform.kv.get(KEY)).toBe(raw)
  expect(platform.kv.get(KEY + '_corrupt_key')).toBeNull()
  expect(useStore.getState().S.restSec).toBe(120)
})
it.each(['switch', 'signOut', 'signOutAll'])('refused preservation before %s keeps the original and every deletion is blocked', async action => {
  const raw = '{not readable'; boot(raw, 'old-user')
  const set = platform.kv.set
  platform.kv.set = (key, value) => { if (key.includes('.corrupt-')) throw new Error('full'); set(key, value) }
  if (action === 'switch') expect(() => useStore.getState().setUser({ id: 'next-user' })).toThrow('full')
  else await expect(useStore.getState()[action]({ force: true })).rejects.toThrow('full')
  expect(platform.kv.get(KEY)).toBe(raw)
  expect(platform.kv.get(KEY + '_corrupt_key')).toBeNull()
})
it.each(['switch', 'signOut', 'signOutAll'])('oversized unreadable bytes survive %s without deletion', async action => {
  const raw = '{' + 'x'.repeat(5 * 1024 * 1024); boot(raw, 'old-user')
  if (action === 'switch') expect(() => useStore.getState().setUser({ id: 'next-user' })).toThrow(/cap/)
  else await expect(useStore.getState()[action]({ force: true })).rejects.toThrow(/cap/)
  expect(platform.kv.get(KEY)).toBe(raw)
})
it('a transient initial KV read failure is resolved before any replacing write', () => {
  const raw = '{not readable'; platform.kv.set(KEY, raw)
  const get = platform.kv.get; let first = true
  platform.kv.get = key => { if (key === KEY && first) { first = false; throw new Error('temporarily unreadable') } return get(key) }
  dispose = initializeSyncEngine({ platform, api: async () => ({}), prompts: { askAddDeviceData: async () => false, toast } })
  useStore.getState().update(s => { s.restSec = 120 }, false)
  expect(platform.kv.get(platform.kv.get(KEY + '_corrupt_key')!)).toBe(raw)
  expect(JSON.parse(platform.kv.get(KEY)!).restSec).toBe(120)
})
it('a still-unresolved read refuses saving until the original can be checked', () => {
  const raw = '{not readable'; platform.kv.set(KEY, raw)
  const get = platform.kv.get; let blocked = true
  platform.kv.get = key => { if (key === KEY && blocked) throw new Error('unreadable'); return get(key) }
  dispose = initializeSyncEngine({ platform, api: async () => ({}), prompts: { askAddDeviceData: async () => false, toast } })
  useStore.getState().update(s => { s.restSec = 120 }, false)
  expect(get(KEY)).toBe(raw)
  blocked = false; useStore.getState().update(s => { s.restSec = 150 }, false)
  expect(platform.kv.get(platform.kv.get(KEY + '_corrupt_key')!)).toBe(raw)
})
