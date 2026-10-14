// Compile-only consumers: an ordinary frozen state/workout must be accepted without casts.
import type { StateDoc, Workout } from '../../contract/domain/state-doc'
import { buildPlanBundle, planPrintHTML, mergePlan, parsePlan } from '../src/plan-share'
import { workoutFit, workoutFitMessages, fitFileName } from '../src/fit-export'
import { workoutText } from '../src/workout-text'
import { workoutCardModel } from '../src/workout-card'
import { createExerciseIndex } from '../src/exercises'
export function exportConsumers(state: StateDoc, workout: Workout) {
  const index = createExerciseIndex(state.customEx)
  const bundle = buildPlanBundle(state, 'Synthetic', index)
  planPrintHTML(state, 'Synthetic', {}, index)
  mergePlan(state, parsePlan(bundle, state.unit, index), {}, index)
  workoutFit(workout, {}, index)
  workoutFitMessages(workout, {}, index)
  fitFileName(workout)
  const options = { unit: state.unit, nameOf: (e: { id: string }) => index[e.id]?.n || e.id }
  workoutText(workout, options, index)
  workoutCardModel(workout, options, index)
}
