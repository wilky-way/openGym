import { NativeTarget } from './components/NativeTarget'
import { Thumb } from './components/Media'
import { guardedStoreUpdate, abortGuardedUpdate } from './lib/guarded-update'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyValueStore } from '@opengym/contract/platform/adapters'
import { clientPlatform } from './lib/client-io'
import {captureSheetTarget,type SheetTarget as ShellContext} from './lib/sheet-target'
import { useStore, type StoreDocument, type StoreState } from './store/useStore'
import { useUI } from './store/useUI'
import { fmtDate, fmtNum, fmtVol, fmtDur, durPart, todayISO, exCount, routineCount, DAYN, DAYS, weekOrder, weekStartOf, weekDayOffset, MONTHS_LONG } from '@opengym/core/format'
import { effectiveRoutineIds, workoutDay, workoutVolume, setsDone, sessionSections, setLabel, NOTE_MAX } from '@opengym/core/history'
import { t, tn, exerciseNameFor, exerciseNameClass } from '@opengym/core/i18n-core'
import { nav, closeThenNav } from './lib/nav'
import Icon from './components/Icon'
import { Button, Row, Switch, Stepper } from './components/ui'
import { glyphOf } from './lib/glyphs'
import { useSheetKeyboard, tappable } from './lib/use-sheet-keyboard'
import { buildPlanBundle, parsePlan, mergePlan, planPrintHTML } from '@opengym/core/plan-share'
import { hasPrivateProgrammes } from '@opengym/core/programme-import'
import { pin as pinProgramme } from '@opengym/core/programme'
import { deriveSessionName } from '@opengym/core/session-merge'
import { speedUnitOf } from '@opengym/core/speed'
import { hasCompletedWork, isWarmupRow } from '@opengym/core/workout-model'
import { saveSessionAsRoutine } from '@opengym/core/session-routines'
import { workoutsOn } from '@opengym/core/backfill'
import { moveWorkout, sameWorkout, startTimeOf, durationMinOf, setWorkoutDuration, MAX_DURATION_MIN, endsInFuture } from '@opengym/core/workout-date'
import { uid } from '@opengym/core/format'
import { editCompletedSession } from '@opengym/core/session-edit'
import { stampWorkout } from '@opengym/core/sync-merge'
import { workoutFit, fitFileName } from '@opengym/core/fit-export'
import { workoutText } from '@opengym/core/workout-text'
import { workoutCardModel, layoutWorkoutCard, drawWorkoutCard, viewAspect, CARD_FONT } from './lib/workout-card'
import { copyText } from './lib/clipboard'
import { queueRemaining, pinState } from '@opengym/core/queue'
import { DAY_NOTE_TAGS, DAY_NOTE_LABEL, DAY_NOTE_ICON, dayNoteOf, dayNoteLine, canNoteDay, withDayNote } from '@opengym/core/day-notes'
import { ux } from './platform/ux'
import { readPlanFile, saveBlob, shareBlob, imageURL, revokeImageURL, printHTML } from './platform/plan-history'
import { EXIDX, type ExerciseIndex } from '@opengym/core/exercises'
import type { ExportPlan, ExportWorkout } from '../../core/src/export-types'

const S = () => useStore.getState().S
const update = (fn: (s: StoreDocument) => void) => useStore.getState().update(fn)
const ui = () => useUI.getState()
const toast = (message: string) => ui().toast(message)
// A transition epoch catches A → B → A, including reopening an editor for the same workout.
// Stable active identity survives the document clones made by ordinary updates.
const contextKey = (state: StoreState) => JSON.stringify([
  state.documentInstance ?? 0, state.user?.id ?? null, state.user?.profileId ?? state.S.profileId ?? null,
  state.S.active ? [state.S.active.id ?? null, state.S.active.start ?? null,
    state.S.active.editingWorkoutId ?? null, state.S.active.instanceId ?? null, state.S.active.editBase?.sheetInstanceId ?? null] : null,
])
let contextEpoch = 0
useStore.subscribe((next, prev) => {
  if (next.user !== prev.user || contextKey(next) !== contextKey(prev)) contextEpoch++
})
interface SheetTarget { context:ShellContext; epoch: number; key: string; workout?: ExportWorkout; kv?: KeyValueStore; durableOwner?: string | null; durableRequired: boolean }
function captureTarget(w?: ExportWorkout): SheetTarget {
  const state = useStore.getState()
  // W07 can join another tab's saved editor AFTER the producer. Inspect its shell-owned
  // durable context too, even when the corresponding storage event is still queued.
  const durableRequired = typeof state.replaceState === 'function'
  let kv: KeyValueStore | undefined
  let durableOwner: string | null | undefined
  if (durableRequired) {
    try {
      kv = clientPlatform().kv
      // An expired login can keep its owned copy and continue locally as a guest.
      // Capture that retained owner; a signed-in user still requires their own id.
      durableOwner = state.user?.id ?? kv.get('gym_owner')
    } catch { /* fail closed below */ }
  }
  return { context:captureSheetTarget(), epoch: contextEpoch, key: contextKey(state), workout: w ? { ...w } : undefined, kv, durableOwner, durableRequired }
}
function durableTargetCurrent(target: SheetTarget): boolean {
  if (!target.durableRequired) return true
  if (!target.kv || target.durableOwner === undefined) return false
  try {
    const owner = target.kv.get('gym_owner')
    const user = JSON.parse(target.kv.get('gym_user') || 'null')
    const savedOwner = target.kv.get('gym_state_owner')
    if (savedOwner !== null && savedOwner !== (owner || '')) return false
    if (owner !== target.durableOwner ||
      (user?.id ?? null) !== (useStore.getState().user?.id ?? null)) return false
    const raw = target.kv.get('gym_state_v1')
    if (!raw) return true // first durable save; W07 keeps its recovery guarantees
    const saved = JSON.parse(raw)
    return target.key === contextKey({ ...useStore.getState(), user, S: saved }) &&
      (!target.workout || (saved.workouts || []).some((w: ExportWorkout) => sameWorkout(w, target.workout)))
  } catch { return false } // unreadable/blocked durable context cannot authorize a write
}
function targetCurrent(target: SheetTarget, state = S()): boolean {
  return target.context(state) && durableTargetCurrent(target) && target.epoch === contextEpoch && target.key === contextKey({ ...useStore.getState(), S: state }) &&
    (!target.workout || (state.workouts || []).some((w: ExportWorkout) => sameWorkout(w, target.workout)))
}
function validateTarget(target: SheetTarget): boolean {
  if (targetCurrent(target)) return true
  toast(t('This sheet is out of date. Open it again.'))
  return false
}
function updateTarget(target: SheetTarget, mut: (s: StoreDocument) => void): boolean {
  // Refuse before invoking W07: even a no-op updater stamps/persists the document.
  if (!validateTarget(target)) return false
  return guardedStoreUpdate(s => targetCurrent(target, s), mut,
    {update, onStale: () => toast(t('This sheet is out of date. Open it again.'))})
}
export const PLAN_FILE_MAX = 1_048_576
export interface PlanHistoryServices {
  exerciseHistorySheet(id: string): unknown
  logPastWorkoutSheet(options: { iso: string; routineIds: string[] }): unknown
  repeatWorkout(w: ExportWorkout, close: () => void): unknown
  version: string
}
const missing = (): never => { throw new Error('Plan/history sheet services have not been configured') }
let services: PlanHistoryServices = { exerciseHistorySheet: missing, logPastWorkoutSheet: missing, repeatWorkout: missing, version: '0.0.0' }
export function configurePlanHistorySheets(value: PlanHistoryServices): void { services = value }
interface ConfirmOptions { title: string; message: string; confirmText: string; danger?: boolean; onConfirm(): void }
function confirmSheet(options: ConfirmOptions) {
  return ui().openSheet((close: any) => <><h3>{options.title}</h3><div className="muted">{options.message}</div>
    <Button variant={options.danger ? 'danger' : 'primary'} onClick={() => { close(); options.onConfirm() }}>{options.confirmText}</Button>
    <Button variant="ghost" onClick={close}>{t('Cancel')}</Button></>)
}
export function printPlan(state: ExportPlan, owner = '', opts: { routineId?: string } = {}, index: ExerciseIndex = EXIDX): void {
  printHTML(planPrintHTML(state, owner, opts, index))
}
export const planToolsSheet = () => {
  const target = captureTarget()
  return ui().openSheet((close: any) => <PlanTools target={target} close={close} />)
}

// The three things the Plan menu and this sheet both do with a plan, so the two can never drift.
export const planHasRoutines = (st: any) => (st.routines || []).some((r: any) => r.ex && r.ex.length)
export async function exportPlanFile(target = captureTarget()) {
  if (!validateTarget(target)) return
  const st = S(), user = useStore.getState().user
  const bundle = buildPlanBundle(st, user?.name ? t('{0}’s plan', user.name) : '', useStore.getState().index)
  const json = JSON.stringify(bundle, null, 2)
  const name = 'opengym-plan-' + todayISO() + '.json'

  const blob = new Blob([json], { type: 'application/json' })
  saveBlob(blob, name)
  toast(t(hasPrivateProgrammes(st) ? 'Exports include private program prescriptions and notes. Keep them for personal use.' : 'Plan file saved. Send it to a friend!'))
}
// The browser's print dialog can also save the printable plan as PDF.
export function printWholePlan(target = captureTarget()) {
  if (!validateTarget(target)) return
  const st = S(), owner = String(useStore.getState().user?.name || '')
  if(hasPrivateProgrammes(st)) toast(t('Exports include private program prescriptions and notes. Keep them for personal use.'))
  printPlan(st as ExportPlan, owner, {}, useStore.getState().index)
}
// A picked plan file → the import sheet, or a toast saying why not.
export async function importPlanFile(f: Blob | null | undefined, onRead?: () => void, isCurrent: () => boolean = () => true) {
  const target = captureTarget()
  const current = () => isCurrent() && validateTarget(target)
  if (!f) return
  if (f.size > PLAN_FILE_MAX) { toast(t('Couldn’t read that file.')); return }
  try {
    const raw = await readPlanFile(f)
    if (!current()) return
    const bundle = parsePlan(raw, S().unit || 'kg', useStore.getState().index)
    onRead?.()
    if (validateTarget(target)) planImportSheet(bundle)
  } catch (error: any) {
    if (!current()) return
    const e = error as { code?: string; message?: string }
    toast(e?.code === 'not-plan' ? t('Import failed: {0}', e.message) : t('Couldn’t read that file.'))
  }
}

function PlanTools({ target, close }: any) {
  const st = useStore((s: any) => s.S)
  const index = useStore((s: any) => s.index)
  const fileRef = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const readSeq = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const hasRoutines = planHasRoutines(st)

  const exportFile = async () => { if (!validateTarget(target)) return; await exportPlanFile(target); if (validateTarget(target)) close() }
  const pickFile = (ev: any) => {
    if (!validateTarget(target)) return
    const f = ev.target.files[0]; ev.target.value = ''
    const seq = ++readSeq.current
    void importPlanFile(f, close, () => alive.current && readSeq.current === seq && validateTarget(target))
  }

  return <>
    <h3>{t('Share your plan')}</h3>
    {hasPrivateProgrammes(st) && <p className="sect-f">{t('Exports include private program prescriptions and notes. Keep them for personal use.')}</p>}
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Send your routines to a friend, or put your week on paper.')}</div>
    <Button variant="primary" icon="share" onClick={exportFile} disabled={!hasRoutines}>{t('Export plan file')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A small file a friend can import into their own openGym. Routines only, none of your workouts or weigh-ins.')}</div>
    <div style={{ height: 12 }} />
    <Button variant="tinted" icon="note" onClick={() => { if (!validateTarget(target)) return; printWholePlan(target); close() }} disabled={!hasRoutines}>{t('Print / Save as PDF')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A clean printout, one page per plan. No exercise ever gets split across pages.')}</div>
    {!hasRoutines && <div className="dim small" style={{ margin: '12px 2px 0' }}>{t('Add an exercise to a routine first. An empty plan has nothing to share.')}</div>}
    <h4 className="sec">{t('Got a plan from a friend?')}</h4>
    <Button variant="ghost" icon="download" onClick={() => fileRef.current?.click()}>{t('Import a plan file')}</Button>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
  </>
}

export const planImportSheet = (bundle: any) => {
  const target = captureTarget()
  return ui().openSheet((close: any) => <PlanImport bundle={bundle} target={target} close={close} />)
}

function PlanImport({ bundle, close, target }: {bundle: any; close: () => void; target: SheetTarget}) {
  const [schedule, setSchedule] = useState(false)
  const apply = () => {
    if (!updateTarget(target, (s: any) => mergePlan(s, bundle, { schedule }, useStore.getState().index))) return
    close()
    toast(tn('Added {0} routine to your plan', 'Added {0} routines to your plan', bundle.routineCount))
    nav('/plan')
  }
  return <>
    <h3>{bundle.name ? t('Import “{0}”', bundle.name) : t('Import this plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {routineCount(bundle.routineCount)}
      {' · ' + exCount(bundle.exerciseCount)}
      {bundle.scheduledDays > 0
        ? ' · ' + tn('scheduled on {0} day', 'scheduled on {0} days', bundle.scheduledDays)
        : ''}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>{t('These are added as new routines. Nothing you already have is touched.')}</div>
    {bundle.dropped > 0 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 14, lineHeight: 1.4 }}>
      {t(bundle.dropped === 1
        ? '{0} exercise in the file isn’t in your library and was left out.'
        : '{0} exercises in the file aren’t in your library and were left out.', bundle.dropped)}
    </div>}
    {bundle.scheduledDays > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', marginBottom: 16, gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Use this weekly schedule')}</div><div className="small dim">{t('Replaces your current Mon–Sun assignments.')}</div></div>
      <Switch checked={schedule} onChange={setSchedule} />
    </div>}
    <Button variant="primary" onClick={apply}>{t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* ============================ day override / assign ============================ */
function DayOverride({ iso, target, close }: any) {
  const st = useStore((s: any) => s.S)
  const index = useStore((s: any) => s.index)
  const programPins = (st.programmes?.cycles || []).filter((c: any) => c.status === 'active' || c.status === 'paused')
    .flatMap((c: any) => c.occurrences.filter((o: any) => o.pinnedOn === iso && o.status === 'pending').map((o: any) => ({ cycle: c, occurrence: o })))
  const hasOvr = st.dayPlan[iso] !== undefined || programPins.length > 0
  const changed = hasOvr && pinState(st, st.dayPlan[iso]) !== 'done'
  const { [iso]: _ovr, ...noOvr } = st.dayPlan
  const weeklyNames = effectiveRoutineIds({ ...st, dayPlan: noOvr }, iso).map((id: any) => st.routines.find((r: any) => r.id === id)?.name).filter(Boolean)
  // A weekday can hold several routines; the per-date override stays single-pick, so picking
  // one here collapses a combined day to it (docs/dev/COMBINE_ROUTINES.md §8). The check marks
  // show everything currently planned for the day.
  const effIds = effectiveRoutineIds(st, iso)
  // A planned day in the past with nothing logged was missed — or trained and never logged,
  // like a run you forgot to start the app for (#284). Logging it opens "Log a past workout" on
  // that date with the day's routines picked, where the time and the duration can still change.
  const missed = iso < todayISO() && effIds.length > 0 && !workoutsOn(st, iso).length
  const logIt = () => { if (!validateTarget(target)) return; close(); services.logPastWorkoutSheet({ iso, routineIds: effIds }) }
  // A note on a day off (#261, lib/day-notes.js): offered on today and past days with nothing
  // logged, kept in view on any day that already has one. Quiet on purpose: a row, not a button.
  const note = dayNoteOf(st, iso)
  const canNote = !!note || (canNoteDay(iso) && !workoutsOn(st, iso).length)
  const remaining = queueRemaining(st)
  const ownLoop = !!st.queue && !!st.rotation && st.queue.rotationId === st.rotation.id
  const coach = remaining.map((id: any) => st.routines.find((r: any) => r.id === id)).filter(Boolean)
  // Active pins straight from the plan (earliest day per session, today or later) — not the
  // row's 'pinned' items, which leave out the session pinned to today itself.
  const pinnedOn = Object.entries(st.dayPlan).filter(([d, id]: any) => d >= todayISO() && remaining.includes(id)).sort()
    .reduce((m: any, [d, id]: any) => (m[id] ? m : { ...m, [id]: d }), {})
  for (const c of st.programmes?.cycles || []) if (c.status === 'active' || c.status === 'paused')
    for (const o of c.occurrences) if (o.pinnedOn && o.status === 'pending') pinnedOn[o.routineId] = o.pinnedOn
  const set = (v: any) => {
    const r = st.routines.find((r: any) => r.id === v)
    try { if (!updateTarget(target, (s: any) => {
      if (v && v !== 'rest' && !s.routines.some((r: any) => r.id === v)) abortGuardedUpdate()
      if (r?.programme) {
        pinProgramme(s, r.programme.cycleId, r.programme.instanceId, iso)
        delete s.dayPlan[iso]
      }
      else {
        for (const p of programPins) pinProgramme(s, p.cycle.id, p.occurrence.instanceId, null)
        if (!v) delete s.dayPlan[iso]; else s.dayPlan[iso] = v
      }
    })) return } catch (err: any) { toast(t(err.message)); return }
    close()
    toast(v === '' ? t('Back to weekly plan') : v === 'rest' ? t('{0} set to rest', fmtDate(iso, false)) : t('{0} planned for {1}', (st.routines.find((r: any) => r.id === v) || {}).name, fmtDate(iso, false)))
  }
  const row = (r: any) => <div key={r.id} className="item" {...tappable(() => set(r.id))}>
    <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
    <div className="grow"><div className="tt">{r.name}</div><div className="ss">{pinnedOn[r.id] && pinnedOn[r.id] !== iso ? fmtDate(pinnedOn[r.id], true) : exCount(r.ex.length)}</div></div>
    {effIds.includes(r.id) && <Icon name="check" className="accent" />}</div>
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Weekly plan:')} {weeklyNames.length ? deriveSessionName(weeklyNames) : t('Rest')}{changed && <span style={{ color: 'var(--orange)' }}> · {t('changed for this day')}</span>}<br />{t('Sick, missed a day or want a different session? Pick what to train instead.')}</div>
    {missed && <div style={{ marginBottom: 14 }}><Button variant="primary" icon="checkCircle" onClick={logIt}>{t('Log this workout')}</Button></div>}
    {canNote && <div className="day-note" style={{ marginBottom: 14 }}>
      <div className="item day-note-row" {...tappable(() => { if (validateTarget(target)) dayNoteSheet(iso) })}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name={note?.tag ? DAY_NOTE_ICON[note.tag as keyof typeof DAY_NOTE_ICON] : 'note'} /></span>
        <div className="grow">{note
          ? <><div className="tt">{note.tag ? t(DAY_NOTE_LABEL[note.tag as keyof typeof DAY_NOTE_LABEL]) : t('Day note')}</div>{note.text && <div className="ss" style={{ whiteSpace: 'pre-wrap' }}>{note.text}</div>}</>
          : <div className="tt">{t('Add a note for this day')}</div>}</div>
        <Icon name={note ? 'pencil' : 'plus'} className="chev" />
      </div>
    </div>}
    {coach.length > 0 && <>
      <h4 className="sec" style={{ marginTop: 0 }}>{st.queue?.programmeCycleId ? t('Program sessions') : ownLoop ? t('Your loop') : t('Coach week')}</h4>
      <div className="list" style={{ marginBottom: 8 }}>{coach.map(row)}</div>
    </>}
    <div className="list">
      {st.routines.filter((r: any) => !remaining.includes(r.id) && (!r.programme || (st.programmes?.cycles || []).some((c: any) => c.id === r.programme.cycleId && c.status === 'active' && c.occurrences.some((o: any) => o.instanceId === r.programme.instanceId && o.status === 'pending')))).map(row)}
      <div className="item" {...tappable(() => set('rest'))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest / skip this day')}</div></div>{effIds.length === 0 && <Icon name="check" className="accent" />}</div>
      {hasOvr && <div className="item" {...tappable(() => set(''))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="reset" /></span><div className="grow"><div className="tt">{t('Back to weekly plan')}</div></div></div>}
    </div>
  </>
}
export const dayOverrideSheet = (iso: any) => {
  const target = captureTarget()
  return ui().openSheet((close: any) => <DayOverride iso={iso} target={target} close={close} />)
}

// Why a day went without training (#261): one quick pick, a line of text, or both. Saving an
// empty note takes it away (a stamped clear, lib/day-notes.js withDayNote), and so does Remove.
function DayNote({ iso, target, close }: any) {
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore((s: any) => s.S)
  const index = useStore((s: any) => s.index)
  const had = dayNoteOf(st, iso)
  const [tag, setTag] = useState<keyof typeof DAY_NOTE_LABEL | null>(had?.tag || null)
  const [text, setText] = useState(had?.text || '')
  const write = (v: any) => {
    if (!updateTarget(target, (s: any) => {
      // Preserve future fields while letting K02 canonicalize/clear tag, text and stamp.
      const { tag: _tag, text: _text, _ts: _stamp, ...unknown } = s.dayNotes?.[iso] || {}
      const notes = withDayNote(s.dayNotes, iso, v)
      notes[iso] = { ...unknown, ...notes[iso] }
      s.dayNotes = notes
    })) return false
    close()
    return true
  }
  const save = () => {
    if (!validateTarget(target)) return
    const clean = text.trim().slice(0, NOTE_MAX)
    if (!tag && !clean && !had) { close(); return }
    if (!write({ tag, text: clean })) return
    toast(tag || clean ? t('Noted. See you next session!') : t('Note removed'))
  }
  const remove = () => { if (write(null)) toast(t('Note removed')) }
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Life happens. Leave yourself a note, and the missed-day nudge lets this one go.')}</div>
    <div className="chips" style={{ margin: '0 0 12px' }}>
      {DAY_NOTE_TAGS.map((k: any) => <button key={k} className={'chip nocap' + (tag === k ? ' on' : '')} aria-pressed={tag === k}
        onClick={() => setTag(tag === k ? null : k as keyof typeof DAY_NOTE_LABEL)}><Icon name={DAY_NOTE_ICON[k as keyof typeof DAY_NOTE_ICON]} /> {t(DAY_NOTE_LABEL[k as keyof typeof DAY_NOTE_LABEL])}</button>)}
    </div>
    <textarea ref={noteRef} className="input" rows={3} maxLength={NOTE_MAX} value={text}
      placeholder={t('Anything else? (optional)')}
      onFocus={onNoteFocus} onChange={(e: any) => setText(e.target.value)} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {had && <><div style={{ height: 10 }} /><Button variant="ghost" icon="trash" onClick={remove}>{t('Remove note')}</Button></>}
  </>
}
export const dayNoteSheet = (iso: any) => {
  const target = captureTarget()
  return ui().openSheet((close: any) => <DayNote iso={iso} target={target} close={close} />)
}

// Plan → Schedule → a weekday. One sheet for the whole day: tap routines to put them on it or
// take them off (two or more make a combined day, docs/dev/COMBINE_ROUTINES.md), in the order
// tapped, which is the order the session runs them; "Rest day" clears it. The sheet stays open
// for a second pick, so "Done" closes it. The weekday never stores [] (the key goes instead).
function DayAssign({ day, target, close }: any) {
  const st = useStore((s: any) => s.S)
  const index = useStore((s: any) => s.index)
  const cur = ([] as string[]).concat(st.week[day] || [])
  const toggle = (id: any) => updateTarget(target, (s: any) => {
    if (!s.routines.some((r: any) => r.id === id)) abortGuardedUpdate()
    const ids = ([] as string[]).concat(s.week[day] || [])
    const next = ids.includes(id) ? ids.filter((x: any) => x !== id) : [...ids, id]
    if (next.length) s.week[day] = next; else delete s.week[day]
  })
  const rest = () => { if (updateTarget(target, (s: any) => { delete s.week[day] })) close() }
  return <>
    <h3 style={{ marginBottom: 2 }}>{t(DAYN[day])}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Pick one routine, or more to train them together.')}</div>
    <div className="list menu-list">
      <div className="item menu-item" {...tappable(rest)}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest day')}</div></div><span className={'menu-on' + (!cur.length ? ' is-on' : '')}><Icon name="check" /></span></div>
      {st.routines.map((r: any) => {
        const on = cur.includes(r.id)
        return <div key={r.id} className="item menu-item" aria-pressed={on} {...tappable(() => toggle(r.id))}>
          <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
          <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
          <span className={'menu-on' + (on ? ' is-on' : '')}><Icon name="check" /></span>
        </div>
      })}
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const dayAssignSheet = (day: any) => {
  const target = captureTarget()
  return ui().openSheet((close: any) => <DayAssign day={day} target={target} close={close} />)
}

/* ============================ workout detail ============================ */
// Correcting when a saved session happened: typed in from another app, or logged on the wrong
// day. Only its place in history moves — the sets, the volume and the notes are the record, and
// the session keeps the length it had. The PR badges of the exercises it trained are worked out
// again, because "this was a record" is a claim about the sessions before it.
function WorkoutDateEdit({ w, target, onDone, close }: any) {
  const [date, setDate] = useState(w.d)
  const [time, setTime] = useState(startTimeOf(w))
  const today = todayISO()
  const save = () => {
    if (!validateTarget(target)) return
    if (!date || date > today) { toast(t('Pick a day up to today')); return }
    // Nothing to do, and nothing to push: a no-op save and a workout deleted from another
    // sheet both just close.
    if (date === w.d && time === startTimeOf(w)) { close(); return }
    if (!(S().workouts || []).some((x: any) => sameWorkout(x, w))) { close(); return }
    // It keeps its length, so the end it would have is what has to be in the past.
    if (endsInFuture(date, time, durationMinOf(w))) { toast(t('That’s still in the future. Try an earlier start.')); return }
    if (!updateTarget(target, (s: any) => {
      const next = moveWorkout(s.workouts, w, date, time, undefined, useStore.getState().index)
      if (next) s.workouts = next
    })) return
    close()
    onDone && onDone()
    toast(t('Workout moved'))
  }
  return <>
    <h3>{t('Change date & time')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('The session keeps its length. Personal records are worked out again from the new order.')}</div>
    <Row icon="calendar" title={t('Date')}>
      <input type="date" className="timef" value={date} max={today} onChange={(e: any) => setDate(e.target.value)} /></Row>
    <Row icon="clock" title={t('Start time')}>
      <input type="time" className="timef" value={time} onChange={(e: any) => setTime(e.target.value)} /></Row>
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const workoutDateSheet = (w: any, onDone?: () => void) => {
  const target = captureTarget(w)
  return ui().openSheet((close: any) => <WorkoutDateEdit w={w} target={target} onDone={onDone} close={close} />)
}

// Correcting how long a saved session ran — mostly the workout nobody ended until they got home
// (Discord). The start stays, the end follows it; the sets, the order of history and the badges
// do not depend on the length and are left alone.
function WorkoutDurationEdit({ w, target, onDone, close }: any) {
  const [dur, setDur] = useState(durationMinOf(w))
  // A cleared field reads as 0, and saving that made the session one minute long without a word
  // (QA 1.3.9): it is refused with the reason under the field, and the saved length stays.
  const durInvalid = !(dur >= 1)
  const durTooLong = dur > MAX_DURATION_MIN
  const save = () => {
    if (!validateTarget(target)) return
    if (durInvalid) { toast(t('Enter how long it took (at least 1 minute).')); return }
    if (durTooLong) { toast(t('That’s more than a day. Keep it to 24 hours or less.')); return }
    let changed = false
    if (!updateTarget(target, (s: any) => {
      const next = setWorkoutDuration(s.workouts, w, dur)   // at least a minute, however the field was left
      if (next) { s.workouts = next; changed = true }
    })) return
    close()
    if (!changed) return
    onDone && onDone()
    toast(t('Duration changed'))
  }
  return <>
    <h3>{t('Change duration')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Forgot to finish on time? Set how long the session really took. It keeps its start time and its sets.')}</div>
    {/* min 0, not 1: the stepper would put a cleared field back to 1 as it lost focus to Save. */}
    {/* No max either: one would cut a typo down to a day on blur and save that without a word. */}
    <Stepper label={t('Duration')} unit={t('min')} value={dur} step={5} min={0} decimal={false} invalid={durInvalid || durTooLong} onChange={(v: any) => setDur(Math.round(v))} />
    {durInvalid && <div className="small" style={{ color: 'var(--red)', marginTop: 6 }}>{t('Enter how long it took (at least 1 minute).')}</div>}
    {durTooLong && <div className="small" style={{ color: 'var(--red)', marginTop: 6 }}>{t('That’s more than a day. Keep it to 24 hours or less.')}</div>}
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
  </>
}
export const workoutDurationSheet = (w: any, onDone?: () => void) => {
  const target = captureTarget(w)
  return ui().openSheet((close: any) => <WorkoutDurationEdit w={w} target={target} onDone={onDone} close={close} />)
}

function WorkoutDetail({ w, target, close }: any) {
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore((s: any) => s.S)
  const index = useStore((s: any) => s.index)
  // The session note is editable here rather than only at the finish sheet: what you want to
  // record about a session is often clearer once you have looked at what you actually did.
  const [note, setNote] = useState(w.note || '')
  // A note written here is an edit of the saved workout, stamped for the sync to keep it over an
  // older copy of the same workout (stampWorkout) — and only when it changed, since a stamp
  // outranks what another device wrote since.
  const saveNote = () => updateTarget(target, (s: any) => {
    const rec = s.workouts.find((x: any) => sameWorkout(x, w))
    if (!rec) return
    const text = note.trim().slice(0, NOTE_MAX)
    if (text === (rec.note || '')) return
    if (text) rec.note = text; else delete rec.note
    stampWorkout(rec)
  })
  // onBlur alone loses the note: Escape, the Android back gesture and swipe-to-dismiss all
  // close the sheet without ever moving focus out of the textarea. Flush on unmount too. The
  // ref is what makes that work — a cleanup closes over the note from its own render, which
  // is the empty string this started with.
  const latest = useRef(note)
  latest.current = note
  const initial = useRef(w.note || '')
  useEffect(() => () => {
    const text = latest.current.trim().slice(0, NOTE_MAX)
    if (text === initial.current) return
    updateTarget(target, (s: any) => {
      const rec = s.workouts.find((x: any) => sameWorkout(x, w))
      if (!rec || text === (rec.note || '')) return   // deleted from this very sheet, or already saved
      if (text) rec.note = text; else delete rec.note
      stampWorkout(rec)
    })
  }, [])
  const nameOf = useCallback((e: any) => (index[e.id] ? exerciseNameFor(index[e.id]) : (e.n || e.id)), [index])
  // Tapping an exercise opens its history (Discord 'Improvement ideas'): from one session to the
  // curve it sits on, which is the question a past workout raises most often.
  const entryRow = (e: any, i: any) => {
    const ex = index[e.id]
    return <div key={i} className="row wd-ex" style={{ alignItems: 'flex-start' }} {...tappable(() => { if (validateTarget(target)) services.exerciseHistorySheet(e.id) })}>
      {ex && <Thumb ex={ex} />}
      <div className="grow"><div className={`tt ${exerciseNameClass(ex)}`} style={{ fontWeight: 600 }}>{nameOf(e)} {w.prs && w.prs.includes(e.id) && <span className="pr"><Icon name="trophy" />PR</span>}</div>
        <div className="ss">{e.sets.filter(hasCompletedWork).map((s: any) => setLabel(e.id, s, e.target, speedUnitOf(st), index)).join('  ·  ') || t('no sets')}</div>
        {e.sets.filter((s:any)=>hasCompletedWork(s) && s.nativeTarget?.relativeLoad).map((s:any,i:number)=><div key={i} className="small"><NativeTarget row={s}/></div>)}
        {e.note && <div className="small dim" style={{ marginTop: 3 }}>
          {e.notePin && <Icon name="pin" style={{ fontSize: 12, marginInlineEnd: 4, verticalAlign: '-1px', color: 'var(--yellow)' }} />}{e.note}
        </div>}</div>
      <Icon name="chevronRight" className="chev" style={{ alignSelf: 'center' }} />
    </div>
  }
  // Exercises done as a superset stay together under a "Superset" label and one bar, the way the
  // routine editor shows them (Discord: "supersets aren't shown at all"). Adjacent entries with
  // the same tag, as in the workout itself; a workout finished before the tag was kept has none.
  const entryRows = (units: any) => units.map((unit: any) => {
    if (unit.length < 2) return entryRow(w.entries[unit[0]], unit[0])
    return <div key={'ss' + unit[0]} className="wd-ss">
      <div className="ss-label"><Icon name="link" />{t('Superset')}</div>
      {unit.map((i: any) => entryRow(w.entries[i], i))}
    </div>
  })
  // Copied with the note as it stands in the box, which may not be saved yet.
  const copyAsText = async () => {
    if (!validateTarget(target)) return
    const rec = { ...(st.workouts.find((x: any) => sameWorkout(x, w)) || w), note: note.trim() }
    toast(await copyText(workoutText(rec, { unit: st.unit, nameOf, speedUnit: speedUnitOf(st) }, index)) ? t('Copied') : t('Could not copy'))
  }
  // A Garmin .fit activity (#447) of the saved record, for Garmin Connect's Import Data.
  const exportFit = () => {
    if (!validateTarget(target)) return
    const rec = st.workouts.find((x: any) => sameWorkout(x, w)) || w
    let bytes
    try { bytes = workoutFit(rec, { unit: st.unit, version: services.version }, index) }
    catch (e: any) { toast(t('Could not create the file')); return }
    saveFitFile(new Blob([bytes], { type: 'application/vnd.ant.fit' }), fitFileName(rec))
  }
  const shareAsImage = () => {
    if (!validateTarget(target)) return
    const rec = st.workouts.find((x: any) => sameWorkout(x, w)) || w
    ui().openSheet((c2: any) => <ShareWorkoutImage w={rec} target={target} close={c2} />)
  }
  // A combined session's entries carry a `rid`; group them into per-routine sections in merge
  // order, with each section's supersets paired inside it (sessionSections, which "Copy as text"
  // reads the workout through too). A legacy single-routine workout (one routineIds, or no rid
  // anywhere) renders flat.
  const groups = sessionSections(w.entries)
  const grouped = groups.length > 1 || (groups[0] && groups[0].rid && (w.routineIds || []).length > 1)
  return <>
    <h3>{w.name}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{[fmtDate(w.d, true), ...durPart(w.end - w.start), fmtVol(w.vol, st.unit), ...(w.bw ? [fmtNum(w.bw) + ' ' + st.unit] : [])].join(' · ')}</div>
    {grouped ? groups.map((g: any) => {
      const r = g.rid ? st.routines.find((x: any) => x.id === g.rid) : null
      const items = g.items.map((i: any) => w.entries[i])
      const setN = items.reduce((n: any, e: any) => n + e.sets.filter((s: any) => s.done && !isWarmupRow(s)).length, 0)
      const vol = workoutVolume({ entries: items }, index)
      return <div key={g.rid || '__none'}>
        <div className="row between" style={{ margin: '2px 0 8px', paddingBottom: 6, borderBottom: '1px solid var(--sep)' }}>
          <div className="row" style={{ gap: 7, fontWeight: 600 }}>
            {r && <Icon name={glyphOf(r.emoji)} />}{r ? r.name : t('Freestyle')}
          </div>
          <div className="small dim">{t('{0} sets', setN)} · {fmtVol(vol, st.unit)}</div>
        </div>
        {entryRows(g.units)}
      </div>
    }) : entryRows(groups[0]?.units || [])}
    <div className="small muted" style={{ margin: '4px 0 6px' }}>{t('Session note')}</div>
    <textarea ref={noteRef} className="input" rows={2} maxLength={NOTE_MAX} value={note}
      placeholder={t('How the session went as a whole.')}
      onFocus={onNoteFocus} onChange={(e: any) => setNote(e.target.value)} onBlur={saveNote} />
    <div style={{ height: 14 }} />
    {st.active && <p className="small muted">{t('Finish the current workout first.')}</p>}
    {/* The editor starts from the record as it is, so a note typed here goes in first — the same
        flush the date row does, and the unmount hook then has nothing left to write over it. */}
    <Button icon="pencil" disabled={!!st.active} onClick={() => {
      if (!saveNote()) return
      initial.current = latest.current.trim().slice(0, NOTE_MAX)
      try { if (updateTarget(target, (state: any) => { editCompletedSession(state, w); if (state.active?.editingWorkoutId) state.active.editBase = {...state.active.editBase, sheetInstanceId: uid()} })) closeThenNav(close, '/workout') }
      catch (error: any) { toast(t(error.message)) }
    }}>{t('Edit workout')}</Button>
    <div style={{ height: 8 }} />
    {/* The same exercises again, today, as a new session (#58): the rows read what was logged
        in this workout. The record itself stays as it is. */}
    <Button icon="reset" disabled={!!st.active} style={{ marginBottom: 8 }} onClick={() => {
      if (!saveNote()) return
      initial.current = latest.current.trim().slice(0, NOTE_MAX)
      if (!validateTarget(target)) return
      services.repeatWorkout(w, close)
    }}>{t('Repeat today')}</Button>
    {/* The note lives in a textarea that only writes on blur, and moving the workout re-keys a
        legacy record — so flush it first and stop the unmount hook writing it a second time. */}
    <Button icon="calendar" style={{ marginBottom: 8 }} onClick={() => {
      if (!saveNote()) return
      initial.current = latest.current.trim().slice(0, NOTE_MAX)
      if (!validateTarget(target)) return
      workoutDateSheet(w, close)
    }}>{t('Change date & time')}</Button>
    <Button icon="stopwatch" style={{ marginBottom: 8 }} onClick={() => {
      if (!saveNote()) return
      initial.current = latest.current.trim().slice(0, NOTE_MAX)
      if (!validateTarget(target)) return
      workoutDurationSheet(w, close)
    }}>{t('Change duration')}</Button>
    <Button icon="plus" onClick={() => confirmSheet({
      title: t('Save as routine?'),
      message: t('Create an independent routine from these exercise targets. Your workout history is kept.'),
      confirmText: t('Save'),
      onConfirm: () => {
        let id
        try { if (!updateTarget(target, (s: any) => { id = saveSessionAsRoutine(s, s.workouts.find((x: any) => sameWorkout(x, w)), w.name, useStore.getState().index) })) return }
        catch (e: any) { toast(t(e.message)); return }
        close()
        nav('/plan/r/' + id)
      }
    })}>{t('Save as routine')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="copy" onClick={copyAsText}>{t('Copy as text')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="share" onClick={shareAsImage}>{t('Share as image')}</Button>
    <div style={{ height: 8 }} />
    <Button icon="download" onClick={exportFit}>{t('Export as .fit file')}</Button>
    <div style={{ height: 10 }} />
    {/* Matched the way the edits above are, not by id: a workout from before ids has none, and
        filtering on `x.id !== undefined` took every other one of them with it. */}
    <Button variant="danger" onClick={() => confirmSheet({ title: t('Delete workout?'), message: t('This removes it from your history for good.'), confirmText: t('Delete'), danger: true, onConfirm: () => { if (!updateTarget(target, (s: any) => { s.workouts = s.workouts.filter((x: any) => !sameWorkout(x, w)) })) return; close(); toast(t('Workout deleted')) } })}>{t('Delete workout')}</Button>
  </>
}
// "Share as image" (#453): the card lib/workout-card.js lays out, painted in the theme and accent
// the app is showing right now, previewed before it goes anywhere. The muscle map is the finish
// summary's, for this one session; whether the card carries it is remembered with the profile.
function ShareWorkoutImage({ w, target, close }: any) {
  const st = useStore((s: any) => s.S)
  const index = useStore((s: any) => s.index)
  const nameOf = useCallback((e: any) => (index[e.id] ? exerciseNameFor(index[e.id]) : (e.n || e.id)), [index])
  const withMap = st.shareMap !== false
  const model = useMemo(() => workoutCardModel(w, { unit: st.unit, nameOf }, index), [w, st.unit, nameOf, index])
  // The last picture stays up while the next one is drawn, so the toggle never blanks the sheet.
  const [img, setImg] = useState<{blob?: Blob; url?: string; failed?: boolean} | null>(null)
  const [busy, setBusy] = useState(false)
  const shown = useRef<string | null>(null)
  useEffect(() => {
    let alive = true
    workoutCardImage(model, { map: withMap, body: st.body })
      .then((blob: any) => {
        if (!alive || !validateTarget(target)) return
        if (!blob) { setImg((prev: any) => ({ ...prev, failed: true })); return }
        if (shown.current) revokeImageURL(shown.current)
        shown.current = imageURL(blob)
        setImg({ blob, url: shown.current })
      })
      .catch(() => { if (alive) setImg((prev: any) => ({ ...prev, failed: true })) })
    return () => { alive = false }
  }, [model, withMap, st.body])
  useEffect(() => () => { if (shown.current) revokeImageURL(shown.current) }, [])
  const name = 'opengym-workout-' + (workoutDay(w) || todayISO()) + '.png'
  const share = async () => {
    if (!validateTarget(target)) return
    setBusy(true)
    try { await shareImage(img!.blob!, name, w.name || 'openGym', () => validateTarget(target)); if (validateTarget(target)) close() }
    catch { toast(t('Could not share the image')) }
    finally { setBusy(false) }
  }
  return <>
    <h3>{t('Share workout')}</h3>
    <div className="share-card">
      {img?.url
        ? <img src={img.url} alt={t('Preview of the image to share')} />
        : img?.failed ? <div className="share-card-ph small muted">{t('Could not create the image')}</div>
          : <div className="share-card-ph" aria-hidden="true" />}
    </div>
    {model.levels && <div className="sect-b" style={{ marginBottom: 12 }}>
      <Row icon="figureStrength" iconTint="var(--acc)" title={t('Muscle map')} subtitle={t('Show which muscles this workout trained.')}>
        <Switch checked={withMap} aria-label={t('Muscle map')} onChange={(v: any) => updateTarget(target, (s: any) => { s.shareMap = v })} />
      </Row>
    </div>}
    <Button variant="primary" icon="share" disabled={!img?.blob || busy} onClick={share}>{t('Share')}</Button>
  </>
}
async function workoutCardImage(model: any, { map, body }: any) {
  const root = ux().window!.getComputedStyle(ux().document!.documentElement)
  const css = (name: any, fallback: any) => root.getPropertyValue(name).trim() || fallback
  const colors = { bg: css('--bg', '#000'), surface: css('--surface', '#1c1c1e'), tile: css('--surface-2', '#2c2c2e'), label: css('--label', '#fff'), label2: css('--label-2', '#999'), acc: css('--acc', '#30d158') }
  // The body geometry is ~90 KB and lazy everywhere else too (components/BodyMap.jsx).
  const geometry = map && model.levels ? (await import('./lib/body-paths')).default : null
  const shape = geometry && (geometry[body as keyof typeof geometry] || geometry.male)
  const canvas = ux().document!.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const measure = (text: any, weight: any, size: any) => { ctx.font = `${weight} ${size}px ${CARD_FONT}`; return ctx.measureText(text).width }
  const layout = layoutWorkoutCard(model, { measure, rtl: false, map: shape ? { aspect: viewAspect(shape.front) } : null })
  canvas.width = layout.width
  canvas.height = layout.height
  drawWorkoutCard(ctx, layout, colors, shape ? { body: shape, levels: model.levels } : null)
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
}

// Garmin Connect itself), a download in the browser.
async function saveFitFile(blob: Blob, name: string) {
  saveBlob(blob, name)
  toast(t('Saved. Garmin Connect can take it from here.'))
}
async function shareImage(blob: Blob, name: string, title: string, current: () => boolean) {
  if (!(await shareBlob(blob, name, title)) && current()) { saveBlob(blob, name); toast(t('Image saved')) }
}
export const workoutDetailSheet = (w: any) => {
  const target = captureTarget(w)
  return ui().openSheet((close: any) => <WorkoutDetail w={w} target={target} close={close} />)
}

/* ============================ calendar ============================ */
function Calendar({ start, close }: any) {
  const st = useStore((s: any) => s.S)
  const index = useStore((s: any) => s.index)
  const [cur, setCur] = useState(() => { const d = start ? new Date(start + 'T12:00:00') : new Date(); d.setDate(1); return d })
  const y = cur.getFullYear(), mo = cur.getMonth()
  const byDay: Record<string, any[]> = {}
  st.workouts.forEach((w: any) => {
    const day = workoutDay(w)
    if (day) (byDay[day] = byDay[day] || []).push(w)
  })
  // Which column the 1st sits in, and therefore how many blanks come before it.
  const ws = weekStartOf(st)
  const startOffset = weekDayOffset(new Date(y, mo, 1).getDay(), ws)
  const daysIn = new Date(y, mo + 1, 0).getDate()
  const monthWs = st.workouts.filter((w: any) => workoutDay(w)?.startsWith(y + '-' + String(mo + 1).padStart(2, '0')))
  const monthVol = monthWs.reduce((a: any, w: any) => a + (w.vol || 0), 0)
  const monthMs = monthWs.reduce((a: any, w: any) => a + Math.max(0, (w.end || w.start) - w.start), 0)
  const cells = []
  for (let i = 0; i < startOffset; i++) cells.push(<div key={'e' + i} />)
  for (let d = 1; d <= daysIn; d++) {
    const iso = y + '-' + String(mo + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0')
    const ws = byDay[iso], planned = effectiveRoutineIds(st, iso).length > 0, ovr = st.dayPlan[iso] !== undefined && pinState(st, st.dayPlan[iso]) !== 'done'
    // A day off with a note on it (#261) shows the note's dot instead of the plan's, and its
    // note as the tooltip; tapping it opens the day sheet, where the note is.
    const note = !ws && dayNoteOf(st, iso)
    const dotCls = ws ? 'done' : note ? 'noted' : ovr && planned ? 'ovr' : planned ? 'plan' : ''
    cells.push(<button key={d} className={'cal-d' + (ws ? ' has' : '') + (note ? ' noted' : '') + (iso === todayISO() ? ' today' : '')}
      title={note ? dayNoteLine(note, t) : undefined} onClick={() => {
      if (!ws) { close(); dayOverrideSheet(iso); return }
      if (ws.length === 1) { close(); workoutDetailSheet(ws[0]); return }
      close(); ui().openSheet((c2: any) => <><h3>{fmtDate(iso, true)}</h3><div className="list">{ws.map((w: any) => <WorkoutRow key={w.id} w={w} onClick={() => { c2(); workoutDetailSheet(w) }} />)}</div></>)
    }}><span>{d}</span><i className={dotCls} /></button>)
  }
  return <>
    <div className="row between" style={{ marginBottom: 2 }}>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo - 1, 1))} aria-label={t('Previous month')}><Icon name="chevronLeft" /></button>
      <h3 style={{ margin: 0 }}>{t(MONTHS_LONG[mo])} {y}</h3>
      <button className="iconbtn" onClick={() => setCur(new Date(y, mo + 1, 1))} aria-label={t('Next month')}><Icon name="chevronRight" /></button>
    </div>
    <div className="small muted" style={{ textAlign: 'center' }}>{monthWs.length ? `${tn('{0} workout', '{0} workouts', monthWs.length)} · ${fmtDur(monthMs)} · ${fmtVol(monthVol, st.unit)}` : t('No workouts this month')}</div>
    <div className="cal-grid">{weekOrder(ws).map((d: any) => <div key={d} className="cal-h">{t(DAYS[d])}</div>)}{cells}</div>
    <div className="cal-legend">
      <span><i style={{ background: 'var(--acc)' }} />{t('Trained')}</span>
      <span><i style={{ background: 'var(--label-3)' }} />{t('Planned')}</span>
      <span><i style={{ background: 'var(--orange)' }} />{t('Rescheduled')}</span>
      {Object.keys(st.dayNotes || {}).some((k: any) => k.startsWith(y + '-' + String(mo + 1).padStart(2, '0')) && dayNoteOf(st, k)) &&
        <span><i style={{ background: 'var(--indigo)' }} />{t('Day note')}</span>}
    </div>
    <div className="small dim" style={{ textAlign: 'center', marginTop: 10 }}>{t('Tap a trained day for details · tap any other day to plan a session')}</div>
  </>
}
export const calendarSheet = (start?: string) => ui().openSheet((close: any) => <Calendar start={start} close={close} />)

/* shared small workout row (used in lists) */
export function WorkoutRow({ w, onClick }: any) {
  const st = useStore((s: any) => s.S)
  const index = useStore((s: any) => s.index)
  const glyph = glyphOf((st.routines.find((r: any) => r.id === w.routineId) || {}).emoji)
  return <div className="item" {...tappable(onClick)}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19 }}><Icon name={glyph} /></span>
    <div className="grow"><div className="tt">{w.name}</div>
      <div className="ss">{[fmtDate(w.d, true), ...durPart(w.end - w.start), tn('{0} set', '{0} sets', setsDone(w)), fmtVol(w.vol, st.unit)].join(' · ')}</div></div>
    {w.prs && w.prs.length > 0 && <span className="pr"><Icon name="trophy" />{w.prs.length} PR</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

/* a day off with a note (#261), as History lists it between the workouts */
export function DayNoteRow({ iso, note }: any) {
  return <div className="item day-note-row" {...tappable(() => dayNoteSheet(iso))}>
    <span className="lrow-i" style={{ width: 34, height: 34, borderRadius: 8, fontSize: 19, background: 'var(--surface-3)' }}><Icon name={note.tag ? DAY_NOTE_ICON[note.tag as keyof typeof DAY_NOTE_ICON] : 'note'} /></span>
    <div className="grow"><div className="tt">{note.tag ? t(DAY_NOTE_LABEL[note.tag as keyof typeof DAY_NOTE_LABEL]) : t('Day note')}</div>
      <div className="ss">{[fmtDate(iso, true), note.text].filter(Boolean).join(' · ')}</div></div>
    <Icon name="chevronRight" className="chev" />
  </div>
}

