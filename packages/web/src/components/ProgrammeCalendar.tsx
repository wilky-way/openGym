// Persisted programme records retain legacy unknown fields; core validates mutations.
import { createExerciseIndex } from '@opengym/core/exercises'
import { ProgrammeSheet, programmeOwner, programmeUi } from '../lib/programme-ui-services'
import { loggedProgrammeWorkout } from '@opengym/core/programme-ui'
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { Button } from './ui'
import Icon from './Icon'
import { t, dateLocale } from '../lib/i18n'
import { todayISO, fmtDate, DAYS, weekOrder, weekStartOf } from '@opengym/core/format'
import { programmesOf } from '@opengym/core/programme'
import { projectCycle } from '@opengym/core/programme-calendar'
import { monthCells } from '../../../core/src/programme-calendar'
import { programmeSessionSheet } from './ProgrammeSession'
import { workoutDetailSheet, dayOverrideSheet } from '../lib/programme-ui-services'

const fullDate = (date: any) => new Date(date+'T12:00:00').toLocaleDateString('en-US', { weekday:'long',year:'numeric',month:'long',day:'numeric' })
const read = (key: any) => { try { const x = JSON.parse(programmeUi().platform.kv.get(key) || 'null'); const p = x?.projection || x?.before; return x?.owner === programmeOwner() && Array.isArray(p?.occurrences) && Array.isArray(p?.pending) ? x : null } catch { return null } }
const seenKey = 'gym_programme_calendar_seen', reflowKey = 'gym_programme_calendar_reflow'
const signature = (p: any) => JSON.stringify(p?.occurrences.map((o: any) => [o.instanceId,o.status,o.date]))
const statusText = (o: any, next: boolean, moved: boolean) => [next && t('Next session'), o.mode === 'deload' && t('Deload'), moved && t('Moved'), o.status === 'skipped' ? t('Skipped') : o.status === 'done' ? t('Done') : t('Projected session')].filter(Boolean).join(' · ')

function CalendarDay({ cell, close, owner }: any) {
  const go = (action: () => unknown) => { close(); if (owner === programmeOwner()) action();else useUI.getState().toast(t('Account changed. Open the program again.')) }
  return <><h3>{fmtDate(cell.date, true)}</h3>
    {cell.workouts.map((w: any) => <Button key={w.id} onClick={() => go(() => workoutDetailSheet(w))}>{w.name || t('Workout')}</Button>)}
    {cell.occurrences.filter((o: any) => o.status !== 'done' || !loggedProgrammeWorkout(cell.workouts, o)).map((o: any) => <Button key={o.instanceId} onClick={() => go(() => programmeSessionSheet(o))}>{o.routineName} · {o.status === 'skipped' ? t('Skipped') : t('Projected session')}</Button>)}
    <Button onClick={() => go(() => dayOverrideSheet(cell.date))}>{t('Plan this day')}</Button>
  </>
}
export default function ProgrammeCalendar() {
  const S = useStore((s) => s.S), owner = programmeOwner(), today = todayISO()
  useStore(s=>s.user)
  const [month, setMonth] = useState(today.slice(0, 7))
  const cycles = programmesOf(S).cycles
  const cycle = cycles.find((c: any) => ['active', 'paused'].includes(c.status))
  const projection = cycle && projectCycle(cycle, S.workouts, today, S.queue)
  const shift = useUI((s) => s.programmeShift)
  const shifted = shift && shift.owner === owner && shift.cycleId === cycle?.id && shift.notBefore === cycle?.notBefore
  const [seenState, setSeen] = useState(() => read(seenKey))
  const [rememberedState, setRemembered] = useState(() => read(reflowKey))
  const seen = seenState?.owner === owner ? seenState : null, remembered = rememberedState?.owner === owner ? rememberedState : null
  const sameDone = seen && JSON.stringify(seen.projection.occurrences.filter((o: any) => o.status !== 'pending').map((o: any) => [o.instanceId,o.status,o.date])) === JSON.stringify(projection?.occurrences.filter((o: any) => o.status !== 'pending').map((o: any) => [o.instanceId,o.status,o.date]))
  const missed = cycle?.status === 'active' && seen?.cycleId === cycle.id && seen.today < today && sameDone && seen.projection.pending.some((o: any) => o.date < today && projection.pending.some((p: any) => p.instanceId === o.instanceId && p.date > o.date))
  const passive = missed ? { owner, cycleId:cycle.id, today, before:seen.projection, current:signature(projection) } : remembered?.cycleId === cycle?.id && remembered?.today === today && remembered.current === signature(projection) ? remembered : null
  const old = shifted ? shift.before : passive?.before
  const moved = old ? old.pending.filter((o: any) => projection?.pending.some((p: any) => p.instanceId === o.instanceId && p.date !== o.date)).length : 0
  useEffect(() => {
    if (!cycle || !projection) return
    const current = { owner, cycleId:cycle.id, today, projection }
    setSeen(current)
    if (passive) setRemembered(passive)
    try {
      programmeUi().platform.kv.set(seenKey, JSON.stringify({ owner, cycleId:cycle.id, today, projection }))
      if (passive) programmeUi().platform.kv.set(reflowKey, JSON.stringify(passive))
    } catch { useUI.getState().toast('Could not save calendar dates. The previous copy was kept.') }
  }, [owner, cycle?.id, today, signature(projection)])
  const projections = cycles.map((c: any) => ({ cycle:c, projection:c.id === cycle?.id ? projection : projectCycle(c,S.workouts,today,S.queue) }))
  const all = { occurrences:projections.flatMap((p: any) => p.projection.occurrences), endDate:projection?.endDate }
  const ends = projections.filter((p: any) => ['finished','archived'].includes(p.cycle.status)).map((p: any) => p.projection.occurrences.map((o: any) => o.date).filter(Boolean).sort().at(-1) || p.cycle.completedOn || p.cycle.archivedOn).filter(Boolean)
  if (projection?.endDate) ends.push(projection.endDate)
  const ws = weekStartOf(S)
  const cells = monthCells(all, month, {workouts:S.workouts, weekStartsOn:ws, today})
  for (const cell of cells) if (cell) cell.end = ends.includes(cell.date)
  while (cells.length % 7) cells.push(null)
  const move = (delta: any) => { const date = new Date(month+'-01T12:00:00');date.setMonth(date.getMonth()+delta);setMonth(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`) }
  const openDay = (cell: any) => { const owner = programmeOwner(); return useUI.getState().openSheet((close) => <ProgrammeSheet owner={owner} close={close} render={() => <CalendarDay cell={cell} owner={owner} close={close} />} />) }
  const isMoved = (o: any) => !!old?.occurrences.find((p: any) => p.instanceId === o.instanceId && p.date !== o.date)
  return <section className="card programme-calendar" aria-label={t('Workout calendar')}>
    <div className="row between">
      <button className="iconbtn" aria-label={t('Previous month')} onClick={() => move(-1)}><Icon name="chevronLeft" /></button>
      <h2 aria-live="polite">{new Date(month+'-01T12:00:00').toLocaleDateString('en-US', {month:'long',year:'numeric'})}</h2>
      <button className="iconbtn" aria-label={t('Next month')} onClick={() => move(1)}><Icon name="chevronRight" /></button>
    </div>
    <Button size="sm" variant="ghost" onClick={() => setMonth(today.slice(0,7))}>{t('Today')}</Button>
    <div className="program-calendar-grid">
      {weekOrder(ws).map((d: any) => <div className="program-calendar-heading" key={d}>{t(DAYS[d])}</div>)}
      {cells.map((cell: any, i: any) => cell ? <div className={'program-calendar-day'+(cell.today?' today':'')} key={cell.date} data-date={cell.date} role="group" aria-label={fmtDate(cell.date,true)}>
        <button className="program-calendar-date" aria-label={[fullDate(cell.date), ...cell.workouts.map((w: any) => t('Logged workout: {0}',w.name || t('Workout'))), ...cell.occurrences.map((o: any) => statusText(o,projection?.next?.instanceId === o.instanceId,isMoved(o))+': '+o.routineName), cell.end && t('Program end')].filter(Boolean).join(' · ')} aria-current={cell.today?'date':undefined} onClick={() => openDay(cell)}>{cell.day}{cell.end && <span aria-label={t('Program end')}>🏁</span>}</button>
        {cell.workouts.map((w: any) => { const deload = cell.occurrences.some((o: any) =>o.mode==='deload' && loggedProgrammeWorkout([w],o)); return <button key={w.id} className={'program-calendar-chip logged'+(deload?' deload':'')} title={w.name} aria-label={t('Logged workout: {0}', w.name || t('Workout'))+(deload?' · '+t('Deload'):'')+' · '+fullDate(cell.date)} onClick={() => workoutDetailSheet(w)}><Icon name="check" />{deload && '◇ '}<span>{w.name || t('Workout')}</span></button>})}
        {cell.occurrences.filter((o: any) => o.status !== 'done' || !loggedProgrammeWorkout(cell.workouts, o)).map((o: any) => <button key={o.instanceId} className={'program-calendar-chip '+o.status+(o.mode==='deload'?' deload':'')+(projection?.next?.instanceId===o.instanceId?' next':'')+(isMoved(o)?' moved':'')} title={o.routineName} aria-label={statusText(o,projection?.next?.instanceId===o.instanceId,isMoved(o))+': '+o.routineName+' · '+fullDate(cell.date)} onClick={() => programmeSessionSheet(o)}>{projection?.next?.instanceId===o.instanceId ? '→ ' : o.status==='skipped' ? '× ' : o.status==='done' ? '✓ ' : ''}{o.mode==='deload' && '◇ '}{isMoved(o) && '↗ '}{o.dayKey.toUpperCase()}</button>)}
        {old?.occurrences.filter((o: any) => o.projected && o.date===cell.date && projection?.occurrences.find((p: any) =>p.instanceId===o.instanceId)?.date!==o.date).map((o: any) => <span className="program-calendar-ghost" key={o.instanceId} aria-label={t('Moved from this day')+': '+o.routineName+' · '+fullDate(cell.date)}>{t('Was {0}',o.dayKey.toUpperCase())}</span>)}
      </div> : <div key={'blank'+i} aria-hidden="true" />)}
    </div>
    <p className="program-calendar-legend">{t('Calendar legend: → next · ✓ logged · × skipped · ◇ deload · ↗ moved · dashed: previous date · 🏁 program end')}</p>
    <p className="sect-f">{t('Logged workouts are saved history. Program dates are projected and move with your training.')}</p>
    {cycle?.status === 'paused' && <p className="sect-f">{t('Program paused. Logged workouts remain visible.')}</p>}
    {old && <p className="program-calendar-notice" aria-live="polite">{passive && !shifted && t('Your projected sessions moved.')+' '}{t('{0} sessions moved · end {1} → {2}',moved,fmtDate(old.endDate,true),fmtDate(projection.endDate,true))}</p>}
    {projection?.endDate && <p className="ss">{t('Projected end: {0}',fmtDate(projection.endDate,true))}</p>}
  </section>
}
