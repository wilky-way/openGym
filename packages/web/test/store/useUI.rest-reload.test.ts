const uiState = (): any => useUI.getState()
import { installUIEnvironment } from './environment'
const { api } = vi.hoisted(() => ({ api: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({ ok: true })) }))
// Ported legacy twin; malformed fixtures intentionally retain tolerant JS shapes.
// @vitest-environment happy-dom
// A reload mid-rest keeps the countdown (v1.3.11): the rest is kept in localStorage (not sessionStorage, which dies with the app process) and comes
// back at boot while its end is ahead, without booking its end a second time.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

const { chime } = vi.hoisted(() => ({ chime: vi.fn() }))
vi.mock('../../src/lib/sound', () => ({ beep: vi.fn(), chime, vibrate: vi.fn(), alertBuzz: vi.fn() }))


import { useUI, restoreRest, REST_KEY } from '../../src/store/useUI'
import { useStore } from '../../src/store/useStore'

const saved = () => JSON.parse(localStorage.getItem(REST_KEY) || 'null')
const pushes = () => api.mock.calls.filter(([p]) => p === '/api/push/rest-timer')

// Inject browser capabilities and pin the clock for every legacy timer case.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  installUIEnvironment(api)
})

describe('the rest timer across a reload', () => {
  let original: any
  beforeEach(() => {
    vi.useFakeTimers()
    original = { S: useStore.getState().S, user: useStore.getState().user }
    useStore.setState({ S: { ...original.S, sound: true, active: { id: 'a', entries: [] } }, user: { id: 'u1' } })
    useUI.setState({ timer: null, work: null, toastMsg: '' })
    localStorage.clear()
    api.mockClear(); chime.mockClear()
  })
  afterEach(() => {
    uiState().stopRest()
    useStore.setState(original)
    vi.useRealTimers()
  })

  it('keeps the running rest, and forgets it once it is skipped', () => {
    uiState().startRest(90, 2)
    expect(saved()).toMatchObject({ total: 90, forIdx: 2, paused: false, kind: null })
    expect(saved().endsAt).toBe(uiState().timer.endsAt)
    uiState().pauseRest()
    expect(saved()).toMatchObject({ paused: true, left: 90 })
    uiState().stopRest()
    expect(saved()).toBeNull()
  })

  it('comes back at boot with the time left, books nothing new, and chimes once at the end', () => {
    const endsAt = Date.now() + 40_000
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt, total: 90, forIdx: 1, kind: null, paused: false, left: 50 }))
    expect(restoreRest()).toBe(true)
    expect(uiState().timer).toMatchObject({ left: 40, total: 90, endsAt, forIdx: 1 })
    expect(pushes()).toEqual([])
    vi.advanceTimersByTime(41_000)
    expect(uiState().timer).toMatchObject({ ready: true, left: 0 })
    expect(chime).toHaveBeenCalledTimes(1)
    expect(saved()).toBeNull()
  })

  it('a paused rest comes back held', () => {
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() - 5000, total: 90, forIdx: 0, kind: null, paused: true, left: 33 }))
    expect(restoreRest()).toBe(true)
    expect(uiState().timer).toMatchObject({ left: 33, total: 90, paused: true })
    vi.advanceTimersByTime(60_000)
    expect(uiState().timer.left).toBe(33)
  })

  it('a rest that ended meanwhile, or one with no session running, is dropped', () => {
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() - 1, total: 90, forIdx: 0, paused: false, left: 3 }))
    expect(restoreRest()).toBe(false)
    expect(uiState().timer).toBeNull()
    expect(saved()).toBeNull()
    useStore.setState({ S: { ...useStore.getState().S, active: null } })
    localStorage.setItem(REST_KEY, JSON.stringify({ endsAt: Date.now() + 30_000, total: 90, forIdx: 0, paused: false, left: 30 }))
    expect(restoreRest()).toBe(false)
    expect(uiState().timer).toBeNull()
  })
})
