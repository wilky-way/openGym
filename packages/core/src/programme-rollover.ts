import type { ProgrammeCycle, ProgrammeOccurrence, ProgrammeSession, Routine, Workout, Queue, Unit } from '../../contract/domain/state-doc'
import { EXIDX, type ExerciseIndex } from './exercises'
import { hasLoadContinuity } from './progression-engine/continuity'
export interface RolloverState { programmes?: { cycles: ProgrammeCycle[]; definitions: ProgrammeCycle['snapshot'][]; [key: string]: unknown }; routines: Routine[]; workouts: Workout[]; active?: { routineIds?: string[] } | null; unit?: Unit; queue?: Queue | null; [key: string]: unknown }
export interface RolloverProposal { routineId: string; instanceId: string; slotId: string | undefined; exerciseId: string | undefined; currentSets: number; sets: number; reason: string }
import { programmeSessionKey, programmeSnapshotSession } from '@opengym/core/programme-edit'
import { activate } from '@opengym/core/programme'
import { resolveOccurrences } from '@opengym/core/programme-sync'
import { occurrenceWeekId } from '@opengym/core/programme-calendar'
import { loggedProgrammeWorkout } from '@opengym/core/programme-ui'
import { modeOf } from '@opengym/core/history'
import { isWarmupRow } from '@opengym/core/workout-model'
import { convertWeightPrecise } from './progression-engine/units'
export interface RepeatMax { values: Record<string, number>; unit: Unit }
export interface FinishBlockOptions { today?: string; repeatMax?: RepeatMax }

const clone = <T,>(x: T): T => structuredClone(x)
const keyOf = (c: Partial<ProgrammeCycle>) => c.rollover && `${c.rollover.fromWeekId}:${c.rollover.toWeekId}:${c.rollover.closedOn}`
export const needsRollover = (c: Partial<ProgrammeCycle>) => !!keyOf(c) && c.rolloverReviewed !== keyOf(c) && c.status === 'active'

/** Conservative set proposals: only authored adds of at most one set are offered. */
export function rolloverProposals(S: RolloverState, cycleId: string, index: ExerciseIndex = EXIDX): RolloverProposal[] {
  const c = S.programmes?.cycles.find(c => c.id === cycleId)
  if (!needsRollover(c || {})) return []
  const resolved = resolveOccurrences(c, S.workouts) as ProgrammeOccurrence[]
  const source = resolved.filter(o => occurrenceWeekId(o) === c!.rollover!.fromWeekId)
  const target = resolved.filter(o => occurrenceWeekId(o) === c!.rollover!.toWeekId && o.status === 'pending')
  const out = []
  for (const o of target) {
    const r = S.routines.find(r => r.id === o.routineId)
    const from = source.find(s => s.dayKey === o.dayKey && programmeSessionKey(c,s) === programmeSessionKey(c,o))
    const prior = from && S.routines.find(r => r.id === from.routineId)
    const log = (from && loggedProgrammeWorkout(S.workouts, from)) as Workout | null | undefined
    if (!r || !prior || r.deload || prior.deload || S.active?.routineIds?.includes(r.id)) continue
    for (const e of r.ex) {
      const old = prior.ex.find(x => x.slotId === e.slotId && x.id === e.id)
      if (!old || old.slotScope === 'session' || e.tm || e.pyramid || modeOf(e, index) !== 'reps') continue
      const candidates = log?.entries?.filter(x => x.id === e.id && (!x.series || x.series === prior.programme!.series) && (!x.occurrenceId || x.occurrenceId === from.instanceId)) || []
      const twins=prior.ex.filter(x=>x.id===e.id).length>1
      const identified=candidates.filter(x=>x.target?.slotId===old.slotId)
      if(twins && identified.length!==1) continue
      const en = identified.length===1 ? identified[0] : candidates.length === 1 && !twins ? candidates[0] : null
      const rows = en?.sets?.filter(s => !isWarmupRow(s)) || []
      const aim = Number(en?.target?.repsMin ?? en?.target?.reps ?? old.repsMin ?? old.reps)
      const held = aim > 0 && rows.length >= Number(en?.target?.sets || old.sets || 1) && rows.every(s => s.done && Number(s.r) >= aim)
      const reason = !en || !rows.some(s => s.done) ? 'no-data' : held ? 'held' : 'dropped'
      const base = Math.max(1, Number(old.sets) || 1), currentSets = Math.max(1, Number(e.sets) || 1)
      const sets = reason === 'held' ? Math.max(base, Math.min(base + 1, currentSets)) : base
      out.push({ routineId:r.id, instanceId:o.instanceId, slotId:e.slotId, exerciseId:e.id, currentSets, sets, reason })
    }
  }
  return out
}

export function acceptRollover(S: RolloverState, cycleId: string, reviewed: RolloverProposal[], selected = reviewed.map((_, i) => i), index: ExerciseIndex = EXIDX) {
  const c = S.programmes?.cycles.find(c => c.id === cycleId)
  if (S.active) throw new Error('Finish the current workout before changing the program.')
  const fresh = rolloverProposals(S, cycleId, index)
  if (!needsRollover(c || {}) || JSON.stringify(fresh) !== JSON.stringify(reviewed)) throw new Error('The program changed. Review the proposals again.')
  if (selected.some(i => !Number.isInteger(i) || !fresh[i])) throw new Error('Invalid progression proposal')
  for (const i of new Set(selected)) {
    const p = fresh[i]!, r = S.routines.find(r => r.id === p.routineId)!, e = r.ex.find(e => e.slotId === p.slotId)!
    e.sets = p.sets
    const o = c!.occurrences.find(o => o.instanceId === p.instanceId)
    const session=programmeSnapshotSession(c,o) as ProgrammeSession | undefined
    const slot = session?.routineSnapshot?.ex.find(e => e.slotId === p.slotId || e.id === p.exerciseId && r.ex.filter(x => x.id === e.id).length === 1)
    if (slot) slot.sets = p.sets
  }
  c!.rolloverReviewed = keyOf(c!) || undefined
  return fresh
}

/** Explicit choice after completion; validate a repeat in a draft before archiving. */
export function finishProgrammeBlock(S: RolloverState, cycleId: string, choice: string, { today, repeatMax }: FinishBlockOptions = {}, index: ExerciseIndex = EXIDX) {
  const c = S.programmes?.cycles.find(c => c.id === cycleId)
  if (S.active) throw new Error('Finish the current workout before changing the program.')
  if (!c || c.status !== 'finished' || (resolveOccurrences(c,S.workouts) as ProgrammeOccurrence[]).some(o => o.status === 'pending') || c.endHandled) throw new Error('Only a completed block can choose what comes next.')
  if (!['next','repeat','stop'].includes(choice)) throw new Error('Invalid end-of-block choice')
  const draft = clone(S), old = draft.programmes!.cycles.find(x => x.id === cycleId)!
  old.end = choice; old.endHandled = true; old.status = 'archived'; old.archivedOn = today
  let next: ReturnType<typeof activate> | undefined
  if (choice === 'repeat') {
    const definition = clone(old.snapshot)
    definition.weeks = definition.weeks.filter(w => !w.weekId)
    // A migrated partial block repeats its explicit authored weeks; it never invents W1–W3.
    const tm = clone(old.tm || {})
    if (repeatMax) {
      if (!['lb','kg'].includes(repeatMax.unit) || Object.keys(repeatMax.values).length !== Object.keys(tm).length || Object.entries(repeatMax.values).some(([key,value])=>!Object.hasOwn(tm,key) || typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) throw new Error('Review a positive finite max for every lift before repeating.')
      for (const [key,value] of Object.entries(repeatMax.values)) {
        const converted = convertWeightPrecise(value,repeatMax.unit,S.unit ?? 'lb')
        const seed = convertWeightPrecise(converted,S.unit ?? 'lb',definition.unit)
        if (!Number.isFinite(converted) || converted <= 0 || !Number.isFinite(seed) || seed <= 0) throw new Error('Review a positive finite max in both profile and program units before repeating.')
        tm[key] = converted
      }
    }
    for (const [key, value] of Object.entries(tm)) {
      if (repeatMax) continue // Reviewed absolute values already include the athlete's chosen bump.
      const amount = Number((definition.repeat as { bump?: Record<string, unknown> } | undefined)?.bump?.[key] ?? 0)
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid training max increment')
      tm[key] = Number(value) + convertWeightPrecise(amount, definition.unit || S.unit || 'lb', S.unit || 'lb')
    }
    const saved = clone(draft.programmes!.definitions)
    next = activate(draft, definition, {today,cycleId:`${old.id}:lap${(old.lap || 1)+1}`, lap:(old.lap || 1)+1, seriesId:old.seriesId || old.id,tm,end:old.end,perWeek:old.cadence.perWeek}, index)
    draft.programmes!.definitions = saved
    if (repeatMax) {
      const cycle = next as ProgrammeCycle
      cycle.tmSeed = Object.fromEntries(Object.entries(tm).map(([key,value])=>[key,convertWeightPrecise(Number(value),S.unit ?? 'lb',definition.unit)]))
      cycle.tmUnit = S.unit ?? 'lb'
      cycle.repeatMaxReview = clone(repeatMax)
    }
    // activate normalizes cycles into fresh objects; stamp the retained parent.
    if (repeatMax || hasLoadContinuity(definition)) draft.programmes!.cycles.find(cycle => cycle.id === old.id)!.repeatedAs = next.id
  }
  if (draft.queue?.programmeCycleId === c.id) draft.queue = null
  Object.assign(S,draft)
  return next || null
}
