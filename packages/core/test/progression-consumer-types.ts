import type { StateDoc, Routine, RoutineExercise, WorkoutEntry, WorkoutSet } from '../../contract/domain/state-doc'
import { nextPrescription, readSession, sessionsFor, plannedOf, planChanged, applyPrescription } from '../src/progression'
import { programmeTMConfig, missingProgrammeTMs } from '../src/programme-tm'
import { dropGrid, loadKindFor } from '../src/plates'
import type { ExerciseIndex } from '@opengym/core/exercises'
// Compile-only fixture: real contract consumers require no broad casts.
export function checkK08Consumers(state: StateDoc, cfg: RoutineExercise, routine: Routine, entry: WorkoutEntry, sets: WorkoutSet[], index: ExerciseIndex) {
  const result = nextPrescription(state, cfg, routine, index)
  readSession(entry, cfg, index)
  sessionsFor(state, cfg.id, cfg, routine.id, index)
  planChanged(entry.planned, cfg, index)
  plannedOf(cfg, index)
  const applied = applyPrescription(sets, result, [10, 15, 20])
  const numeric: WorkoutSet[] = applyPrescription(sets, { kind: "up", reps: 5 }, [10, 15, 20])
  const resolved: RoutineExercise = programmeTMConfig(state, cfg, routine, index)
  missingProgrammeTMs(state, routine)
  dropGrid(state, cfg, index)
  loadKindFor(state, cfg, index)
  return { applied, resolved, numeric }
}

type Assert<T extends true> = T
type GoalAllowsMax = Assert<'max' extends ReturnType<typeof readSession>['goal'] ? true : false>

import * as declaredProgression from '@opengym/core/progression'
import * as declaredPlates from '@opengym/core/plates'
import * as declaredTM from '@opengym/core/programme-tm'
export function checkK08PackageIndices(state: StateDoc, cfg: RoutineExercise, routine: Routine, entry: WorkoutEntry, index: ExerciseIndex) {
  declaredProgression.weightIncrement(cfg, state.unit, index)
  declaredProgression.policyFor(cfg, routine, cfg.mode, index)
  declaredProgression.plannedOf(cfg, index)
  declaredProgression.planChanged(entry.planned, cfg, index)
  declaredProgression.readSession(entry, cfg, index)
  declaredProgression.sessionsFor(state, cfg.id, cfg, routine.id, index)
  declaredProgression.nextPrescription(state, cfg, routine, index)
  declaredPlates.loadKindFor(state, cfg, index)
  declaredPlates.baseWeightFor(state, cfg.id, index)
  declaredPlates.dropGrid(state, cfg, index)
  declaredTM.programmeTMConfig(state, cfg, routine, index)
}
