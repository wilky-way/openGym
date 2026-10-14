import { create } from 'zustand'
import type { ReactNode } from 'react'
import type { Platform } from '@opengym/contract/platform/adapters'
import { uid } from '@opengym/core/format'
import { t } from '@opengym/core/i18n-core'
import { beep, chime, vibrate, alertBuzz } from '../lib/sound'
import { restSoundOf } from '../lib/rest-sounds'
import { ux } from '../platform/ux'
import { useStore } from './useStore'
import { REST_MAX } from '../lib/duration'

export interface WorkOwner { idx: number; i: number; id: string }
export interface WorkTimer { left: number; total: number; endsAt: number; label: string; overtime?: boolean; alerted?: boolean; owner?: WorkOwner; context?: string; occurrence?: string }
export interface RestTimer { left: number; total: number; endsAt: number; forIdx?: number; forSet?: number; ready?: boolean; paused?: boolean; kind?: string }
export interface WorkResult { chimed?: boolean; abandoned?: boolean }
export type WorkDone = (elapsed: number, result?: WorkResult) => void
export type SheetRender = (close: () => void) => ReactNode
export interface SheetOptions { kind?: string; locked?: boolean }
export interface ToastOptions { action?: string; onAction?: () => void; ms?: number }
export interface RestOptions { kind?: string; forSet?: number }
export interface UIState {
  programmeShift?: {owner?:string;cycleId: string; notBefore?: string | null; before: import("@opengym/core/programme-engine-types").ProgrammeProjection; [key: string]: unknown} | null
  sheets: { id: string; render: SheetRender; kind: string; locked: boolean }[]
  toastMsg: string
  toastAction: { label: string; run: () => void; id: number } | null
  swipeHint: { idx: number; i: number; id: string } | null
  setFlash: { idx: number; i: number; id: string } | null
  timer: RestTimer | null
  work: WorkTimer | null
  timerFlashId: number
  flashTimer(): void
  openSheet(render: SheetRender, options?: SheetOptions): { id: string; close(): void; lock(v: boolean): void }
  closeSheet(id: string): void
  closeAll(): void
  toast(msg: string, options?: ToastOptions): void
  runToastAction(): void
  pauseToast(): void
  resumeToast(): void
  startRest(sec: number, forIdx?: number, options?: RestOptions): void
  pauseRest(): void
  resumeRest(): void
  addRest(sec: number): void
  shiftRestOwner(at: number, delta: number): void
  stopRest(): void
  startWork(sec: number, label: string, onDone?: WorkDone | null, owner?: WorkOwner | null): void
  bindWork(make: (work: WorkTimer) => WorkDone | null | undefined): void
  refreshWorkOwner?(owner: WorkOwner): void
  finishWorkEarly(): void
  abandonWork(): void
  stopWork(): void
}
type SetUI = (partial: Partial<UIState> | ((s: UIState) => Partial<UIState>)) => void
export interface UIEnvironment { platform: Platform; deviceId(): string | undefined; notifyRestOver(): Promise<void> }
let environment: UIEnvironment | null = null
let detachVisibility: (() => void) | null = null
/** Shell injection is explicit; no storage or DOM reads at import time. */
export function configureUI(next: UIEnvironment): void {
  detachVisibility?.()
  environment = next
  const doc = ux().document
  const onVisibility = () => { if (hidden()) pageHiddenAt = Date.now() }
  doc?.addEventListener('visibilitychange', onVisibility)
  detachVisibility = () => doc?.removeEventListener('visibilitychange', onVisibility)
  pageHiddenAt = hidden() ? Date.now() : null
}
/** Call after initializeStore, before rendering the workout screen. */
export function initializeUI(next: UIEnvironment): void {
  configureUI(next)
  restoreRest()
  restoreWork()
}

// Fire-and-forget: lets the server push a "rest over" alert if this tab gets suspended
// before the local timer completes. No-ops for guests / offline. The device id keeps the
// timer this browser's own: a desktop tab finishing its rest on screen used to cancel the
// alert the phone in the gym was waiting for, because the server held one timer per account.
const pushRestTimer = (sec: number) => { if (useStore.getState().user) sendRest('/api/push/rest-timer', { seconds: sec, deviceId: environment?.deviceId() }) }
const cancelPushRestTimer = () => { if (useStore.getState().user) sendRest('/api/push/rest-timer/cancel', { deviceId: environment?.deviceId() }) }
function sendRest(path: string, body: unknown): void {
  const platform = environment?.platform
  if (!platform) return
  // Legacy api() bounds POSTs, including the response body, at 60 seconds. The browser client's
  // full JSON client is separate; this fire-and-forget path retains that bound.
  const ctl = new AbortController()
  let deadline: ReturnType<typeof setTimeout>
  const expired = new Promise<never>((_, reject) => {
    deadline = setTimeout(() => { ctl.abort(); reject(new Error('Rest push timed out')) }, 60_000)
  })
  const answer = (async () => {
    const response = await platform.transport.fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal })
    return response.json()
  })()
  answer.catch(() => {}) // A transport/body that ignores abort may settle after the deadline.
  void Promise.race([answer, expired]).catch(() => {}).finally(() => clearTimeout(deadline))
}

// Books a server push for rest completion while the browser is backgrounded.
// A switch-sides pause (Workout.jsx SWITCH_SIDES_SEC) books no server push, whose words are "rest over":
// it is ten seconds between the two sides of a hold, and the app is in your hand.
const bookRestEnd = (endsAt: number, totalSec: number, kind?: string) => {
  if (kind !== 'switch') pushRestTimer(Math.max(1, Math.round((endsAt - Date.now()) / 1000)))
}

let pageHiddenAt: number | null = null
const hidden = () => ux().document?.hidden ?? false
const maybeRestNotification = () => { void environment?.notifyRestOver().catch(() => {}) }

let toastTm: ReturnType<typeof setTimeout> | null = null
const TOAST_MS = 2200
const TOAST_ACTION_MS = 5000
let toastLeft = 0
let toastT0 = 0
let toastPaused = false
let toastSeq = 0
const runToast = (set: SetUI) => {
  toastPaused = false
  toastT0 = Date.now()
  if (toastTm) clearTimeout(toastTm)
  toastTm = setTimeout(() => set({ toastMsg: '', toastAction: null }), toastLeft)
}
let timerInt: ReturnType<typeof setInterval> | null = null
let timerTick: (() => void) | null = null
let workInt: ReturnType<typeof setInterval> | null = null
let workTick: (() => void) | null = null
let workDone: WorkDone | null | undefined = null
let handingOffWork = false
const MAX_WORK_OVERTIME_SEC = 15 * 60

// The hold's countdown tick, from a start or from a restore after a reload.
const runWork = (set: SetUI, get: () => UIState) => {
  stopWorkTicking()
  workTick = () => {
    const wk = get().work
    if (!wk) return
    const left = Math.max(wk.overtime ? -MAX_WORK_OVERTIME_SEC : 0, Math.round((wk.endsAt - Date.now()) / 1000))
    const seenLive = !hidden() && pageHiddenAt === null
    if (!hidden()) pageHiddenAt = null
    if (left === wk.left) return
    const { S: st } = useStore.getState()
    const snd = st.sound, endSound = restSoundOf(st)
    if (left <= 0) {
      if (seenLive && !wk.alerted) {
        endTone(snd, endSound)
        alertBuzz([200, 100, 200]); get().flashTimer()
      }
      if (wk.overtime && left > -MAX_WORK_OVERTIME_SEC) { set({ work: { ...wk, left, alerted: true } }); return }
      const done = safeWorkDone(wk)
      handingOffWork = true
      get().stopWork()
      // `chimed` tells the set's own tick that this end has already sounded and buzzed — not
      // so when overtime ran out, whose end chime played when the target was reached.
      try { if (done) done(wk.total - left, { chimed: seenLive && !wk.alerted }) }
      finally { handingOffWork = false; clearHandedOffWork(wk) }
      return
    }
    if (left <= 3) beep(snd, 660, 0.1)
    set({ work: { ...wk, left } })
  }
  workInt = setInterval(workTick, 1000)
  ux().document?.addEventListener('visibilitychange', workTick)
}
const stopWorkTicking = () => {
  if (workInt) clearInterval(workInt); workInt = null
  if (workTick) ux().document?.removeEventListener('visibilitychange', workTick); workTick = null
}
// The set a hold belongs to, while it still is that one: the same exercise at that place in the
// running workout, not ticked off yet.
const workContext = (S = useStore.getState().S) => JSON.stringify([
  useStore.getState().user?.id ?? null, environment?.platform.server.baseUrl() ?? null, useStore.getState().documentInstance ?? null, S.profileId ?? null, S.activeEquipId ?? null,
  S.active ? [S.active.id, S.active.start, S.active.d, S.active.routineId, S.active.editingWorkoutId, S.active.programme?.instanceId] : null,
])
const workOccurrence = (owner?: WorkOwner, S = useStore.getState().S) => {
  const entry = S.active?.entries?.[owner?.idx ?? -1]
  return JSON.stringify([entry?.id, entry?.occurrenceId, entry?.rid, entry?.slotId, entry?.sets?.[owner?.i ?? -1]])
}
const ownerSet = (o?: WorkOwner | null, S = useStore.getState().S) => {
  const e = S?.active?.entries?.[o?.idx ?? -1]
  const st = e && e.id === o?.id ? e.sets?.[o!.i] : null
  return st && !st.done ? st : null
}
// A restored hold that ends before the workout screen is back to bind its handler: the time still
// goes to its set, and a hold that ran out (or got its Done) ticks the set off. No rest follows:
// that is the workout screen's to start, and the hold mostly ended while the app was away.
const ownerDone = (wk: WorkTimer | null): WorkDone | null => !wk?.owner ? null : (elapsed, { abandoned = false } = {}) => {
  if (!ownerSet(wk.owner)) return false
  const { idx, i } = wk.owner!
  const stale = Symbol('stale hold target')
  try { const outcome: unknown = useStore.getState().update(s => {
    if (!workTargetValid(wk,s) || !ownerSet(wk.owner, s)) throw stale
    const st = s.active.entries[idx].sets[i]
    st.sec = elapsed
    if (abandoned) { if (st.planSec == null) st.planSec = wk.total; return }
    delete st.planSec
    if (st.sides) return   // a per-side row is ticked side by side, on the workout screen
    st.done = true
    st.at = Date.now()
  }, true); return outcome !== false } catch (error) {
    if (error !== stale) throw error
    useUI.getState().toast('The account, profile or workout changed. The hold was not logged.')
    return false
  }
}
const safeWorkDone = (wk: WorkTimer) => {
  if ((wk.context !== undefined && wk.context !== workContext()) ||
    (!workDone && wk.occurrence !== undefined && wk.occurrence !== workOccurrence(wk.owner))) {
    useUI.getState().toast('The account, profile or workout changed. The hold was not logged.')
    return null
  }
  return workDone || ownerDone(wk)
}
const stopRestTicking = () => {
  if (timerInt) clearInterval(timerInt); timerInt = null
  if (timerTick) ux().document?.removeEventListener('visibilitychange', timerTick); timerTick = null
}
// The rest countdown's tick, from a start or from a resume: the same endsAt-based count either
// way, so a paused rest carries on exactly as a started one runs.
const runRest = (set: SetUI, get: () => UIState) => {
  stopRestTicking()
  timerTick = () => {
    const tm = get().timer
    if (!tm || tm.ready || tm.paused) return
    const left = Math.max(0, Math.round((tm.endsAt - Date.now()) / 1000))
    const seenLive = !hidden() && pageHiddenAt === null
    if (!hidden()) pageHiddenAt = null
    if (left === tm.left) return
    const { S: st } = useStore.getState()
    const snd = st.sound, endSound = restSoundOf(st)
    if (left <= 0 && tm.kind === 'switch') {
      // Over like a hold is: the chime and its buzz, then the bar goes. No "Ready", no toast:
      // the other side is the next thing, one tap away.
      if (seenLive) { endTone(snd, endSound); alertBuzz([200, 100, 200]); get().flashTimer() }
      stopRestTicking()
      set({ timer: null })
      return
    }
    if (left <= 0) {
      if (seenLive) {
        endTone(snd, endSound)
        alertBuzz([200, 100, 200]); get().flashTimer()
      }
      // The toast stays even when the rest ran out while the app was hidden: a guest, or anyone
      // without push permission, gets no notification, and a countdown that silently vanishes
      // on reopen reads like a bug. Only the loud parts (beep, vibration, flash) are gated.

      get().toast(t('Rest’s over. Next set!'))
      maybeRestNotification()
      cancelPushRestTimer()
      stopRestTicking()
      set({ timer: { ...tm, left: 0, ready: true } })
      return
    }
    if (left <= 3) beep(snd, 660, 0.1)
    set({ timer: { ...tm, left } })
  }
  timerInt = setInterval(timerTick, 1000)
  ux().document?.addEventListener('visibilitychange', timerTick)
}

function endTone(enabled: boolean, kind: string) { chime(enabled, kind) }

export const useUI = create<UIState>((set, get) => ({
  sheets: [],          // { id, render:(close)=>JSX, kind:'sheet'|'center', locked }
  toastMsg: '',
  toastAction: null,   // { label, run, id } while the toast offers an action (Undo)
  swipeHint: null,     // { idx, i, id }: the set row showing the one-time swipe hint (Workout.jsx)
  setFlash: null,      // { idx, i, id }: the set row a copy or an undo just brought, flashed once
  timer: null,         // rest countdown between sets — { left, total, endsAt, forIdx, ready?, paused?, kind? }
                       // kind: 'switch' for the short pause between the two sides of a timed set
                       // forIdx: index of the active entry whose set started the rest (undefined when unknown)
                       // forSet: index of that set in the entry's rows, so removing the set stops its rest
                       // paused: held at `left`; `endsAt` means nothing until resumeRest sets it again
  work: null,          // work countdown DURING a timed set (issue #16) — { left, total, endsAt, label, overtime? }
  timerFlashId: 0,     // changing the id retriggers the theme-blink visual alert

  flashTimer() {
    if (!useStore.getState().S.timerFlash) return
    set(s => ({ timerFlashId: s.timerFlashId + 1 }))
  },

  openSheet(render: SheetRender, { kind = 'sheet', locked = false }: SheetOptions = {}) {
    const id = uid()
    set(s => ({ sheets: [...s.sheets, { id, render, kind, locked }] }))
    const close = () => get().closeSheet(id)
    return { id, close, lock: v => set(s => ({ sheets: s.sheets.map(x => x.id === id ? { ...x, locked: v } : x) })) }
  },
  closeSheet(id: string) { set(s => ({ sheets: s.sheets.filter(x => x.id !== id) })) },
  closeAll() { set({ sheets: [] }) },

  // A toast is 2.2 s of text. With an action (`{ action: 'Undo', onAction }`) it stays 5 s, shows
  // the action as a button at its end and holds still while a finger rests on it (pauseToast). A
  // new toast replaces the one showing, action and all: the old Undo is gone, what it would have
  // undone stays done. The action runs once at most, and the toast goes with it.
  toast(msg: string, { action, onAction, ms }: ToastOptions = {}) {
    const withAction = !!(action && typeof onAction === 'function')
    if (toastTm) clearTimeout(toastTm)
    toastLeft = ms || (withAction ? TOAST_ACTION_MS : TOAST_MS)
    toastSeq += 1
    set({ toastMsg: msg, toastAction: withAction ? { label: action, run: onAction, id: toastSeq } : null })
    runToast(set)
  },
  runToastAction() {
    const act = get().toastAction
    if (!act) return
    if (toastTm) clearTimeout(toastTm)
    set({ toastMsg: '', toastAction: null })
    act.run()
  },
  pauseToast() {
    if (!get().toastAction || toastPaused) return
    toastPaused = true
    if (toastTm) clearTimeout(toastTm)
    toastLeft = Math.max(400, toastLeft - (Date.now() - toastT0))
  },
  resumeToast() {
    if (!toastPaused) return
    toastPaused = false
    if (get().toastMsg) runToast(set)
  },

  startRest(sec: number, forIdx?: number, { kind, forSet }: RestOptions = {}) {
    get().stopRest()
    // Rest timer set to Off. Stopping and returning rather than starting a zero-length timer
    // keeps every caller honest: the four places that start a rest do not each need to know.
    if (!(sec > 0)) return
    // And the hold, the other way round from startWork: the two must never run together (see the
    // work timer below). A set ticked by hand while its hold ran used to leave both going — the
    // rest bar with its Skip and ±15 s hidden behind the hold bar, and then the hold reaching
    // zero under a rest that was still counting down, beeping its own end and logging the full
    // target for a set nobody was holding any more. Below the guard, not above it: a rest that
    // does not start has nothing to run alongside the hold, and taking the hold down for it
    // would throw away a plank in progress for nothing. What it held is kept either way —
    // abandonWork, not stopWork.
    get().abandonWork()
    // Nothing clears pageHiddenAt but a tick, so an app switch with no timer running left it set
    // for good. The next timer's first tick then read it as "this countdown ran out while the app
    // was away" and finished in silence — a one-second rest, started on screen, over on screen,
    // with no beep, no vibration and no flash. Each timer starts from where the page is now.
    pageHiddenAt = hidden() ? Date.now() : null
    const endsAt = Date.now() + sec * 1000
    set({ timer: { left: sec, total: sec, endsAt, forIdx, ...(forSet != null ? { forSet } : {}), ...(kind === 'switch' ? { kind } : {}) } })
    bookRestEnd(endsAt, sec, kind)
    runRest(set, get)
  },
  // Holding the rest where it is — a longer break than planned, a machine to wait for, a phone
  // call (#193). Paused time does not count: the countdown stops, and so does everything that
  // would announce its end — the server's push and the alert this tab shows are cancelled, not
  // left to fire at the old time. The timed hold is a separate timer.
  pauseRest() {
    const tm = get().timer
    if (!tm || tm.ready || tm.paused) return
    stopRestTicking()
    cancelPushRestTimer()
    const left = Math.max(1, Math.round((tm.endsAt - Date.now()) / 1000))

    set({ timer: { ...tm, left, paused: true } })
  },
  // Carrying on from where the pause held it: the end moves out by however long the pause was,
  // and the push that announces it is booked again for the new time.
  resumeRest() {
    const tm = get().timer
    if (!tm?.paused) return
    const { paused, ...rest } = tm
    // As in startRest: the page may have been hidden and shown while paused, and that is no
    // catch-up of a countdown that was not running.
    pageHiddenAt = hidden() ? Date.now() : null
    const endsAt = Date.now() + tm.left * 1000
    set({ timer: { ...rest, endsAt } })
    bookRestEnd(endsAt, tm.total, tm.kind)
    runRest(set, get)
  },
  addRest(sec: number) {
    const tm = get().timer
    if (!tm) return
    if (tm.ready) { if (sec > 0) get().startRest(Math.min(sec, REST_MAX), tm.forIdx, { forSet: tm.forSet }); else get().stopRest(); return }
    // +15 s stops where the wheel does (15:00), so the two never disagree about a rest's length.
    if (sec > 0) sec = Math.min(sec, Math.max(0, REST_MAX - tm.left))
    if (!sec) return
    const left = tm.left + sec
    // taking off more than is left means "I'm ready now" — same as skipping, and it keeps a
    // negative duration out of both the progress bar and the server-side push schedule
    if (left <= 0) { get().stopRest(); return }
    const total = Math.max(tm.total || left, left)
    // Paused, there is no end to move and nothing booked on the server: the time is simply held,
    if (tm.paused) { set({ timer: { ...tm, left, total } }); return }
    const endsAt = tm.endsAt + sec * 1000
    set({ timer: { ...tm, left, total, endsAt } })
    bookRestEnd(endsAt, total, tm.kind)
  },
  // The active list changed shape (an exercise removed or inserted at `at`): keep the rest
  // pointing at the same exercise. Returns nothing; the caller decides whether to stop instead.
  shiftRestOwner(at: number, delta: number) {
    const tm = get().timer
    if (!tm || !(tm.forIdx != null && tm.forIdx >= at)) return
    set({ timer: { ...tm, forIdx: tm.forIdx! + delta } })
  },

  stopRest() {
    stopRestTicking()

    if (get().timer) cancelPushRestTimer()
    set({ timer: null })
  },

  /* ---- work timer (issue #16) ----
     Times the set itself, not the recovery after it. Kept separate from the rest timer on
     purpose: the two mean opposite things, they must never run together, and a work set is
     something you are watching — so it gets no server push (that endpoint says "rest over",
     and a plank does not need a notification you are staring at anyway).
     `onDone(elapsedSec, { chimed, abandoned })` is called both when the countdown reaches zero and
     on an early finish; the elapsed time is what actually gets logged, so stopping at 0:38 of a
     0:45 hold records 0:38 rather than crediting the full target. `chimed` is true when the
     countdown ran out in front of you and the end chime and buzz have just played; `abandoned`
     when a rest displaced the hold (abandonWork).
     `owner` ({ idx, i, id }: the active entry and set being held) lets a hold outlive a reload or
     the app being killed (restoreWork below). onDone is a closure and cannot be kept, so the owner
     says where the time goes, and the workout screen binds its handler again (bindWork). */
  startWork(sec: number, label: string, onDone?: WorkDone | null, owner: WorkOwner | null = null) {
    get().abandonWork()   // a hold this one replaces keeps what it held, same as a rest replacing one
    get().stopRest()
    const total = Math.max(1, Math.round(sec) || 1)
    const endsAt = Date.now() + total * 1000
    workDone = onDone
    pageHiddenAt = hidden() ? Date.now() : null   // see startRest: a stale hide is not a catch-up
    set({ work: { left: total, total, endsAt, label, context: workContext(), overtime: useStore.getState().S.timedSetOvertime === true, ...(owner ? { owner, occurrence: workOccurrence(owner) } : {}) } })
    runWork(set, get)
  },
  // The workout screen, back on a hold restored after a reload: `make(work)` gives it the handler
  // its own start would have. Nothing to do for a hold that has one, or whose set is gone.
  bindWork(make: (work: WorkTimer) => WorkDone | null | undefined) {
    const wk = get().work
    if (!wk?.owner || workDone || !ownerSet(wk.owner)) return
    workDone = make(wk)
  },
  refreshWorkOwner(owner: WorkOwner) {
    const wk = get().work
    if (!wk || (wk.context !== undefined && wk.context !== workContext())) return
    set({work:{...wk,owner,occurrence:workOccurrence(owner)}})
  },
  // Ended the hold early — log what was actually held.
  finishWorkEarly() {
    const wk = get().work
    if (!wk) return
    const startedAt = wk.endsAt - wk.total * 1000
    const elapsed = Math.max(1, Math.min(wk.total + (wk.overtime ? MAX_WORK_OVERTIME_SEC : 0), Math.round((Date.now() - startedAt) / 1000)))
    const done = safeWorkDone(wk)
    vibrate(30)
    handingOffWork = true
    get().stopWork()
    try { if (done) done(elapsed) }
    finally { handingOffWork = false; clearHandedOffWork(wk) }
  },
  // A rest is starting while a hold runs that is not the one being ticked — a set finished on
  // another row, or on another exercise, which the List layout puts one tap away. The hold cannot
  // survive (the two must never run together) but the time it held is real, so it is handed back
  // before it goes and its own row keeps it. The `abandoned` flag tells the owner this was not a
  // finish: the row is not ticked off and earns no rest of its own, since the rest that displaced
  // the hold is the one now running.
  abandonWork() {
    const wk = get().work
    if (!wk) { get().stopWork(); return }
    const elapsed = wk.total - wk.left
    const done = safeWorkDone(wk)
    handingOffWork = elapsed >= 2
    get().stopWork()
    // Under two seconds there is nothing to keep: that is a play button tapped by accident, or
    // tapped and thought better of, and rounding it up to one second the way an early finish does
    // would write a one-second plank over a real plan. (finishWorkEarly's Math.max(1, …) is right
    // for what it is: you pressed Done, so you held it, however briefly.)
    try { if (done && elapsed >= 2) done(elapsed, { abandoned: true }) }
    finally { handingOffWork = false; if (elapsed >= 2) clearHandedOffWork(wk) }
  },
  // Abandon without logging anything.
  stopWork() {
    stopWorkTicking()
    workDone = null
    set({ work: null })
  }
}))

// A reload in the middle of a rest (pull to refresh, a WebView restart, an update) used to drop
// the countdown while its alarm still rang later. The rest lives on in localStorage and comes
// back at boot while its end is still ahead, held if it was paused. Not sessionStorage: that
// dies with the process, and Android killing the app mid-rest (or iOS dropping the home-screen
// app) took the bar with it. On the web its end was booked when it started (the server's push,
// per device, which survives the reload), so it is not booked again: the alert fires once, and
// the bar's own tick at zero calls the push off as it always does. In the app the countdown
// notification lives in the app's process and may be gone with it, so the end is booked again
// there: the alarm has a fixed id and the new booking replaces the old one, it never adds a second.
// A rest that ended meanwhile, or one left with no session running, is dropped.
export const REST_KEY = 'gym_rest'
const restStore = () => environment?.platform.kv ?? null
const writeTimerRecord = (key: string, value: string | null, valid?: (draft: import('./useStore').StoreDocument)=>boolean, expected?: string | null) => {
  const persist = useStore.getState().persistTimerRecord
  if (typeof persist === 'function') return persist(key,value,valid,expected)
  // Isolated UI fixtures can run without sync store; production installs it before UI.
  const kv = restStore()
  if (!kv || (expected !== undefined && kv.get(key) !== expected)) return false
  if (value === null) kv.remove(key); else kv.set(key,value)
  return true
}
const saveRest = (tm: RestTimer | null) => {
  const ss = restStore()
  if (!ss) return
  try {
    if (!tm || tm.ready) writeTimerRecord(REST_KEY,null)
    else writeTimerRecord(REST_KEY, JSON.stringify({ endsAt: tm.endsAt, total: tm.total, forIdx: tm.forIdx ?? null, forSet: tm.forSet ?? null, kind: tm.kind || null, paused: !!tm.paused, left: tm.left }))
  } catch { /* the rest just does not outlive a reload */ }
}
export function restoreRest(now = Date.now()) {
  const ss = restStore()
  let saved = null
  try { saved = JSON.parse(ss?.get(REST_KEY) || 'null') } catch { saved = null }
  if (!saved || useUI.getState().timer) return false
  const total = Math.round(Number(saved.total))
  const ok = useStore.getState().S?.active && total > 0 && (saved.paused ? saved.left > 0 : saved.endsAt > now)
  if (!ok) { try { writeTimerRecord(REST_KEY,null) } catch { /* nothing to drop */ } return false }
  const base = { total, forIdx: saved.forIdx ?? undefined, ...(saved.forSet != null ? { forSet: saved.forSet } : {}), ...(saved.kind === 'switch' ? { kind: 'switch' } : {}) }
  if (saved.paused) {
    useUI.setState({ timer: { ...base, left: Math.round(saved.left), endsAt: saved.endsAt, paused: true } })

    return true
  }
  pageHiddenAt = hidden() ? now : null
  useUI.setState({ timer: { ...base, left: Math.max(1, Math.round((saved.endsAt - now) / 1000)), endsAt: saved.endsAt } })

  runRest(useUI.setState, useUI.getState)
  return true
}
useUI.subscribe((s, prev) => { if (s.timer !== prev.timer) saveRest(s.timer) })

// The hold (a timed set) the same way: a reload or the app being killed mid-plank used to drop
// the bar and the seconds with it. Kept beside the rest, with the set it belongs to (`owner`);
// at boot it carries on while its end is ahead, and one that ended meanwhile is written to its set
// as held to the end. The workout screen binds its own handler again (bindWork), and until it
// does the time still lands on the set (ownerDone). Only the start, total and owner are kept:
// the tick reads `endsAt`, so what it shows after the reload is what the clock says.
export const WORK_KEY = 'gym_work'
const workRecord = (wk: WorkTimer) => JSON.stringify({ endsAt: wk.endsAt, total: wk.total, label: wk.label || '', overtime: !!wk.overtime, alerted: !!wk.alerted, owner: wk.owner, ...(wk.context !== undefined ? {context:wk.context} : {}), ...(wk.occurrence !== undefined ? {occurrence:wk.occurrence} : {}) })
const workTargetValid = (wk: WorkTimer, draft = useStore.getState().S) => {
  const matches = (s: import('./useStore').StoreDocument) =>
    (wk.context === undefined || wk.context === workContext(s)) &&
    (wk.occurrence === undefined || wk.occurrence === workOccurrence(wk.owner,s))
  if (!matches(draft)) return false
  if (typeof useStore.getState().persistTimerRecord !== 'function') return true
  try { const saved = JSON.parse(restStore()?.get('gym_state_v1') || 'null'); return !!saved && matches(saved) } catch { return false }
}
const clearHandedOffWork = (wk: WorkTimer, expected = workRecord(wk)) => {
  if (!wk.owner) return
  // A failed workout save must keep the only durable elapsed-time record.
  try {
    if (restStore()?.get(WORK_KEY) !== expected) return
    if (typeof useStore.getState().persistTimerRecord === 'function' && restStore()?.get('gym_state_v1') !== JSON.stringify(useStore.getState().S)) return
    writeTimerRecord(WORK_KEY,null,draft => wk.context === undefined || wk.context === workContext(draft),expected)
  } catch { /* keep the record for recovery */ }
}
const saveWork = (wk: WorkTimer | null, previous?: WorkTimer | null) => {
  const ls = restStore()
  if (!ls) return
  if (!wk && handingOffWork) return
  try {
    if (!wk?.owner) writeTimerRecord(WORK_KEY,null,draft => !previous?.context || previous.context === workContext(draft),previous?.owner ? workRecord(previous) : undefined)
    else writeTimerRecord(WORK_KEY,workRecord(wk),draft => workTargetValid(wk,draft))
  } catch { /* the hold just does not outlive a reload */ }
}
export function restoreWork(now = Date.now()) {
  const ls = restStore()
  let saved = null, raw: string | null = null
  try { raw = ls?.get(WORK_KEY) ?? null; saved = JSON.parse(raw || 'null') } catch { saved = null }
  if (!saved || useUI.getState().work) return false
  const total = Math.round(Number(saved.total))
  const drop = () => { try { writeTimerRecord(WORK_KEY,null,undefined,raw) } catch { /* nothing to drop */ } return false }
  if (typeof saved.context !== 'string' || !(total > 0) || !(saved.endsAt > 0) || !ownerSet(saved.owner)) return drop()
  if (!workTargetValid(saved) ||
    (saved.context === undefined && (useStore.getState().user || ls?.get('gym_owner')))) {
    useUI.getState().toast('The account, profile or workout changed. The hold was not logged.')
    return false
  }
  const wk = { left: total, total, endsAt: saved.endsAt, label: saved.label || '', overtime: !!saved.overtime, ...(saved.alerted ? { alerted: true } : {}), owner: saved.owner, context: saved.context ?? workContext(), occurrence: saved.occurrence ?? workOccurrence(saved.owner) }
  const left = Math.round((saved.endsAt - now) / 1000)
  // Over while the app was away: held to the end (overtime past the target is not known, and
  // the target is what was planned), with no chime for an end nobody was there for.
  if (left <= 0 && !(wk.overtime && left > -MAX_WORK_OVERTIME_SEC)) {
    const applied: unknown = ownerDone(wk)?.(total)
    clearHandedOffWork(wk, raw ?? undefined)
    return applied !== false
  }
  pageHiddenAt = hidden() ? now : null
  useUI.setState({ work: { ...wk, left, ...(left <= 0 ? { alerted: true } : {}) } })
  runWork(useUI.setState, useUI.getState)
  return true
}
useUI.subscribe((s, prev) => { if (s.work !== prev.work && (!s.work || !prev.work || s.work.owner !== prev.work.owner || s.work.endsAt !== prev.work.endsAt || s.work.alerted !== prev.work.alerted)) saveWork(s.work,prev.work) })
