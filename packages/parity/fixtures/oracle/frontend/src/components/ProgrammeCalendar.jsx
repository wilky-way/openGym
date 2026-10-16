import { loggedProgrammeWorkout } from '../lib/programme-ui.js'
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import { t, dateLocale } from '../lib/i18n.js'
import { todayISO, fmtDate, DAYS, weekOrder, weekStartOf } from '../lib/format.js'
import { programmesOf } from '../lib/programme.js'
import { projectCycle, monthCells } from '../lib/programme-calendar.js'
import { programmeSessionSheet } from './ProgrammeSession.jsx'
import { workoutDetailSheet, dayOverrideSheet } from '../sheets.jsx'
import '../views/Programs.css'

const fullDate = date => new Date(date+'T12:00:00').toLocaleDateString(dateLocale(), { weekday:'long',year:'numeric',month:'long',day:'numeric' })
const read = key => { try { const x = JSON.parse(localStorage.getItem(key)); const p = x?.projection || x?.before; return Array.isArray(p?.occurrences) && Array.isArray(p?.pending) ? x : null } catch { return null } }
const seenKey = 'gym_programme_calendar_seen', reflowKey = 'gym_programme_calendar_reflow'
const signature = p => JSON.stringify(p?.occurrences.map(o => [o.instanceId,o.status,o.date]))
const statusText = (o, next, moved) => [next && t('Next session'), o.mode === 'deload' && t('Deload'), moved && t('Moved'), o.status === 'skipped' ? t('Skipped') : o.status === 'done' ? t('Done') : t('Projected session')].filter(Boolean).join(' · ')

function CalendarDay({ cell, close }) {
  return <><h3>{fmtDate(cell.date, true)}</h3>
    {cell.workouts.map(w => <Button key={w.id} onClick={() => { close(); workoutDetailSheet(w) }}>{w.name || t('Workout')}</Button>)}
    {cell.occurrences.filter(o => o.status !== 'done' || !loggedProgrammeWorkout(cell.workouts, o)).map(o => <Button key={o.instanceId} onClick={() => { close(); programmeSessionSheet(o) }}>{o.routineName} · {o.status === 'skipped' ? t('Skipped') : t('Projected session')}</Button>)}
    <Button onClick={() => { close(); dayOverrideSheet(cell.date) }}>{t('Plan this day')}</Button>
  </>
}
export default function ProgrammeCalendar() {
  const S = useStore(s => s.S), today = todayISO()
  const [month, setMonth] = useState(today.slice(0, 7))
  const cycles = programmesOf(S).cycles
  const cycle = cycles.find(c => ['active', 'paused'].includes(c.status))
  const projection = cycle && projectCycle(cycle, S.workouts, today, S.queue)
  const shift = useUI(s => s.programmeShift)
  const shifted = shift && shift.cycleId === cycle?.id && shift.notBefore === cycle?.notBefore
  const [seen, setSeen] = useState(() => read(seenKey))
  const [remembered, setRemembered] = useState(() => read(reflowKey))
  const sameDone = seen && JSON.stringify(seen.projection.occurrences.filter(o => o.status !== 'pending').map(o => [o.instanceId,o.status,o.date])) === JSON.stringify(projection?.occurrences.filter(o => o.status !== 'pending').map(o => [o.instanceId,o.status,o.date]))
  const missed = cycle?.status === 'active' && seen?.cycleId === cycle.id && seen.today < today && sameDone && seen.projection.pending.some(o => o.date < today && projection.pending.some(p => p.instanceId === o.instanceId && p.date > o.date))
  const passive = missed ? { cycleId:cycle.id, today, before:seen.projection, current:signature(projection) } : remembered?.cycleId === cycle?.id && remembered?.today === today && remembered.current === signature(projection) ? remembered : null
  const old = shifted ? shift.before : passive?.before
  const moved = old ? old.pending.filter(o => projection?.pending.some(p => p.instanceId === o.instanceId && p.date !== o.date)).length : 0
  useEffect(() => {
    if (!cycle || !projection) return
    const current = { cycleId:cycle.id, today, projection }
    setSeen(current)
    if (passive) setRemembered(passive)
    try {
      localStorage.setItem(seenKey, JSON.stringify({ cycleId:cycle.id, today, projection }))
      if (passive) localStorage.setItem(reflowKey, JSON.stringify(passive))
    } catch { /* Calendar remains available if storage is full. */ }
  }, [cycle?.id, today, signature(projection)])
  const projections = cycles.map(c => ({ cycle:c, projection:c.id === cycle?.id ? projection : projectCycle(c,S.workouts,today,S.queue) }))
  const all = { occurrences:projections.flatMap(p => p.projection.occurrences), endDate:projection?.endDate }
  const ends = projections.filter(p => ['finished','archived'].includes(p.cycle.status)).map(p => p.projection.occurrences.map(o => o.date).filter(Boolean).sort().at(-1) || p.cycle.completedOn || p.cycle.archivedOn).filter(Boolean)
  if (projection?.endDate) ends.push(projection.endDate)
  const ws = weekStartOf(S)
  const cells = monthCells(all, month, {workouts:S.workouts, weekStartsOn:ws, today})
  for (const cell of cells) if (cell) cell.end = ends.includes(cell.date)
  while (cells.length % 7) cells.push(null)
  const move = delta => { const date = new Date(month+'-01T12:00:00');date.setMonth(date.getMonth()+delta);setMonth(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`) }
  const openDay = cell => useUI.getState().openSheet(close => <CalendarDay cell={cell} close={close} />)
  const isMoved = o => !!old?.occurrences.find(p => p.instanceId === o.instanceId && p.date !== o.date)
  return <section className="card programme-calendar" aria-label={t('Workout calendar')}>
    <div className="row between">
      <button className="iconbtn" aria-label={t('Previous month')} onClick={() => move(-1)}><Icon name="chevronLeft" /></button>
      <h2 aria-live="polite">{new Date(month+'-01T12:00:00').toLocaleDateString(dateLocale(), {month:'long',year:'numeric'})}</h2>
      <button className="iconbtn" aria-label={t('Next month')} onClick={() => move(1)}><Icon name="chevronRight" /></button>
    </div>
    <Button size="sm" variant="ghost" onClick={() => setMonth(today.slice(0,7))}>{t('Today')}</Button>
    <div className="program-calendar-grid">
      {weekOrder(ws).map(d => <div className="program-calendar-heading" key={d}>{t(DAYS[d])}</div>)}
      {cells.map((cell,i) => cell ? <div className={'program-calendar-day'+(cell.today?' today':'')} key={cell.date} data-date={cell.date} role="group" aria-label={fmtDate(cell.date,true)}>
        <button className="program-calendar-date" aria-label={[fullDate(cell.date), ...cell.workouts.map(w => t('Logged workout: {0}',w.name || t('Workout'))), ...cell.occurrences.map(o => statusText(o,projection?.next?.instanceId === o.instanceId,isMoved(o))+': '+o.routineName), cell.end && t('Program end')].filter(Boolean).join(' · ')} aria-current={cell.today?'date':undefined} onClick={() => openDay(cell)}>{cell.day}{cell.end && <span aria-label={t('Program end')}>🏁</span>}</button>
        {cell.workouts.map(w => { const deload = cell.occurrences.some(o=>o.mode==='deload' && loggedProgrammeWorkout([w],o)); return <button key={w.id} className={'program-calendar-chip logged'+(deload?' deload':'')} title={w.name} aria-label={t('Logged workout: {0}', w.name || t('Workout'))+(deload?' · '+t('Deload'):'')+' · '+fullDate(cell.date)} onClick={() => workoutDetailSheet(w)}><Icon name="check" />{deload && '◇ '}<span>{w.name || t('Workout')}</span></button>})}
        {cell.occurrences.filter(o => o.status !== 'done' || !loggedProgrammeWorkout(cell.workouts, o)).map(o => <button key={o.instanceId} className={'program-calendar-chip '+o.status+(o.mode==='deload'?' deload':'')+(projection?.next?.instanceId===o.instanceId?' next':'')+(isMoved(o)?' moved':'')} title={o.routineName} aria-label={statusText(o,projection?.next?.instanceId===o.instanceId,isMoved(o))+': '+o.routineName+' · '+fullDate(cell.date)} onClick={() => programmeSessionSheet(o)}>{projection?.next?.instanceId===o.instanceId ? '→ ' : o.status==='skipped' ? '× ' : o.status==='done' ? '✓ ' : ''}{o.mode==='deload' && '◇ '}{isMoved(o) && '↗ '}{o.dayKey.toUpperCase()}</button>)}
        {old?.occurrences.filter(o => o.projected && o.date===cell.date && projection?.occurrences.find(p=>p.instanceId===o.instanceId)?.date!==o.date).map(o => <span className="program-calendar-ghost" key={o.instanceId} aria-label={t('Moved from this day')+': '+o.routineName+' · '+fullDate(cell.date)}>{t('Was {0}',o.dayKey.toUpperCase())}</span>)}
      </div> : <div key={'blank'+i} aria-hidden="true" />)}
    </div>
    <p className="program-calendar-legend">{t('Calendar legend: → next · ✓ logged · × skipped · ◇ deload · ↗ moved · dashed: previous date · 🏁 program end')}</p>
    <p className="sect-f">{t('Logged workouts are saved history. Program dates are projected and move with your training.')}</p>
    {cycle?.status === 'paused' && <p className="sect-f">{t('Program paused. Logged workouts remain visible.')}</p>}
    {old && <p className="program-calendar-notice" aria-live="polite">{passive && !shifted && t('Your projected sessions moved.')+' '}{t('{0} sessions moved · end {1} → {2}',moved,fmtDate(old.endDate,true),fmtDate(projection.endDate,true))}</p>}
    {projection?.endDate && <p className="ss">{t('Projected end: {0}',fmtDate(projection.endDate,true))}</p>}
  </section>
}
