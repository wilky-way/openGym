import ProgressionPrescription from './ProgressionPrescription'
import { progressionDisplay } from '../lib/progression-display'
// Persisted programme records retain legacy unknown fields; core validates mutations.
import { createExerciseIndex } from '@opengym/core/exercises'
import { targetLabel } from '@opengym/core/programme-targets'
import { effortOf } from '@opengym/core/history'
import { useState, useRef } from 'react'
import { nav } from '../lib/nav'
import { ProgrammeSheet, programmeOwner, setProgrammePreference, programmeTarget, updateProgramme, type ProgrammeTarget } from '../lib/programme-ui-services'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { Button, TextField } from './ui'
import { t, exerciseNameFor } from '../lib/i18n'
import { exOr } from '@opengym/core/exercises'
import { todayISO, fmtDate, exCount } from '@opengym/core/format'
import { buildPlannedEntry } from '@opengym/core/session-start'
import { isWarmupRow } from '@opengym/core/workout-model'
import { effectiveRoutineIds, modeOf, fmtSec } from '@opengym/core/history'
import ProgrammeRollover from './ProgrammeRollover'
import { projectCycle, addProgrammeDays } from '@opengym/core/programme-calendar'
import { programmesOf, shiftNotToday, skip, pin, pause, resume } from '@opengym/core/programme'
import { shiftPreview, programmeIdle, repeatStageOf } from '@opengym/core/programme-today'
import { undoMarks, markUndone } from '@opengym/core/sync-merge'
import { startFlow, confirmSheet } from '../lib/programme-ui-services'
import { programmeSessionSheet } from './ProgrammeSession'

export const programmeError = (err: any) => t(err?.message || 'The program action could not be completed.')
const statePart = (S: any, id: any) => ({ cycle: S.programmes.cycles.find((c: any) => c.id === id), queue: S.queue, dayPlan: S.dayPlan, active: S.active, workouts: S.workouts })
export function programmeAction(cycleId: string, action: (draft: import("../store/useStore").StoreDocument) => unknown, message: string, shift: any = null, valid: ProgrammeTarget = programmeTarget()) {
  const owner = programmeOwner(), st = useStore.getState(), before = structuredClone(statePart(st.S, cycleId)), fullBefore = st.S
  try { if (!updateProgramme(action, valid)) return false } catch (err: any) { useUI.getState().toast(programmeError(err)); return false }
  const afterState = useStore.getState().S, after = JSON.stringify(statePart(afterState, cycleId)), marks = undoMarks(fullBefore, afterState)
  const undoTarget = programmeTarget(owner, draft => JSON.stringify(statePart(draft ?? useStore.getState().S, cycleId)) === after)
  useUI.setState({programmeShift: shift ? {owner, cycleId, notBefore: afterState.programmes.cycles.find((c: any) => c.id === cycleId)?.notBefore, ...shift} : null})
  useUI.getState().toast(message, { action: t('Undo'), onAction: () => {
    const current = useStore.getState()
    if (owner !== programmeOwner()) {useUI.getState().toast(t('Account changed. Undo is no longer available.'));return}
    if (JSON.stringify(statePart(current.S, cycleId)) !== after) { useUI.getState().toast(t('The plan has changed. Undo is no longer available.')); return }
    useUI.setState({programmeShift:null})
    updateProgramme((s: any) => { const at = s.programmes.cycles.findIndex((c: any) => c.id === cycleId);s.programmes.cycles[at] = before.cycle;s.queue = before.queue;s.dayPlan = before.dayPlan;markUndone(s, marks) }, undoTarget)
  } })
  return true
}
const liveContext = (S: any, cycleId: any) => {
  const today = todayISO(), cycle = S.programmes?.cycles.find((c: any) => c.id === cycleId)
  const next = cycle && projectCycle(cycle, S.workouts, today, S.queue).next
  if (!cycle || cycle.status !== 'active' || !next) throw new Error('Only a pending programme session can be changed')
  return {today, cycle, next}
}
export function notTodaySheet(cycleId: string) {
  const owner = programmeOwner(), state = useStore.getState().S
  const cycle = state.programmes?.cycles.find((c: any) => c.id === cycleId)
  const instance = cycle && projectCycle(cycle,state.workouts,todayISO(),state.queue).next?.instanceId
  const opened = programmeTarget(owner, (draft = useStore.getState().S) => {
    try { return liveContext(draft,cycleId).next.instanceId === instance } catch { return false }
  })
  useUI.getState().openSheet((close) => <ProgrammeSheet owner={owner} close={close} render={() => <NotToday cycleId={cycleId} owner={owner} opened={opened} close={close} />} />)
}
function NotToday({ cycleId, close, owner, opened }: {opened:ProgrammeTarget;owner:string;cycleId: string; close: () => void}) {
  const S = useStore((s) => s.S), today = todayISO()
  const [, refreshDate] = useState(today)
  const [date, setDate] = useState(addProgrammeDays(today, 1)), [error, setError] = useState('')
  const cycle = S.programmes?.cycles.find((c: any) => c.id === cycleId)
  const target = useRef(cycle ? projectCycle(cycle,S.workouts,today,S.queue).next?.instanceId : null)
  const stillTarget = (draft = useStore.getState().S) => {try {return liveContext(draft,cycleId).next.instanceId===target.current}catch{return false}}
  if (!cycle || cycle.status !== 'active') return <><h3>{t('Program is paused or complete')}</h3><Button onClick={close}>{t('Close')}</Button></>
  const preview = shiftPreview(S, cycleId, today), next = preview.before.next
  if (!next) return <Button onClick={close}>{t('Close')}</Button>
  const apply = (action: (draft: import("../store/useStore").StoreDocument) => unknown, message: string, shifted: any = null, valid = programmeTarget(owner, draft => opened(draft) && stillTarget(draft))) => { if (owner !== programmeOwner()) {close();useUI.getState().toast(t('Account changed. Open the program again.'));return} if(!stillTarget()){useUI.getState().toast(t('The program changed. Open it again.'));return} refreshDate(todayISO());if (programmeAction(cycleId, action, message, shifted, valid)) close() }
  const shift = () => {
    if (owner !== programmeOwner()) {close();useUI.getState().toast(t('Account changed. Open the program again.'));return}
    const st = useStore.getState().S, now = todayISO()
    const fresh = shiftPreview(st, cycleId, now)
    if (!fresh.moved) { refreshDate(now);useUI.getState().toast(t('Your sessions already have these dates.'));return }
    apply((s: any) => shiftNotToday(s, cycleId, todayISO()), t('Program shifted'), fresh)
  }
  const move = () => {
    if (owner !== programmeOwner()) {close();useUI.getState().toast(t('Account changed. Open the program again.'));return}
    refreshDate(todayISO())
    try {
      const draft = structuredClone(useStore.getState().S), live = liveContext(draft, cycleId)
      pin(draft, cycleId, live.next.instanceId, date, live.today)
      apply((s: any) => { const fresh = liveContext(s, cycleId);pin(s, cycleId, fresh.next.instanceId, date, fresh.today) }, t('Session moved'))
    } catch (err: any) { setError(programmeError(err)) }
  }
  const skipIt = () => { const instanceId = liveContext(useStore.getState().S,cycleId).next.instanceId;return confirmSheet({title:t('Skip this session?'),message:t('The session stays in your program as skipped. Later sessions move earlier.'),confirmText:t('Skip this session'),onConfirm:valid=>apply((s: any) =>{const live=liveContext(s,cycleId);skip(s,cycleId,live.next.instanceId,{today:live.today})},t('Session skipped'),null,valid)},(draft = useStore.getState().S)=>{try{return liveContext(draft,cycleId).next.instanceId===instanceId}catch{return false}},opened) }
  return <>
    <h3>{t('Not today?')}</h3>
    <p className="ss">{t('{0} · week {1} · planned {2}', next.routineName, next.weekIndex, fmtDate(next.date,true))}</p>
    <p>{t('Shift keeps every session. Dates also re-flow automatically when a day passes without training.')}</p>
    <section className="card" aria-label={t('Shift preview')}>
      <strong>{preview.moved ? t('Shift: do it tomorrow') : t('Your next session is already later')}</strong>
      <p>{t('{0} → {1} · {2} sessions move', next.dayKey, fmtDate(preview.after.next?.date, true), preview.moved)}</p>
      <p className="ss">{t('End {0} → {1}', fmtDate(preview.before.endDate, true), fmtDate(preview.after.endDate, true))}</p>
      <Button variant="primary" onClick={shift}>{preview.moved ? t('Shift: do it tomorrow') : t('Check current dates')}</Button>
    </section>
    <Button onClick={skipIt}>{t('Skip {0} instead', next.dayKey)}</Button>
    <p className="sect-f">{t('Skip counts this session as planned but not done. The next session moves earlier.')}</p>
    <h4 className="sec">{t('Move to a day')}</h4>
    <TextField aria-label={t('Move to a day')} type="date" min={today} value={date ?? ''} onChange={(e) => { setDate(e.target.value); setError('') }} />
    {error && <p role="alert">{error}</p>}
    <Button onClick={move}>{t('Move session')}</Button>
    <Button onClick={() => apply((s: any) => pause(s, cycleId, todayISO()), t('Program paused'), null, programmeTarget(owner, draft => opened(draft) && stillTarget(draft)))}>{t('Pause for travel')}</Button>
    <p className="sect-f">{t('Pause freezes the program. No projected sessions or reminders until you resume.')}</p>
  </>
}

export default function ProgrammeToday() {
  const S = useStore((s) => s.S), today = todayISO(), owner = programmeOwner()
  const cycle = programmesOf(S).cycles.find((c: any) => ['active', 'paused'].includes(c.status))
  if (!cycle) return <ProgrammeRollover />
  const projection = projectCycle(cycle, S.workouts, today, S.queue), next = projection.next
  const week = cycle.snapshot?.weeks?.find((w: any) => (w.weekId || String(w.index)) === (cycle.weekId || String(cycle.weekIndex)))
  const routine = next && S.routines.find((r: any) => r.id === next.routineId), main = routine?.ex[0]
  const planned = main && buildPlannedEntry(S,main,routine,{noProg:routine.excludeFromProgression === true},createExerciseIndex(S.customEx))
  const mode = planned && modeOf(planned.target,createExerciseIndex(S.customEx))
  const mainText = planned && `${main.open && !main.id ? main.sets : planned.sets.filter((s: any) => !isWarmupRow(s)).length} × ${mode === 'time' ? fmtSec(planned.target.sec) : mode === 'cardio' ? (planned.target.min || 0)+' '+t('min') : planned.target.reps ?? 0}`
  const isToday = next?.date === today && effectiveRoutineIds(S,today).includes(next.routineId)
  const startTarget = programmeTarget(owner, (draft = useStore.getState().S) => { const live = draft.programmes?.cycles.find((c: any) => c.id === cycle.id); return !!live && live.status === 'active' && projectCycle(live, draft.workouts, todayISO(), draft.queue).next?.instanceId === next?.instanceId })
  const start = () => { if (!actionTarget() || !startTarget()) return; if (S.active) nav('/workout');else if (next) startFlow([next.routineId]) }
  const plan = (view: string, focus = '') => { setProgrammePreference('gym_plan_view', view); nav('/plan'+focus) }
  const repeatStage = repeatStageOf(S, cycle, today)
  const actionTarget = programmeTarget(owner, (draft = useStore.getState().S) => draft.programmes.cycles.some((c:any)=>c.id===cycle.id && c.status===cycle.status))
  const restart = () => confirmSheet({title:t('Repeat week {0}?',repeatStage?.index || cycle.weekIndex),message:t('Start a fresh run from this week. Logged workouts and your progression history stay saved.'),confirmText:t('Repeat week'),onConfirm:valid=>{try{useStore.getState().repeatProgrammeWeek(cycle.id,todayISO(),{weekId:repeatStage?.weekId || String(repeatStage?.index || cycle.weekIndex)},valid)}catch(err: any){useUI.getState().toast(programmeError(err))}}},(draft = useStore.getState().S)=>{const live=draft.programmes.cycles.find((c:any)=>c.id===cycle.id);return !!live && ['active','paused'].includes(live.status) && (live.weekId || String(live.weekIndex))===(cycle.weekId || String(cycle.weekIndex))},actionTarget)
  const upcoming = projection.weeks.filter((w: any) => w.startDate && !w.closed && w.weekId !== (cycle.weekId || String(cycle.weekIndex))).slice(0,2)
  return <section className="card program-today" aria-label={t('Program today')}>
    <div className="row between"><span className="small muted">{cycle.snapshot?.short || cycle.snapshot?.name} · {t('Week {0} of {1}', cycle.weekIndex, cycle.lengthWeeks)}{week?.rir != null && ' · '+targetLabel(week,t,effortOf(S))}</span><Button size="sm" variant="ghost" onClick={() => plan('programs','?program='+encodeURIComponent(cycle.id))}>{t('Week ›')}</Button></div>
    <h2>{cycle.status === 'paused' ? t('Program paused') : isToday ? t('Next program session') : t('Program rest day')}</h2>
    {S.active && <div className="row between" style={{marginBlock:8}}><div><div className="tt">{S.active.name}</div><div className="ss">{S.active.editingWorkoutId ? t('Editing saved workout') : t('Workout in progress')}</div></div><Button variant="primary" onClick={() => nav('/workout')}>{S.active.editingWorkoutId ? t('Edit') : t('Resume')}</Button></div>}
    {next && <><div className="tt">{next.routineName}</div>
      <div className="ss">{routine && exCount(routine.ex.length)}{main && ' · '+(main.open && !main.id ? main.label || t('Choose exercise') : exerciseNameFor(exOr(main.id,createExerciseIndex(S.customEx))))+' '+mainText}{week?.rir != null && ' · '+targetLabel(week,t,effortOf(S))}</div>
      {!isToday && <p className="ss">{next.date === today ? t('Start this program session whenever you are ready') : t('Next {0} · or start now', fmtDate(next.date, true))}</p>}</>}
    {next && <ProgressionPrescription display={progressionDisplay(S, cycle.snapshot, cycle, [next.weekIndex], today)} scale={effortOf(S)} day={next.dayKey} session={next.sessionTemplateId ?? ''}/> }
    <ProgrammeRollover />
    <div className="chips" style={{flexWrap:'wrap',marginBlock:12}}>{projection.weeks.find((w: any) => w.weekId === (cycle.weekId || String(cycle.weekIndex)))?.occurrences.map((o: any) => <button key={o.instanceId} className={'chip nocap' + (next?.instanceId === o.instanceId ? ' on' : '')} onClick={() => programmeSessionSheet(o)}>{o.dayKey.toUpperCase()} · {o.status === 'done' ? t('Done') : o.status === 'skipped' ? t('Skipped') : o.date ? fmtDate(o.date,false) : t('Pending')}</button>)}</div>
    {cycle.status === 'paused' ? <div className="row" style={{gap:8}}><Button variant="primary" onClick={() => programmeAction(cycle.id, (s: any) => resume(s, cycle.id, {today:todayISO()}), t('Program resumed'), null, actionTarget)}>{t('Pick up at week {0}',cycle.weekIndex)}</Button><Button disabled={!!S.active} onClick={restart}>{t('Repeat week {0}',repeatStage?.index || cycle.weekIndex)}</Button></div> : next && <div className="row" style={{gap:8}}>{!S.active && <Button variant="primary" onClick={start}>{t('Start')}</Button>}<Button onClick={() => programmeSessionSheet(next)}>{t('Preview')}</Button><Button onClick={() => notTodaySheet(cycle.id)}>{t('Not today?')}</Button></div>}
    {cycle.status === 'active' && programmeIdle(S, cycle, today) && <div className="row" style={{gap:8, marginTop:8}}><Button onClick={() => programmeAction(cycle.id, (s: any) => pause(s, cycle.id, todayISO()), t('Program paused'), null, actionTarget)}>{t('Pause')}</Button><Button disabled={!!S.active} onClick={restart}>{t('Repeat week {0}',repeatStage?.index || cycle.weekIndex)}</Button></div>}
    {upcoming.length>0 && <div className="small dim" style={{marginTop:12,color:"var(--label)"}}><strong>{t('Coming up')}</strong>{upcoming.map((w: any) =><div key={w.weekId}>{t('Week {0}{1} from {2}',w.weekIndex,w.mode==='deload'?' · '+t('Deload'):'',fmtDate(w.startDate,true))}</div>)}</div>}
    {projection.endDate && <button className="plan-textbtn" style={{marginTop:12}} onClick={() => plan('schedule')}>{t('Block ends {0} · calendar ›', fmtDate(projection.endDate, true))}</button>}
  </section>
}
