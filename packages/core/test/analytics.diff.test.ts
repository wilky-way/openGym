import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error Oracle JS has no declarations; differential imports only.
import * as oldRm from '../../../packages/parity/fixtures/oracle/frontend/src/lib/onerm.js'
// @ts-expect-error Oracle JS has no declarations; differential imports only.
import * as oldMuscles from '../../../packages/parity/fixtures/oracle/frontend/src/lib/muscles.js'
// @ts-expect-error Oracle JS has no declarations; differential imports only.
import * as oldEffort from '../../../packages/parity/fixtures/oracle/frontend/src/lib/effort.js'
// @ts-expect-error Oracle JS has no declarations; differential imports only.
import * as oldPerSet from '../../../packages/parity/fixtures/oracle/frontend/src/lib/per-set.js'
// @ts-expect-error Oracle JS has no declarations; differential imports only.
import * as oldHistory from '../../../packages/parity/fixtures/oracle/frontend/src/lib/exercise-history.js'
// @ts-expect-error Oracle JS has no declarations; differential imports only.
import * as oldExercises from '../../../packages/parity/fixtures/oracle/frontend/src/lib/exercises.js'
import * as rm from '../src/onerm'
import * as muscles from '../src/muscles'
import * as effort from '../src/effort'
import * as perSet from '../src/per-set'
import * as history from '../src/exercise-history'
import { createExerciseIndex } from '../src/exercises'

const runs = {
  seed: 909031,
  numRuns: Number(process.env.PARITY_RUNS ?? 1000),
  includeErrorInReport: true,
  reporter<T>(details: fc.RunDetails<T>) {
    if (!details.failed) return
    // Keep the seed, shrink path and counterexample in both stderr and the gate's JSON report.
    // fast-check's formatter preserves undefined, NaN and Infinity in generated inputs.
    const message = `K09 differential (TZ=${process.env.TZ ?? 'host'}):\n${fc.defaultReportMessage(details)}`
    console.error(message)
    throw new Error(message, { cause: details.errorInstance })
  },
}
const equal = (a: unknown, b: unknown) => {
  expect(a).toEqual(b)
  expect(JSON.stringify(a)).toBe(JSON.stringify(b))
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-27T12:00:00Z')) })
afterEach(() => { vi.useRealTimers(); oldExercises.registerCustom([]) })
const scalar = fc.oneof(fc.integer({ min: -10, max: 500 }), fc.integer({ min: -10, max: 500 }).map(String), fc.constant(null), fc.constant(undefined), fc.constant(NaN), fc.constant(Infinity))
const formula = fc.constantFrom('epley', 'brzycki', 'lombardi', 'oconner', 'mayhew', 'wathan', 'lander', 'weighted', 'unknown')
const row = fc.record({
  w: scalar, r: scalar, sec: fc.nat(120), min: fc.nat(30), speed: fc.nat(20),
  rir: fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }), done: fc.boolean(),
  phase: fc.constantFrom('work', 'warmup'), type: fc.constantFrom('normal', 'failure', 'dropset', 'restpause'),
  drops: fc.array(fc.record({ w: fc.nat(80), r: fc.nat(12) }), { maxLength: 2 }),
  clusters: fc.array(fc.nat(5), { maxLength: 2 }),
})
const side = fc.record({ w: fc.nat(100), r: fc.nat(15), rir: fc.nat(5), done: fc.boolean() })
const set = fc.oneof(row, fc.record({ sides: fc.record({ L: side, R: side }), phase: fc.constantFrom('work', 'warmup') }))
const workout = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }), d: fc.constantFrom('2026-08-01', '2026-08-24', '2026-08-26'),
  start: fc.integer({ min: Date.UTC(2026, 7, 1), max: Date.UTC(2026, 7, 27) }),
  entries: fc.array(fc.record({ id: fc.constantFrom('0025', 'synthetic', '0585'), target: fc.record({ mode: fc.constantFrom('reps', 'time', 'cardio'), dbLoad: fc.constantFrom('as', 'each', 'total') }), sets: fc.array(set, { maxLength: 6 }) }), { maxLength: 3 }),
})
const profile = fc.record({ workouts: fc.array(workout, { maxLength: 8 }), oneRmFormula: formula, weekStart: fc.constantFrom(0, 1) })
const metadata = fc.record({
  id: fc.constant('synthetic'), n: fc.constant('Synthetic lift'), bp: fc.constantFrom('chest', 'back', 'upper legs', 'waist', 'cardio'),
  tg: fc.constantFrom('pectorals', 'lats', 'quads', 'unknown'), sm: fc.array(fc.constantFrom('triceps', 'core', 'quads', 'hands')),
  primaries: fc.array(fc.constantFrom('chest', 'pectorals', 'upper-back', 'abs', 'hands'), { maxLength: 4 }),
  secondaries: fc.array(fc.constantFrom('triceps', 'core', 'chest', 'quads'), { maxLength: 4 }),
  muscleWeights: fc.dictionary(fc.constantFrom('chest', 'abs', 'quadriceps', 'hands'), fc.integer({ min: -2, max: 3 })),
  assisted: fc.boolean(), eq: fc.constantFrom('custom', 'dumbbell', 'leverage machine'),
})

describe('K09 differential parity', () => {
  it('matches all estimator formulas, coercions, caps and confidence', () => {
    fc.assert(fc.property(scalar, scalar, formula, scalar, (w, r, f, rir) => {
      equal(rm.estimate1RM(w, r, f, rir), oldRm.estimate1RM(w, r, f, rir))
      equal(rm.calculate1RMAccuracy(r, rir, f), oldRm.calculate1RMAccuracy(r, rir, f))
      equal(rm.weightedEstimate(Number(w), Number(r)), oldRm.weightedEstimate(Number(w), Number(r)))
    }), runs)
  }, 30_000)
  it('matches muscle metadata, snapshots, loads and bucket order for custom indexes', () => {
    fc.assert(fc.property(metadata, fc.nat(10), (ex, sets) => {
      oldExercises.registerCustom([ex]); const index = createExerciseIndex([ex])
      equal(muscles.muscleGroupsOf(ex), oldMuscles.muscleGroupsOf(ex))
      equal(muscles.hasExplicitMuscleMetadata(ex), oldMuscles.hasExplicitMuscleMetadata(ex))
      equal(muscles.muscleWeightsOf(ex), oldMuscles.muscleWeightsOf(ex))
      equal(muscles.musclesOf(ex), oldMuscles.musclesOf(ex))
      equal(muscles.exerciseMuscleSnapshot(ex), oldMuscles.exerciseMuscleSnapshot(ex))
      equal(muscles.matchesMuscleGroups(ex, ['chest', 'quads']), oldMuscles.matchesMuscleGroups(ex, ['chest', 'quads']))
      const items = [{ id: ex.id, sets }, { id: '0025', sets }, { id: 'missing', ex: { bp: ex.bp }, sets }]
      const load = muscles.loadOf(items, index)
      equal(load, oldMuscles.loadOf(items))
      equal(muscles.levelsOf(load), oldMuscles.levelsOf(load))
      const thresholds = [{ at: 0, level: 1, exclusive: true }, { at: 4, level: 3 }]
      equal(muscles.levelsOf(load, thresholds), oldMuscles.levelsOf(load, thresholds))
      equal(muscles.rankOf(load), oldMuscles.rankOf(load))
    }), runs)
  }, 30_000)
  it('matches analytics on mixed modes, duplicate entries, sides, warm-ups and dumbbell meanings', () => {
    fc.assert(fc.property(profile, metadata, (S, ex) => {
      oldExercises.registerCustom([ex]); const index = createExerciseIndex([ex])
      const before = JSON.stringify(S)
      for (const id of ['0025', 'synthetic', '0585']) {
        equal(rm.e1rmSeries(S, id, undefined, undefined, index), oldRm.e1rmSeries(S, id))
        equal(rm.best1RM(S, id, undefined, undefined, index), oldRm.best1RM(S, id))
        for (const en of S.workouts.flatMap(w => w.entries)) {
          equal(rm.bestSetOf(en, S.oneRmFormula, index), oldRm.bestSetOf(en, S.oneRmFormula))
          equal(rm.is1RMRecord(S, id, en, undefined, index), oldRm.is1RMRecord(S, id, en))
        }
        for (const metric of ['weight', 'reps', 'e1rm']) {
          const sessions = perSet.perSetSessions(S.workouts, id, { metric, formula: S.oneRmFormula })
          equal(sessions, oldPerSet.perSetSessions(S.workouts, id, { metric, formula: S.oneRmFormula }))
          equal(perSet.perSetLines(sessions), oldPerSet.perSetLines(sessions))
          equal(perSet.dropOffSet(sessions), oldPerSet.dropOffSet(sessions))
        }
        equal(history.exerciseHistory(S, id, { limit: 3 }, index), oldHistory.exerciseHistory(S, id, { limit: 3 }))
        for (const mode of ['reps', 'time', 'cardio', null]) equal(history.bestSetFor(S, id, mode, undefined, index), oldHistory.bestSetFor(S, id, mode))
      }
      equal(effort.displayScale(S), oldEffort.displayScale(S))
      equal(effort.hasEffort(S), oldEffort.hasEffort(S))
      equal(effort.hasEstimableEffort(S, index), oldEffort.hasEstimableEffort(S))
      for (const days of [0, 7, 30]) {
        equal(effort.effortSummary(S, days), oldEffort.effortSummary(S, days))
        equal(effort.effortWeeks(S, days), oldEffort.effortWeeks(S, days))
        equal(effort.effortHistogram(S, days), oldEffort.effortHistogram(S, days))
        equal(muscles.muscleBalanceWindow(S.workouts, days, Date.now(), '2026-08-27', 1), oldMuscles.muscleBalanceWindow(S.workouts, days, Date.now(), '2026-08-27', 1))
      }
      equal(muscles.loadOfWorkouts(S.workouts, effort.isHardSet, index), oldMuscles.loadOfWorkouts(S.workouts, oldEffort.isHardSet))
      equal(muscles.loadOfActive({ entries: S.workouts.flatMap(w => w.entries) }, index), oldMuscles.loadOfActive({ entries: S.workouts.flatMap(w => w.entries) }))
      equal(JSON.stringify(S), before)
    }), runs)
  }, 30_000)
})
