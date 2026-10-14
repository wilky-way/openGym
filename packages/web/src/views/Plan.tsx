import { sessionPreviewSheet } from '../components/SessionPreview'
import { capturePlanTarget, updatePlanTarget, validatePlanTarget, planFingerprint, occurrenceKeys, type PlanTarget } from './plan-target'
import { ux } from '../platform/ux'
import { clientPlatform } from '../lib/client-io'
import { ProgrammeCalendar, Programs, ProgrammeRoutines, programmeSkipSheet } from './plan-services'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { DAYN, DAYS, weekOrder, weekStartOf, uid, exCount, routineCount, todayISO, fmtDate } from '@opengym/core/format'
import { t } from '../lib/i18n'
import {
  dayAssignSheet, starterPlanSheet, confirmSheet, menuSheet,
  planHasRoutines, exportPlanFile, printWholePlan, importPlanFile,
} from '../sheets'
import Icon from '../components/Icon'
import { Button, Row, Section, Segmented } from '../components/ui'
import SwipeRow from '../components/SwipeRow'
import { copyRoutine, deleteRoutine, restoreRoutine, routineSnapshot } from '@opengym/core/routines'
import { workoutControls } from '@opengym/core/workout-controls'
import { tappable } from '../lib/use-sheet-keyboard'
import { useListReorder, moved } from '../lib/use-list-reorder'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs'
import { queueOf, queueView } from '@opengym/core/queue'
import { deriveSessionName } from '@opengym/core/session-merge'
import { markUndone, undoMarks } from '@opengym/core/sync-merge'
import {
  scheduleModeOf, queueRecovery, rotationIds, saveRotation, startNewPass, startPass, stopPass,
  chooseRotation, chooseFixedWeek,
} from '@opengym/core/rotation'

// Plan has two views (v1.3.11): Schedule (how you train, and when) and Routines (what you
// train). The last one you looked at comes back: a per-device convenience, never synced, so it
// lives in this browser's storage and not in S.
export const PLAN_VIEW_KEY: any = 'gym_plan_view'
const readView: any = () => {
  try { return ['routines', 'programs'].includes((clientPlatform().kv.get(PLAN_VIEW_KEY) || '')) ? clientPlatform().kv.get(PLAN_VIEW_KEY) : 'schedule' } catch { return 'schedule' }
}

/* Undo for Plan's two removals (v1.3.11). Both go through the store's normal update, so sync
   sees an ordinary edit (a routine put back clears its own removal stamp, lib/sync-merge.js). */

/** Deletes a routine with an Undo toast in place of a confirm: the toast puts it back exactly,
 *  list place, weekdays, reschedules and loop included (lib/routines.js routineSnapshot). */
export function deleteRoutineWithUndo(id: any, target?: PlanTarget) {
  if (target && !validatePlanTarget(target)) return false
  const st: any = useStore.getState()
  const routine: any = st.S.routines.find((r: any) => r.id === id)
  if (routine?.programme && st.S.programmes?.cycles.some((c: any) => c.id === routine.programme.cycleId && ['active', 'paused'].includes(c.status))) { programmeSkipSheet(routine); return false }
  const owner = capturePlanTarget()
  const opened = JSON.stringify(routine)
  target ??= capturePlanTarget(s => JSON.stringify(s.routines.find((r: any) => r.id === id)) === opened)
  const snap: any = routineSnapshot(st.S, id)
  if (!snap) return false
  const before: any = st.S
  if (!updatePlanTarget(target, s => { if (!s.routines.some((r: any) => r.id === id)) throw new Error('Missing routine'); deleteRoutine(s, id) })) return false
  // What the removal moved (weekdays, reschedules, the loop), for the Undo to mark as put back:
  // a change another device made to one of them before it saw the removal then still wins.
  snap.marks = undoMarks(before, useStore.getState().S)
  useUI.getState().toast(t('“{0}” gone.', snap.routine.name), { action: t('Undo'), onAction: () => undoDeleteRoutine(snap, owner) })
  return true
}
export function undoDeleteRoutine(snap: any, owner = capturePlanTarget()) {
  let ok: any = false
  if (!updatePlanTarget(owner, s => { ok = restoreRoutine(s, snap); if (ok && snap.marks) markUndone(s, snap.marks) })) return false
  // False when a sync brought it back first (another device's Undo, or its later edit).
  if (!ok) useUI.getState().toast(t('It’s already back.'))
  return ok
}

/** Takes a routine out of the loop (the swipe and the edit-mode minus), with an Undo. The removal
 *  is the editor's own (`setSeq`), which may sweep the routine's future pins or roll a finished
 *  round over; so while the loop is still what the removal left, Undo puts the loop, the round and
 *  the swept pins back as they were. Once something else changed the loop, it just slots the
 *  routine back in at its old place, through the same save an edit uses. */
export function takeOutOfLoop(id: any, setSeq: any, seq: any, label: any) {
  const at: any = seq.indexOf(id)
  if (at < 0) return false
  const before: any = useStore.getState().S
  const owner = capturePlanTarget()
  const snap: any = structuredClone({ rotation: before.rotation ?? null, queue: before.queue ?? null, dayPlan: before.dayPlan ?? {} })
  if (setSeq(seq.filter((x: any) => x !== id)) === false) return false
  const after: any = useStore.getState().S
  const mark: any = loopMark(after)
  const marks: any = undoMarks(before, after)
  const name: any = before.routines.find((r: any) => r.id === id)?.name ?? id
  useUI.getState().toast(t('“{0}” is out of the loop.', name), { action: t('Undo'), onAction: () => undoTakeOut({ id, at, label, snap, mark, marks, owner }) })
  return true
}
// What the loop looked like right after a removal: the saved loop, the pass and the mode switch.
const loopMark: any = (S: any) => JSON.stringify([S.rotation ?? null, S.queue ?? null, S.scheduleMode ?? null])
export function undoTakeOut({ id, at, label, snap, mark, marks, owner = capturePlanTarget() }: any) {
  if (!useStore.getState().S.routines.some((r: any) => r.id === id)) {
    useUI.getState().toast(t('Too late, that one’s gone'))
    return false
  }
  if (!updatePlanTarget(owner, s => {
    if (loopMark(s) === mark) {
      s.rotation = snap.rotation
      s.queue = snap.queue
      const pins: any = Object.entries(snap.dayPlan).filter(([iso]: any) => s.dayPlan?.[iso] == null)
      if (pins.length) s.dayPlan = { ...(s.dayPlan || {}), ...Object.fromEntries(pins) }
      // Put back exactly: a reorder another device made before it saw the removal still wins.
      if (marks) markUndone(s, marks)
      return
    }
    const q: any = queueOf(s)
    const ours: any = scheduleModeOf(s) === 'rotation' && (!s.queue || (!!q && !!s.rotation && q.rotationId === s.rotation.id))
    if (!ours) {
      const seq: any = Array.isArray(s.rotation?.sequence) ? s.rotation.sequence : null
      if (seq && !seq.includes(id)) {
        const next: any = seq.slice()
        next.splice(Math.min(at, next.length), 0, id)
        s.rotation = { ...s.rotation, sequence: next }
      }
      return
    }
    const ids: any = q?.ids ?? rotationIds(s)
    if (ids.includes(id)) return
    const next: any = ids.slice()
    next.splice(Math.min(at, next.length), 0, id)
    saveLoop(s, next, s.queue?.label || s.rotation?.label || label)
  })) return false
  return true
}

// The flash a row lands with when a swipe brought it (a duplicate, an undo): one per new value.
let flashSeq: any = 0

export default function Plan() {
  const nav: any = useNavigate()
  const S: any = useStore((s: any) => s.S)
  const editor = useRef({ mounted: true })
  useEffect(() => { editor.current.mounted = true; return () => { editor.current.mounted = false } }, [])
  const baseline = planFingerprint(S)
  const target = capturePlanTarget(s => planFingerprint(s) === baseline, () => editor.current.mounted)
  const update = (fn: (s: any) => void) => updatePlanTarget(target, fn)
  const config: any = useStore((s: any) => s.config)

  const user: any = useStore((s: any) => s.user)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const fileTarget = useRef<PlanTarget | null>(null)
  const fileGeneration = useRef(0)
  const [view, setViewState] = useState<any>(readView)
  const setView: any = (v: any) => {
    setViewState(v)
    try { clientPlatform().kv.set(PLAN_VIEW_KEY, v) } catch { /* private mode: the view just isn't remembered */ }
  }

  // Share, print, import and starter plans: one menu behind the header button, so the
  // two views below are only about the plan itself.
  const openMenu: any = () => {
    if (!validatePlanTarget(target)) return
    const has: any = planHasRoutines(S)
    menuSheet({
      title: t('Plan'),
      subtitle: has ? null : t('Add an exercise to a routine first. An empty plan has nothing to share.'),
      items: [
        { icon: 'share', label: t('Export plan file'), sub: t('A small file a friend can import into their own openGym. Routines only, none of your workouts or weigh-ins.'), disabled: !has, onClick: () => exportPlanFile() },
        { icon: 'note', label: t('Print / Save as PDF'), disabled: !has, onClick: () => printWholePlan() },
        { icon: 'download', label: t('Import a plan file'), onClick: () => { if (validatePlanTarget(target)) { fileTarget.current = target; fileGeneration.current++; fileRef.current?.click() } } },
        { icon: 'clipboard', label: t('Load starter plan'), onClick: () => { if (validatePlanTarget(target)) starterPlanSheet() } },
      ],
    })
  }
  const pickFile = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const f = ev.currentTarget.files?.[0], selection = fileTarget.current, generation = fileGeneration.current
    ev.currentTarget.value = ''; fileTarget.current = null
    if (!selection || !validatePlanTarget(selection)) return
    void importPlanFile(f, undefined, () => generation === fileGeneration.current && validatePlanTarget(selection))
  }

  const mode: any = scheduleModeOf(S)

  return <div className="narrow plan">
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{mode === 'rotation' ? t('Your routines in a loop') : t('Your weekly routine')}</div></div>
      <div className="hdr-actions">
        <button className="iconbtn" onClick={openMenu} aria-label={t('Plan options')} title={t('Plan options')}><Icon name="share" /></button>
      </div>
    </div>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
    <Segmented className="plan-views" value={view} onChange={setView}
      options={[{ value: 'schedule', label: t('Schedule') }, { value: 'routines', label: t('Routines') }, { value: 'programs', label: t('Programs') }]} />
    {view === 'programs' ? <Programs /> : view === 'routines'
      ? <Routines S={S} update={update} nav={nav} target={target} />
      : <Schedule S={S} update={update} nav={nav} mode={mode} target={target} />}
  </div>
}

/* ================================ Schedule ================================ */

// Ordinary edits retain newer fields without restoring fields saveRotation deliberately clears.
function saveLoop(s: any, ids: string[], label: string) {
  const rotation = s.rotation, queue = s.queue
  saveRotation(s, ids, label)
  const opaque = (value: any, known: string[]) => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !known.includes(key)))
  if (rotation && s.rotation?.id === rotation.id) {
    s.rotation = { ...opaque(rotation, ['id', 'sequence', 'label']), ...s.rotation }
  }
  if (queue && s.queue && queue.rotationId === s.queue.rotationId && queue.since === s.queue.since && queue.startsOn === s.queue.startsOn) {
    s.queue = { ...opaque(queue, ['ids', 'since', 'startsOn', 'label', 'rotationId', 'strict', 'programmeCycleId', 'skipped']), ...s.queue }
  }
}

function Schedule({ S, update, nav, mode, target }: any) {
  const [editLoop, setEditLoop] = useState<any>(false)
  /* The rotation editor. What it shows is the live pass when there is one, otherwise the saved
     sequence — S.rotation is only a definition, so the pass is the truth whenever it exists.
     Every edit writes straight through saveRotation: an edit IS the save (and, for a queue
     somebody else wrote, the adoption), so there is no half-edited state to lose. `since` and
     `startsOn` carry over, so progress already logged survives a reorder. */
  const liveQ: any = queueOf(S)
  const seq: any = liveQ?.ids ?? rotationIds(S)
  // A loop the app makes has no name of its own: Home shows it as 'Rotation' in the language on
  // screen. Stored as text, it stayed in the language it was made in (QA 2026-10-06).
  const seqLabel: any = liveQ?.label || S.rotation?.label || ''
  // Ownership, not presence: a planner's queue has no rotationId, or one that does not match the
  // saved rotation here — that's what makes it someone else's to write, not this app's.
  const managed: any = !!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id
  const external: any = !!liveQ && !managed
  const recovery: any = queueRecovery(S)
  const qv: any = liveQ ? queueView(S, todayISO()) : null
  const gestureKey = JSON.stringify([target.epoch, target.owner, target.endpoint, planFingerprint(S)])
  const rowKeys = occurrenceKeys(seq)

  // "How you train" is the same switch as Settings' (lib/rotation.js chooseRotation /
  // chooseFixedWeek), on the same keys. Leaving a running loop asks first: its progress goes,
  // the loop itself and the weekdays stay. With nothing running there is nothing to lose.
  const setMode: any = (v: any) => {
    if (v === mode) return
    if (v === 'rotation') { update((s: any) => { chooseRotation(s) }); return }
    if (!liveQ) { update((s: any) => { chooseFixedWeek(s) }); return }
    confirmSheet({
      title: t('Back to a fixed week?'),
      message: t('The loop stops. Your weekdays stay as they are, and the loop is saved for later.'),
      confirmText: t('Use Fixed Week'),
      onConfirm: () => update((s: any) => { chooseFixedWeek(s) }),
    })
  }

  const setSeq: any = (ids: any) => update((s: any) => {
    // Emptying the sequence stops the pass but stays on Rotation with an empty loop ('No rotation
    // yet'), so taking out the last routine to swap it for another never throws you onto the
    // weekday grid. Leaving the rotation is the 'How you train' switch's job.
    if (ids.length) saveLoop(s, ids, seqLabel)
    else {
      stopPass(s)
      if (s.rotation) s.rotation = { ...s.rotation, sequence: [] }
      s.scheduleMode = 'rotation'
    }
  })
  const loopReorder: any = useListReorder(seq.length, (from: any, to: any) => setSeq(moved(seq, from, to)), gestureKey)
  const takeOut: any = (id: any) => takeOutOfLoop(id, setSeq, seq, seqLabel)
  const swipe: any = workoutControls(S).swipeSets && !external
  const addToSeq: any = () => menuSheet({
    title: t('Add to the rotation'),
    items: S.routines.filter((r: any) => !seq.includes(r.id)).map((r: any) => ({
      icon: glyphOf(r.emoji), label: r.name, onClick: () => setSeq([...seq, r.id]),
    })),
  })
  const ownSeq: any = S.rotation?.sequence || []
  const replacesOwn: any = ownSeq.length > 0 && (ownSeq.length !== seq.length || ownSeq.some((id: any, i: any) => id !== seq[i]))
  const adopt: any = () => confirmSheet({
    title: t('Use this rotation?'),
    message: t('Your coach gives up control of this week: openGym owns the queue from here on and repeats these sessions by itself once they are all done. A new week from the coach’s app would replace this rotation.')
      + (replacesOwn ? ' ' + t('Your own loop gets replaced.') : ''),
    confirmText: t('Use this rotation'),
    onConfirm: () => update((s: any) => saveLoop(s, seq, '')),
  })

  const ws: any = weekStartOf(S)
  const todayDow: any = new Date().getDay()
  const routineOf: any = (id: any) => S.routines.find((x: any) => x.id === id)
  const dayRoutines: any = (d: any) => ([] as string[]).concat(S.week[d] || []).map(routineOf).filter(Boolean)
  // One weekday: what is on it at a glance, and a tap to change it (dayAssignSheet picks one
  // routine, several for a combined day, or a rest day).
  const previewRoutines = (ids: string[], title: string, day?: number) => {
    if (!validatePlanTarget(target)) return
    return sessionPreviewSheet(live => {
      const assigned = day == null ? ids : ([] as string[]).concat(live.week[day] || [])
      const liveIds = day != null && mode === 'rotation' ? assigned.filter(id => !seq.includes(id)) : assigned
      const routines = liveIds.map(id => live.routines.find((r: any) => r.id === id)).filter(Boolean)
      return routines.length ? {title, identity: [day, assigned, liveIds], routines} : null
    })
  }
  const dayRow: any = (d: any, rs: any = dayRoutines(d)) => {
    return <div key={d} className="item plan-day" data-day={d} aria-label={t(DAYN[d])} {...tappable(() => { if (validatePlanTarget(target)) dayAssignSheet(d) })}>
      <span className={'plan-day-n' + (d === todayDow ? ' today' : '')} aria-hidden="true">{t(DAYS[d])}</span>
      <span className={'lrow-i' + (rs.length ? '' : ' rest')}><Icon name={rs.length ? glyphOf(rs[0].emoji) : 'moon'} /></span>
      <div className="grow">
        <div className="tt">{rs.length ? deriveSessionName(rs.map((r: any) => r.name)) : t('Rest day')}</div>
        <div className="ss">{rs.length === 1 ? exCount(rs[0].ex.length) : rs.length ? routineCount(rs.length) : t('Tap to plan something')}</div>
      </div>
      {rs.length > 0 && <Button size="sm" variant="ghost" aria-label={`Preview ${t(DAYN[d])}`} onClick={(event: any) => {event.stopPropagation(); previewRoutines(rs.map((r: any) => r.id), t(DAYN[d]), d)}}>Preview</Button>}
      <Icon name="chevronRight" className="chev" />
    </div>
  }
  // Beside a loop, a weekday shows only what it adds to it: a routine that is in the loop already
  // is the loop's session, the same rule Home follows (effectiveRoutineIds, history.js).
  const extraRoutines: any = (d: any) => dayRoutines(d).filter((r: any) => !seq.includes(r.id))
  const plannedDays: any = weekOrder(ws).filter((d: any) => extraRoutines(d).length)
  const doneCount: any = qv ? qv.items.filter((i: any) => i.state === 'done').length : 0
  const stateWord: any = (item: any) => item.state === 'pinned' ? fmtDate(item.on, true)
    : ({ done: t('Done'), next: t('Up next'), later: t('Later') } as Record<string, string>)[item.state]
  const editing: any = editLoop && !external

  return <>
    <ProgrammeCalendar />
    <Section className="plan-mode" footer={mode === 'rotation'
      ? t('Routines in a loop. Whatever is next stays next until you train it, whatever the day.')
      : t('The same routines on the same weekdays, every week.')}>
      <Row icon="repeat" iconTint="var(--orange)" title={t('How you train')}>
        {/* A planner's own queue is not this app's to switch off: text, not a control. */}
        {external
          ? <span className="small dim plan-mode-locked">{t('Rotation')} · {t('Externally managed')}</span>
          : <Segmented className="seg-inline" value={mode} onChange={setMode}
              options={[{ value: 'week', label: t('Fixed Week') }, { value: 'rotation', label: t('Rotation') }]} />}
      </Row>
    </Section>

    {!S.routines.length && <div className="empty plan-empty">
      <div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Make one, or grab the starter plan to get going.')}
      <div style={{ marginTop: 12 }}><Button icon="clipboard" onClick={() => { if (validatePlanTarget(target)) starterPlanSheet() }}>{t('Load starter plan')}</Button></div>
    </div>}

    {/* A queue payload that arrived unusable: a fix-up, shown whichever way you train. Giving it
        up also gives up S.scheduleMode='rotation', or the loop would sit there with no queue. */}
    {recovery && <div className="empty">
      {t('This rotation couldn’t be read. Another device may have written it.')}
      <div style={{ marginTop: 10 }}>
        <Button size="sm" variant="tinted" aria-label={t('Discard it')} onClick={() => update((s: any) => { s.queue = null; s.scheduleMode = 'week' })}>{t('Discard it')}</Button>
      </div>
    </div>}

    {mode === 'week' ? <>
      <h4 className="sec">{t('This week')}</h4>
      <div className="list plan-week">{weekOrder(ws).map((d: any) => dayRow(d))}</div>
      <p className="sect-f">{t('Want two routines on one day? Tap the day and pick both.')}</p>
    </> : <div className="rotation">
      <div className="row between plan-sec-h">
        <h4 className="sec">{t('The loop')}{external && <span className="tag" style={{ marginInlineStart: 8 }}>{t('Externally managed')}</span>}</h4>
        {/* A coach's own queue is read-only here: the one way to change what it holds is to
            adopt it first ("Use this rotation" below), never a tap on one of its rows. */}
        {!external && <div className="row plan-sec-acts" style={{ gap: 6 }}>
          {seq.length > 0 && <button className="plan-textbtn" aria-pressed={editLoop} onClick={() => setEditLoop((e: any) => !e)}>{editLoop ? t('Done') : t('Edit')}</button>}
          <Button size="sm" variant="tinted" icon="plus" aria-label={t('Add routine to the rotation')}
            disabled={S.routines.every((r: any) => seq.includes(r.id))} onClick={addToSeq}>{t('Add')}</Button>
        </div>}
      </div>
      {seq.length ? <div className="list plan-loop" ref={loopReorder.listRef}>
        {seq.map((id: any, i: any) => {
          const r: any = routineOf(id)
          const item: any = qv?.items[i]
          // The loop's swipe is remove-only (v1.3.11): a routine is in the loop once, so there is
          // nothing to copy. The row the reorder measures is the swipe's outer element.
          const reorderProps: any = { 'data-reorder-row': '', style: loopReorder.rowStyle(i) }
          const row: any = <div {...(swipe ? {} : { key: rowKeys[i], ...reorderProps })} className={'item rotation-row' + (item?.state === 'done' ? ' is-done' : '')}>
            {editing && <button className="plan-minus" aria-label={t('Remove {0}', r?.name ?? id)} title={t('Remove')}
              onClick={() => takeOut(id)}><Icon name="minus" /></button>}
            <span className={'plan-order' + (item?.state === 'next' ? ' next' : '')}>{item?.state === 'done' ? <Icon name="check" /> : i + 1}</span>
            <span className="lrow-i"><Icon name={glyphOf(r?.emoji)} /></span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="tt">{r?.name ?? id}</div>
              <div className="ss">{item ? stateWord(item) : r ? exCount(r.ex.length) : ''}</div>
            </div>
            {!editing && r && <Button size="sm" variant="ghost" aria-label={`Preview ${r.name}`} onClick={() => previewRoutines([id], r.name)}>Preview</Button>}
            {editing && seq.length > 1 && <button className="plan-handle" aria-label={t('Move {0}', r?.name ?? id)} title={t('Drag to reorder')}
              {...loopReorder.handle(i)}><Icon name="chevronsUpDown" /></button>}
          </div>
          return swipe
            ? <SwipeRow key={rowKeys[i]} closeKey={gestureKey} {...reorderProps} className="swrow-item" deleteLabel={t('Remove')} deleteIcon="minus"
              onDelete={() => takeOut(id)}>{row}</SwipeRow>
            : row
        })}
      </div> : <div className="empty">{t('No rotation yet. Add routines in the order you want to train them. The first one you haven’t logged stays up next.')}</div>}
      {seq.length > 0 && <p className="sect-f">
        {qv ? (qv.waiting ? t('Next round starts {0}.', fmtDate(qv.startsOn, true)) : t('{0} of {1} done this round.', doneCount, qv.items.length)) + ' ' : ''}
        {external ? '' : editing ? t('Drag to reorder. Tap the minus to take one out.') : t('Trained out of order? Just pick another routine on Home.')}
      </p>}
      <div className="row" style={{ gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {external && !liveQ?.programmeCycleId && <Button size="sm" variant="tinted" aria-label={t('Use this rotation')} onClick={adopt}>{t('Use this rotation')}</Button>}
        {/* Throws the current round away and starts the saved loop again today; nothing logged
            before this moment counts for it (startNewPass, the strict pass). */}
        {!!liveQ && !external && <Button size="sm" icon="reset" aria-label={t('Start the loop over')}
          onClick={() => update((s: any) => startNewPass(s))}>{t('Start the loop over')}</Button>}
        {/* Rotation chosen and a loop saved, but no round running (it was stopped elsewhere). */}
        {!liveQ && !recovery && seq.length > 0 && <Button size="sm" variant="tinted" icon="play" aria-label={t('Start the loop')}
          onClick={() => update((s: any) => startPass(s))}>{t('Start the loop')}</Button>}
      </div>
      {/* The weekday routines ride along beside a loop (effectiveRoutineIds, history.js) and feed
          the same tally (weekTally, queue.js), so the days that still add one stay in sight; a
          day whose only routines are in the loop already adds nothing and is left out. */}
      {plannedDays.length > 0 && <>
        <h4 className="sec">{t('Also on fixed days')}</h4>
        <div className="list plan-week">{plannedDays.map((d: any) => dayRow(d, extraRoutines(d)))}</div>
        <p className="sect-f">{t('These count on top of the loop. Tap a day to change or clear it.')}</p>
      </>}
    </div>}

    {/* Weekly muscle volume is analysis: it moved to Stats, next to Muscle balance. Stats only
        shows that card once there is a routine, so the link waits for one too. */}
    {S.routines.length > 0 && <Section className="plan-link">
      <Row icon="chart" iconTint="var(--indigo)" title={t('Weekly muscle volume')} subtitle={t('Now in Stats, next to Muscle balance')}
        accessory="chevron" onClick={() => nav('/stats?focus=weekly-volume')} />
    </Section>}
  </>
}

/* ================================ Routines ================================ */

function Routines({ S, update, nav, target }: any) {
  const [edit, setEdit] = useState<any>(false)
  const [flash, setFlash] = useState<any>(null)
  const swipe: any = workoutControls(S).swipeSets
  const routines: any = S.routines.filter((r: any) => !r.programme)
  const gestureKey = JSON.stringify([target.epoch, target.owner, target.endpoint, planFingerprint(S)])
  const rowKeys = occurrenceKeys(routines)
  // The order of this list is the order of `S.routines`, and every other screen reads the same
  // array (the Start screen, the day sheets, the routine pickers), so moving a routine here moves
  // it everywhere (#142). Reordering lives behind Edit, like on an iPhone.
  const reorder: any = useListReorder(routines.length, (from: any, to: any) => update((s: any) => {
    if (!routines[from] || !routines[to]) return
    const source: any = s.routines.findIndex((r: any) => r.id === routines[from].id)
    const target: any = s.routines.findIndex((r: any) => r.id === routines[to].id)
    if (source < 0 || target < 0) return
    const [m] = s.routines.splice(source, 1)
    s.routines.splice(target, 0, m)
  }), gestureKey)

  const addRoutine: any = () => {
    const r: any = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    if (!update((s: any) => { s.routines.push(r) })) return
    nav('/plan/r/' + r.id)
  }
  // The same delete as RoutineEdit's "Delete routine" button (lib/routines.js), with an Undo in
  // place of its confirm (v1.3.11): the swipe and the edit-mode minus both land here.
  const remove: any = (r: any) => deleteRoutineWithUndo(r.id, target)
  // The swipe's other side: a copy right below the original, named the way "Copy routine" names
  // one, and staying on this list rather than opening it.
  const duplicate: any = (r: any) => {
    const copy: any = copyRoutine(r, t('Copy'))
    if (!update((s: any) => {
      const at: any = s.routines.findIndex((x: any) => x.id === r.id)
      s.routines.splice(at < 0 ? s.routines.length : at + 1, 0, copy)
    })) return
    setFlash({ id: copy.id, n: ++flashSeq })
    // With its own Undo: the toast takes the place of any Undo still showing (one toast at a
    // time), so the newest swipe is at least the one you can take back.
    const owner = capturePlanTarget(s => s.routines.some((x: any) => x.id === copy.id))
    useUI.getState().toast(t('Copied as “{0}”.', copy.name), { action: t('Undo'), onAction: () => {
      updatePlanTarget(owner, s => { deleteRoutine(s, copy.id) })
    } })
  }
  // The weekdays a routine is on, short, in the order the week runs.
  const order: any = weekOrder(weekStartOf(S))
  const daysOf: any = (id: any) => order.filter((d: any) => ([] as string[]).concat(S.week[d] || []).includes(id)).map((d: any) => t(DAYS[d]))
  const sub: any = (r: any) => [exCount(r.ex.length), daysOf(r.id).join(', ')].filter(Boolean).join(' · ')

  return <>
    <ProgrammeRoutines S={S} nav={nav} />
    <div className="row between plan-sec-h plan-routines-bar">
      {routines.length > 0
        ? <button className="plan-textbtn" aria-pressed={edit} onClick={() => setEdit((e: any) => !e)}>{edit ? t('Done') : t('Edit')}</button>
        : <span />}
      <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New routine')}</Button>
    </div>
    {routines.length ? <>
      {edit
        ? <div className="list routine-list plan-routines is-editing" ref={reorder.listRef}>{routines.map((r: any, i: any) =>
          <div key={rowKeys[i]} data-reorder-row className="item plan-routine" style={reorder.rowStyle(i)}>
            <button className="plan-minus" aria-label={t('Delete {0}', r.name)} title={t('Delete routine')} onClick={() => remove(r)}><Icon name="minus" /></button>
            <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
            <div className="grow"><div className="tt">{r.name}</div><div className="ss">{sub(r)}</div></div>
            {routines.length > 1 && <button className="plan-handle" aria-label={t('Move {0}', r.name)} title={t('Drag to reorder')}
              {...reorder.handle(i)}><Icon name="chevronsUpDown" /></button>}
          </div>)}</div>
        : <div className="list routine-list plan-routines">{routines.map((r: any, i: number) => {
          const row: any = <div key={rowKeys[i]} className="item plan-routine" {...tappable(() => nav('/plan/r/' + r.id))}>
            <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
            <div className="grow"><div className="tt">{r.name}</div><div className="ss">{sub(r)}</div></div>
            <Icon name="chevronRight" className="chev" /></div>
          // Swipe (v1.3.11, Settings → Swipe actions): toward the start deletes with an Undo,
          // toward the end duplicates. Edit's minus and the routine's own page stay the way in
          // for a keyboard and a screen reader.
          return swipe
            ? <SwipeRow key={rowKeys[i]} closeKey={gestureKey} className="swrow-item" copyLabel={t('Duplicate')}
              onDelete={() => remove(r)} onCopy={() => duplicate(r)}
              flash={flash?.id === r.id ? flash.n : 0}>{row}</SwipeRow>
            : row
        })}</div>}
      <p className="sect-f">{edit ? t('Drag to reorder. Tap the minus to delete.') : t('Tap a routine to edit it. Reorder and delete are behind Edit.')}</p>
    </> : !S.routines.length && <>
      <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Make one, or grab the starter plan to get going.')}</div>
      <Button icon="clipboard" onClick={() => { if (validatePlanTarget(target)) starterPlanSheet() }}>{t('Load starter plan')}</Button>
    </>}
  </>
}
