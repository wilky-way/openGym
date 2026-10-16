// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { installUIEnvironment } from './environment'
import { initializeStore, useStore } from '../../src/store/useStore'
import { initializeUI, configureUI, REST_KEY, WORK_KEY, useUI } from '../../src/store/useUI'
import { createBrowserPlatform } from '../../src/platform/browser'
import { configureUx, createBrowserUx } from '../../src/platform/ux'

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  localStorage.clear()
  installUIEnvironment(vi.fn(async () => ({})))
  useUI.getState().stopRest(); useUI.getState().stopWork(); useUI.getState().closeAll()
})
afterEach(() => {
  useUI.getState().stopRest(); useUI.getState().stopWork(); useUI.getState().closeAll()
  Object.defineProperty(document, 'hidden', { value: false, configurable: true })
  configureUx(createBrowserUx())
  vi.clearAllTimers(); vi.useRealTimers(); localStorage.clear()
})
describe('shell boot and sheets', () => {
  it('keeps sheet handles, close callbacks and locks independent', () => {
    const render = () => 'Synthetic sheet'
    const first = useUI.getState().openSheet(render)
    const second = useUI.getState().openSheet(render, { kind: 'center', locked: true })
    expect(first.id).not.toBe(second.id)
    expect(useUI.getState().sheets.map(s => [s.kind, s.locked])).toEqual([['sheet', false], ['center', true]])
    first.lock(true)
    expect(useUI.getState().sheets[0]?.locked).toBe(true)
    second.lock(false)
    first.close(); first.close()
    expect(useUI.getState().sheets.map(s => s.id)).toEqual([second.id])
    useUI.getState().closeAll()
    expect(useUI.getState().sheets).toEqual([])
  })
  it('restores the legacy state and paused timer after shell injection, without a push', () => {
    const platform = createBrowserPlatform()
    const fetch = vi.fn(async () => new Response('{}'))
    platform.transport = { fetch }
    platform.kv.set('gym_state_v1', JSON.stringify({ active: { id: 'live', entries: [] } }))
    platform.kv.set('gym_user', JSON.stringify({ id: 'synthetic-user' }))
    platform.kv.set(REST_KEY, JSON.stringify({ total: 90, endsAt: 0, paused: true, left: 30, forIdx: 1 }))
    initializeStore(platform)
    initializeUI({ platform, deviceId: () => 'synthetic-device', notifyRestOver: async () => {} })
    expect(useStore.getState().S.active.id).toBe('live')
    expect(useUI.getState().timer).toMatchObject({ total: 90, left: 30, paused: true, forIdx: 1 })
    expect(fetch).not.toHaveBeenCalled()
    initializeUI({ platform, deviceId: () => 'synthetic-device', notifyRestOver: async () => {} })
    expect(useUI.getState().timer?.left).toBe(30)
  })
  it('logs an expired hold through the W07-installed update before rendering', () => {
    const platform = createBrowserPlatform()
    const owner = { idx: 0, i: 0, id: 'synthetic-hold' }
    platform.kv.set('gym_state_v1', JSON.stringify({ active: { id: 'live', entries: [{ id: owner.id, sets: [{ sec: 45 }] }] } }))
    initializeStore(platform)
    configureUI({platform,deviceId:()=>undefined,notifyRestOver:async()=>{}})
    useUI.getState().startWork(45,'Hold',null,owner)
    const identified = JSON.parse(platform.kv.get(WORK_KEY)!)
    useUI.getState().stopWork()
    platform.kv.set(WORK_KEY,JSON.stringify({...identified,endsAt:Date.now()-1000}))
    const update = useStore.getState().update
    const syncUpdate = vi.fn((mut, push) => { update(mut, push); platform.kv.set('gym_state_v1', JSON.stringify(useStore.getState().S)) })
    useStore.setState({ update: syncUpdate })
    initializeUI({ platform, deviceId: () => 'synthetic-device', notifyRestOver: async () => {} })
    expect(syncUpdate).toHaveBeenCalledTimes(1)
    expect(syncUpdate.mock.calls[0]?.[1]).toBe(true)
    expect(JSON.parse(platform.kv.get('gym_state_v1')!).active.entries[0].sets[0]).toMatchObject({ sec: 45, done: true })
    expect(platform.kv.get(WORK_KEY)).toBeNull()
    useStore.setState({ update })
  })
  it('aborts black-holed rest booking and cancellation at the legacy 60-second deadline', async () => {
    const platform = createBrowserPlatform()
    const signals: AbortSignal[] = []
    platform.transport = { fetch(_path, init) {
      signals.push(init!.signal as AbortSignal)
      return new Promise<Response>(() => {}) // Hostile transport deliberately ignores abort.
    } }
    useStore.setState({ user: { id: 'synthetic-user' }, S: { ...useStore.getState().S, sound: false } })
    initializeUI({ platform, deviceId: () => 'synthetic-device', notifyRestOver: async () => {} })
    useUI.getState().startRest(90)
    expect(signals).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(59_999)
    expect(signals[0]?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(signals[0]?.aborted).toBe(true)
    useUI.getState().stopRest()
    expect(signals).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(signals[1]?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('uses the injected document for timer visibility, independent of the ambient page', () => {
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    const shellDoc = document.implementation.createHTMLDocument()
    Object.defineProperty(shellDoc, 'hidden', { value: false, configurable: true })
    configureUx({ ...createBrowserUx(), document: shellDoc })
    useStore.setState({ S: { ...useStore.getState().S, sound: false, timerFlash: true } })
    useUI.setState({ timerFlashId: 0 })
    useUI.getState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(useUI.getState().timerFlashId).toBe(1)
  })
})
