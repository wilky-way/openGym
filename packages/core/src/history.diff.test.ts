// Differential: the ported history selectors and superset/row helpers against the legacy module,
// on seeded random inputs. Each call must agree on the value (deep equal and JSON.stringify, so
// key order too) or on whether it throws. The legacy import is the only one in the core package.
import type { Legacy } from './legacy-shape'
import { describe, expect, it, vi } from 'vitest'
import * as fc from 'fast-check'
// @ts-expect-error the legacy oracle is untyped JS; this differential test is its only importer
import * as Old from '../../../packages/parity/fixtures/oracle/frontend/src/lib/history.js'
import * as Ported from './history'

const SEED = 20261013
const RUNS = { numRuns: 1000, seed: SEED }

const outcome = (fn: () => unknown) => {
  try { const value = fn(); return { ok: true as const, value, json: JSON.stringify(value) } }
  catch (e) { return { ok: false as const, error: (e as Error).constructor.name } }
}
const agree = (fn: (lib: Legacy) => unknown) => {
  const a = outcome(() => fn(Ported)), b = outcome(() => fn(Old))
  expect(a.ok).toBe(b.ok)
  if (a.ok && b.ok) { expect(a.value).toEqual(b.value); expect(a.json).toBe(b.json) }
  else expect(a).toEqual(b)
}

const entryArb = fc.record({
  id: fc.constantFrom('a', 'b', 'c', 'd', 'e'),
  sg: fc.constantFrom<string | undefined>(undefined, 'g1', 'g2'),
})
const listArb = fc.array(entryArb, { maxLength: 7 })
const indexArb = fc.integer({ min: -1, max: 8 })
const directionArb = fc.constantFrom(-1, 1, 0, 2)
const weightArb = fc.constantFrom<number | undefined>(undefined, 0, 5, 10, 12.5, 40)
const repsArb = fc.option(fc.integer({ min: 0, max: 16 }), { nil: undefined })
const sideArb = fc.record({ w: weightArb, r: repsArb, done: fc.boolean(), rir: fc.option(fc.constantFrom(0, 1, 2.5), { nil: undefined }) })
const setArb = fc.record({
  w: weightArb, r: repsArb, done: fc.boolean(),
  warmup: fc.option(fc.boolean(), { nil: undefined }),
  phase: fc.constantFrom<string | undefined>(undefined, 'work', 'warmup'),
  side: fc.constantFrom<string | undefined>(undefined, 'L', 'R'),
  sides: fc.option(fc.record({ L: sideArb, R: sideArb }), { nil: undefined }),
  sec: fc.option(fc.integer({ min: 0, max: 180 }), { nil: undefined }),
  min: fc.option(fc.integer({ min: 0, max: 60 }), { nil: undefined }),
  speed: fc.option(fc.constantFrom(0, 5, 9.7), { nil: undefined }),
  mode: fc.constantFrom<string | undefined>(undefined, 'reps', 'time', 'cardio'),
  bw: fc.option(fc.constantFrom(0, 70, 85.5), { nil: undefined }),
  rir: fc.option(fc.constantFrom(0, 1, 2.5), { nil: undefined }),
})
const rowsArb = fc.array(setArb, { maxLength: 6 })

describe('history selectors (differential)', () => {
  it('pairAdjacent, unpairSuperset, cleanupSg, supersetUnits agree with legacy', () => {
    fc.assert(fc.property(listArb, indexArb, indexArb, (items, i, j) => {
      agree(lib => lib.pairAdjacent(structuredClone(items), i, j))
      agree(lib => lib.unpairSuperset(structuredClone(items), i))
      agree(lib => lib.supersetUnits(items))
    }), RUNS)
  }, 30_000)

  it('moveRoutineEntry and moveSupersetUnit agree with legacy', () => {
    fc.assert(fc.property(listArb, indexArb, directionArb, (items, i, dir) => {
      agree(lib => lib.moveRoutineEntry(items, i, dir))
      agree(lib => lib.moveSupersetUnit(items, i, dir))
    }), RUNS)
  }, 30_000)

  it('sessionSections agrees with legacy', () => {
    fc.assert(fc.property(fc.array(fc.record({ id: fc.constantFrom('a', 'b'), sg: fc.constantFrom<string | undefined>(undefined, 'g1'), rid: fc.constantFrom<string | null | undefined>(undefined, null, 'r1', 'r2') }), { maxLength: 7 }), entries => {
      agree(lib => lib.sessionSections(entries))
    }), RUNS)
  }, 30_000)

  it('row helpers agree with legacy: copyRowAt, removeRowAt, insertRowAt, workSetsDone inputs', () => {
    fc.assert(fc.property(rowsArb, indexArb, (rows, i) => {
      agree(lib => lib.copyRowAt(rows, i))
      agree(lib => lib.removeRowAt(rows, i))
      agree(lib => lib.setSpanAt(rows, i))
      agree(lib => lib.copySpanAt(rows, i))
    }), RUNS)
  }, 30_000)

  it('lastEntryFor and entryRoutineId agree with legacy across routine lineage and exclusions', () => {
    const entryArb = fc.record({
      id: fc.constantFrom('x', 'y'),
      rid: fc.constantFrom<string | null | undefined>(undefined, null, 'A', 'B'),
      noProg: fc.boolean(),
      series: fc.constantFrom<string | undefined>(undefined, 's1'),
      sets: fc.array(fc.record({ w: fc.integer({ min: 0, max: 100 }), r: fc.integer({ min: 0, max: 12 }), done: fc.boolean(), warmup: fc.option(fc.boolean(), { nil: undefined }) }), { maxLength: 3 }),
    })
    const workoutArb = fc.record({
      d: fc.constantFrom('2026-09-01', '2026-09-02', '2026-09-07'),
      routineId: fc.constantFrom<string | null | undefined>(undefined, 'A', 'B'),
      routineIds: fc.constantFrom<string[] | undefined>(undefined, ['A'], ['A', 'B']),
      excludeFromProgression: fc.boolean(),
      entries: fc.array(entryArb, { maxLength: 3 }),
    })
    fc.assert(fc.property(fc.array(workoutArb, { maxLength: 5 }), fc.constantFrom<string | null | undefined>(undefined, null, 'A', 'B', 'C'), (workouts, rid) => {
      const S = { workouts, routines: [{ id: 'A', programme: { series: 's1' } }, { id: 'B' }] }
      agree(lib => lib.lastEntryFor(S, 'x', rid))
      agree(lib => lib.lastEntryFor(S, 'y', rid))
      agree(lib => lib.lastEntryFor(S, 'x', undefined))
      workouts.forEach(w => w.entries.forEach(en => agree(lib => lib.entryRoutineId(w, en))))
    }), RUNS)
  }, 30_000)

  it('setLabel, fmtSec, stepEffort and effortOf agree with legacy', () => {
    fc.assert(fc.property(setArb, fc.integer({ min: 0, max: 600 }), fc.constantFrom<'rir' | 'rpe'>('rir', 'rpe'), fc.constantFrom(-1, 1), (s, sec, kind, dir) => {
      agree(lib => lib.setLabel('bench', s, undefined, 'km/h'))
      agree(lib => lib.fmtSec(sec))
      agree(lib => lib.stepEffort(kind, s.warmup ? 6 : 7.5, dir))
      agree(lib => lib.effortOf({ effort: kind }))
    }), RUNS)
  }, 30_000)
})

// The Review Manager's richer probes, now durable and clock-pinned. These assertions require
// successful results: a shared exception cannot masquerade as parity for valid saved inputs.
const same = (fn: (lib: typeof Ported) => unknown) => {
  const actual = fn(Ported), expected = fn(Old)
  expect(actual).toEqual(expected)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  return actual
}
const DATES = ['2026-03-07', '2026-03-08', '2026-03-09', '2026-10-31', '2026-11-01', '2026-11-02', '2026-12-31', '2027-01-01']
const exerciseArb = fc.constantFrom('0025', '0001', '0009', '2352', 'custom-unresolved')
const savedEntryArb = fc.record({
  id: exerciseArb,
  rid: fc.constantFrom<string | undefined>(undefined, 'push', 'pull'),
  noProg: fc.boolean(),
  target: fc.record({
    mode: fc.constantFrom<string | undefined>(undefined, 'reps', 'time', 'cardio'),
    bodyweight: fc.option(fc.boolean(), { nil: undefined }),
    side: fc.boolean(),
    dbLoad: fc.constantFrom('as', 'each', 'total'),
  }),
  sets: fc.array(setArb, { maxLength: 5 }),
  topW: weightArb,
})
const savedWorkoutArb = fc.record({
  d: fc.constantFrom(...DATES),
  start: fc.constantFrom<number | undefined>(undefined, 0, Date.parse('2026-03-08T07:30:00Z'), Date.parse('2026-11-01T06:30:00Z')),
  end: fc.constantFrom<number | string | undefined>(undefined, 0, '0', Date.parse('2026-11-01T08:30:00Z')),
  bw: fc.constantFrom<number | undefined>(undefined, 0, 70, 85.5),
  excludeFromProgression: fc.boolean(),
  routineId: fc.constantFrom<string | undefined>(undefined, 'push', 'pull'),
  entries: fc.array(savedEntryArb, { maxLength: 4 }),
})
const savedStateArb = fc.record({
  workouts: fc.array(savedWorkoutArb, { maxLength: 6 }),
  unit: fc.constantFrom('kg', 'lb'),
  weekStart: fc.constantFrom(0, 1),
}).map(s => ({ ...s, routines: [{ id: 'push', ex: [{ id: '0025', sets: 3, reps: 8 }] }, { id: 'pull', ex: [{ id: '0009', sets: 3, reps: 8 }] }] }))
const planArb = fc.record({
  id: exerciseArb,
  mode: fc.constantFrom<string | undefined>(undefined, 'reps', 'time', 'cardio'),
  sets: fc.integer({ min: 1, max: 5 }),
  reps: fc.integer({ min: 0, max: 16 }),
  weight: weightArb,
  sec: fc.integer({ min: 0, max: 180 }),
  side: fc.boolean(),
  bodyweight: fc.option(fc.boolean(), { nil: undefined }),
  warmupSets: fc.integer({ min: 0, max: 7 }),
  pyramid: fc.option(fc.array(fc.oneof(fc.integer({ min: 1, max: 12 }), fc.constant('max')), { minLength: 1, maxLength: 4 }), { nil: undefined }),
  pyramidWeight: fc.option(fc.array(weightArb, { maxLength: 4 }), { nil: undefined }),
})

describe('Review Manager history differentials', () => {
  it('volume, dates, duration, completed rows, best loads and streaks match across DST/year boundaries', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-01-04T18:00:00Z'))
    try {
      fc.assert(fc.property(savedStateArb, S => {
        S.workouts.forEach(w => {
          same(lib => lib.workoutVolume(w))
          same(lib => lib.workoutAt(w))
          same(lib => lib.workoutDay(w))
          same(lib => lib.workoutDuration(w))
          same(lib => lib.setsDone(w))
          same(lib => lib.workSetsDone(w))
          w.entries.forEach(e => {
            same(lib => lib.bestWeightForEntry(e))
            same(lib => lib.metricModeForEntry(e))
            for (const mode of ['reps', 'time', 'cardio']) same(lib => lib.metricRowsForEntry(e, mode))
            e.sets.forEach(row => same(lib => lib.completedRepsOf(row)))
            same(lib => lib.metricEntriesForExercise(w, e.id))
          })
        })
        for (const id of ['0025', '0001', '0009', '2352', 'custom-unresolved']) {
          same(lib => lib.bestWeightFor(S, id))
          same(lib => lib.bestWeightFor(S, id, 'each'))
          same(lib => lib.bestWeightFor(S, id, 'total'))
        }
        same(lib => lib.streakWeeks(S))
      }), { ...RUNS, numRuns: 3000 })
    } finally { vi.useRealTimers() }
  }, 30_000)
  it('nextTrainingDay matches random schedules around DST changes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-01T18:00:00Z'))
    let trainingDays = 0, restSchedules = 0
    try {
      fc.assert(fc.property(savedStateArb, fc.oneof(fc.constant(Array<string | string[] | undefined>(7).fill(undefined)), fc.array(fc.constantFrom<string | string[] | undefined>(undefined, 'push', 'pull', ['push', 'pull']), { minLength: 7, maxLength: 7 })), fc.constantFrom(...DATES), (S, days, iso) => {
        const week = Object.fromEntries(days.flatMap((id, i) => id ? [[i, id]] : []))
        const next = same(lib => lib.nextTrainingDay({ ...S, week, dayPlan: {} }, iso))
        if (next) trainingDays++; else restSchedules++
      }), RUNS)
      expect(trainingDays).toBeGreaterThan(0)
      expect(restSchedules).toBeGreaterThan(0)
    } finally { vi.useRealTimers() }
  }, 30_000)
  it('buildSets matches side/time/pyramid/warmup/history/target paths and loading grids', () => {
    fc.assert(fc.property(savedStateArb, planArb, fc.record({
      preferLast: fc.boolean(), useTarget: fc.boolean(), planReps: fc.boolean(),
      rid: fc.constantFrom<string | undefined>(undefined, 'push', 'pull'),
      step: fc.oneof(fc.constantFrom(1, 2.5, 5), fc.constant([5, 10, 15, 22.5, 30, 40])),
    }), (S, cfg, options) => {
      same(lib => lib.buildSets(S, cfg, options))
    }), { ...RUNS, numRuns: 3000 })
  }, 30_000)
})
