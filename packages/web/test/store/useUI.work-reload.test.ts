const uiState = (): any => useUI.getState()
import { installUIEnvironment } from './environment'
const { api } = vi.hoisted(() => ({ api: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({ ok: true })) }))
// Ported legacy twin; malformed fixtures intentionally retain tolerant JS shapes.
// @vitest-environment happy-dom
// A reload or the app being killed mid-hold (a timed set, a plank) used to drop the bar and the
// seconds with it. The hold is kept with the set it belongs to, carries on after the reload, and
// one that ended while the app was away is written to its set as held to the end.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../src/lib/sound', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))

import { useUI, restoreWork, WORK_KEY } from '../../src/store/useUI'
import { useStore } from '../../src/store/useStore'

const saved = () => JSON.parse(localStorage.getItem(WORK_KEY) || 'null')
const plankSet = () => useStore.getState().S.active.entries[1].sets[0]
const owner = { idx: 1, i: 0, id: 'plank' }

// Inject browser capabilities and pin the clock for every legacy timer case.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  installUIEnvironment(api)
})

let proof: any
const identified = (value: any) => ({...proof,...value})
let original: any
beforeEach(() => {
  vi.useFakeTimers()
  original = useStore.getState().S
  useStore.setState({ S: { ...original, sound: true, active: { id: 'a', entries: [
    { id: 'squat', sets: [{ w: 100, r: 5 }] },
    { id: 'plank', sets: [{ sec: 45 }, { sec: 45 }] },
  ] } } })
  useUI.setState({ timer: null, work: null })
  localStorage.clear()
  uiState().startWork(45,'Plank',null,owner)
  proof = saved()
  uiState().stopWork()
})
afterEach(() => {
  uiState().stopWork()
  uiState().stopRest()
  useStore.setState({ S: original })
  vi.useRealTimers()
})

describe('a hold across a reload', () => {
  it('is kept with its set while it runs, and forgotten once it ends', () => {
    const done = vi.fn()
    uiState().startWork(45, 'Plank', done, owner)
    expect(saved()).toMatchObject({ total: 45, label: 'Plank', owner })
    uiState().finishWorkEarly()
    expect(done).toHaveBeenCalled()
    expect(saved()).toBeNull()
  })

  it('a hold without an owner is not kept', () => {
    uiState().startWork(45, 'Plank', vi.fn())
    expect(saved()).toBeNull()
  })

  it('carries on after the reload, and the time lands on its set even before the screen is back', () => {
    const endsAt = Date.now() + 42_000
    localStorage.setItem(WORK_KEY, JSON.stringify(identified({ endsAt, total: 45, label: 'Plank', overtime: false, owner })))
    expect(restoreWork()).toBe(true)
    expect(uiState().work).toMatchObject({ left: 42, total: 45, label: 'Plank', owner })
    vi.advanceTimersByTime(43_000)
    expect(uiState().work).toBeNull()
    expect(plankSet()).toMatchObject({ sec: 45, done: true })
    expect(saved()).toBeNull()
  })

  it('the workout screen binds its own handler again, and Done goes to it', () => {
    localStorage.setItem(WORK_KEY, JSON.stringify(identified({ endsAt: Date.now() + 40_000, total: 45, label: 'Plank', overtime: false, owner })))
    restoreWork()
    const handler = vi.fn()
    uiState().bindWork((wk: any) => { expect(wk.owner).toEqual(owner); return handler })
    vi.advanceTimersByTime(10_000)
    uiState().finishWorkEarly()
    expect(handler).toHaveBeenCalledWith(15)
    expect(plankSet().done).toBeUndefined()   // the screen's handler ticks it, not the fallback
  })

  it('one that ended while the app was away is written as held to the end', () => {
    localStorage.setItem(WORK_KEY, JSON.stringify(identified({ endsAt: Date.now() - 5_000, total: 45, label: 'Plank', overtime: false, owner })))
    expect(restoreWork()).toBe(true)
    expect(uiState().work).toBeNull()
    expect(plankSet()).toMatchObject({ sec: 45, done: true })
    expect(saved()).toBeNull()
  })

  it('is dropped when its set is gone or already ticked', () => {
    localStorage.setItem(WORK_KEY, JSON.stringify(identified({ endsAt: Date.now() + 30_000, total: 45, label: 'Plank', overtime: false, owner: { idx: 0, i: 0, id: 'plank' } })))
    expect(restoreWork()).toBe(false)
    expect(uiState().work).toBeNull()
    expect(saved()).toBeNull()
    useStore.getState().update(s => { s.active.entries[1].sets[0].done = true }, false)
    localStorage.setItem(WORK_KEY, JSON.stringify(identified({ endsAt: Date.now() + 30_000, total: 45, label: 'Plank', overtime: false, owner })))
    expect(restoreWork()).toBe(false)
  })
})
