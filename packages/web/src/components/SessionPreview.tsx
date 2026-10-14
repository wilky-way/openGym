import { useSyncExternalStore } from 'react'
import { createExerciseIndex, exOr } from '@opengym/core/exercises'
import { buildSets, effortOf, modeOf, isBw, supersetUnits } from '@opengym/core/history'
import { programmeTMConfig } from '@opengym/core/programme-tm'
import { weightIncrement, defaultIncrement } from '@opengym/core/progression'
import { ownedWeightsFor } from '@opengym/core/dumbbells'
import { convertStateUnit } from '@opengym/core/units'
import { isWarmupRow } from '@opengym/core/workout-model'
import { supersetMeta } from '@opengym/core/superset-meta'
import { setTargetAt, targetLabel } from '@opengym/core/programme-targets'
import { todayISO } from '@opengym/core/format'
import { exerciseNameFor, t } from '../lib/i18n'
import { programmeOwner } from '../lib/programme-ui-services'
import { progressionDisplay, type PrescriptionDisplay } from '../lib/progression-display'
import { useStore, type StoreDocument } from '../store/useStore'
import { useUI } from '../store/useUI'
import { Button } from './ui'
import { SlotPrescription } from './ProgressionPrescription'
import './SessionPreview.css'

export interface PreviewContent {
  title: string
  identity: unknown
  routines: any[]
  definition?: any
  cycle?: any
  week?: number
  day?: string
  session?: string
  sessionKeys?: string[]
}
type ResolvePreview = (S: StoreDocument) => PreviewContent | null
export const previewFingerprint = (content: PreviewContent | null, S: StoreDocument) => JSON.stringify([content,
  S.active && [S.active.id, S.active.start, S.active.d, S.active.routineId, S.active.routineIds, S.active.editingWorkoutId, S.active.programme?.instanceId], S.workouts, S.restSec, S.barWeights, S.dumbbells, S.dbLoad,
  content?.routines.map(r => r.programme ? S.programmes.cycles.find((c: any) => c.id === r.programme.cycleId) : null), S.customEx, S.effort, S.effortScale])

/** Captures the exact owner and target; a live resolver may invalidate but never retarget it. */
export function sessionPreviewSheet(resolve: ResolvePreview, openSession?: () => void) {
  const S = useStore.getState().S, content = resolve(S)
  if (!content) return
  const routineDisplays = content.routines.map(r => {
    if (content.definition || !r.programme) return null
    const cycle = S.programmes.cycles.find((c: any) => c.id === r.programme.cycleId)
    const occurrence = cycle?.occurrences.find((o: any) => o.instanceId === r.programme.instanceId)
    return cycle && occurrence ? {display: progressionDisplay(S, cycle.snapshot, cycle, [occurrence.weekIndex], todayISO()),
      week: occurrence.weekIndex, day: occurrence.dayKey, session: occurrence.sessionTemplateId} : null
  })
  const owner = programmeOwner(), opened = previewFingerprint(content, S)
  const captured = structuredClone(content)
  const display = content.definition ? progressionDisplay(S, content.definition, content.cycle,
    [content.week!], todayISO()) : null
  const matches = (live: StoreDocument) => owner === programmeOwner() && opened === previewFingerprint(resolve(live), live)
  let closed = false, stale = false, unsubscribe: (() => void) | undefined
  const listeners = new Set<() => void>()
  const stop = () => { unsubscribe?.(); unsubscribe = undefined }
  const watch = () => {
    unsubscribe ??= useStore.subscribe(next => { if (!matches(next.S)) {stale = true; listeners.forEach(listener => listener())} })
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener); watch()
    return () => {listeners.delete(listener); if (!listeners.size) stop()}
  }
  const snapshot = () => !closed && !stale && matches(useStore.getState().S)
  watch()
  const sheet = useUI.getState().openSheet(close => <SessionPreview content={captured} display={display} routineDisplays={routineDisplays} subscribe={subscribe} snapshot={snapshot}
    close={() => {closed = true; stop(); close()}} openSession={openSession ? () => {
      if (!snapshot()) return
      closed = true; stop(); close(); openSession()
    } : undefined} />)
  const removeWatch = useUI.subscribe(next => {
    if (!next.sheets.some(s => s.id === sheet.id)) {closed = true; stop(); removeWatch()}
  })
}

/** Session/day identity comes from authored keys, never an exercise or positional fallback. */
export function programmePreviewContent(S: StoreDocument, definition: any, cycle: any, week: any, day: string, session?: string): PreviewContent | null {
  const w = definition?.weeks?.find((x: any) => (x.weekId || String(x.index)) === (week.weekId || String(week.index)))
  const d = w?.days?.find((x: any) => x.key === day)
  const sessions = d?.sessions?.filter((s: any) => session == null || s.sessionTemplateId === session)
  if (!sessions?.length || (session != null && sessions.length !== 1)) return null
  const routines = []
  for (const s of sessions) {
    const occurrences = cycle?.occurrences?.filter((o: any) => (o.weekId || String(o.weekIndex)) === (w.weekId || String(w.index)) && o.dayKey === day && o.sessionTemplateId === s.sessionTemplateId)
    if (cycle && occurrences?.length !== 1) return null
    const routine = occurrences?.length === 1 ? S.routines.find((r: any) => r.id === occurrences[0].routineId) : null
    if (cycle && !routine) return null
    routines.push(routine || (convertStateUnit({unit: w.unit || definition.unit || S.unit, routines: [s.routineSnapshot]}, S.unit, createExerciseIndex(S.customEx)).routines as any[])[0])
  }
  return {title: session == null ? definition.days?.find((d: any) => d.key === day)?.name || day.toUpperCase() : routines[0]?.name || t('Session'),
    identity: [definition.id, cycle?.id, w.weekId || w.index, day, sessions.map((s: any) => s.sessionTemplateId)],
    definition, cycle, week: w.index, day, session, sessionKeys: sessions.map((s: any) => s.sessionTemplateId), routines}
}

function reps(value: unknown, min?: number) {
  if (value === 'max' || value === 'amrap') return min != null ? t('AMRAP (at least {0})', min) : t('AMRAP')
  return `${min != null && min !== value ? `${min}–` : ''}${value ?? t('Choose reps')}`
}
function ExercisePreview({e: authored, routine, S, display, week, day, session, superset = false}: {e: any; routine: any; S: StoreDocument; display: PrescriptionDisplay | null; week?: number; day?: string; session?: string; superset?: boolean}) {
  const index = createExerciseIndex(S.customEx), scale = effortOf(S), mode = modeOf(authored, index)
  const attached = !!authored.progression?.rules?.length
  const e = !attached && authored.tm ? programmeTMConfig(S, authored, routine, index) : authored
  const missingTM = !attached && e.tm && !(Number(S.programmes.cycles.find((c: any) => c.id === routine.programme?.cycleId)?.tm?.[e.tm.key || e.id]) > 0)
  const matches = display?.slots.filter(({prescription: p}) => p.ref.week === week && p.ref.day === day && p.ref.session === session && p.ref.slot === e.slotId) ?? []
  const prescription = matches.length === 1 ? matches[0]!.prescription : null
  const count = e.pyramid?.length ?? e.sets ?? 1
  const summary = mode === 'time' ? `${e.sec ?? 45}s` : mode === 'cardio' ? `${e.min ?? 20} min` : reps(e.reps, e.repsMin)
  const warmCfg = {...e, weight: prescription?.sets[0]?.load ?? e.pyramidWeight?.[0] ?? e.weight, sets: 1, pyramid: undefined, pyramidWeight: undefined}
  const warmups = attached && prescription?.sets.length === 0 ? [] : buildSets({...S, workouts: [], exWeights: {}}, warmCfg, {useTarget: true, planReps: true, step: (mode === 'reps' && ownedWeightsFor(S, e, index)) || (mode === 'reps' ? weightIncrement(e, S.unit, index) : defaultIncrement(e.id, S.unit, index))}, index).filter(isWarmupRow)
  return <div className="item session-preview-exercise"><div className="grow">
    <div className="tt">{e.open && !e.id ? e.label || t('Choose exercise') : exerciseNameFor(exOr(e.id, index))}</div>
    <p className="ss">{attached ? t('{0} working sets · Progression prescription', prescription?.sets.length ?? '—') : `${count} × ${summary}`}</p>
    {warmups.length > 0 && <ol className="session-preview-sets">{warmups.map((row: any, i: number) => <li key={i}>{t('Warm-up {0}', i + 1)} · {row.r != null ? t('{0} reps', row.r) : `${row.sec ?? 0}s`}{isBw(e, index) ? '' : (!attached && !missingTM) || prescription?.sets[0]?.load != null ? ` · ${row.w ?? 0} ${S.unit}` : ` · ${t('Choose load')}`}</li>)}</ol>}
    {attached ? prescription ? <SlotPrescription slot={prescription} scale={scale} readOnly /> : <p role="status">{t('Prescription unavailable.')}</p> :
      <ol className="session-preview-sets">{Array.from({length: count}, (_, i) => <li key={i}>{t('Set {0}', i + 1)} · {mode === 'reps' ? t('{0} reps', reps(e.lastToFailure && i === count - 1 ? 'amrap' : e.pyramid?.[i] ?? e.reps, e.setRepsMin?.[i] ?? e.repsMin)) : summary}
        {missingTM ? ` · ${t('Choose load (training max unavailable)')}` : e.pyramidWeight?.[i] != null || e.weight != null ? ` · ${e.pyramidWeight?.[i] ?? e.weight} ${S.unit}` : ''}
        {setTargetAt(e, i) && ` · ${targetLabel(setTargetAt(e, i), undefined, scale)}`}
        {!superset && ` · ${t('Rest {0}s', (e.pyramidRest?.[i] > 0 ? e.pyramidRest[i] : e.restSec > 0 ? e.restSec : S.restSec))}`}</li>)}</ol>}
    {attached && !superset && <p className="ss">{t('Rest {0}s', (e.restSec > 0 ? e.restSec : S.restSec))}{e.pyramidRest?.length ? ` · ${t('Per-set rest: {0}s', e.pyramidRest.join(' / '))}` : ''}</p>}
    {e.note && <p className="exnote">{e.note}</p>}{e.instructions && <p>{e.instructions}</p>}
  </div></div>
}
interface RoutineDisplay {display: PrescriptionDisplay | null; week: number; day: string; session?: string}
function SessionPreview({content, display, close, subscribe, snapshot, routineDisplays, openSession}: {content: PreviewContent; display: PrescriptionDisplay | null; routineDisplays: (RoutineDisplay | null)[]; close(): void; subscribe(listener: () => void): () => void; snapshot(): boolean; openSession?: () => void}) {
  const valid = useSyncExternalStore(subscribe, snapshot, snapshot)
  const S = useStore(s => s.S)
  useStore(s => s.user)
  useStore(s => s.documentInstance)
  if (!valid) return <section aria-label={t('Session preview')}><h3>{t('Preview changed')}</h3><p role="status">{t('The account, profile or session changed. Close this preview and open it again.')}</p><Button onClick={close}>{t('Close')}</Button></section>
  return <section className="session-preview" aria-label={t('Session preview')}>
    <h3>{content.title}</h3><p className="sect-f">{t('Read-only preview')}{content.week != null ? ` · ${t('Week {0}', content.week)} · ${content.day?.toUpperCase()}` : ''}</p>
    {display?.result.error && <p role="status">{t('Prescription unavailable: {0}', display.result.error.code)}</p>}
    {display?.result.slotErrors?.filter(e => e.slot.week === content.week && e.slot.day === content.day && (content.session == null || e.slot.session === content.session)).map((e, i) => <p role="status" key={i}>{e.slot.slot}: {e.code}</p>)}
    {display?.result.warnings.filter(w => !w.ref || (w.ref.week === content.week && w.ref.day === content.day && (content.session == null || w.ref.session === content.session))).map((w, i) => <p className="sect-f" key={i}>{w.code}: {w.message}</p>)}
    {content.routines.map((r: any, ri) => {
      const session = content.session ?? content.sessionKeys?.[ri]
      const scope = routineDisplays[ri] ?? {display, week: content.week, day: content.day, session}
      const units = supersetUnits(r.ex || [])
      return <div key={ri}>{content.routines.length > 1 && <h4>{r.name}</h4>}
        {routineDisplays[ri]?.display?.result.error && <p role="status">{t('Prescription unavailable: {0}', routineDisplays[ri]!.display!.result.error!.code)}</p>}
        {!r.ex?.length && <p>{t('No exercises in this session.')}</p>}
        <div className="list">{units.map((unit: number[], ui: number) => {
          const meta = supersetMeta(r.ex, unit)
          return <div key={ui}>{unit.length > 1 && <p className="ss-label">{t('Superset {0} · Back-to-back', meta.name || ui + 1)}{meta.rest > 0 && ` · ${t('{0}s rest after each round', meta.rest)}`}</p>}
            {unit.map(i => <ExercisePreview key={i} e={r.ex[i]} routine={r} superset={unit.length > 1} S={S} display={scope.display} week={scope.week} day={scope.day} session={scope.session}/>)}</div>
        })}</div></div>
    })}{openSession && <Button variant="primary" onClick={openSession}>{t('Open session')}</Button>}<Button onClick={close}>{t('Close')}</Button>
  </section>
}
