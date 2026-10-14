import type { ExerciseIndex } from '../../contract/core-api/exercises'
import { EXIDX } from '@opengym/core/exercises'
import type { ProgrammeState, ProgrammeWeek, ProgrammeCycle, ProgrammeProjection } from './programme-engine-types'
import { shiftNotToday, activate, materializeWeek, advanceProgramme } from './programme'
import { projectCycle, addProgrammeDays, occurrenceOrder } from '@opengym/core/programme-calendar'

export function shiftPreview(S: ProgrammeState, cycleId: string, today: string) {
  const draft = structuredClone(S)
  const cycle = S.programmes!.cycles.find(c => c.id === cycleId)
  const before: ProgrammeProjection = projectCycle(cycle, S.workouts, today, S.queue)
  shiftNotToday(draft, cycleId, today)
  const after: ProgrammeProjection = projectCycle(draft.programmes!.cycles.find(c => c.id === cycleId), draft.workouts, today, draft.queue)
  return { before, after, moved: after.pending.filter(o => before.pending.find(b => b.instanceId === o.instanceId)?.date !== o.date).length }
}
export function programmeIdle(S: ProgrammeState, cycle: ProgrammeCycle, today: string) {
  const last = projectCycle(cycle, S.workouts, today, S.queue).lastDoneDate || cycle.startsOn || cycle.week1StartDate
  return !!last && today >= addProgrammeDays(last, 7)!
}
/** A restart retains history and series but creates fresh occurrences from the current week. */
const stageOrder = (w: ProgrammeWeek) => Number(w.orderIndex ?? w.index) || 0
export function repeatProgrammeWeek(S: ProgrammeState, cycleId: string, today: string, {weekId}: {weekId?: string} = {}, index: ExerciseIndex = EXIDX) {
  const cycle = S.programmes!.cycles.find(c => c.id === cycleId)
  if (!cycle || !['active','paused'].includes(cycle.status)) return false
  // Validate the new activation on a draft before archiving the existing run.
  const draft = structuredClone(S), old = draft.programmes!.cycles.find(c => c.id === cycleId)!
  old.status = 'archived'
  const authored = old.snapshot.weeks.filter(w => !w.weekId)
  const stage = old.snapshot.weeks.find(w => (w.weekId || String(w.index)) === (weekId || old.weekId || String(old.weekIndex)))
  if (!stage || !authored.length) throw new Error('The starting week is missing')
  const order = stageOrder(stage)
  const starting = authored.find(w => stageOrder(w) >= order) || authored.at(-1)
  const definition = { ...structuredClone(old.snapshot), weeks: structuredClone(authored) }
  const savedDefinitions = structuredClone(draft.programmes!.definitions)
  const next = activate(draft, definition, { today, weekIndex: starting!.index, seriesId: old.seriesId || old.id, end: old.end, tm:structuredClone(old.tm || {}), perWeek: old.cadence.perWeek }, index)
  // Activation freezes this run, but a recovery action must never rewrite the saved template.
  draft.programmes!.definitions = savedDefinitions
  const inserted = old.snapshot.weeks.filter(w => w.weekId && stageOrder(w) >= order)
  for (const week of inserted) {
    const built = materializeWeek(definition, week, next, {unit: draft.unit}, index)
    draft.routines.push(...built.routines)
    next.occurrences.push(...built.occurrences)
    next.snapshot.weeks.push(structuredClone(week))
  }
  next.occurrences = next.occurrences.filter(o => occurrenceOrder(o) >= order)
  const ids = new Set(next.occurrences.map(o => o.routineId))
  draft.routines = draft.routines.filter(r => r.programme?.cycleId !== next.id || ids.has(r.id))
  next.inserted = structuredClone(old.inserted || []).filter(w => inserted.some(i => i.weekId === w.weekId))
  next.weekIndex = stage.index
  if (stage.weekId) next.weekId = stage.weekId
  advanceProgramme(draft, today)
  old.restartedAs = next.id
  Object.assign(S, draft)
  return next
}

/** Resume can repeat the last trained stage, or the current stage if none was logged. */
export function repeatStageOf(S: ProgrammeState, cycle: ProgrammeCycle, today: string) {
  const current = cycle.snapshot?.weeks?.find(w => (w.weekId || String(w.index)) === (cycle.weekId || String(cycle.weekIndex)))
  if (!current) return null
  const trained = new Set(projectCycle(cycle,S.workouts,today,S.queue).weeks.filter(w => w.done > 0 && occurrenceOrder(w.occurrences[0]) <= stageOrder(current)).map(w => w.weekId))
  return cycle.snapshot.weeks.filter(w => trained.has(w.weekId || String(w.index))).sort((a,b)=>stageOrder(a)-stageOrder(b)).at(-1) || current
}
