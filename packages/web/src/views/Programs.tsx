import { nativeMaxLabel } from '@opengym/core/native-prescription'
import { effectiveProgrammeMax, maxBasisLabel, programmeMaxKeys } from '@opengym/core/programme-max'
import { adjustProgrammeMaxSheet } from '../components/ProgrammeMaxEditor'
import { convertWeightPrecise } from '@opengym/core/progression-engine/units'
import { sessionPreviewSheet, programmePreviewContent } from '../components/SessionPreview'
import ProgressionPrescription from '../components/ProgressionPrescription'
import { progressionDisplay } from '../lib/progression-display'
const programmeErrorText = (error: unknown) => error instanceof Error ? error.message : 'Could not load the program library.'
// Persisted programme records retain legacy unknown fields; core validates mutations.
import { createExerciseIndex } from '@opengym/core/exercises'
import { targetLabel } from '@opengym/core/programme-targets'
import { effortOf } from '@opengym/core/history'
import ProgrammeImport from '../components/ProgrammeImport'
import ProgrammeRollover from '../components/ProgrammeRollover'
import { useEffect, useState, useRef } from 'react'
import Icon from '../components/Icon'
import { nav } from '../lib/nav'
import { programmeOwner, programmeUi, setProgrammePreference, programmeTarget, updateProgramme } from '../lib/programme-ui-services'
import { useStore } from '../store/useStore'
import { useUI } from '../store/useUI'
import { Button, Switch, SelectRow } from '../components/ui'
import { programmeSessionSheet } from '../components/ProgrammeSession'
import { programmePreAppWeeks, programmesOf } from '@opengym/core/programme'
import { startProgramme, switchProgramme, requireProgrammeIdle, runningProgramme } from '@opengym/core/programme-lifecycle'
import { confirmSheet } from '../lib/programme-ui-services'
import { projectCycle } from '@opengym/core/programme-calendar'
import { todayISO, fmtDate, uid } from '@opengym/core/format'
import { t } from '../lib/i18n'

const library = (d: any) => d.source?.library || d.source?.kind === 'library'
const reviewLabel = (d: any) => d?.needsReview?.length ? t('Needs review') : t('Ready')
const dayName = (d: any, day: any) => d.days?.find((x: any) => x.key === day.key)?.name || day.sessions?.[0]?.routineSnapshot?.name || day.key
const weekSets = (S: any, cycle: any, w: any) => {
  const actual = cycle?.occurrences.filter((o: any) => (o.weekId || String(o.weekIndex)) === (w.weekId || String(w.index))).map((o: any) => S.routines.find((r: any) => r.id === o.routineId)).filter(Boolean)
  return (actual?.length ? actual : w.days?.flatMap((day: any) => day.sessions?.map((s: any) => s.routineSnapshot) || []) || []).reduce((n: any, r: any) => n + (r.ex || []).reduce((n: any, e: any) => n + Math.max(1, Math.floor((Number(e.sets) || 1) * (r.deload?.setsFactor ?? (w.mode === 'deload' ? w.deload?.setsFactor ?? .5 : 1)))), 0), 0)
}
const running = runningProgramme
export default function Programs() {
  const S = useStore((s) => s.S)
  const [selected, setSelected] = useState(() => programmeUi().initialProgramId?.() ?? null)
  const p = programmesOf(S), active = running(S)
  const user = useStore((s) => s.user)
  const [libraryState,setLibraryState] = useState<{scope:string; items:import('@opengym/contract/http/api').LibrarySummary[]}>({scope:'',items:[]})
  const [entryState,setEntryState] = useState<{scope:string; entry:import('@opengym/contract/http/api').LibraryEntry} | null>(null)
  const [libraryError,setLibraryError] = useState('')
  const [busy,setBusy] = useState(false)
  const [retry,setRetry] = useState(0)
  const scope = programmeOwner()
  const serverItems = libraryState.scope===scope ? libraryState.items : []
  const serverEntry = entryState?.scope===scope && entryState.entry.definition.id===selected ? entryState.entry : null
  useEffect(() => {
    let live = true
    setLibraryState({scope,items:[]});setEntryState(null);setLibraryError('')
    if (!user) return
    setBusy(true)
    useStore.getState().listProgrammeLibrary().then((result: any) => { if(live)setLibraryState({scope,items:result.items}) }).catch((error: any) => { if(live)setLibraryError(programmeErrorText(error)) }).finally(()=>{if(live)setBusy(false)})
    return () => { live = false }
  }, [scope,retry])
  useEffect(() => {
    let live = true
    setEntryState(null)
    const item = serverItems.find((item: any) =>item.id===selected)
    if (!item || !user) return
    setBusy(true);setLibraryError('')
    useStore.getState().getLibraryProgramme(item.id,item.versionId).then((entry: any) => {if(live)setEntryState({scope,entry})}).catch((error: any) => {if(live)setLibraryError(programmeErrorText(error))}).finally(()=>{if(live)setBusy(false)})
    return () => {live=false}
  }, [selected,libraryState,scope])
  const cycle = p.cycles.find((c: any) => c.id === selected)
  const activeProjection = active && projectCycle(active, S.workouts, todayISO(), S.queue)
  const definition = serverEntry?.definition || p.definitions.find((d: any) => d.id === selected && !serverItems.some((item: any) =>item.id===d.id))
  if (cycle || definition) return <>
    <Button className="program-back" variant="ghost" icon="chevronLeft" onClick={() => setSelected(null)}>{t('All programs')}</Button>
    <ProgramDetail key={scope+selected} definition={cycle?.snapshot || definition} cycle={cycle} serverVersion={serverEntry?.versionId} libraryItems={serverItems} />
  </>
  const card = (d: any, id: string, sub: string) => <button className="card program-card" key={id} onClick={() => setSelected(id)}><div className="tt">{d?.name || t('Program')}</div><div className="ss">{sub}</div><span className="tag">{id === active?.id ? active.status === 'paused' ? t('Paused') : t('Active program') : library(d) ? reviewLabel(d) : t('Mine')}</span>{id === active?.id && <><progress className="program-progress" aria-label={t('Program progress')} max={activeProjection.occurrences.length || 1} value={activeProjection.occurrences.filter((o: any) => o.status !== 'pending').length}/><div className="ss">{t('{0} done · {1} skipped', activeProjection.occurrences.filter((o: any) => o.status === 'done').length, activeProjection.occurrences.filter((o: any) => o.status === 'skipped').length)} · {active.end === 'repeat' ? t('Then: repeat program') : t('Then: pick next')}</div></>}</button>
  return <>
    <ProgrammeRollover />
    <ProgrammeImport />
    <h4 className="sec">{t('Active program')}</h4>
    {active ? card(active.snapshot, active.id, active.status === 'paused' ? t('Paused') : t('Week {0} of {1} · ends {2}', active.weekIndex, active.lengthWeeks, fmtDate(projectCycle(active, S.workouts, todayISO(), S.queue).endDate, true)) + (active.snapshot?.weeks.find((w: any) => w.index === active.weekIndex)?.rir != null ? ' · ' + targetLabel(active.snapshot.weeks.find((w: any) => w.index === active.weekIndex),t,effortOf(S)) : '')) : <div className="empty">{t('No active program. Choose a program to load into Routines.')}</div>}
    {active && <ProgramControls key={scope} cycle={active} libraryItems={serverItems} />}
    {p.cycles.filter((c: any) => c.activationConflict && c.activationConflict === active?.id).map((c: any) => <p className="sect-f" key={c.id}>{t('An offline activation was archived. Your earlier run continues; its routines and history are kept.')}</p>)}
    <h4 className="sec">{t('Mine')}</h4>
    {p.definitions.filter((d: any) => !library(d)).map((d: any) => card(d, d.id, t('{0} weeks', d.weeks?.length || 0)))}
    {!p.definitions.some((d: any) => !library(d)) && <p className="sect-f">{t('Your saved program definitions appear here.')}</p>}
    <h4 className="sec">{t('Library')} · {serverItems.length + p.definitions.filter((d:any)=>library(d) && !serverItems.some((item: any) =>item.id===d.id)).length}</h4>
    {busy && <p role="status">{t('Loading program library…')}</p>}
    {libraryError && <p role="alert">{libraryError}</p>}
    {user && <Button onClick={()=>setRetry(retry+1)}>{t('Refresh library')}</Button>}
    {!user && <p>{t('Sign in to load the program library.')}</p>}
    {serverItems.map((item: any) => <button className="card program-card" key={item.id} onClick={()=>setSelected(item.id)}><div className="tt">{item.name}</div><div className="ss">{item.level}{item.private?' · '+t('Private import'):''}</div><span className="tag">{t('Library')}</span></button>)}
    {p.definitions.filter((d: any) => library(d) && !serverItems.some((item: any) =>item.id===d.id)).map((d: any) => card(d, d.id, reviewLabel(d)))}
    {p.cycles.some((c: any) => ['archived', 'finished'].includes(c.status)) && <h4 className="sec">{t('Program history')}</h4>}
    {p.cycles.filter((c: any) => ['archived', 'finished'].includes(c.status)).map((c: any) => card(c.snapshot, c.id, c.status === 'finished' ? t('Done') : t('Archived')))}
    <p className="sect-f">{t('Programs imported on your own device appear here. No private training library is bundled.')}</p>
  </>
}

function ProgramControls({ cycle, libraryItems=[] }: any) {
  const owner = programmeOwner()
  const S = useStore((s) => s.S)
  const [switching, setSwitching] = useState<any>(false)
  const controlsTarget = programmeTarget(owner)
  const end = () => confirmSheet({
    title: t('End program?'),
    message: t('Archive {0} and release its training queue. Logged workouts stay in history, and generated routines remain as plain routines.', cycle.snapshot?.name || t('Program')),
    confirmText: t('End program'),
    onConfirm: valid => {
      try { useStore.getState().endProgramme(cycle.id, {}, valid); useUI.getState().toast(t('Program ended')) }
      catch (err: any) { useUI.getState().toast(t(err.message)) }
    },
  },(draft = useStore.getState().S)=>draft.programmes.cycles.some((c:any)=>c.id===cycle.id && ['active','paused'].includes(c.status)),controlsTarget)
  return <>
    <div className="program-controls">
      {cycle.status === 'paused' && <Button disabled={!!S.active} onClick={() => {
        try { useStore.getState().resumeProgramme(cycle.id, {}, controlsTarget) }
        catch (err: any) { useUI.getState().toast(t(err.message)) }
      }}>{t('Resume program')}</Button>}
      <Button variant="danger" disabled={!!S.active} onClick={end}>{t('End program')}</Button>
      <Button disabled={!!S.active} onClick={() => setSwitching(cycle)}>{t('Switch program')}</Button>
    </div>
    {S.active && <p className="sect-f">{t('Finish the current workout before changing the program.')}</p>}
    {switching && <SwitchPreview libraryItems={libraryItems} cycle={switching} onClose={() => setSwitching(false)} />}
  </>
}

function SwitchPreview({ cycle, onClose, libraryItems }: any) {
  const S = useStore((s) => s.S)
  const [definitionId, setDefinitionId] = useState('')
  const user = useStore(s=>s.user), owner = programmeOwner()
  const [result,setResult] = useState<{owner:string;entry:import('@opengym/contract/http/api').LibraryEntry}|null>(null)
  const [error,setError] = useState('')
  const item = libraryItems.find((item: any)=>item.id===definitionId)
  useEffect(()=>{
    let live=true;setResult(null);setError('')
    if(item)useStore.getState().getLibraryProgramme(item.id,item.versionId).then((entry:import('@opengym/contract/http/api').LibraryEntry)=>{if(live)setResult({owner,entry})}).catch((error:unknown)=>{if(live)setError(programmeErrorText(error))})
    return ()=>{live=false}
  },[definitionId,item?.versionId,owner,user?.id])
  const entry = result?.owner===owner && result.entry.definition.id===definitionId ? result.entry : null
  const d = item ? entry?.definition : programmesOf(S).definitions.find((d: any) => d.id === definitionId)
  const choices = [...programmesOf(S).definitions.filter((d:any)=>!libraryItems.some((item:any)=>item.id===d.id)),...libraryItems]
  return <section className="card" aria-label={t('Switch program')}>
    <SelectRow title={t('Choose next program')} value={definitionId} onChange={setDefinitionId} options={[{ value: '', label: t('Choose next program') }, ...choices.map((d: any) => ({ value: d.id, label: d.name }))]} />
    {error && <p role="alert">{error}</p>}
    {d ? <LoadPreview key={owner+d.id} serverVersion={entry?.versionId} definition={d} repeat={d.end === 'repeat'} switchCycle={cycle} onClose={onClose} /> : <Button onClick={onClose}>{t('Cancel')}</Button>}
  </section>
}

function ProgramDetail({ definition: d, cycle, serverVersion, libraryItems }: {definition: any; cycle?: any; serverVersion?: string; libraryItems:any[]}) {
  const S = useStore((s) => s.S), owner = programmeOwner()
  const previewSource = useRef({definition: d, cycle, mounted: true})
  previewSource.current = {definition: d, cycle, mounted: true}
  useEffect(() => { previewSource.current.mounted = true; return () => { previewSource.current.mounted = false } }, [])
  const preview = (w: any, day: string, session?: string, occurrence?: import('@opengym/core/programme-engine-types').ProjectedProgrammeOccurrence) => {
    const live = useStore.getState().S
    const currentCycle = cycle ? live.programmes.cycles.find((c: any) => c.id === cycle.id) : undefined
    const currentOccurrence = currentCycle && occurrence ? projectCycle(currentCycle, live.workouts, todayISO(), live.queue).occurrences.find(o =>
      o.instanceId === occurrence.instanceId && o.routineId === occurrence.routineId && o.dayKey === day && o.sessionTemplateId === session &&
      (o.weekId || String(o.weekIndex)) === (w.weekId || String(w.index))) : undefined
    sessionPreviewSheet(live => {
      if (!previewSource.current.mounted || owner !== programmeOwner()) return null
      const currentCycle = cycle ? live.programmes.cycles.find((c: any) => c.id === cycle.id) : undefined
      const currentDefinition = cycle ? currentCycle?.snapshot : serverVersion ? previewSource.current.definition : live.programmes.definitions.find((x: any) => x.id === d.id)
      return programmePreviewContent(live, currentDefinition, currentCycle, w, day, session)
    }, currentCycle?.status === 'active' && currentOccurrence?.status === 'pending' ? () => programmeSessionSheet(currentOccurrence) : undefined)
  }
  const detailTarget = programmeTarget(owner)
  const update = (mutate: (draft: import('../store/useStore').StoreDocument) => void) => updateProgramme(mutate, detailTarget)
  const [repeat, setRepeat] = useState(d.end === 'repeat')
  const [loading, setLoading] = useState(false)
  const [switchCycle, setSwitchCycle] = useState<any>(null)
  const projection = cycle && projectCycle(cycle, S.workouts, todayISO(), S.queue)
  const weeks = d.weeks || []
  const prescriptions = progressionDisplay(S, d, cycle, weeks.map((w: any) => w.index), todayISO())
  const exerciseIndex = createExerciseIndex(S.customEx)
  const currentId = cycle?.weekId || String(cycle?.weekIndex ?? weeks[0]?.index)
  const currentWeek = weeks.find((w: any) => (w.weekId || String(w.index)) === currentId)
  const preApp = cycle?.preApp?.weeks || []
  const timeline = [...preApp.filter((index: any) => !weeks.some((w: any) => w.index === index)).map((index: any) => ({ index, preApp: true })), ...weeks]
  const tmKeys: string[] = [...new Set<string>([...programmeMaxKeys(d,cycle), ...Object.keys(d.tmSeeds ?? {}), ...Object.keys(cycle?.tmSeed ?? {}), ...Object.keys(cycle?.tm ?? {}), ...Object.keys(prescriptions?.result.tm ?? {}), ...weeks.flatMap((w: any) =>w.days.flatMap((day: any) =>day.sessions.flatMap((s: any) =>s.routineSnapshot.ex.filter((e: any) =>e.tm).map((e: any) =>e.tm.key || e.id))))])]
  const setRepeating = (value: any) => {
    setRepeat(value)
    update((s: any) => { requireProgrammeIdle(s); const record = cycle ? s.programmes.cycles.find((c: any) => c.id === cycle.id) : s.programmes.definitions.find((x: any) => x.id === d.id); if (record) record.end = value ? 'repeat' : 'next' })
  }
  return <div className="program-detail">
    <header className="program-title">
      <h2>{d.name}</h2>
      <p className="ss">{d.source?.name || t('Own program')} · {t('{0} days per week', cycle?.cadence?.perWeek || weeks[0]?.days?.length || 0)}</p>
      {d.instructions && <p className="program-description">{d.instructions}</p>}
    </header>
    {d.needsReview?.length > 0 && <section className="card"><strong>{t('Needs review')}</strong>{d.needsReview.map((reason: any, i: any) => <p key={i}>{t(reason)}</p>)}</section>}
    <section className="card program-overview">
      <div className="row between"><div>
        <div className="program-now">{cycle ? t('Week {0} of {1}', cycle.weekIndex, cycle.lengthWeeks) : t('{0} weeks', weeks.length)}</div>
        <p className="ss">{cycle?.status === 'paused' ? t('Paused') : projection?.endDate ? t('Projected end: {0}', fmtDate(projection.endDate, true)) : ''}</p>
      </div>{currentWeek?.rir != null && <span className="program-effort hot">{targetLabel(currentWeek,t,effortOf(S))}</span>}</div>
      <div className="program-week-strip" aria-label={t('Program progress')}>
        {timeline.map((w: any) => {
          const id = w.weekId || String(w.index), projected = projection?.weeks.find((p: any) => p.weekId === id)
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
        {weeks.some((w: any) => w.mode === 'deload') && <span><i className="deload" />{t('Deload')}</span>}
      </div>
    </section>
    <div className="program-week-list">
      {weeks.filter((w: any) => !preApp.includes(w.index)).map((w: any) => {
        const id = w.weekId || String(w.index), projected = projection?.weeks.find((p: any) => p.weekId === id)
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
            {cycle ? (projected?.occurrences || []).map((o: any) => <button className={'program-cell ' + o.status + (projection.next?.instanceId === o.instanceId ? ' next' : '')} key={o.instanceId} onClick={() => preview(w, o.dayKey, o.sessionTemplateId, o)}>
              <i className="program-day-dot" aria-hidden="true" />
              <span className="program-day-key">{o.dayKey.toUpperCase()}</span>
              <span className="program-day-name"><strong>{dayName(d, w.days?.find((day: any) => day.key === o.dayKey) || { key: o.dayKey })}</strong><small>{o.date ? fmtDate(o.date, true) : t('Pending')}</small></span>
              <span className="program-day-status">{o.status === 'done' ? t('Done') : o.status === 'skipped' ? t('Skipped') : projection.next?.instanceId === o.instanceId ? o.date === todayISO() ? t('Today') : t('Next session') : t('Planned')}</span>
              <Icon name="chevronRight" />
            </button>) : w.days?.map((day: any) => <div key={day.key}>
              <button className="program-cell" onClick={() => preview(w, day.key, day.sessions?.length === 1 ? day.sessions[0].sessionTemplateId : undefined)}><i className="program-day-dot" aria-hidden="true" /><span className="program-day-key">{day.key.toUpperCase()}</span><span className="program-day-name"><strong>{dayName(d, day)}</strong><small>{day.sessions?.filter((s: any) => day.sessions.length > 1 || s.routineSnapshot?.name !== dayName(d, day)).map((s: any) => s.routineSnapshot?.name).join(' · ')}</small></span><Icon name="chevronRight" /></button>
              {day.sessions?.length > 1 && day.sessions.map((s: any) => <button className="program-cell program-session-cell" key={s.sessionTemplateId} onClick={() => preview(w, day.key, s.sessionTemplateId)} aria-label={t('Preview {0}', s.routineSnapshot?.name || t('session'))}><span className="program-day-name">{s.routineSnapshot?.name || t('Session')}</span><Icon name="chevronRight" /></button>)}
            </div>)}
            <ProgressionPrescription display={prescriptions} scale={effortOf(S)} week={w.index} showSession/>
          </div>
          <p className="sect-f">{count} {t('working sets')}{delta != null && ` (${delta >= 0 ? '+' : ''}${delta})`} · {t('Edit a session to change its prescriptions.')}</p>
        </details>
      })}
      {preApp.length > 0 && <details className="card program-pre-app"><summary>{preApp.map((index: any) => t('Week {0}', index)).join(' · ')}<span className="ss">{t('Pre-app')}</span><Icon name="chevronDown" /></summary><p className="sect-f">{t('Trained before openGym; no workout logs are created.')}</p></details>}
    </div>
    {cycle && tmKeys.length > 0 && <section className="card training-maxes">
      {tmKeys.map(key => {
        const point = prescriptions?.result.tm[key]?.filter(p => p.at === 'seed' || p.at <= todayISO()).at(-1)
        const frozen = Object.hasOwn(cycle.tmSeed ?? {}, key) ? cycle.tmSeed[key] : undefined
        const manual = cycle.maxAdjustments?.filter((event: any)=>event.lift===key && event.effectiveOn<=todayISO()).at(-1)
        const source = point?.why.inputs.source === 'manual-max' || !point && manual ? t('Manual') : point && point.at !== 'seed' ? t('Engine') : typeof frozen === 'number' || point ? t('Seed') : cycle.maxAdjustments?.some((event: any)=>event.lift===key) ? t('Prior max') : t('Program cache')
        let effective: number | null = null
        try { effective = effectiveProgrammeMax({...S,routines:S.routines}, cycle, key, todayISO(), S.unit, exerciseIndex) } catch { /* Invalid rules remain unavailable. */ }
        return <div className="row between" key={key}><span>{maxBasisLabel(d)}: {nativeMaxLabel(d,key)}</span>
          <output aria-label={t('Effective training max: {0}', key)}>{effective == null ? t('Unavailable') : `${Math.round(effective * 100) / 100} ${S.unit}`} · {source}</output></div>
      })}
      <p>{maxBasisLabel(d)}</p>{['active','paused'].includes(cycle.status) && <Button onClick={()=>adjustProgrammeMaxSheet(cycle.id,detailTarget)}>Adjust max</Button>}
      {!!cycle.maxAdjustments?.length && <details><summary>Max adjustment history</summary>{cycle.maxAdjustments.map((event: any)=><p key={event.id}>{event.effectiveOn} · {event.lift}: {event.previous ?? 'Unavailable'} → {event.value} {event.unit}{event.basis ? ` (${event.basis})` : ''}{event.reason ? ` · ${event.reason}` : ''}</p>)}</details>}
    </section>}
    <section className="card program-after">
      {cycle?.startsOn && <p className="ss">{t('Started {0}', fmtDate(cycle.startsOn, true))}</p>}
      <div className="row between"><div>{t('Repeat program')}<p className="ss">{t('Saves your end-of-block preference.')}</p></div><Switch aria-label={t('Repeat program')} disabled={!!S.active || !!cycle && !['active', 'paused'].includes(cycle.status)} checked={cycle ? cycle.end === 'repeat' : repeat} onChange={setRepeating} /></div>
      <p className="sect-f">{t('Repeat starts a new full program lap with progression carried. After the block, repeat or choose your next program.')}</p>
      {cycle && ['active','paused'].includes(cycle.status) && <ProgramControls cycle={cycle} libraryItems={libraryItems} />}
    </section>
    <div className="program-detail-actions">
      {cycle && <Button onClick={() => { setProgrammePreference('gym_plan_view', 'routines'); nav('/plan') }}>{t('View in Routines')}</Button>}
      <Button disabled={!!S.active} onClick={() => update((s: any) => { requireProgrammeIdle(s); s.programmes.definitions.push({ ...structuredClone(d), id: uid(), name: d.name + ' (' + t('Copy') + ')', source: { kind: 'own', ...(d.source?.private ? {private:true} : {}) } }) })}>{t('Duplicate program')}</Button>
      {!cycle && <Button variant="primary" disabled={!!S.active} onClick={() => { setSwitchCycle(running(S) || null); setLoading(true) }}>{running(S) ? t('Switch to this program') : t('Start this program')}</Button>}
      {!cycle && S.active && <p className="sect-f">{t('Finish the current workout before changing the program.')}</p>}
    </div>
    {loading && <LoadPreview definition={d} repeat={repeat} switchCycle={switchCycle} serverVersion={serverVersion} onClose={() => setLoading(false)} />}
  </div>
}

function LoadPreview({ definition: d, repeat, switchCycle, onClose, serverVersion }: {definition: any; repeat: boolean; switchCycle?: any; onClose: () => void; serverVersion?: string}) {
  const S = useStore((s) => s.S)
  const [weekIndex, setWeekIndex] = useState(d.weeks[0].index)
  const [adopting, setAdopting] = useState(false)
  const [mapping, setMapping] = useState<Record<string,string>>({})
  const [error, setError] = useState('')
  const [applying,setApplying] = useState(false)
  const pending = useRef(false), owner = useRef(programmeOwner()), valid = useRef(programmeTarget(owner.current, draft => !draft?.active && (!switchCycle || draft?.programmes.cycles.some((c:any)=>c.id===switchCycle.id && ['active','paused'].includes(c.status)))))
  const [tm,setTM] = useState<Record<string,number>>({})
  const tmUnit = S.unit === 'kg' ? 'kg' as const : 'lb' as const
  const [startDate, setStartDate] = useState(todayISO())
  const tmKeys = programmeMaxKeys(d)
  const week = d.weeks.find((w: any) => w.index === weekIndex)
  const canAdopt = !switchCycle && week.days.every((day: any) => day.sessions?.length === 1)
  const count = d.weeks.filter((w: any) => w.index >= weekIndex).flatMap((w: any) => w.days.flatMap((day: any) => day.sessions || [])).length
  const validMap = week.days.every((day: any) => mapping[day.key]) && new Set(Object.values(mapping)).size === week.days.length
  let preview: any, previewError: string | undefined
  try {
    const draft = structuredClone(S)
    if (!adopting || !validMap) draft.queue = null
    const opts = { startsOn: startDate, weekIndex, tm, ...(adopting && validMap ? { existingRoutineIds:mapping } : {}) }
    const c = switchCycle ? switchProgramme(draft, switchCycle.id, d, opts,createExerciseIndex(draft.customEx)) : startProgramme(draft, d, opts,createExerciseIndex(draft.customEx))
    preview = projectCycle(c, draft.workouts, todayISO(), draft.queue)
  } catch (err: any) { previewError = t(err.message) }
  const apply = async () => {
    if (owner.current !== programmeOwner()) {useUI.getState().toast(t('Account changed. Open the program again.'));setError('Account changed. Open the program again.');return}
    if (pending.current) return
    pending.current=true;setApplying(true)
    try {
      const opts = { startsOn: startDate, weekIndex, tm, tmUnit, end: repeat ? 'repeat' : 'next', preApp: { weeks: programmePreAppWeeks(d, weekIndex) }, ...(adopting ? { existingRoutineIds: mapping } : {}) }
      if (serverVersion) await useStore.getState().activateLibraryProgramme(d.id, opts, serverVersion, switchCycle?.id, valid.current)
      else if (switchCycle) useStore.getState().switchProgramme(switchCycle.id,d,opts,valid.current)
      else useStore.getState().startProgramme(d,opts,valid.current)
      if(owner.current===programmeOwner()){onClose(); useUI.getState().toast(t('Program loaded into Routines'))}
    } catch (err: any) { setError(t(err.message)) }
    finally { pending.current=false;setApplying(false) }
  }
  return <section className="card" aria-label={t('Load preview')}>
    <h3>{t('Load preview')}</h3>
    <label>{t('Program start date')}<input type="date" aria-label={t('Program start date')} value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
    {switchCycle && <p>{t('Switch from {0} to {1}? The current cycle will be archived and its queue released. Logged workouts are kept, and its routines become plain routines. The new program starts on {2} and takes over the queue.', switchCycle.snapshot?.name || t('Program'), d.name, startDate)}</p>}
    <SelectRow title={t('Starting week')} value={weekIndex} onChange={(v: any) => { setWeekIndex(Number(v)); setMapping({}) }} options={d.weeks.map((w: any) => ({ value: w.index, label: t('Start at week {0}', w.index) }))} />
    <p>{adopting ? t('Adopt {0} routines and create {1} new routines.', week.days.length, count - week.days.length) : t('Load {0} routines. Your program owns the training queue.', count)}</p>
    <div className="program-preview-breakdown">{d.weeks.filter((w: any) => w.index >= weekIndex).map((w: any) => <p key={w.index}>{t('Week {0}', w.index)} · {adopting && w.index === weekIndex ? t('Adopt {0} · ids kept', w.days.length) : t('Create {0} routines', w.days.flatMap((day: any) => day.sessions || []).length)}</p>)}</div>
    <p className="ss">{adopting ? t('Training queue order and logged progress are kept.') : t('The new program takes over the training queue.')} {t('Existing workouts are untouched.')}</p>
    <p className="ss">{t('{0} sessions per week · any days', week.days.length)} · {preview?.endDate && t('Projected end: {0}', fmtDate(preview.endDate, true))}</p>
    <p className="ss">{t('Next session: {0}', preview?.next?.routineName || '')} · {repeat ? t('Then: repeat program') : t('Then: pick next')}</p>
    {canAdopt && <div className="row between"><span>{t('Adopt existing routines for this week')}</span><Switch aria-label={t('Adopt existing routines for this week')} checked={adopting} onChange={(value) => { setAdopting(value); if (value) { const picks: Record<string,string> = {}; for (const day of week.days) { const name = dayName(d, day).toLowerCase(); const matches = S.routines.filter((r: any) => !r.programme && (r.name?.toLowerCase() === name || r.id === day.key)); if (matches.length === 1) picks[day.key] = matches[0].id }; if (new Set(Object.values(picks)).size === Object.values(picks).length) setMapping(picks) } }} /></div>}
    {adopting && week.days.map((day: any) => <label key={day.key}><SelectRow title={dayName(d, day)} value={mapping[day.key] || ''} onChange={(id: any) => setMapping({ ...mapping, [day.key]: id })} options={[{ value: '', label: t('Choose routine') }, ...S.routines.filter((r: any) => !r.programme).map((r: any) => ({ value: r.id, label: r.name }))]} /></label>)}
    {adopting && <p className="sect-f">{t('Selected routines keep their prescriptions, ids and logged progress. Later weeks are added.')}</p>}
    {tmKeys.map((key: any) => { const value = tm[key]; return <label key={key}>{`${maxBasisLabel(d)}: ${nativeMaxLabel(d,key)} (${S.unit})`}<input type="number" min="0" step="any" value={tm[key] || ''} onChange={(e) =>setTM({...tm,[key]:Number(e.target.value)})}/>
      {typeof value === 'number' && Number.isFinite(value) && value > 0 && <output aria-label={t('Program training max: {0}', key)}>{Math.round(convertWeightPrecise(value, tmUnit, d.unit) * 100) / 100} {d.unit}</output>}
    </label>})}
    {(error || previewError) && <p role="alert">{error || previewError}</p>}
    <Button variant="primary" disabled={applying || !!S.active || !preview || adopting && !validMap} onClick={apply}>{switchCycle ? t('Confirm switch') : t('Confirm load')}</Button><Button disabled={applying} onClick={onClose}>{t('Cancel')}</Button>
  </section>
}

export function ProgrammeRoutines({ S, nav }: any) {
  const owner = programmeOwner()
  const active = running(S)
  return programmesOf(S).cycles.map((c: any) => <div key={c.id}>
    <h4 className="sec">{c.snapshot?.name} · {c.status === 'archived' ? t('Archived') : c.status === 'finished' ? t('Done') : t('Program sessions')}</h4>
    {projectCycle(c, S.workouts, todayISO(), S.queue).weeks.filter((w: any) => c.id !== active?.id || !w.closed).map((w: any) => <details className="program-routine-week" key={w.weekId} open={c.id === active?.id && w.weekIndex === c.weekIndex}>
      <summary>{t('Week {0}', w.weekIndex)} · {w.mode === 'deload' ? t('Deload') : t('{0} done · {1} skipped', w.done, w.skipped)}</summary>
      <div className="list">{w.occurrences.filter((o: any) => S.routines.some((r: any) => r.id === o.routineId)).map((o: any) => <div className="item program-routine" key={o.instanceId}><button className="grow program-preview-link" onClick={() => sessionPreviewSheet(live => {if(owner !== programmeOwner())return null;const cycle = live.programmes.cycles.find((x: any) => x.id === c.id);return programmePreviewContent(live, cycle?.snapshot, cycle, {weekId:w.weekId,index:w.weekIndex}, o.dayKey, o.sessionTemplateId)})}><span className="tt">{o.routineName}</span><span className="ss">{o.status === 'pending' ? t('Pending') : o.status === 'done' ? t('Done') : t('Skipped')}</span></button><Button size="sm" variant="ghost" onClick={() => nav('/plan/r/' + o.routineId)}>Edit</Button></div>)}</div>
    </details>)}
  </div>)
}
