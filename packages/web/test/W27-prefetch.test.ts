import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { MEDIA_CACHE, planMediaUrls, installedApp, prefetchAllowed, prefetchMedia, startMediaPrefetch } from '../src/platform/media-prefetch'
import { useStore, freshState } from '../src/store/useStore'
import { EXIDX } from '@opengym/core/exercises'
describe('catalogue-only offline warmup', () => {
 it('matches the bounded persistent service-worker media cache', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')
  expect(sw).toContain(`const MEDIA = '${MEDIA_CACHE}'`); expect(sw).toContain('150 * 1024 * 1024')
 })
 it('collects unique same-origin plan/active media and skips custom shadows and unknown ids', () => {
  const S = { ...freshState(), routines: [{ ex: [{ id: '0025' }, { id: 'missing' }] }], active: { entries: [{ id: '0025' }, { id: '0043' }] } }
  const urls = planMediaUrls(S, 'https://gym.test/open/')
  expect(urls).toHaveLength(4); expect(urls.every(u => u.startsWith('https://gym.test/open/exercise-media/'))).toBe(true)
  expect(planMediaUrls({ ...S, customEx: [{ ...EXIDX['0025'], custom: true }] }, 'https://gym.test/')).toHaveLength(2)
 })
 it('honours both figure settings', () => {
  const ex = Object.values(EXIDX).find(e => e.fv)!
  const S = { routines: [{ ex: [{ id: ex.id }] }], body: 'female' }
  expect(planMediaUrls(S, 'https://gym.test/').join()).toContain(`${ex.fv}.mp4`)
  expect(planMediaUrls({ ...S, exFigure: 'male' }, 'https://gym.test/').join()).toContain(ex.gif)
 })
 it('runs only installed, online, without data saver/cellular/2g', () => {
  expect(installedApp({ matchMedia: () => ({ matches: true }) } as any, {} as any)).toBe(true)
  expect(installedApp({} as any, { standalone: true } as any)).toBe(true)
  expect(installedApp({} as any, {} as any)).toBe(false)
  for (const nav of [{ onLine: false }, { connection: { saveData: true } }, { connection: { type: 'cellular' } }, { connection: { effectiveType: 'slow-2g' } }, { connection: { effectiveType: '2g' } }]) expect(prefetchAllowed(nav as any)).toBe(false)
  expect(prefetchAllowed({ onLine: true } as any)).toBe(true)
 })
 it('skips cached URLs, drains successful responses and stops when network permission changes', async () => {
  const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(0)), fetchImpl = vi.fn().mockResolvedValue({ ok: true, arrayBuffer })
  const cache = { match: vi.fn(async (u: string) => u === 'cached' ? {} : undefined) } as unknown as Cache
  expect(await prefetchMedia(['cached', 'missing'], { cache, fetchImpl })).toEqual({ wanted: 2, missing: 1, fetched: 1 })
  expect(fetchImpl).toHaveBeenCalledWith('missing', { priority: 'low' }); expect(arrayBuffer).toHaveBeenCalledOnce()
  await prefetchMedia(['other'], { fetchImpl, allowed: () => false }); expect(fetchImpl).toHaveBeenCalledOnce()
 })
 it('bounds failing requests instead of fetching the entire plan', async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
  await prefetchMedia(Array.from({ length: 30 }, (_, i) => String(i)), { fetchImpl, allowed: () => true })
  expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(4)
 })
 it('does not open caches or fetch for browser tabs, missing workers or data saver', async () => {
  vi.useFakeTimers()
  const open = vi.fn(), win = { addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) } as any
  const nav = { onLine: true, serviceWorker: { controller: {}, addEventListener() {}, removeEventListener() {} } } as any
  const stop = startMediaPrefetch(useStore, { win, nav, cachesApi: { open } as any, delay: 1 })
  await vi.advanceTimersByTimeAsync(2); expect(open).not.toHaveBeenCalled(); stop(); vi.useRealTimers()
 })
 it('warms an installed controlled app once, reschedules on figure changes, and stops cleanly', async () => {
  vi.useFakeTimers()
  const dual = Object.values(EXIDX).find(e => e.fv)!
  useStore.setState({ S: { ...freshState(), routines: [{ ex: [{ id: dual.id }] }] } })
  const fetchImpl = vi.fn(async (_input: string, _init?: RequestInit) => new Response(new Uint8Array([1])))
  vi.stubGlobal('fetch', fetchImpl); vi.stubGlobal('location', new URL('https://gym.test/app/'))
  const events = new Map<string, () => void>()
  const win = { matchMedia: () => ({ matches: true }), addEventListener: (name: string, fn: () => void) => events.set(name, fn), removeEventListener: (name: string) => events.delete(name) } as any
  const nav = { onLine: true, serviceWorker: { controller: {}, addEventListener() {}, removeEventListener() {} } } as any
  const match = vi.fn().mockResolvedValue(undefined), open = vi.fn().mockResolvedValue({ match })
  const stop = startMediaPrefetch(useStore, { win, nav, cachesApi: { open } as any, delay: 1 })
  try {
   await vi.advanceTimersByTimeAsync(2); expect(open).toHaveBeenCalledWith(MEDIA_CACHE); expect(fetchImpl).toHaveBeenCalledTimes(2)
   events.get('online')!(); await vi.advanceTimersByTimeAsync(2); expect(fetchImpl).toHaveBeenCalledTimes(2)
   useStore.setState({ S: { ...useStore.getState().S, exFigure: 'female' } })
   await vi.advanceTimersByTimeAsync(2); expect(fetchImpl).toHaveBeenCalledTimes(4)
   expect(fetchImpl.mock.calls[2]![0]).toContain(`${dual.fv}.mp4`)
   stop(); expect(events.size).toBe(0)
   useStore.setState({ S: { ...useStore.getState().S, exFigure: 'male' } }); await vi.advanceTimersByTimeAsync(2); expect(fetchImpl).toHaveBeenCalledTimes(4)
  } finally { stop(); vi.unstubAllGlobals(); vi.useRealTimers() }
 })

})
