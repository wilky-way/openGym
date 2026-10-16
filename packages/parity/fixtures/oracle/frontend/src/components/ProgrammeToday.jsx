import { targetLabel } from '../lib/programme-targets.js'
import { effortOf } from '../lib/history.js'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button, TextField } from './ui.jsx'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { todayISO, fmtDate, exCount } from '../lib/format.js'
import { buildPlannedEntry } from '../lib/session-start.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { effectiveRoutineIds, modeOf, fmtSec } from '../lib/history.js'
import ProgrammeRollover from './ProgrammeRollover.jsx'
import { projectCycle, addProgrammeDays } from '../lib/programme-calendar.js'
import { programmesOf, shiftNotToday, skip, pin, pause, resume } from '../lib/programme.js'
import { shiftPreview, programmeIdle, repeatProgrammeWeek, repeatStageOf } from '../lib/programme-today.js'
import { undoMarks, markUndone } from '../lib/sync-merge.js'
import { startFlow, confirmSheet } from '../sheets.jsx'
import { programmeSessionSheet } from './ProgrammeSession.jsx'

export const programmeError = err => t(err?.message || 'The program action could not be completed.')
const statePart = (S, id) => ({ cycle: S.programmes.cycles.find(c => c.id === id), queue: S.queue, dayPlan: S.dayPlan, active: S.active, workouts: S.workouts })
export function programmeAction(cycleId, action, message, shift = null) {
  const st = useStore.getState(), before = structuredClone(statePart(st.S, cycleId)), fullBefore = st.S
  try { st.update(action) } catch (err) { useUI.getState().toast(programmeError(err)); return false }
  const afterState = useStore.getState().S, after = JSON.stringify(statePart(afterState, cycleId)), marks = undoMarks(fullBefore, afterState)
  useUI.setState({programmeShift: shift ? {cycleId, notBefore: afterState.programmes.cycles.find(c => c.id === cycleId)?.notBefore, ...shift} : null})
  useUI.getState().toast(message, { action: t('Undo'), onAction: () => {
    const current = useStore.getState()
    if (JSON.stringify(statePart(current.S, cycleId)) !== after) { useUI.getState().toast(t('The plan has changed. Undo is no longer available.')); return }
    useUI.setState({programmeShift:null})
    current.update(s => { const at = s.programmes.cycles.findIndex(c => c.id === cycleId);s.programmes.cycles[at] = before.cycle;s.queue = before.queue;s.dayPlan = before.dayPlan;markUndone(s, marks) })
  } })
  return true
}
const liveContext = (S, cycleId) => {
  const today = todayISO(), cycle = S.programmes?.cycles.find(c => c.id === cycleId)
  const next = cycle && projectCycle(cycle, S.workouts, today, S.queue).next
  if (!cycle || cycle.status !== 'active' || !next) throw new Error('Only a pending programme session can be changed')
  return {today, cycle, next}
}
export function notTodaySheet(cycleId) {
  useUI.getState().openSheet(close => <NotToday cycleId={cycleId} close={close} />)
}
function NotToday({ cycleId, close }) {
  const S = useStore(s => s.S), today = todayISO()
  const [, refreshDate] = useState(today)
  const [date, setDate] = useState(addProgrammeDays(today, 1)), [error, setError] = useState('')
  const cycle = S.programmes?.cycles.find(c => c.id === cycleId)
  if (!cycle || cycle.status !== 'active') return <><h3>{t('Program is paused or complete')}</h3><Button onClick={close}>{t('Close')}</Button></>
  const preview = shiftPreview(S, cycleId, today), next = preview.before.next
  if (!next) return <Button onClick={close}>{t('Close')}</Button>
  const apply = (action, message, shifted) => { refreshDate(todayISO());if (programmeAction(cycleId, action, message, shifted)) close() }
  const shift = () => {
    const st = useStore.getState().S, now = todayISO()
    const fresh = shiftPreview(st, cycleId, now)
    if (!fresh.moved) { refreshDate(now);useUI.getState().toast(t('Your sessions already have these dates.'));return }
    apply(s => shiftNotToday(s, cycleId, todayISO()), t('Program shifted'), fresh)
  }
  const move = () => {
    refreshDate(todayISO())
    try {
      const draft = structuredClone(useStore.getState().S), live = liveContext(draft, cycleId)
      pin(draft, cycleId, live.next.instanceId, date, live.today)
      apply(s => { const fresh = liveContext(s, cycleId);pin(s, cycleId, fresh.next.instanceId, date, fresh.today) }, t('Session moved'))
    } catch (err) { setError(programmeError(err)) }
  }
  const skipIt = () => confirmSheet({title:t('Skip this session?'),message:t('The session stays in your program as skipped. Later sessions move earlier.'),confirmText:t('Skip this session'),onConfirm:()=>apply(s=>{const live=liveContext(s,cycleId);skip(s,cycleId,live.next.instanceId,{today:live.today})},t('Session skipped'))})
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
    <TextField aria-label={t('Move to a day')} type="date" min={today} value={date} onChange={e => { setDate(e.target.value); setError('') }} />
    {error && <p role="alert">{error}</p>}
    <Button onClick={move}>{t('Move session')}</Button>
    <Button onClick={() => apply(s => pause(s, cycleId, todayISO()), t('Program paused'))}>{t('Pause for travel')}</Button>
    <p className="sect-f">{t('Pause freezes the program. No projected sessions or reminders until you resume.')}</p>
  </>
}

export default function ProgrammeToday() {
  const S = useStore(s => s.S), nav = useNavigate(), today = todayISO()
  const cycle = programmesOf(S).cycles.find(c => ['active', 'paused'].includes(c.status))
  if (!cycle) return <ProgrammeRollover />
  const projection = projectCycle(cycle, S.workouts, today, S.queue), next = projection.next
  const week = cycle.snapshot?.weeks?.find(w => (w.weekId || String(w.index)) === (cycle.weekId || String(cycle.weekIndex)))
  const routine = next && S.routines.find(r => r.id === next.routineId), main = routine?.ex[0]
  const planned = main && buildPlannedEntry(S,main,routine,{noProg:routine.excludeFromProgression === true})
  const mode = planned && modeOf(planned.target)
  const mainText = planned && `${main.open && !main.id ? main.sets : planned.sets.filter(s => !isWarmupRow(s)).length} × ${mode === 'time' ? fmtSec(planned.target.sec) : mode === 'cardio' ? (planned.target.min || 0)+' '+t('min') : planned.target.reps ?? 0}`
  const isToday = next?.date === today && effectiveRoutineIds(S,today).includes(next.routineId)
  const start = () => { if (S.active) nav('/workout');else if (next) startFlow([next.routineId]) }
  const plan = (view, focus = '') => { localStorage.setItem('gym_plan_view', view); nav('/plan'+focus) }
  const repeatStage = repeatStageOf(S, cycle, today)
  const restart = () => confirmSheet({title:t('Repeat week {0}?',repeatStage?.index || cycle.weekIndex),message:t('Start a fresh run from this week. Logged workouts and your progression history stay saved.'),confirmText:t('Repeat week'),onConfirm:()=>{try{useStore.getState().update(s=>repeatProgrammeWeek(s,cycle.id,todayISO(),{weekId:repeatStage?.weekId || String(repeatStage?.index || cycle.weekIndex)}))}catch(err){useUI.getState().toast(programmeError(err))}}})
  const upcoming = projection.weeks.filter(w => w.startDate && !w.closed && w.weekId !== (cycle.weekId || String(cycle.weekIndex))).slice(0,2)
  return <section className="card program-today" aria-label={t('Program today')}>
    <div className="row between"><span className="small muted">{cycle.snapshot?.short || cycle.snapshot?.name} · {t('Week {0} of {1}', cycle.weekIndex, cycle.lengthWeeks)}{week?.rir != null && ' · '+targetLabel(week,t,effortOf(S))}</span><Button size="sm" variant="ghost" onClick={() => plan('programs','?program='+encodeURIComponent(cycle.id))}>{t('Week ›')}</Button></div>
    <h2>{cycle.status === 'paused' ? t('Program paused') : isToday ? t('Next program session') : t('Program rest day')}</h2>
    {S.active && <div className="row between" style={{marginBlock:8}}><div><div className="tt">{S.active.name}</div><div className="ss">{S.active.editingWorkoutId ? t('Editing saved workout') : t('Workout in progress')}</div></div><Button variant="primary" onClick={() => nav('/workout')}>{S.active.editingWorkoutId ? t('Edit') : t('Resume')}</Button></div>}
    {next && <><div className="tt">{next.routineName}</div>
      <div className="ss">{routine && exCount(routine.ex.length)}{main && ' · '+(main.open && !main.id ? main.label || t('Choose exercise') : exerciseNameFor(exOr(main.id)))+' '+mainText}{week?.rir != null && ' · '+targetLabel(week,t,effortOf(S))}</div>
      {!isToday && <p className="ss">{next.date === today ? t('Start this program session whenever you are ready') : t('Next {0} · or start now', fmtDate(next.date, true))}</p>}</>}
    <ProgrammeRollover />
    <div className="chips" style={{flexWrap:'wrap',marginBlock:12}}>{projection.weeks.find(w => w.weekId === (cycle.weekId || String(cycle.weekIndex)))?.occurrences.map(o => <button key={o.instanceId} className={'chip nocap' + (next?.instanceId === o.instanceId ? ' on' : '')} onClick={() => programmeSessionSheet(o)}>{o.dayKey.toUpperCase()} · {o.status === 'done' ? t('Done') : o.status === 'skipped' ? t('Skipped') : o.date ? fmtDate(o.date) : t('Pending')}</button>)}</div>
    {cycle.status === 'paused' ? <div className="row" style={{gap:8}}><Button variant="primary" onClick={() => programmeAction(cycle.id, s => resume(s, cycle.id, {today:todayISO()}), t('Program resumed'))}>{t('Pick up at week {0}',cycle.weekIndex)}</Button><Button disabled={!!S.active} onClick={restart}>{t('Repeat week {0}',repeatStage?.index || cycle.weekIndex)}</Button></div> : next && <div className="row" style={{gap:8}}>{!S.active && <Button variant="primary" onClick={start}>{t('Start')}</Button>}<Button onClick={() => programmeSessionSheet(next)}>{t('Preview')}</Button><Button onClick={() => notTodaySheet(cycle.id)}>{t('Not today?')}</Button></div>}
    {cycle.status === 'active' && programmeIdle(S, cycle, today) && <div className="row" style={{gap:8, marginTop:8}}><Button onClick={() => programmeAction(cycle.id, s => pause(s, cycle.id, todayISO()), t('Program paused'))}>{t('Pause')}</Button><Button disabled={!!S.active} onClick={restart}>{t('Repeat week {0}',repeatStage?.index || cycle.weekIndex)}</Button></div>}
    {upcoming.length>0 && <div className="small dim" style={{marginTop:12,color:"var(--label)"}}><strong>{t('Coming up')}</strong>{upcoming.map(w=><div key={w.weekId}>{t('Week {0}{1} from {2}',w.weekIndex,w.mode==='deload'?' · '+t('Deload'):'',fmtDate(w.startDate,true))}</div>)}</div>}
    {projection.endDate && <button className="plan-textbtn" style={{marginTop:12}} onClick={() => plan('schedule')}>{t('Block ends {0} · calendar ›', fmtDate(projection.endDate, true))}</button>}
  </section>
}
