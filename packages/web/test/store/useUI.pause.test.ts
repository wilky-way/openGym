const uiState = (): any => useUI.getState()
import { installUIEnvironment } from './environment'
const { api } = vi.hoisted(() => ({ api: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({ ok: true })) }))
// Ported legacy twin; malformed fixtures intentionally retain tolerant JS shapes.
// @vitest-environment happy-dom
// Pausing the rest between sets (#193): paused time does not count, nothing announces the end at
// the old time, and resuming books the push again for the new one. The timed hold is its own timer.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

const { beep, chime } = vi.hoisted(() => ({ beep: vi.fn(), chime: vi.fn() }))
vi.mock('../../src/lib/sound', () => ({ beep, chime, vibrate: vi.fn(), alertBuzz: vi.fn() }))


import { useUI } from '../../src/store/useUI'
import { useStore } from '../../src/store/useStore'

const posts = (path: string) => api.mock.calls.filter(([p]) => p === path).map(([, o]) => JSON.parse(o.body))

// Inject browser capabilities and pin the clock for every legacy timer case.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  installUIEnvironment(api)
})

describe('pausing the rest timer', () => {
  let original: any
  beforeEach(() => {
    vi.useFakeTimers()
    original = { S: useStore.getState().S, user: useStore.getState().user }
    useStore.setState({ S: { ...original.S, sound: true, timerFlash: true }, user: { id: 'u1' } })
    useUI.setState({ timer: null, work: null, timerFlashId: 0, toastMsg: '' })
    api.mockClear()
    beep.mockClear()
    chime.mockClear()
  })
  afterEach(() => {
    uiState().stopRest()
    uiState().stopWork()
    useStore.setState(original)
    vi.useRealTimers()
  })

  it('holds the time left while paused and runs it out after resuming', () => {
    uiState().startRest(90, 1)
    vi.advanceTimersByTime(30000)
    uiState().pauseRest()
    expect(uiState().timer).toMatchObject({ left: 60, total: 90, paused: true, forIdx: 1 })

    vi.advanceTimersByTime(10 * 60000)   // a phone call
    expect(uiState().timer).toMatchObject({ left: 60, paused: true })
    expect(uiState().timer.ready).toBeUndefined()
    expect(beep).not.toHaveBeenCalled()
    expect(chime).not.toHaveBeenCalled()
    expect(uiState().toastMsg).toBe('')

    uiState().resumeRest()
    expect(uiState().timer.paused).toBeUndefined()
    vi.advanceTimersByTime(59000)
    expect(uiState().timer).toMatchObject({ left: 1 })
    vi.advanceTimersByTime(1000)
    expect(uiState().timer).toMatchObject({ left: 0, ready: true, forIdx: 1 })
    expect(uiState().timerFlashId).toBe(1)   // ended on screen: the usual alert
    expect(chime).toHaveBeenCalledTimes(1)
  })

  it('cancels the push booked for the old end and books it again on resume', () => {
    uiState().startRest(90)
    expect(posts('/api/push/rest-timer').map(b => b.seconds)).toEqual([90])
    vi.advanceTimersByTime(20000)
    uiState().pauseRest()
    expect(posts('/api/push/rest-timer/cancel')).toHaveLength(1)
    vi.advanceTimersByTime(60000)
    uiState().resumeRest()
    expect(posts('/api/push/rest-timer').map(b => b.seconds)).toEqual([90, 70])
  })

  it('adds and takes off time while paused without booking anything', () => {
    uiState().startRest(60)
    uiState().pauseRest()
    api.mockClear()
    uiState().addRest(15)
    expect(uiState().timer).toMatchObject({ left: 75, total: 75, paused: true })
    expect(api).not.toHaveBeenCalled()
    uiState().addRest(-90)
    expect(uiState().timer).toBeNull()
  })

  it('has nothing to pause once the rest is over, and nothing to resume while it runs', () => {
    uiState().startRest(1)
    vi.advanceTimersByTime(1000)
    uiState().pauseRest()
    expect(uiState().timer).toMatchObject({ ready: true })
    expect(uiState().timer.paused).toBeUndefined()

    uiState().startRest(30)
    const running = uiState().timer
    uiState().resumeRest()
    expect(uiState().timer).toBe(running)
  })

  it('a set finished while paused starts its own rest, running', () => {
    uiState().startRest(90, 0)
    uiState().pauseRest()
    uiState().startRest(60, 2)
    expect(uiState().timer).toMatchObject({ left: 60, forIdx: 2 })
    expect(uiState().timer.paused).toBeUndefined()
    vi.advanceTimersByTime(10000)
    expect(uiState().timer.left).toBe(50)
  })

  it('leaves the timed hold alone: pausing is the rest\'s alone, and a hold still ends a paused rest', () => {
    const done = vi.fn()
    uiState().startWork(45, 'Plank', done)
    uiState().pauseRest()
    vi.advanceTimersByTime(5000)
    expect(uiState().work).toMatchObject({ left: 40 })
    expect(uiState().work.paused).toBeUndefined()
    uiState().stopWork()

    uiState().startRest(90)
    uiState().pauseRest()
    uiState().startWork(30, 'Plank', done)
    expect(uiState().timer).toBeNull()
    vi.advanceTimersByTime(30000)
    expect(done).toHaveBeenCalledExactlyOnceWith(30, { chimed: true })
  })
})
