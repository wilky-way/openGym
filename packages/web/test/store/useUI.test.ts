const uiState = (): any => useUI.getState()
import { installUIEnvironment } from './environment'
const { api } = vi.hoisted(() => ({ api: vi.fn<(...args: any[]) => Promise<any>>(() => Promise.resolve({ ok: true })) }))
// Ported legacy twin; malformed fixtures intentionally retain tolerant JS shapes.
// @vitest-environment happy-dom
// useUI pulls in api.js, which reads navigator.userAgent at module scope.
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { useUI } from '../../src/store/useUI'
import { useStore } from '../../src/store/useStore'

// "Off" has to hold at the timer itself, not at the four places that start one — the same
// reason the rest-after-a-set rule is a shared condition rather than four copies.
// Inject browser capabilities and pin the clock for every legacy timer case.
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  installUIEnvironment(api)
})

describe('rest timer set to Off', () => {
  beforeEach(() => { vi.useFakeTimers(); useUI.setState({ timer: null }) })
  afterEach(() => { uiState().stopRest(); vi.useRealTimers() })

  it('starts nothing', () => {
    uiState().startRest(0)
    expect(uiState().timer).toBe(null)
  })

  it('stops a rest that is already running', () => {
    uiState().startRest(90)
    expect(uiState().timer).not.toBe(null)
    uiState().startRest(0)
    expect(uiState().timer).toBe(null)
  })

  it('still runs for a real duration', () => {
    uiState().startRest(90)
    expect(uiState().timer.total).toBe(90)
  })

  // A rest that does not start has nothing to run alongside a hold, so it leaves it alone: with
  // the timer Off, ticking a set somewhere must not throw away a plank in progress.
  it('leaves a running hold alone — there is no rest for it to clash with', () => {
    uiState().startWork(45, 'Plank', vi.fn())
    uiState().startRest(0, 1)
    expect(uiState().work).not.toBe(null)
    expect(uiState().work.total).toBe(45)
    uiState().stopWork()
  })
})

describe('opt-in timer screen flash', () => {
  let originalSettings: any

  beforeEach(() => {
    vi.useFakeTimers()
    originalSettings = useStore.getState().S
    useStore.setState({ S: { ...originalSettings, sound: false, timerFlash: false } })
    useUI.setState({ timer: null, work: null, timerFlashId: 0 })
  })

  afterEach(() => {
    uiState().stopRest()
    uiState().stopWork()
    useStore.setState({ S: originalSettings })
    vi.useRealTimers()
  })

  it('stays off unless enabled in Settings', () => {
    uiState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(uiState().timerFlashId).toBe(0)
  })

  it('flashes when the rest timer finishes', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    uiState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(uiState().timerFlashId).toBe(1)
  })

  it('flashes when a timed exercise finishes', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    uiState().startWork(1, 'Plank', vi.fn())
    vi.advanceTimersByTime(1000)
    expect(uiState().timerFlashId).toBe(1)
  })

  const goHidden = () => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
  const goVisible = () => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) }
  afterEach(() => goVisible())   // leave document.hidden the way every other test expects it

  it('does not flash a rest that expires while the app is hidden, even once reopened, but keeps Ready visible', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    uiState().startRest(90)
    goHidden()
    vi.setSystemTime(Date.now() + 91_000)   // deadline passes with no ticks — the app was actually closed/suspended
    goVisible()                             // reopening re-fires visibilitychange, which is how the bug used to trigger
    expect(uiState().timerFlashId).toBe(0)
    expect(uiState().timer).toMatchObject({ left: 0, ready: true })
  })

  it('does not flash a timed exercise that finishes while the app is hidden', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    uiState().startWork(90, 'Plank', vi.fn())
    goHidden()
    vi.setSystemTime(Date.now() + 91_000)
    goVisible()
    expect(uiState().timerFlashId).toBe(0)
    expect(uiState().work).toBe(null)
  })

  it('still flashes a rest that expires normally while the app stays visible', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    uiState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(uiState().timerFlashId).toBe(1)
  })

  // Nothing clears the "the app went away" mark but a tick, so an app switch with no timer
  // running left it set for good and the next timer read it as a catch-up on its very first tick.
  // Only a timer short enough to finish on that first tick can hit it, which is why it went
  // unnoticed: a one-second rest, started on screen and over on screen, ran out in silence.
  it('a hide and a show BEFORE the rest starts is no catch-up: it still flashes', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    goHidden(); goVisible()                 // switched apps and came back, with no timer running
    uiState().startRest(1)
    vi.advanceTimersByTime(1000)
    expect(uiState().timerFlashId).toBe(1)
  })

  it('a hide and a show BEFORE the hold starts is no catch-up: it still flashes', () => {
    useStore.setState({ S: { ...useStore.getState().S, timerFlash: true } })
    goHidden(); goVisible()                 // switched apps and came back, with no timer running
    uiState().startWork(1, 'Plank', vi.fn())
    vi.advanceTimersByTime(1000)
    expect(uiState().timerFlashId).toBe(1)
  })
})

// The rest and the hold mean opposite things and the store has always said so, but only
// startWork enforced it. Ticking a timed set's own checkbox by hand starts a rest
// (Workout.toggle) while the hold is still running, which left both going.
describe('a rest and a hold never run together', () => {
  beforeEach(() => { vi.useFakeTimers(); useUI.setState({ timer: null, work: null }) })
  afterEach(() => {
    uiState().stopRest()
    uiState().stopWork()
    vi.useRealTimers()
  })

  it('a rest starting ends the hold, the way a hold starting ends the rest', () => {
    uiState().startWork(45, 'Plank', vi.fn())
    uiState().startRest(90, 0)
    expect(uiState().work).toBe(null)
    expect(uiState().timer).not.toBe(null)
  })

  it('so a left-over hold cannot reach zero under a running rest and log a set nobody held', () => {
    const holdDone = vi.fn()
    uiState().startWork(30, 'Plank', holdDone)
    vi.advanceTimersByTime(12_000)                    // 12 s of the plank held
    uiState().startRest(90, 1)
    vi.advanceTimersByTime(30_000)                    // past where the hold would have run out
    expect(uiState().timer.left).toBe(60)      // the rest is still counting, untouched
    expect(uiState().work).toBe(null)
    // Once, on the way out, and never again — and with the 12 s it actually held, marked as no
    // finish. The count alone would not say which: a hold left running reaches its own zero and
    // calls back too, with the full 30 s target for a set that stopped being held at 12.
    expect(holdDone).toHaveBeenCalledTimes(1)
    expect(holdDone).toHaveBeenCalledWith(12, { abandoned: true })
  })

  // The hold cannot survive the rest, but the time it held is real: it is handed back on the way
  // out so its own row keeps it. Before this a plank in progress vanished without a trace every
  // time a set was ticked somewhere else — one tap away in the List layout.
  it('the displaced hold hands back what it held, marked as no finish', () => {
    const holdDone = vi.fn()
    uiState().startWork(45, 'Plank', holdDone)
    vi.advanceTimersByTime(18_000)
    uiState().startRest(90, 1)
    expect(uiState().work).toBe(null)
    expect(holdDone).toHaveBeenCalledTimes(1)
    expect(holdDone).toHaveBeenCalledWith(18, { abandoned: true })   // the seconds held, and: abandoned
  })

  it('under two seconds there is nothing to hand back — that was a play button by accident', () => {
    const holdDone = vi.fn()
    uiState().startWork(45, 'Plank', holdDone)
    vi.advanceTimersByTime(1000)
    uiState().startRest(90, 1)
    expect(uiState().work).toBe(null)
    expect(holdDone).not.toHaveBeenCalled()
  })

  it('a hold displaced by another hold hands back what it held too', () => {
    const first = vi.fn()
    uiState().startWork(45, 'Plank', first)
    vi.advanceTimersByTime(18_000)
    uiState().startWork(60, 'Side plank', vi.fn())
    expect(first).toHaveBeenCalledWith(18, { abandoned: true })
    expect(uiState().work.total).toBe(60)
  })

  it('and a rest that never starts hands back nothing, because the hold is still going', () => {
    const holdDone = vi.fn()
    uiState().startWork(45, 'Plank', holdDone)
    vi.advanceTimersByTime(18_000)
    uiState().startRest(0, 1)
    expect(uiState().work).not.toBe(null)
    expect(holdDone).not.toHaveBeenCalled()
  })
})

describe('rest readiness and optional timed-set overtime', () => {
  let originalSettings: any

  beforeEach(() => {
    vi.useFakeTimers()
    originalSettings = useStore.getState().S
    useStore.setState({ S: { ...originalSettings, sound: false, timerFlash: true, timedSetOvertime: false } })
    useUI.setState({ timer: null, work: null, timerFlashId: 0 })
  })

  afterEach(() => {
    uiState().stopRest()
    uiState().stopWork()
    useStore.setState({ S: originalSettings })
    vi.useRealTimers()
  })

  it('keeps Ready and its rest owner until dismissed or restarted', () => {
    uiState().startRest(1, 2)
    vi.advanceTimersByTime(1000)
    vi.advanceTimersByTime(5000)
    expect(uiState().timer).toMatchObject({ left: 0, ready: true, forIdx: 2 })
    uiState().addRest(15)
    expect(uiState().timer).toMatchObject({ left: 15, forIdx: 2 })
    expect(uiState().timer.ready).toBeUndefined()
    uiState().addRest(-15)
    expect(uiState().timer).toBeNull()
  })

  it('keeps an opted-in hold through its deadline and logs actual overtime on Done', () => {
    useStore.setState({ S: { ...useStore.getState().S, timedSetOvertime: true } })
    const done = vi.fn()
    uiState().startWork(2, 'Hold', done)
    vi.advanceTimersByTime(2000)
    const flash = uiState().timerFlashId
    vi.advanceTimersByTime(5000)
    expect(done).not.toHaveBeenCalled()
    expect(uiState().work).toMatchObject({ left: -5, overtime: true, alerted: true })
    expect(uiState().timerFlashId).toBe(flash)
    uiState().finishWorkEarly()
    expect(done).toHaveBeenCalledExactlyOnceWith(7)
  })

  it('caps unattended overtime at 15 minutes and logs it once at the deadline', () => {
    useStore.setState({ S: { ...useStore.getState().S, timedSetOvertime: true } })
    const done = vi.fn()
    uiState().startWork(1, 'Hold', done)
    vi.advanceTimersByTime(901000)
    expect(done).toHaveBeenCalledExactlyOnceWith(901, { chimed: false })
    expect(uiState().work).toBeNull()
  })

  it('cancels an overtime hold without logging and clears its old owner callback', () => {
    useStore.setState({ S: { ...useStore.getState().S, timedSetOvertime: true } })
    const canceled = vi.fn()
    const replacement = vi.fn()
    uiState().startWork(2, 'Canceled', canceled)
    uiState().stopWork()
    uiState().startWork(2, 'Replacement', replacement)
    vi.advanceTimersByTime(2000)
    uiState().stopWork()
    expect(canceled).not.toHaveBeenCalled()
    expect(replacement).not.toHaveBeenCalled()
  })
})

describe('addRest adjustments', () => {
  beforeEach(() => { vi.useFakeTimers(); useUI.setState({ timer: null }) })
  afterEach(() => { uiState().stopRest(); vi.useRealTimers() })

  it('reduces left without shrinking total so progress bar reflects the decrement', () => {
    uiState().startRest(60)
    expect(uiState().timer.left).toBe(60)
    expect(uiState().timer.total).toBe(60)

    uiState().addRest(-15)
    expect(uiState().timer.left).toBe(45)
    expect(uiState().timer.total).toBe(60)
  })

  it('stops timer if subtraction reaches zero or below', () => {
    uiState().startRest(15)
    uiState().addRest(-15)
    expect(uiState().timer).toBe(null)
  })

  it('increases left and keeps total if still within initial total', () => {
    uiState().startRest(60)
    uiState().addRest(-15) // left: 45, total: 60
    uiState().addRest(10)  // left: 55, total: 60
    expect(uiState().timer.left).toBe(55)
    expect(uiState().timer.total).toBe(60)
  })

  it('expands total if time added exceeds the initial total', () => {
    uiState().startRest(60)
    uiState().addRest(15)
    expect(uiState().timer.left).toBe(75)
    expect(uiState().timer.total).toBe(75)
  })
})
