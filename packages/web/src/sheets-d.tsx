import { closeTrainingLocally } from './lib/training-close'
import { buildBackfillSession, fileBackfillWorkout } from '../../core/src/past-workout'
import { guardedStoreUpdate, abortGuardedUpdate } from './lib/guarded-update'
import { captureSheetTarget, type SheetTarget as ContextTarget } from './lib/sheet-target'
import { useState, useEffect, useRef } from 'react'
import { useStore, type StoreDocument } from './store/useStore'
import { useUI } from './store/useUI'
import { createExerciseIndex, exOr, isCustomEx, beatsWeight, betterWeight } from '@opengym/core/exercises'
import { todayISO, isoOf, fmtDate, fmtNum, fmtDur, fmtVol, uid, exCount, setsWorkCount } from '@opengym/core/format'
import { bestWeightFor, bestWeightForEntry, workoutVolume, setsDone, setsDoneActive, setUnitsTotal, setLabel, workSetsDone, NOTE_MAX } from '@opengym/core/history'
import { t, tn, exerciseNameFor, exerciseNameClass } from './lib/i18n'
import { nav, closeThenNav, navToWorkout } from './lib/nav'
import { beep } from './lib/sound'
import { SG_NAME_MAX } from '@opengym/core/superset-meta'
import { REST_MAX, fmtRest } from './lib/duration'
import Icon from './components/Icon'
import { Button, Switch, SelectRow, Row, Stepper } from './components/ui'
import { durationSheet } from './components/DurationWheel'
import { glyphOf } from './lib/glyphs'
import BodyMap from './components/BodyMap'
import { exerciseMuscleSnapshot, loadOfWorkouts } from '@opengym/core/muscles'
import { is1RMRecord } from '@opengym/core/onerm'
import { entryDbLoad } from '@opengym/core/dumbbells'
import { speedUnitOf } from '@opengym/core/speed'
import { buildCompletedWorkout, sessionEnd } from '@opengym/core/finish-workout'
import { refillAfter } from '@opengym/core/rotation'
import { isWarmupRow } from '@opengym/core/workout-model'
import { repeatSessionEntries } from '@opengym/core/session-repeat'
import { useSheetKeyboard, tappable } from './lib/use-sheet-keyboard'
import { buildSessionEntries, programmeInstanceFor } from '@opengym/core/session-start'
import { finishCompare, finishCardio } from '@opengym/core/finish-compare'
import { joinSessionNoProg } from '@opengym/core/session-noprog'
import { buildCombinedEntries, deriveSessionName, requireProgrammeStart } from '@opengym/core/session-merge'
import { workoutsOn, sessionHistory } from '@opengym/core/backfill'
import { MAX_DURATION_MIN, endsInFuture } from '@opengym/core/workout-date'
import { editLeftEmpty, editChangesNothing, saveWorkoutEdit, deleteEditedWorkout } from '@opengym/core/session-edit'
import type { ReactNode } from 'react'
export interface ConfirmOptions {
  title?: string; message?: ReactNode; confirmText?: string; cancelText?: string; danger?: boolean;
  locked?: boolean; onConfirm?: () => void; onCancel?: () => void
}
export interface MenuItem { icon?: string; accent?: boolean; danger?: boolean; label: string; onClick?: () => void }
export interface WorkoutSheetServices {
  confirmSheet(options: ConfirmOptions): void
  menuSheet(options: {title?: string; subtitle?: string | null; sections: {items: (MenuItem | false | undefined)[]}[]}): void
  bwSheet(options: {required: true; onDone: (bw: number | null) => void}): void
}
let services: WorkoutSheetServices | undefined
/** W11 / the shell binds its real dialogs and weigh-in flow before rendering. */
export function configureWorkoutSheets(next: WorkoutSheetServices) { services = next }
function dialogs(): WorkoutSheetServices { if (!services) throw new Error('Workout sheet services are not configured'); return services }
const confirmSheet = (options: ConfirmOptions) => dialogs().confirmSheet(options)
const menuSheet: WorkoutSheetServices['menuSheet'] = (options: any) => dialogs().menuSheet(options)
const bwSheet: WorkoutSheetServices['bwSheet'] = (options: any) => dialogs().bwSheet(options)
const S = () => useStore.getState().S
const currentIndex = (st: StoreDocument = S()) => createExerciseIndex(st.customEx)
const update = (mut: (draft: StoreDocument) => void, push?: boolean) => useStore.getState().update(mut, push)
const ui = () => useUI.getState()
const toast = (message: string) => ui().toast(message)
const snd = () => S().sound

// Live workout ids identify sessions; editors reopen the same saved id, so their
// editor-only editBase carries a separate instance through the updater's clones.
const profileIdentity = (st: StoreDocument = S(), user = useStore.getState().user) =>
  JSON.stringify([user?.profileId ?? null, st.profileId ?? null])
const accountProfileIdentity = (store: ReturnType<typeof useStore.getState>) =>
  JSON.stringify([store.user?.id ?? null, profileIdentity(store.S, store.user), store.S.resetAt])
let targetEpoch = 0
useStore.subscribe((next, previous) => {
  if (accountProfileIdentity(next) !== accountProfileIdentity(previous)) targetEpoch++
})
interface SheetTarget { account: unknown; profile: unknown; profileId: string; epoch: number; id: unknown; start: unknown; editingWorkoutId: unknown; editor: unknown; context?: ContextTarget; invalid?: boolean }
function sheetTarget(): SheetTarget {
  const st = S(); const active = st.active
  const target: SheetTarget = { account: useStore.getState().user?.id, profile: st.resetAt, profileId: profileIdentity(st), epoch: targetEpoch,
    id: active?.id, start: active?.start, editingWorkoutId: active?.editingWorkoutId, editor: active?.editBase?.sheetInstanceId }
  if (active?.editingWorkoutId && !target.editor) {
    const instance = uid()
    // At bootstrap there is no editor token yet. Check the pre-clone live reference
    // as well, so even reopening the SAME saved id cannot acquire the old action.
    if (!targetUpdate(target, s => { s.active.editBase = { ...s.active.editBase, sheetInstanceId: instance } },
      () => S().active === active, false)) target.invalid = true
    else target.editor = instance
  }
  target.context = captureSheetTarget()
  return target
}
function targetMatches(target: SheetTarget, st = S()) {
  const a = st.active
  return (!target.context || target.context(st)) && !target.invalid && target.epoch === targetEpoch && profileIdentity(st) === target.profileId &&
    useStore.getState().user?.id === target.account && st.resetAt === target.profile &&
    a?.id === target.id && a?.start === target.start && a?.editingWorkoutId === target.editingWorkoutId &&
    a?.editBase?.sheetInstanceId === target.editor
}
const staleToast = () => toast(t('The workout changed. Open this action again.'))
function validateTarget(target: SheetTarget) {
  if (targetMatches(target)) return true
  staleToast()
  return false
}
// Returning an unchanged draft still stamps and persists in W07. Throw before
// persistence instead, and let unrelated producer failures keep their meaning.
function targetUpdate(target: SheetTarget, mut: (draft: StoreDocument) => void,
  valid: (draft: StoreDocument) => boolean = () => true, push = true) {
  return guardedStoreUpdate(s => targetMatches(target, s) && valid(s), mut, {update, push, onStale: staleToast})
}
const targetClose=(target:SheetTarget,mutate:(draft:StoreDocument)=>void,valid:(draft:StoreDocument)=>boolean=()=>true)=>
  closeTrainingLocally(s=>targetMatches(target,s)&&valid(s),mutate,'editor-closed',staleToast)
// Entries and set rows have no unique legacy id (exercise ids can repeat).
// Assign a sheet-local identity that travels with that row when it is reordered.
interface NoteTarget { entry: string; exercise: string; set?: string }
interface RowIdentity { scope: 'W14-note'; id: string; prior?: unknown }
const rowIdentity = (row: any): RowIdentity | null => row?.sheetInstanceId?.scope === 'W14-note' &&
  typeof row.sheetInstanceId.id === 'string' ? row.sheetInstanceId : null
function markRow(row: any) {
  if (!rowIdentity(row)) row.sheetInstanceId = { scope: 'W14-note', id: uid(),
    ...(Object.hasOwn(row, 'sheetInstanceId') ? { prior: row.sheetInstanceId } : {}) }
}
function noteTarget(target: SheetTarget, entryIdx: number, setIdx?: number): NoteTarget | null {
  if (target.invalid) return null
  const entry = S().active?.entries?.[entryIdx]
  const row = setIdx != null ? entry?.sets?.[setIdx] : null
  if (!entry || (setIdx != null && !row)) return null
  if (!rowIdentity(entry) || (setIdx != null && !rowIdentity(row))) {
    if (!targetUpdate(target, s => {
      const e = s.active.entries[entryIdx]
      markRow(e)
      if (setIdx != null) markRow(e.sets[setIdx])
    }, () => S().active?.entries?.[entryIdx] === entry && (setIdx == null || entry.sets[setIdx] === row), false)) return null
  }
  const e = S().active.entries[entryIdx]
  return { entry: rowIdentity(e)!.id, exercise: e.id, ...(setIdx != null ? { set: rowIdentity(e.sets[setIdx])!.id } : {}) }
}
const noteEntry = (s: StoreDocument, row: NoteTarget) => s.active?.entries?.find((e: any) => rowIdentity(e)?.id === row.entry && e.id === row.exercise)
const noteSet = (s: StoreDocument, row: NoteTarget) => noteEntry(s, row)?.sets?.find((r: any) => rowIdentity(r)?.id === row.set)
function clearSheetRows(active: any) {
  const clear = (row: any) => {
    const identity = rowIdentity(row)
    if (!identity) return
    if (Object.hasOwn(identity, 'prior')) row.sheetInstanceId = identity.prior
    else delete row.sheetInstanceId
  }
  for (const e of active.entries || []) { clear(e); for (const row of e.sets || []) clear(row) }
}
// Even an unchanged target may gain logged sets while a start sheet is open.
function replaceActive(target: SheetTarget, go: (confirmed: boolean) => void) {
  if (!validateTarget(target)) return
  const a = S().active
  if (a?.editingWorkoutId) { toast(t('Finish the current workout first.')); return }
  if (a && setsDoneActive(a)) {
    confirmSheet({ title: t('Replace current workout?'),
      message: t('This workout has logged sets. Discard it and start another workout?'),
      confirmText: t('Discard and start'), danger: true,
      onConfirm: () => { if (validateTarget(target)) go(true) },
    })
    return
  }
  go(false)
}

/* ============================ workout lifecycle ============================ */
// `routineIds` accepts `string | string[] | null` — `[r.id]` for one routine,
// `effectiveRoutineIds(...)` for today's planned session, `[]` / null for explicit freestyle.
export function startFlow(routineIds?: string | string[] | null) {
  try { requireProgrammeStart(S(), routineIds, todayISO()) }
  catch (err) { const error = err as {message: string; startsOn?: string}; toast(t(error.message,error.startsOn)); return }
  const target = sheetTarget()
  if (target.invalid) return
  const go = (bw: number | null) => { if (validateTarget(target)) beginWorkout(routineIds, bw, target) }
  // The weigh-in is a setting (Settings → During a workout, issue #137): off goes straight
  // into the session with no body weight on it, same as "Start without weighing in".
  if (S().weighIn === false) { go(null); return }
  bwSheet({ required: true, onDone: go })
}
export function beginWorkout(routineIds: string | string[] | null | undefined, bw?: number | null, target = sheetTarget()) {
  if (target.invalid) return
  replaceActive(target, confirmed => startWorkout(routineIds, bw, target, confirmed))
}
function startWorkout(routineIds: string | string[] | null | undefined, bw: number | null | undefined, target: SheetTarget, confirmed: boolean) {
  const st = S()
  let built
  try {
    requireProgrammeStart(st, routineIds, todayISO())
    built = buildCombinedEntries(st, routineIds, currentIndex(st))
  } catch (err) { const error = err as {message: string; startsOn?: string}; toast(t(error.message,error.startsOn)); return }
  const { entries, routineIds: rids, routines } = built
  if (!targetUpdate(target, (s: any) => {
    s.active = {
      id: uid(), d: todayISO(), start: Date.now(),
      // A session tracks its routines as a list; per-entry `rid` carries which one each
      // exercise came from. No top-level `excludeFromProgression` — per-entry `noProg` does it.
      routineIds: rids,
      ...(programmeInstanceFor(routines) ? { programmeInstance: programmeInstanceFor(routines) } : {}),
      name: routines.length ? deriveSessionName(routines.map((r: any) => r.name)) : t('Freestyle'),
      bw: bw || null, cur: 0, entries,
      // Snapshot the layout at start so the header ⋮ can change it for this session only —
      // changing the saved default (Settings → Workout view) mid-session leaves it alone.
      workoutView: st.workoutView || 'cards',
    }
  }, s => !s.active?.editingWorkoutId && (confirmed || !s.active || !setsDoneActive(s.active)))) return
  useUI.getState().stopRest()
  navToWorkout()
}

// "Repeat today" (#58): a saved workout's exercises as a new freestyle session dated today, each
// seeded from what that workout logged (lib/session-repeat.js). The weigh-in asks first, the
// way starting any workout does.
export function repeatWorkout(w: StoreDocument, close?: () => void) {
  const st = S()
  if (st.active) { toast(t('Finish the current workout first.')); return }
  const target = sheetTarget()
  if (target.invalid) return
  const { entries, skipped } = repeatSessionEntries(st, w, {}, currentIndex(st))
  if (!entries.length) { toast(t('Nothing to repeat. Its exercises no longer exist.')); return }
  const go = (bw: any) => {
    if (!validateTarget(target)) return
    if (!targetUpdate(target, (s: any) => {
      s.active = {
        id: uid(), d: todayISO(), start: Date.now(), routineIds: [],
        name: w.name || t('Freestyle'), bw: bw || null, cur: 0, entries,
        workoutView: s.workoutView || 'cards',
      }
    })) return
    useUI.getState().stopRest()
    if (close) closeThenNav(close, '/workout'); else navToWorkout()
    if (skipped) toast(tn('{0} exercise no longer exists and was left out.', '{0} exercises no longer exist and were left out.', skipped))
  }
  if (st.weighIn === false) { go(null); return }
  if (close) close()
  bwSheet({ required: true, onDone: go })
}

/* ============================ log a past workout ============================ */
// The same screen as a live session, pointed at another day. `backfill` on the active
// session is what tells the workout screen to drop the clock and the rest timers, and tells
// the finish path to file the workout where its date belongs instead of at the end.
// `initial` is a missed day of the plan (#284): its date, and the routines planned for it. A
// combined day is offered as the one session it plans, next to each routine on its own.
const PLANNED_DAY = '__planned-day'
function LogPastWorkout({ initial, close, target }: {target: SheetTarget; initial: {iso: string; routineIds?: string[] | string} | null; close: () => void}) {
  const st = useStore((s: any) => s.S)
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const planned = ([] as string[]).concat(initial?.routineIds || []).map((id: any) => st.routines.find((r: any) => r.id === id)).filter(Boolean)
  const [date, setDate] = useState(initial?.iso || isoOf(yesterday))
  const [time, setTime] = useState('18:00')
  const [dur, setDur] = useState(60)
  const [routineId, setRoutineId] = useState(planned.length > 1 ? PLANNED_DAY : planned[0]?.id || '')
  const today = todayISO()
  const options = [
    { value: '', label: t('Freestyle') },
    ...(planned.length > 1 ? [{ value: PLANNED_DAY, label: deriveSessionName(planned.map((r: any) => r.name)) }] : []),
    ...st.routines.map((r: any) => ({ value: r.id, label: r.name })),
  ]

  const go = (replaceId: any) => {
    if (!validateTarget(target)) return
    close()
    const routineIds = routineId === PLANNED_DAY ? planned.map((r: any) => r.id) : routineId ? [routineId] : []
    beginBackfill({ iso: date, time, durationMin: Math.max(1, dur), routineIds, replaceId }, target)
  }
  const submit = () => {
    if (!validateTarget(target)) return
    if (!date || date > today) { toast(t('Pick a day up to today')); return }
    if (!(dur >= 1)) { toast(t('Enter how long it took (at least 1 minute).')); return }
    if (dur > MAX_DURATION_MIN) { toast(t('That’s more than a day. Keep it to 24 hours or less.')); return }
    if (endsInFuture(date, time, dur)) { toast(t('That’s still in the future. Try an earlier start.')); return }
    const existing = workoutsOn(st, date)
    if (!existing.length) { go(null); return }
    ui().openSheet((c: any) => <SameDayChoice iso={date} existing={existing} close={c}
      onReplace={(id: any) => { c(); go(id) }} onAdd={() => { c(); go(null) }} />, { kind: 'center' })
  }

  return <>
    <h3>{t('Log a past workout')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Logged on the usual workout screen, without timers.')}</div>
    <Row icon="calendar" title={t('Date')}>
      <input type="date" className="timef" value={date} max={today} onChange={(e: any) => setDate(e.target.value)} /></Row>
    <Row icon="clock" title={t('Start time')}>
      <input type="time" className="timef" value={time} onChange={(e: any) => setTime(e.target.value)} /></Row>
    <Stepper label={t('Duration')} unit={t('min')} value={dur} step={5} min={0} decimal={false} invalid={!(dur >= 1) || dur > MAX_DURATION_MIN} onChange={(v: any) => setDur(Math.round(v))} />
    {!(dur >= 1) && <div className="small" style={{ color: 'var(--red)', marginTop: 6 }}>{t('Enter how long it took (at least 1 minute).')}</div>}
    {dur > MAX_DURATION_MIN && <div className="small" style={{ color: 'var(--red)', marginTop: 6 }}>{t('That’s more than a day. Keep it to 24 hours or less.')}</div>}
    <div style={{ height: 8 }} />
    <SelectRow icon="dumbbell" title={t('Routine')} value={routineId} options={options} onChange={setRoutineId} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={submit}>{t('Continue')}</Button>
  </>
}
// Three ways out when the day already has a workout. Replacing with several on that day means
// picking which one; the rest of the day is left alone.
function SameDayChoice({ iso, existing, onReplace, onAdd, close }: {iso: string; existing: StoreDocument[]; onReplace: (id: string) => void; onAdd: () => void; close: () => void}) {
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 8 }}>{fmtDate(iso, true)}</h3>
    <div className="muted" style={{ marginBottom: 18, lineHeight: 1.5 }}>{t('There is already a workout on that day.')}</div>
    {existing.map((w: any) => {
      return <div key={w.id} style={{ marginBottom: 8 }}>
        <button className="btn danger" onClick={() => onReplace(w.id)}>{existing.length > 1 ? t('Replace') + ' · ' + w.name : t('Replace')}</button>
      </div>
    })}
    <button className="btn primary" onClick={onAdd}>{t('Add as second workout')}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}
// History's button hands this its click event; only a day from the plan counts as `initial`.
export function logPastWorkoutSheet(initial?: {iso?: string; routineIds?: string[] | string} | unknown) {
  if (S().active) { toast(t('Finish the current workout first.')); return }
  const candidate = initial as {iso?: string; routineIds?: string[] | string} | null; const from = typeof candidate?.iso === 'string' ? candidate as {iso: string; routineIds?: string[] | string} : null
  const target = sheetTarget()
  if (target.invalid) return
  ui().openSheet((close: any) => <LogPastWorkout initial={from} close={close} target={target} />)
}
// A backfilled session is built the way a live one is (buildCombinedEntries → buildPlannedEntry),
// so its entries carry the same stamps: the routine list, per-entry rid and the plan, no
// top-level routineId. One routine from the picker, or every routine of a missed combined day.
// Only from the history before that day (historyAsOf): a session logged later must not hand its
// progression back to the day it skipped.
function beginBackfill({ iso, time, durationMin, routineIds, replaceId }: {iso: string; time: string; durationMin: number; routineIds: string[]; replaceId: string | null}, target: SheetTarget) {
  if (S().active) { toast(t('Finish the current workout first.')); return }
  const st = S()
  const active = buildBackfillSession(st, { id: uid(), iso, time, durationMin, routineIds: routineIds || [], replaceId }, currentIndex(st))
  if (!targetUpdate(target, (s: any) => { s.active = active })) return
  useUI.getState().stopRest()
  navToWorkout()
}

/* ============================ add a routine mid-session ============================ */
// The workout header ⋮ → Add routine. Single-pick: a routine already in the session, or one
// with no exercises, is shown disabled and tagged. Picking one appends its entries (each
// stamped with its `rid`), extends `s.active.routineIds`, and re-derives the session name.
// `s.active.cur` is left where it is — the appended block is reached by scrolling / Next.
function AddRoutineToSession({ close, target }: {target: SheetTarget; close: () => void}) {
  const st = useStore((s: any) => s.S)
  const active = st.active
  if (!active) return null
  const inSession = new Set<string>(([] as string[]).concat(active.routineIds || []))
  const add = (r: any) => {
    if (!validateTarget(target)) return
    const entries = buildSessionEntries(sessionHistory(st), r, currentIndex(st)).map((e: any) => ({ ...e, rid: r.id }))
    if (!targetUpdate(target, (s: any) => {
      if (!s.active) return
      // A session kept out of progression as a whole (the header ⋮) keeps the routine's
      // exercises out too, the same as an exercise added on its own.
      s.active.entries.push(...entries.map((e: any) => joinSessionNoProg(s.active, e)))
      s.active.routineIds = [...[].concat(s.active.routineIds || []), r.id]
      const instance = programmeInstanceFor(s.active.routineIds.map((id: any) => s.routines.find((r: any) => r.id === id)))
      if (instance && !s.active.programmeInstance) s.active.programmeInstance = instance
      if (!s.active.customName) {
        s.active.name = deriveSessionName(s.active.routineIds.map((id: any) => s.routines.find((x: any) => x.id === id)?.name).filter(Boolean))
      }
    })) return
    close()
    toast(t('{0} added ({1})', r.name, exCount(r.ex.length)))
  }
  return <>
    <h3>{t('Add routine')}</h3>
    <div className="list">
      {st.routines.map((r: any) => {
        const already = inSession.has(r.id)
        const empty = !(r.ex || []).length
        const disabled = already || empty
        return <div key={r.id} className={'item' + (disabled ? ' disabled' : '')} aria-disabled={disabled || undefined}
          {...tappable(disabled ? null : () => add(r))}>
          <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
          <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
          {already ? <span className="tag">{t('already added')}</span> : empty ? <span className="tag">{t('no exercises')}</span> : <Icon name="chevronRight" className="chev" />}
        </div>
      })}
    </div>
  </>
}
export function addRoutineToSessionSheet() {
  if (!S().active) return
  const target = sheetTarget()
  if (target.invalid) return
  ui().openSheet((close: any) => <AddRoutineToSession close={close} target={target} />)
}

/* ============================ exercise notes ============================
   Two notes, one sheet, because from the user's side it is one question — "what do I want to
   remember about this exercise?" — with two different lifetimes:

     · today's note belongs to this session and is stored on the workout entry. It is history:
       what happened, how it felt. The PIN is the user saying "this one is for next time", which
       only they can know at the moment of writing — see pinnedNoteFor.
     · the standing note belongs to the exercise itself and lives in S.exNotes. Seat height, pin
       position, a form cue. True every session, so it is shown every session and never expires.

   A routine's own `note` (a plan's instruction for this exercise) is edited in the config sheet
   and is deliberately not here: it belongs to the plan, not to the day or to the movement. */
function ExerciseNote({ rowTarget, close, target }: {target: SheetTarget; rowTarget: NoteTarget; close: () => void}) {
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore((s: any) => s.S)
  const A = st.active
  const editing = !!A?.editingWorkoutId
  const openedEntry = useRef(noteEntry(st, rowTarget))
  const entry = noteEntry(st, rowTarget) || openedEntry.current
  const ex = entry ? exOr(entry.id, currentIndex(st)) : null
  const [note, setNote] = useState(entry?.note || '')
  const [pin, setPin] = useState(!!entry?.notePin)
  const [standing, setStanding] = useState(entry ? (st.exNotes?.[entry.id] || '') : '')
  if (!entry) return null

  const save = () => {
    if (!validateTarget(target)) return
    const today = note.trim().slice(0, NOTE_MAX)
    const always = standing.trim().slice(0, NOTE_MAX)
    if (!targetUpdate(target, (s: any) => {
      const e = noteEntry(s, rowTarget)
      if (e) {
        if (today) { e.note = today; if (pin) e.notePin = true; else delete e.notePin }
        else { delete e.note; delete e.notePin }
      }
      if (!editing) {
        s.exNotes = s.exNotes || {}
        if (always) s.exNotes[entry.id] = always
        else delete s.exNotes[entry.id]
      }
    }, s => !!noteEntry(s, rowTarget))) return
    close()
  }

  return <>
    <h3 className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</h3>
    <div className="small muted" style={{ marginBottom: 6 }}>{t('This session')}</div>
    <textarea ref={noteRef} className="input" rows={3} maxLength={NOTE_MAX} value={note}
      placeholder={t('How it went, what to change. Saved with today’s workout.')}
      onFocus={onNoteFocus} onChange={(e: any) => setNote(e.target.value)} />
    <div style={{ height: 10 }} />
    <div className="sect-b">
      <Row icon="pin" iconTint="var(--yellow)" title={t('Show this next time')}
        subtitle={t('Brings it up again the next time you train this exercise.')}>
        <Switch checked={pin} onChange={setPin} disabled={!note.trim()} />
      </Row>
    </div>
    {!editing && <>
      <div style={{ height: 18 }} />
      <div className="small muted" style={{ marginBottom: 6 }}>{t('Always for this exercise')}</div>
      <textarea className="input" rows={2} maxLength={NOTE_MAX} value={standing}
        placeholder={t('Seat height, pin position, a form cue. Shown every session.')}
        onChange={(e: any) => setStanding(e.target.value)} />
    </>}
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const exerciseNoteSheet = (entryIdx: number) => {
  const target = sheetTarget(); const rowTarget = noteTarget(target, entryIdx)
  if (!rowTarget) return
  return ui().openSheet((close: any) => <ExerciseNote rowTarget={rowTarget} close={close} target={target} />)
}

function SetNote({ rowTarget, close, target }: {target: SheetTarget; rowTarget: NoteTarget; close: () => void}) {
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const currentRow = useStore((s: any) => noteSet(s.S, rowTarget))
  const openedRow = useRef(currentRow)
  const row = currentRow || openedRow.current
  const [note, setNote] = useState(row?.note || '')

  if (!row) return null

  const save = () => {
    if (!validateTarget(target)) return
    const text = note.trim().slice(0, NOTE_MAX)
    if (!targetUpdate(target, (s: any) => {
      const set = noteSet(s, rowTarget)
      if (!set) return
      if (text) set.note = text
      else delete set.note
    }, s => !!noteSet(s, rowTarget))) return
    close()
  }

  return <>
    <h3>{t('Set note')}</h3>
    <textarea ref={noteRef} className="input" rows={4} maxLength={NOTE_MAX} value={note}
      placeholder={t('Anything specific to remember about this set.')}
      onFocus={onNoteFocus} onChange={(event: any) => setNote(event.target.value)} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}

export const setNoteSheet = (entryIdx: number, setIdx: number) => {
  const target = sheetTarget(); const rowTarget = noteTarget(target, entryIdx, setIdx)
  if (!rowTarget) return
  return ui().openSheet((close: any) => <SetNote rowTarget={rowTarget} close={close} target={target} />)
}

/* The session note: how the whole workout went, as opposed to how one exercise went. It lives
   on the active session, so buildCompletedWorkout carries it onto the finished workout and it
   shows up again in history — where it stays editable. Written here rather than only after the
   fact because "notes you can write during a workout" is the point; a note you can only add
   once the session is filed is a different, smaller feature. */
function SessionNote({ close, target }: {target: SheetTarget; close: () => void}) {
  const noteRef = useRef<HTMLTextAreaElement | null>(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore((s: any) => s.S)
  const A = st.active
  const [note, setNote] = useState(A?.note || '')
  useEffect(() => { if (!A) close() }, [!A])
  if (!A) return null

  const save = () => {
    if (!validateTarget(target)) return
    const text = note.trim().slice(0, NOTE_MAX)
    if (!targetUpdate(target, (s: any) => { if (text) s.active.note = text; else delete s.active.note })) return
    close()
  }

  return <>
    <h3>{t('Session note')}</h3>
    <textarea ref={noteRef} className="input" rows={4} maxLength={NOTE_MAX} value={note}
      placeholder={t('How the session went as a whole.')}
      onFocus={onNoteFocus} onChange={(e: any) => setNote(e.target.value)} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const sessionNoteSheet = () => { const target = sheetTarget(); if (target.invalid) return; return ui().openSheet((close: any) => <SessionNote close={close} target={target} />) }

function RenameWorkout({ close, target }: {target: SheetTarget; close: () => void}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const onFocus = useSheetKeyboard(inputRef)
  const st = useStore((s: any) => s.S)
  const A = st.active
  const [name, setName] = useState(A?.name || '')
  useEffect(() => { if (!A) close() }, [!A])
  if (!A) return null

  const trimmed = name.trim().slice(0, 60)
  const canSave = trimmed.length > 0

  const save = () => {
    if (!validateTarget(target)) return
    if (!canSave) return
    if (!targetUpdate(target, (s: any) => {
      if (!s.active) return
      s.active.name = trimmed
      s.active.customName = true
    })) return
    close()
  }

  return <>
    <h3>{t('Rename workout')}</h3>
    <input ref={inputRef} className="input" type="text" autoFocus maxLength={60} value={name}
      placeholder={t('Workout title')}
      onFocus={onFocus} onChange={(e: any) => setName(e.target.value)}
      onKeyDown={(e: any) => { if (e.key === 'Enter' && canSave) save() }} />
    <div style={{ height: 18 }} />
    <Button variant="primary" disabled={!canSave} onClick={save}>{t('Save')}</Button>
  </>
}
export const renameWorkoutSheet = () => { const target = sheetTarget(); if (target.invalid) return; return ui().openSheet((close: any) => <RenameWorkout close={close} target={target} />) }

// A superset's own name and rest between rounds (#292), from the routine editor.
function SupersetSettings({ meta, onSave, close, target }: {target: SheetTarget; meta: SupersetMeta; onSave: (meta: SupersetMeta) => void; close: () => void}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const onFocus = useSheetKeyboard(inputRef)
  const [name, setName] = useState(meta.name || '')
  const [rest, setRest] = useState(meta.rest || 0)
  const save = () => { if (!validateTarget(target)) return; onSave({ name: name.trim().slice(0, SG_NAME_MAX), rest }); close() }
  return <>
    <h3>{t('Superset')}</h3>
    <input ref={inputRef} className="input" type="text" maxLength={SG_NAME_MAX} value={name}
      placeholder={t('Name, e.g. Arm finisher')} onFocus={onFocus} onChange={(e: any) => setName(e.target.value)}
      onKeyDown={(e: any) => { if (e.key === 'Enter') save() }} />
    <div style={{ height: 12 }} />
    <div className="list">
      <Row icon="timer" iconTint="var(--orange)" title={t('Rest after each round')}
        value={rest > 0 ? fmtRest(rest) : t('Longest exercise rest')} accessory="chevron"
        onClick={() => durationSheet({ title: t('Rest after each round'), value: rest, max: REST_MAX, off: t('Longest exercise rest'),
          footer: t('Without one, the superset rests as long as its longest exercise rest.'), onDone: value => { if (validateTarget(target)) setRest(value) } })} />
    </div>
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export interface SupersetMeta { name?: string; rest?: number }
export const supersetSheet = (meta: SupersetMeta, onSave: (meta: SupersetMeta) => void) => { const target = sheetTarget(); if (target.invalid) return; return ui().openSheet((close: any) => <SupersetSettings meta={meta} onSave={onSave} close={close} target={target} />) }

/* Drop-set drops and rest-pause bursts are edited inline on the set row itself (Workout.jsx) —
   no sheet, no timer. A planned exercise (see the "Intensifier" config below) arrives with them
   already computed via applyIntensifierPlan; an unplanned straight set can still grow one live
   by tapping "+ Drop"/"+ Burst", which appends with the same suggested-next-value math. */

// Shown when the last exercise's last set is checked — finish, or keep going.
function WorkoutComplete({ close, target }: {target: SheetTarget; close: () => void}) {
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="checkCircle" /></div>
    <h3 style={{ margin: '8px 0' }}>{t("That's the whole workout!")}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('All exercises done. Nice work! Finish up, or add another one if you’ve got more in you.')}</div>
    <Button variant="primary" icon="flag" onClick={() => { if (!validateTarget(target)) return; close(); finishWorkout() }}>{t('Finish workout')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { if (!validateTarget(target)) return; close(); useUI.getState().toast(t('Keep going: tap “+ Add exercise” below')) }}>{t('Continue workout')}</Button>
  </div>
}
export const workoutCompleteSheet = () => { const target = sheetTarget(); if (target.invalid) return; return ui().openSheet((close: any) => <WorkoutComplete close={close} target={target} />, { kind: 'center' }) }

export function saveWorkoutEdits(onExit: any = () => nav('/history'), target = sheetTarget()) {
  if (!validateTarget(target)) return
  // A save decision left open after the editor already closed (a second prompt from a route
  // exit that raced the first save) has nothing to save or delete: it only finishes leaving.
  if (!S().active?.editingWorkoutId) { onExit(); return }
  // An edit that unticked or removed every set would save a workout with nothing in it, which
  // the history would still list and count as a training day. Deleting it is what that edit
  // means; Keep editing goes back to the sets.
  if (editLeftEmpty(S().active)) {
    confirmSheet({
      title: t('Delete workout?'),
      message: t('No sets are left in this workout, so there is nothing to save. Delete it from your history?'),
      confirmText: t('Delete workout'), cancelText: t('Keep editing'), danger: true,
      onConfirm: () => {
        if (!validateTarget(target)) return
        if (!targetClose(target, s => { deleteEditedWorkout(s as any, currentIndex(s)) }, s => editLeftEmpty(s.active))) return
        useUI.getState().stopRest()
        useUI.getState().stopWork()
        toast(t('Workout deleted'))
        onExit()
      },
    })
    return
  }
  try {
    if (!targetClose(target, s => { clearSheetRows(s.active); saveWorkoutEdit(s as any, Date.now(), currentIndex(s)) })) return
    useUI.getState().stopRest()
    useUI.getState().stopWork()
    toast(t('Workout updated'))
    onExit()
  } catch (error) { toast(t(error instanceof Error ? error.message : String(error))); throw error }
}

// The one save prompt that may be open: { id, onExit }. Closing the editor and a route exit
// can both ask in the same moment (the X, then the route change its tap set off); a second
// prompt stacked under the first came back after Save changes and asked all over again
// (QA 10-06). The second ask now joins the open prompt and only says where to go after it.
let savePrompt: {id: string | null; onExit: () => void; target: SheetTarget} | null = null
const promptOpen = () => !!savePrompt && useUI.getState().sheets.some((x: any) => x.id === savePrompt?.id)

export function exitWorkoutEdit(onExit: any = () => nav('/history')) {
  if (!S().active?.editingWorkoutId) { onExit(); return }
  const target = sheetTarget()
  if (target.invalid) return
  if (promptOpen() && savePrompt && targetMatches(savePrompt.target)) { savePrompt.onExit = onExit; return }
  const prompt = { id: null as string | null, onExit, target }
  const done = () => prompt.onExit()
  const leave = () => {
    if (!validateTarget(target)) return
    // A stale prompt's Don't save must not throw away whatever is in S.active by now.
    if (!S().active?.editingWorkoutId) { done(); return }
    if (!targetClose(target, s => { s.active = null })) return
    useUI.getState().stopRest()
    useUI.getState().stopWork()
    done()
  }
  // Nothing to save: closing just closes, as it does for a workout only looked at.
  const compared = structuredClone(S())
  clearSheetRows(compared.active)
  if (editChangesNothing(compared, currentIndex())) { leave(); return }
  prompt.id = ui().openSheet((close: any) => <>
    <h3>{t('Save workout changes?')}</h3>
    <p className="muted">{t('Save your edits to this workout, or keep the original record.')}</p>
    <Button variant="primary" onClick={() => { close(); saveWorkoutEdits(done, target) }}>{t('Save changes')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={() => { close(); leave() }}>{t("Don't save")}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Keep editing')}</Button>
  </>, { kind: 'center' })?.id
  savePrompt = prompt
}

// "60 kg × 5, 5, 4", or "60×5 · 62.5×5" when the weight changed between sets; a bodyweight lift
// without load is just its reps. A set taken to failure keeps its "F", as it does in the history.
export function setsLine(sets: {w: number; r: number; f?: boolean}[], unit: string) {
  const ws = new Set(sets.map((s: any) => s.w))
  const reps = (s: any) => s.r + (s.f ? ' ' + t('F') : '')
  if (ws.size === 1) {
    const w0 = sets[0]!.w
    return (w0 > 0 ? fmtNum(w0) + ' ' + unit + ' × ' : '') + sets.map(reps).join(', ')
  }
  return sets.map((s: any) => (s.w > 0 ? fmtNum(s.w) + '×' : '') + reps(s)).join(' · ')
}
const TREND: Record<number, [string, string]> = { 1: ['arrowUp', 'var(--green)'], 0: ['minus', 'var(--text-2)'], [-1]: ['arrowDown', 'var(--orange)'] }
function LastAndNext({ st, w }: {st: StoreDocument; w: StoreDocument}) {
  const index = currentIndex(st)
  const rows = finishCompare(st, w, index)
  if (!rows.length) return null
  const nextWord: Record<string, string> = { up: t('step up'), hold: t('same again'), down: t('lighter'), deload: t('deload') }
  return <div style={{ textAlign: 'start', marginBottom: 14 }}>
    <h4 className="sec">{t('Last time and next time')}</h4>
    <div className="list">{rows.map((row: any) => {
      const ex = index[row.id]
      const tr = row.trend == null ? null : TREND[row.trend]
      return <div key={row.id} className="item" style={{ display: 'block' }}>
        <div className="row between" style={{ gap: 8 }}>
          <span className={'tt ' + exerciseNameClass(ex)} style={{ fontWeight: 600 }}>{ex ? exerciseNameFor(ex) : row.id}</span>
          {tr ? <span style={{ color: tr[1], display: 'inline-flex' }} aria-label={(row.trend ?? 0) > 0 ? t('Up on last time') : (row.trend ?? 0) < 0 ? t('Down on last time') : t('Same as last time')}><Icon name={tr[0]} /></span>
            : <span className="tag nocap">{t('First time')}</span>}
        </div>
        <div className="small">{t('Today')}: {setsLine(row.today, st.unit)}</div>
        {row.last && <div className="small dim">{t('Last time')}: {setsLine(row.last, st.unit)}</div>}
        {row.next && <div className="small accent">{t('Next time')}: {row.next.w != null ? fmtNum(row.next.w) + ' ' + st.unit : ''}{row.next.w != null && row.next.r != null ? ' × ' : ''}{row.next.r != null ? row.next.r : ''} · {nextWord[row.next.kind]}</div>}
      </div>
    })}</div>
  </div>
}

// The cardio of the session, which "Last time and next time" leaves out: minutes, speed and the
// treadmill's incline as they were logged.
function CardioDone({ st, w }: {st: StoreDocument; w: StoreDocument}) {
  const index = currentIndex(st)
  const rows = finishCardio(w, index)
  if (!rows.length) return null
  return <div style={{ textAlign: 'start', marginBottom: 14 }}>
    <h4 className="sec">{t('Cardio')}</h4>
    <div className="list">{rows.map((row: any, i: any) => {
      const ex = index[row.id]
      return <div key={i} className="item" style={{ display: 'block' }}>
        <span className={'tt ' + exerciseNameClass(ex)} style={{ fontWeight: 600 }}>{ex ? exerciseNameFor(ex) : row.id}</span>
        <div className="small">{row.sets.map((x: any) => setLabel(row.id, x, row.target, speedUnitOf(st), index)).join('  ·  ')}</div>
      </div>
    })}</div>
  </div>
}

function FinishSummary({ w, prs, e1prs = [], close }: {w: StoreDocument; prs: string[]; e1prs?: {id: string; est: number}[]; close: () => void}) {
  const st = useStore((s: any) => s.S)
  const index = currentIndex(st)
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--acc)' }}><Icon name="trophy" /></div>
    <h3 style={{ margin: '8px 0' }}>{t('Workout complete!')}</h3>
    <div className="tiles" style={{ textAlign: 'start' }}>
      <div className="tile"><div className="l">{t('Duration')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtDur(w.end - w.start)}</div></div>
      <div className="tile"><div className="l">{t('Volume')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{fmtVol(w.vol, st.unit)}</div></div>
      <div className="tile"><div className="l">{t('Sets')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{setsWorkCount(setsDone(w), workSetsDone(w))}</div></div>
      <div className="tile"><div className="l">{t('PRs')}</div><div className="v" style={{ fontSize: 20 }}>{prs.length || '–'}</div></div>
    </div>
    {(prs.length > 0 || e1prs.length > 0) && <div style={{ textAlign: 'start', marginBottom: 12 }}>
      {prs.map((id: any) => <div key={id} className="small accent row" style={{ gap: 5 }}><Icon name="trophy" style={{ fontSize: 13 }} />{t('New PR:')} <span className={exerciseNameClass(index[id])}>{index[id] ? exerciseNameFor(index[id]) : id}</span></div>)}
      {e1prs.map((p: any) => <div key={p.id} className="small accent row" style={{ gap: 5 }}><Icon name="chartLine" style={{ fontSize: 13 }} />{t('Best estimated 1RM:')} <span className={exerciseNameClass(index[p.id])}>{index[p.id] ? exerciseNameFor(index[p.id]) : p.id}</span> · {fmtNum(p.est)} {st.unit}</div>)}
    </div>}
    <h4 className="sec" style={{ textAlign: 'start' }}>{t('What you just trained')}</h4>
    <BodyMap load={loadOfWorkouts([w], undefined, index)} body={st.body} />
    <div style={{ height: 14 }} />
    <LastAndNext st={st} w={w} />
    <CardioDone st={st} w={w} />
    <Button variant="primary" onClick={() => closeThenNav(close, '/home')}>{t('Nice!')}</Button>
  </div>
}
export function finishWorkout() {
  if (S().active?.editingWorkoutId) { saveWorkoutEdits(); return }
  const A = S().active
  if (!A) return
  const target = sheetTarget()
  if (target.invalid) return
  const finish = () => { if (validateTarget(target)) doFinishWorkout(target) }
  const done = setsDoneActive(A)
  const total = setUnitsTotal(A.entries)
  if (!done) { confirmSheet({ title: t('Nothing logged yet'), message: t('You haven’t checked off any sets. Finish the workout anyway?'), confirmText: t('Finish anyway'), onConfirm: finish }); return }
  if (done < total) { confirmSheet({ title: t('Finish early?'), message: tn('{0} set still unchecked. Finish the workout now?', '{0} sets still unchecked. Finish the workout now?', total - done), confirmText: t('Finish workout'), onConfirm: finish }); return }
  finish()
}
// The workout screen's Finish pill (v1.3.11): one sheet with both ways out, Finish and save or
// Discard. It says what finishWorkout's confirm would have said about sets still unchecked, so
// the save needs no second question. `onDiscard` is the screen's own discard, with its confirm.
// The editor of a saved workout still saves at once.
export function finishWorkoutSheet({ onDiscard }: {onDiscard?: () => void} = {}) {
  if (S().active?.editingWorkoutId) { saveWorkoutEdits(); return }
  const A = S().active
  if (!A) return
  const target = sheetTarget()
  if (target.invalid) return
  const finish = () => { if (validateTarget(target)) doFinishWorkout(target) }
  const done = setsDoneActive(A)
  const total = setUnitsTotal(A.entries)
  menuSheet({
    title: !done ? t('Nothing logged yet') : done < total ? t('Finish early?') : t('Finish workout?'),
    subtitle: !done ? t('You haven’t checked off any sets. Finish the workout anyway?')
      : done < total ? tn('{0} set still unchecked. Finish the workout now?', '{0} sets still unchecked. Finish the workout now?', total - done) : null,
    sections: [
      { items: [{ icon: 'flag', accent: true, label: t('Finish and save'), onClick: finish }] },
      { items: [onDiscard && { icon: 'trash', danger: true, label: t('Discard workout'), onClick: () => { if (validateTarget(target)) onDiscard() } }] },
    ],
  })
}
function doFinishWorkout(target: SheetTarget) {
  const prs: string[] = []
  const e1prs: {id: string; est: number}[] = []
  let shown: StoreDocument = {}
  if (!targetUpdate(target, (s: any) => {
    const st = s
    const index = currentIndex(st)
    const A = st.active
    if (!A || A.editingWorkoutId || s.workouts.some((x: any) => x.id != null && x.id === A.id)) abortGuardedUpdate()
    const past = !!A.backfill
    // A workout logged into the past is held against the history before it, the way an edit of a
    // saved one is (rebuildPrHistory, below): it gains a badge it leads with, and a later session
    // it outdoes loses its own. It used to report none at all while the editor's Save awarded them
    // (QA 1.3.9). The confirmed weights are left alone either way.
    if (!past) A.entries.forEach((e: any) => {
      const loads = e.sets.filter((s: any) => s.done && !isWarmupRow(s)).map((s: any) => s.w).filter((w: any) => w > 0)
      const mx = loads.length ? loads.reduce((a: any, b: any) => betterWeight(e.id, a, b, index)) : 0
      // Held against history read the way this session logged a dumbbell weight (lib/dumbbells.js).
      if (beatsWeight(e.id, mx, bestWeightFor(st, e.id, entryDbLoad(e), index), index)) prs.push(e.id)
      // A heavier estimate without a heavier top set is its own kind of progress —
      // same weight for more reps. Reported separately so it can't be read as a load PR.
      const rec = is1RMRecord(st, e.id, e, undefined, index)
      if (rec && !prs.includes(e.id)) e1prs.push({ id: e.id, ...rec })
    })
    const completed = structuredClone(A)
    clearSheetRows(completed)
    const finished = past ? fileBackfillWorkout(s.workouts, completed, index) : null
    const w: StoreDocument & {d: string; start: number; entries: any[]} = finished?.workout || buildCompletedWorkout(completed, {
      end: sessionEnd(A), prs,
      snapshotFor: (e: any) => isCustomEx(index[e.id], index) ? exerciseMuscleSnapshot(index[e.id]) : null,
    }, index)
    if (!past) w.vol = workoutVolume(w, index)
    shown = w
    if (finished) {
      s.workouts = finished.workouts
      prs.push(...[...(shown.prs || [])])
    } else {
      w.entries.forEach((e: any) => {
        const mx = bestWeightForEntry(e, index)
        if (mx > 0 && beatsWeight(e.id, mx, (s.exWeights[e.id] || {}).w || 0, index)) s.exWeights[e.id] = { w: mx, d: w.d }
      })
      s.workouts.push(w)
    }
    s.active = null
    // A rotation pass this app manages starts its next pass the moment the last session lands
    // (lib/rotation.js). A planner's queue is left alone: it completes and waits for its writer.
    refillAfter(s, w)
  })) return
  useUI.getState().stopRest()
  // A hold still counting (a plank left unchecked, then Finish early) goes with the workout, as
  // on Discard: its bar is app-wide and would chime over the summary, and its callback writes
  // into s.active, which is gone. What it held is not logged, like any set left unchecked.
  useUI.getState().stopWork()
  beep(snd(), 880, 0.15); beep(snd(), 1100, 0.15, 0.18); beep(snd(), 1320, 0.3, 0.36)
  ui().openSheet((close: any) => <FinishSummary w={shown} prs={prs} e1prs={e1prs} close={close} />, { kind: 'center', locked: true })
}
