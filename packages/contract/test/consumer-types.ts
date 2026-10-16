import type { StateDoc, ClientStateDoc, PutDataRequest, Workout, ProgrammeCycle } from '../domain/state-doc'
import type { ProgrammeTarget, ProgrammeProgression } from '../src/model'
import type { ProgressionRule } from '../domain/progression'
import { backoffAt } from '@opengym/core/backoff'
import { normalizeRepRange } from '@opengym/core/rep-range'
import { setLabel, exLine, bestWeightFor, cascadeWeight, modeOf, isBw, rerampWarmups, entryExcluded, lastEntryFor } from '@opengym/core/history'
import { ownedWeightsFor } from '@opengym/core/dumbbells'
import { best1RM, bestSetOf } from '@opengym/core/onerm'
import { bestSetFor } from '@opengym/core/exercise-history'
import { readSession, nextPrescription, selectDeloadCandidate, weightIncrement, policyFor, plannedOf, planChanged, sessionsFor, applyPrescription } from '@opengym/core/progression'
import { workoutText } from '@opengym/core/workout-text'
import { parseWorkoutCSV } from '@opengym/core/import-csv'
import { plateSplit, DEFAULT_BAR_KG, DEFAULT_BAR_LB, defaultBarWeight } from '@opengym/core/bar'
import { EXIDX, createExerciseIndex, registerCustom, exOr, canonicalExId, isCustomEx, isCardio, isBodyweightEq, isLoadedEq, defaultIncrement, isAssisted, betterWeight, beatsWeight, type ExerciseIndex } from '@opengym/core/exercises'
import { substituteFor, buildStarterPlan } from '@opengym/core/starter'
import { loadKindFor, baseWeightFor, dropGrid } from '@opengym/core/plates'
import { programmeTMConfig } from '@opengym/core/programme-tm'
import { activate, adopt } from '@opengym/core/programme'
import { repeatProgrammeWeek } from '@opengym/core/programme-today'
import { finishProgrammeBlock } from '@opengym/core/programme-rollover'
import { refreshProgrammeDefinitions } from '@opengym/core/programme-refresh'
import { historyAsOf } from '@opengym/core/backfill'
import { rebuildPrHistory } from '@opengym/core/workout-date'
import { buildCompletedWorkout } from '@opengym/core/finish-workout'
import { projectCycle } from '@opengym/core/programme-calendar'
import { programmeNote } from '@opengym/core/programme-targets'
import type { Queue } from '../domain/state-doc'
import { offloadInputs, resetOffload, offloadStamp, type SyncProgrammes } from '@opengym/core/programme-offload'
import { restSecFor } from '@opengym/core/supersetFlow'
// Producers keep named domain properties and permit opaque extension values.
export const state: Partial<StateDoc> = {workouts:[],routines:[]}
export const request: PutDataRequest = {state,baseRev:4}
export const target: ProgrammeTarget = {rir:2}
export const progression: ProgrammeProgression = {kind:'manual',instructions:'Choose the load'}
export const backoff: number = backoffAt(100,1,5)
export const range: number = normalizeRepRange('8','6').reps
// Known frozen issue: Omit over StateDoc's string index signature loses named fields.
// Pin it for the integration owner instead of changing the contract in this unit.
type IsUnknown<T> = unknown extends T ? keyof T extends never ? true : false : false
export const clientNamedPropertyLoss: IsUnknown<ClientStateDoc['workouts']> = true
export type RuleConsumer = ProgressionRule

// Compile-only regression: these are real legacy arities and producer shapes.
export function legacyConsumers() {
  restSecFor([{target:{restSec:90}}],[0],60,{idx:0,sec:300})
  const doc = { workouts: [], unit: 'kg' }, entry = { id: 'synthetic', sets: [] }
  setLabel(entry.id, { w: 60, r: 8 })
  exLine(entry, 'kg')
  bestWeightFor(doc, entry.id)
  best1RM(doc, entry.id)
  bestSetFor(doc, entry.id)
  readSession(entry)
  nextPrescription(doc, entry)
  cascadeWeight([], 0, 60)
  workoutText({ d: '2026-01-01', entries: [] }, { unit: 'kg', nameOf: () => 'Synthetic' })
  parseWorkoutCSV('')
  parseWorkoutCSV('', { customEx: [{ id: 'synthetic', name: 'Synthetic' }] })
  selectDeloadCandidate({ currentWeight: 20, targetWeight: 20, targetReps: 8, step: 2, reps: 8, repsMin: 6, owned: [10, 12, 14] })
  selectDeloadCandidate({ currentWeight: 20, targetWeight: 20, targetReps: 8, step: 2, owned: [10, 12, 14] })
  const nullable: number | null = plateSplit(null, undefined)
  const index = EXIDX[entry.id]
  const kg: number | undefined = DEFAULT_BAR_KG[entry.id]
  const lb: number | undefined = DEFAULT_BAR_LB[entry.id]
  const defaultBar: number | null = defaultBarWeight('none', 'kg')
  return { nullable, index, kg, lb, defaultBar }
}
export function explicitIndexConsumers() {
  const custom = [{ id: 'synthetic', n: 'Synthetic', target: null }]
  const index: ExerciseIndex = createExerciseIndex(custom)
  const fresh: ExerciseIndex = registerCustom(custom)
  const ex = exOr('synthetic', index)
  canonicalExId(ex.id, index); isCustomEx(ex, index); isCardio(ex, index)
  isBodyweightEq(ex, index); isLoadedEq(ex, index); defaultIncrement('synthetic', 'kg', index)
  isAssisted(ex, index); betterWeight(ex, 10, 20, index); beatsWeight(ex, 20, 10, index)
  modeOf(ex, index); isBw(ex, index); ownedWeightsFor({ unit: 'kg' }, ex, index)
  const doc = { unit: 'kg' }
  buildCompletedWorkout({}, { prs: ['synthetic'] }, index)
  applyPrescription([], {}, [10, 12, 14]); rerampWarmups([], [10, 12, 14])
  projectCycle({}, [], undefined, {} as Queue)
  programmeNote(doc, ex, { definition: {}, programme: {} })
  weightIncrement(ex, 'kg', index); policyFor(ex, {}, 'reps', index)
  const planned = plannedOf(ex, index); planChanged(planned, ex, index)
  readSession(ex, undefined, index); sessionsFor(doc, 'synthetic', undefined, undefined, index)
  nextPrescription(doc, ex, undefined, index)
  loadKindFor(doc, ex, index); baseWeightFor(doc, ex, index); dropGrid(doc, ex, index)
  programmeTMConfig(doc, ex, {}, index)
  substituteFor(ex, [], new Set<string>(), index); buildStarterPlan('ppl', [], index)
  const programmes: SyncProgrammes & { extension: string } = { definitions: [], end: '2026-01-01', extension: 'kept' }
  const reset: typeof programmes = resetOffload(programmes, 1)
  const inputs = offloadInputs(programmes, null)
  const stamp: number = offloadStamp(programmes)
  return { fresh, reset, inputs, stamp }
}

// K15 legacy twins: replacement IDs, moved records and boolean exclusion producers.
export function historyEditingConsumers(index: ExerciseIndex) {
  const workout: Workout = { d: '2026-01-01', start: 1, entries: [], excludeFromProgression: false }
  historyAsOf({}, { d: workout.d })
  rebuildPrHistory([], [])
  lastEntryFor({}, 'synthetic')
  historyAsOf({}, { d: workout.d, replaceId: 'synthetic' })
  historyAsOf({}, { d: workout.d, replaceId: null })
  rebuildPrHistory([], [], workout, index); rebuildPrHistory([], [], null, index)
  entryExcluded(workout, {}); entryExcluded(workout, {}, index)
  const completed: Workout = buildCompletedWorkout({}, { prs: ['synthetic'] }, index)
  return { workout, completed }
}

export function populatedReturnConsumers(index: ExerciseIndex) {
  const set = bestSetOf({}, undefined, index)
  if (set) { const est: number = set.est, w: number = set.w, r: number = set.r; void [est, w, r] }
  const best = best1RM({}, 'synthetic', undefined, undefined, index)
  if (best) { const d: string = best.d, t: number = best.t; void [best.est, best.w, best.r, d, t] }
  const cycles: { occurrences: ProgrammeCycle['occurrences'] }[] = [activate({}, {}, {}, index), adopt({}, {}, [], {}, index)]
  const repeated = repeatProgrammeWeek({}, 'synthetic', '2026-01-01', {}, index)
  if (repeated) { cycles.push(repeated); const stageIds: string[] = repeated.inserted.map(w => w.weekId); void stageIds }
  const finished = finishProgrammeBlock({}, 'synthetic', 'repeat', {}, index)
  if (finished) cycles.push(finished)
  const ids: string[] = cycles.flatMap(c => c.occurrences.map(o => o.instanceId))
  const report = refreshProgrammeDefinitions({}, [], {}, index).report
  report.added.push('synthetic'); report.updated.push('synthetic'); report.protected.push('synthetic'); report.skipped.push('synthetic.json')
  report.needsReview.push({ id: 'synthetic', reason: 'Synthetic' })
  report.conformance.push({ id: 'synthetic', protected: false, before: null, after: 'Valid', issues: [] })
  report.repairs.push({ id: 'synthetic', changes: ['/name'] })
  return { ids, report }
}
