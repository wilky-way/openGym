import { targetLabel } from '../lib/programme-targets.js'
import { effortOf } from '../lib/history.js'
import ProgrammeImport from '../components/ProgrammeImport.jsx'
import ProgrammeRollover from '../components/ProgrammeRollover.jsx'
import { useState } from 'react'
import Icon from '../components/Icon.jsx'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button, Switch, SelectRow } from '../components/ui.jsx'
import { programmeSessionSheet } from '../components/ProgrammeSession.jsx'
import { programmePreAppWeeks, programmesOf } from '../lib/programme.js'
import { endProgramme, startProgramme, switchProgramme, resumeProgramme, requireProgrammeIdle, runningProgramme } from '../lib/programme-lifecycle.js'
import { confirmSheet } from '../sheets.jsx'
import { projectCycle } from '../lib/programme-calendar.js'
import { todayISO, fmtDate, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import './Programs.css'

const library = d => d.source?.library || d.source?.kind === 'library'
const reviewLabel = d => d?.needsReview?.length ? t('Needs review') : t('Ready')
const dayName = (d, day) => d.days?.find(x => x.key === day.key)?.name || day.sessions?.[0]?.routineSnapshot?.name || day.key
const weekSets = (S, cycle, w) => {
  const actual = cycle?.occurrences.filter(o => (o.weekId || String(o.weekIndex)) === (w.weekId || String(w.index))).map(o => S.routines.find(r => r.id === o.routineId)).filter(Boolean)
  return (actual?.length ? actual : w.days?.flatMap(day => day.sessions?.map(s => s.routineSnapshot) || []) || []).reduce((n, r) => n + (r.ex || []).reduce((n, e) => n + Math.max(1, Math.floor((Number(e.sets) || 1) * (r.deload?.setsFactor ?? (w.mode === 'deload' ? w.deload?.setsFactor ?? .5 : 1)))), 0), 0)
}
const running = runningProgramme
export default function Programs() {
  const S = useStore(s => s.S)
  const [params] = useSearchParams()
  const [selected, setSelected] = useState(() => params.get('program'))
  const p = programmesOf(S), active = running(S)
  const cycle = p.cycles.find(c => c.id === selected)
  const activeProjection = active && projectCycle(active, S.workouts, todayISO(), S.queue)
  const definition = p.definitions.find(d => d.id === selected)
  if (cycle || definition) return <>
    <Button className="program-back" variant="ghost" icon="chevronLeft" onClick={() => setSelected(null)}>{t('All programs')}</Button>
    <ProgramDetail key={selected} definition={cycle?.snapshot || definition} cycle={cycle} />
  </>
  const card = (d, id, sub) => <button className="card program-card" key={id} onClick={() => setSelected(id)}><div className="tt">{d?.name || t('Program')}</div><div className="ss">{sub}</div><span className="tag">{id === active?.id ? active.status === 'paused' ? t('Paused') : t('Active program') : library(d) ? reviewLabel(d) : t('Mine')}</span>{id === active?.id && <><progress className="program-progress" aria-label={t('Program progress')} max={activeProjection.occurrences.length || 1} value={activeProjection.occurrences.filter(o => o.status !== 'pending').length}/><div className="ss">{t('{0} done · {1} skipped', activeProjection.occurrences.filter(o => o.status === 'done').length, activeProjection.occurrences.filter(o => o.status === 'skipped').length)} · {active.end === 'repeat' ? t('Then: repeat program') : t('Then: pick next')}</div></>}</button>
  return <>
    <ProgrammeRollover />
    <ProgrammeImport />
    <h4 className="sec">{t('Active program')}</h4>
    {active ? card(active.snapshot, active.id, active.status === 'paused' ? t('Paused') : t('Week {0} of {1} · ends {2}', active.weekIndex, active.lengthWeeks, fmtDate(projectCycle(active, S.workouts, todayISO(), S.queue).endDate, true)) + (active.snapshot?.weeks.find(w => w.index === active.weekIndex)?.rir != null ? ' · ' + targetLabel(active.snapshot.weeks.find(w => w.index === active.weekIndex),t,effortOf(S)) : '')) : <div className="empty">{t('No active program. Choose a program to load into Routines.')}</div>}
    {active && <ProgramControls cycle={active} />}
    {p.cycles.filter(c => c.activationConflict && c.activationConflict === active?.id).map(c => <p className="sect-f" key={c.id}>{t('An offline activation was archived. Your earlier run continues; its routines and history are kept.')}</p>)}
    <h4 className="sec">{t('Mine')}</h4>
    {p.definitions.filter(d => !library(d)).map(d => card(d, d.id, t('{0} weeks', d.weeks?.length || 0)))}
    {!p.definitions.some(d => !library(d)) && <p className="sect-f">{t('Your saved program definitions appear here.')}</p>}
    <h4 className="sec">{t('Library')} · {p.definitions.filter(library).length}</h4>
    {p.definitions.filter(d => library(d)).map(d => card(d, d.id, reviewLabel(d)))}
    {p.cycles.some(c => ['archived', 'finished'].includes(c.status)) && <h4 className="sec">{t('Program history')}</h4>}
    {p.cycles.filter(c => ['archived', 'finished'].includes(c.status)).map(c => card(c.snapshot, c.id, c.status === 'finished' ? t('Done') : t('Archived')))}
    <p className="sect-f">{t('Programs imported on your own device appear here. No private training library is bundled.')}</p>
  </>
}

function ProgramControls({ cycle }) {
  const S = useStore(s => s.S)
  const [switching, setSwitching] = useState(false)
  const end = () => confirmSheet({
    title: t('End program?'),
    message: t('Archive {0} and release its training queue. Logged workouts stay in history, and generated routines remain as plain routines.', cycle.snapshot?.name || t('Program')),
    confirmText: t('End program'),
    onConfirm: () => {
      try { useStore.getState().update(s => endProgramme(s, cycle.id)); useUI.getState().toast(t('Program ended')) }
      catch (err) { useUI.getState().toast(t(err.message)) }
    },
  })
  return <>
    <div className="program-controls">
      {cycle.status === 'paused' && <Button disabled={!!S.active} onClick={() => {
        try { useStore.getState().update(s => resumeProgramme(s, cycle.id)) }
        catch (err) { useUI.getState().toast(t(err.message)) }
      }}>{t('Resume program')}</Button>}
      <Button variant="danger" disabled={!!S.active} onClick={end}>{t('End program')}</Button>
      <Button disabled={!!S.active} onClick={() => setSwitching(cycle)}>{t('Switch program')}</Button>
    </div>
    {S.active && <p className="sect-f">{t('Finish the current workout before changing the program.')}</p>}
    {switching && <SwitchPreview cycle={switching} onClose={() => setSwitching(false)} />}
  </>
}

function SwitchPreview({ cycle, onClose }) {
  const S = useStore(s => s.S)
  const [definitionId, setDefinitionId] = useState('')
  const d = programmesOf(S).definitions.find(d => d.id === definitionId)
  return <section className="card" aria-label={t('Switch program')}>
    <SelectRow title={t('Choose next program')} value={definitionId} onChange={setDefinitionId} options={[{ value: '', label: t('Choose next program') }, ...programmesOf(S).definitions.map(d => ({ value: d.id, label: d.name }))]} />
    {d ? <LoadPreview key={d.id} definition={d} repeat={d.end === 'repeat'} switchCycle={cycle} onClose={onClose} /> : <Button onClick={onClose}>{t('Cancel')}</Button>}
  </section>
}

function ProgramDetail({ definition: d, cycle }) {
  const S = useStore(s => s.S), update = useStore(s => s.update), nav = useNavigate()
  const [repeat, setRepeat] = useState(d.end === 'repeat')
  const [loading, setLoading] = useState(false)
  const [switchCycle, setSwitchCycle] = useState(null)
  const projection = cycle && projectCycle(cycle, S.workouts, todayISO(), S.queue)
  const weeks = d.weeks || []
  const currentId = cycle?.weekId || String(cycle?.weekIndex ?? weeks[0]?.index)
  const currentWeek = weeks.find(w => (w.weekId || String(w.index)) === currentId)
  const preApp = cycle?.preApp?.weeks || []
  const timeline = [...preApp.filter(index => !weeks.some(w => w.index === index)).map(index => ({ index, preApp: true })), ...weeks]
  const tmKeys = [...new Set(weeks.flatMap(w=>w.days.flatMap(day=>day.sessions.flatMap(s=>s.routineSnapshot.ex.filter(e=>e.tm).map(e=>e.tm.key || e.id)))))]
  const setRepeating = value => {
    setRepeat(value)
    update(s => { requireProgrammeIdle(s); const record = cycle ? s.programmes.cycles.find(c => c.id === cycle.id) : s.programmes.definitions.find(x => x.id === d.id); if (record) record.end = value ? 'repeat' : 'next' })
  }
  return <div className="program-detail">
    <header className="program-title">
      <h2>{d.name}</h2>
      <p className="ss">{d.source?.name || t('Own program')} · {t('{0} days per week', cycle?.cadence?.perWeek || weeks[0]?.days?.length || 0)}</p>
      {d.instructions && <p className="program-description">{d.instructions}</p>}
    </header>
    {d.needsReview?.length > 0 && <section className="card"><strong>{t('Needs review')}</strong>{d.needsReview.map((reason, i) => <p key={i}>{t(reason)}</p>)}</section>}
    <section className="card program-overview">
      <div className="row between"><div>
        <div className="program-now">{cycle ? t('Week {0} of {1}', cycle.weekIndex, cycle.lengthWeeks) : t('{0} weeks', weeks.length)}</div>
        <p className="ss">{cycle?.status === 'paused' ? t('Paused') : projection?.endDate ? t('Projected end: {0}', fmtDate(projection.endDate, true)) : ''}</p>
      </div>{currentWeek?.rir != null && <span className="program-effort hot">{targetLabel(currentWeek,t,effortOf(S))}</span>}</div>
      <div className="program-week-strip" aria-label={t('Program progress')}>
        {timeline.map(w => {
          const id = w.weekId || String(w.index), projected = projection?.weeks.find(p => p.weekId === id)
          const before = w.preApp || preApp.includes(w.index)
          return <div className={'program-week-marker' + (before ? ' pre-app' : projected?.closed ? ' done' : '') + (id === currentId && !before ? ' current' : '') + (w.mode === 'deload' ? ' deload' : '')} key={id}>
            <i aria-hidden="true">{!before && projected && <b style={{width: `${(projected.done + projected.skipped) / (projected.planned || 1) * 100}%`}} />}</i>
            <span>{t('Week {0}', w.index)}</span>
          </div>
        })}
      </div>
      <div className="program-week-legend">
        {preApp.length > 0 && <span><i className="pre-app" />{t('Pre-app')}</span>}
        <span><i className="current" />{t('Week {0}', cycle?.weekIndex ?? weeks[0]?.index)}</span>
        {weeks.some(w => w.mode === 'deload') && <span><i className="deload" />{t('Deload')}</span>}
      </div>
    </section>
    <div className="program-week-list">
      {weeks.filter(w => !preApp.includes(w.index)).map(w => {
        const id = w.weekId || String(w.index), projected = projection?.weeks.find(p => p.weekId === id)
        const current = id === currentId
        const count = weekSets(S, cycle, w), previousIndex = weeks.indexOf(w) - 1
        const delta = previousIndex >= 0 ? count - weekSets(S, cycle, weeks[previousIndex]) : null
        return <details className={'card program-week' + (current ? ' current' : '') + (w.mode === 'deload' ? ' deload' : '')} key={id} open={current}>
          <summary>
            <div><h3>{t('Week {0}', w.index)}{w.mode === 'deload' && <span className="tag">{t('Deload')}</span>}</h3>
              <p className="ss">{projected?.startDate && <>{fmtDate(projected.startDate, true)} – {fmtDate(projected.endDate, true)} · </>}{projected ? t('{0} done · {1} skipped', projected.done, projected.skipped) : `${count} ${t('working sets')}`}</p>
            </div>
            {w.rir != null && <span className={'program-effort' + (current ? ' hot' : '')}>{targetLabel(w,t,effortOf(S))}</span>}
            <Icon name="chevronDown" />
          </summary>
          <div className="program-weeks-grid">
            {cycle ? (projected?.occurrences || []).map(o => <button className={'program-cell ' + o.status + (projection.next?.instanceId === o.instanceId ? ' next' : '')} key={o.instanceId} onClick={() => programmeSessionSheet(o)}>
              <i className="program-day-dot" aria-hidden="true" />
              <span className="program-day-key">{o.dayKey.toUpperCase()}</span>
              <span className="program-day-name"><strong>{dayName(d, w.days?.find(day => day.key === o.dayKey) || { key: o.dayKey })}</strong><small>{o.date ? fmtDate(o.date, true) : t('Pending')}</small></span>
              <span className="program-day-status">{o.status === 'done' ? t('Done') : o.status === 'skipped' ? t('Skipped') : projection.next?.instanceId === o.instanceId ? o.date === todayISO() ? t('Today') : t('Next session') : t('Planned')}</span>
              <Icon name="chevronRight" />
            </button>) : w.days?.map(day => <div className="program-cell" key={day.key}><i className="program-day-dot" aria-hidden="true" /><span className="program-day-key">{day.key.toUpperCase()}</span><span className="program-day-name"><strong>{dayName(d, day)}</strong><small>{day.sessions?.filter(s => day.sessions.length > 1 || s.routineSnapshot?.name !== dayName(d, day)).map(s => s.routineSnapshot?.name).join(' · ')}</small></span></div>)}
          </div>
          <p className="sect-f">{count} {t('working sets')}{delta != null && ` (${delta >= 0 ? '+' : ''}${delta})`} · {t('Edit a session to change its prescriptions.')}</p>
        </details>
      })}
      {preApp.length > 0 && <details className="card program-pre-app"><summary>{preApp.map(index => t('Week {0}', index)).join(' · ')}<span className="ss">{t('Pre-app')}</span><Icon name="chevronDown" /></summary><p className="sect-f">{t('Trained before openGym; no workout logs are created.')}</p></details>}
    </div>
    {cycle && ['active','paused'].includes(cycle.status) && tmKeys.map(key=><label key={key}>{t('Training max: {0} ({1})',key,S.unit)}<input type="number" min="0" step="any" disabled={!!S.active} value={cycle.tm?.[key] || ''} onChange={e=>{const value=Number(e.target.value);update(s=>{requireProgrammeIdle(s);const live=s.programmes.cycles.find(c=>c.id===cycle.id);live.tm={...live.tm,[key]:Number.isFinite(value)&&value>0?value:0}})}}/></label>)}
    <section className="card program-after">
      {cycle?.startsOn && <p className="ss">{t('Started {0}', fmtDate(cycle.startsOn, true))}</p>}
      <div className="row between"><div>{t('Repeat program')}<p className="ss">{t('Saves your end-of-block preference.')}</p></div><Switch aria-label={t('Repeat program')} disabled={!!S.active || !!cycle && !['active', 'paused'].includes(cycle.status)} checked={cycle ? cycle.end === 'repeat' : repeat} onChange={setRepeating} /></div>
      <p className="sect-f">{t('Repeat starts a new full program lap with progression carried. After the block, repeat or choose your next program.')}</p>
      {cycle && ['active','paused'].includes(cycle.status) && <ProgramControls cycle={cycle} />}
    </section>
    <div className="program-detail-actions">
      {cycle && <Button onClick={() => { localStorage.setItem('gym_plan_view', 'routines'); nav('/plan') }}>{t('View in Routines')}</Button>}
      <Button disabled={!!S.active} onClick={() => update(s => { requireProgrammeIdle(s); s.programmes.definitions.push({ ...structuredClone(d), id: uid(), name: d.name + ' (' + t('Copy') + ')', source: { kind: 'own', ...(d.source?.private ? {private:true} : {}) } }) })}>{t('Duplicate program')}</Button>
      {!cycle && <Button variant="primary" disabled={!!S.active} onClick={() => { setSwitchCycle(running(S) || null); setLoading(true) }}>{running(S) ? t('Switch to this program') : t('Start this program')}</Button>}
      {!cycle && S.active && <p className="sect-f">{t('Finish the current workout before changing the program.')}</p>}
    </div>
    {loading && <LoadPreview definition={d} repeat={repeat} switchCycle={switchCycle} onClose={() => setLoading(false)} />}
  </div>
}

function LoadPreview({ definition: d, repeat, switchCycle, onClose }) {
  const S = useStore(s => s.S)
  const [weekIndex, setWeekIndex] = useState(d.weeks[0].index)
  const [adopting, setAdopting] = useState(false)
  const [mapping, setMapping] = useState({})
  const [error, setError] = useState('')
  const [tm,setTM] = useState({})
  const [startDate, setStartDate] = useState(todayISO())
  const tmKeys = [...new Set(d.weeks.flatMap(w=>w.days.flatMap(day=>day.sessions.flatMap(s=>s.routineSnapshot.ex.filter(e=>e.tm).map(e=>e.tm.key || e.id)))))]
  const week = d.weeks.find(w => w.index === weekIndex)
  const canAdopt = !switchCycle && week.days.every(day => day.sessions?.length === 1)
  const count = d.weeks.filter(w => w.index >= weekIndex).flatMap(w => w.days.flatMap(day => day.sessions || [])).length
  const validMap = week.days.every(day => mapping[day.key]) && new Set(Object.values(mapping)).size === week.days.length
  let preview, previewError
  try {
    const draft = structuredClone(S)
    if (!adopting || !validMap) draft.queue = null
    const opts = { startsOn: startDate, weekIndex, tm, ...(adopting && validMap ? { existingRoutineIds:mapping } : {}) }
    const c = switchCycle ? switchProgramme(draft, switchCycle.id, d, opts) : startProgramme(draft, d, opts)
    preview = projectCycle(c, draft.workouts, todayISO(), draft.queue)
  } catch (err) { previewError = t(err.message) }
  const apply = () => {
    try {
      const opts = { startsOn: startDate, weekIndex, tm, end: repeat ? 'repeat' : 'next', preApp: { weeks: programmePreAppWeeks(d, weekIndex) }, ...(adopting ? { existingRoutineIds: mapping } : {}) }
      useStore.getState().update(s => switchCycle ? switchProgramme(s, switchCycle.id, d, opts) : startProgramme(s, d, opts))
      onClose(); useUI.getState().toast(t('Program loaded into Routines'))
    } catch (err) { setError(t(err.message)) }
  }
  return <section className="card" aria-label={t('Load preview')}>
    <h3>{t('Load preview')}</h3>
    <label>{t('Program start date')}<input type="date" aria-label={t('Program start date')} value={startDate} onChange={e => setStartDate(e.target.value)} /></label>
    {switchCycle && <p>{t('Switch from {0} to {1}? The current cycle will be archived and its queue released. Logged workouts are kept, and its routines become plain routines. The new program starts on {2} and takes over the queue.', switchCycle.snapshot?.name || t('Program'), d.name, startDate)}</p>}
    <SelectRow title={t('Starting week')} value={weekIndex} onChange={v => { setWeekIndex(Number(v)); setMapping({}) }} options={d.weeks.map(w => ({ value: w.index, label: t('Start at week {0}', w.index) }))} />
    <p>{adopting ? t('Adopt {0} routines and create {1} new routines.', week.days.length, count - week.days.length) : t('Load {0} routines. Your program owns the training queue.', count)}</p>
    <div className="program-preview-breakdown">{d.weeks.filter(w => w.index >= weekIndex).map(w => <p key={w.index}>{t('Week {0}', w.index)} · {adopting && w.index === weekIndex ? t('Adopt {0} · ids kept', w.days.length) : t('Create {0} routines', w.days.flatMap(day => day.sessions || []).length)}</p>)}</div>
    <p className="ss">{adopting ? t('Training queue order and logged progress are kept.') : t('The new program takes over the training queue.')} {t('Existing workouts are untouched.')}</p>
    <p className="ss">{t('{0} sessions per week · any days', week.days.length)} · {preview?.endDate && t('Projected end: {0}', fmtDate(preview.endDate, true))}</p>
    <p className="ss">{t('Next session: {0}', preview?.next?.routineName || '')} · {repeat ? t('Then: repeat program') : t('Then: pick next')}</p>
    {canAdopt && <div className="row between"><span>{t('Adopt existing routines for this week')}</span><Switch aria-label={t('Adopt existing routines for this week')} checked={adopting} onChange={value => { setAdopting(value); if (value) { const picks = {}; for (const day of week.days) { const name = dayName(d, day).toLowerCase(); const matches = S.routines.filter(r => !r.programme && (r.name?.toLowerCase() === name || r.id === day.key)); if (matches.length === 1) picks[day.key] = matches[0].id }; if (new Set(Object.values(picks)).size === Object.values(picks).length) setMapping(picks) } }} /></div>}
    {adopting && week.days.map(day => <label key={day.key}><SelectRow title={dayName(d, day)} value={mapping[day.key] || ''} onChange={id => setMapping({ ...mapping, [day.key]: id })} options={[{ value: '', label: t('Choose routine') }, ...S.routines.filter(r => !r.programme).map(r => ({ value: r.id, label: r.name }))]} /></label>)}
    {adopting && <p className="sect-f">{t('Selected routines keep their prescriptions, ids and logged progress. Later weeks are added.')}</p>}
    {tmKeys.map(key=><label key={key}>{t('Training max: {0} ({1})',key,S.unit)}<input type="number" min="0" step="any" value={tm[key] || ''} onChange={e=>setTM({...tm,[key]:Number(e.target.value)})}/></label>)}
    {(error || previewError) && <p role="alert">{error || previewError}</p>}
    <Button variant="primary" disabled={!!S.active || !preview || adopting && !validMap} onClick={apply}>{switchCycle ? t('Confirm switch') : t('Confirm load')}</Button><Button onClick={onClose}>{t('Cancel')}</Button>
  </section>
}

export function ProgrammeRoutines({ S, nav }) {
  const active = running(S)
  return programmesOf(S).cycles.map(c => <div key={c.id}>
    <h4 className="sec">{c.snapshot?.name} · {c.status === 'archived' ? t('Archived') : c.status === 'finished' ? t('Done') : t('Program sessions')}</h4>
    {projectCycle(c, S.workouts, todayISO(), S.queue).weeks.filter(w => c.id !== active?.id || !w.closed).map(w => <details className="program-routine-week" key={w.weekId} open={c.id === active?.id && w.weekIndex === c.weekIndex}>
      <summary>{t('Week {0}', w.weekIndex)} · {w.mode === 'deload' ? t('Deload') : t('{0} done · {1} skipped', w.done, w.skipped)}</summary>
      <div className="list">{w.occurrences.filter(o => S.routines.some(r => r.id === o.routineId)).map(o => <button className="item program-routine" key={o.instanceId} onClick={() => nav('/plan/r/' + o.routineId)}><span className="grow tt">{o.routineName}</span><span className="ss">{o.status === 'pending' ? t('Pending') : o.status === 'done' ? t('Done') : t('Skipped')}</span></button>)}</div>
    </details>)}
  </div>)
}
