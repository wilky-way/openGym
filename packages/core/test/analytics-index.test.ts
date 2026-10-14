import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { describe, expect, it } from 'vitest'
import { createExerciseIndex, EXIDX } from '../src/exercises'
import { best1RM, bestSetOf, e1rmSeries, is1RMRecord, type AnalyticsState } from '../src/onerm'
import { hasEstimableEffort } from '../src/effort'
import { bestSetFor, exerciseHistory } from '../src/exercise-history'
import { loadOf, loadOfActive, loadOfRoutine, loadOfWeeklyPlan, loadOfWorkouts } from '../src/muscles'


const assisted = createExerciseIndex([{ id: 'synthetic', n: 'Synthetic assistance', eq: 'leverage machine', assisted: true, muscleWeights: { chest: 1 } }])
const loaded = createExerciseIndex([{ id: 'synthetic', n: 'Synthetic loaded lift', eq: 'barbell', muscleWeights: { quadriceps: 1 } }])
const rows = [{ w: 30, r: 8, done: true }, { w: 20, r: 8, done: true }]
const entry = { id: 'synthetic', target: { mode: 'reps' }, sets: rows }
const S: AnalyticsState = { workouts: [{ id: 'w', d: '2026-08-27', start: 1, entries: [entry] }] }

describe('caller-owned indexes', () => {
  it('keeps assisted estimates and estimability isolated across profiles', () => {
    expect(bestSetOf(entry, undefined, assisted)).toBeNull()
    expect(bestSetOf(entry, undefined, loaded)?.est).toBe(38)
    expect(e1rmSeries(S, 'synthetic', undefined, undefined, assisted)).toEqual([])
    expect(e1rmSeries(S, 'synthetic', undefined, undefined, loaded)[0]?.y).toBe(38)
    expect(best1RM(S, 'synthetic', undefined, undefined, assisted)).toBeNull()
    expect(best1RM(S, 'synthetic', undefined, undefined, loaded)?.est).toBe(38)
    expect(is1RMRecord({}, 'synthetic', entry, undefined, assisted)).toBeNull()
    expect(is1RMRecord({}, 'synthetic', entry, undefined, loaded)?.prev).toBe(0)
    expect(hasEstimableEffort(S, assisted)).toBe(false)
    expect(hasEstimableEffort(S, loaded)).toBe(true)
    expect(EXIDX.synthetic).toBeUndefined()
  })
  it('forwards the index when ranking assistance and estimating history', () => {
    expect(bestSetFor(S, 'synthetic', 'reps', undefined, assisted)?.set.w).toBe(20)
    expect(bestSetFor(S, 'synthetic', 'reps', undefined, loaded)?.set.w).toBe(30)
    expect(exerciseHistory(S, 'synthetic', {}, assisted).e1rmPoints).toEqual([])
    expect(exerciseHistory(S, 'synthetic', {}, loaded).e1rmPoints[0]?.y).toBe(38)
  })
  it('preserves a custom cardio best set when deriving the default mode from the caller index', () => {
    const index = createExerciseIndex([{ id: 'custom-cardio', n: 'Synthetic cardio', bp: 'cardio', eq: 'body weight' }])
    const state: AnalyticsState = { workouts: [{ id: 'w', start: 1, d: '2026-11-01', entries: [{ id: 'custom-cardio', target: { mode: 'cardio' }, sets: [{ min: 30, speed: 10, done: true }] }] }] }
    expect(bestSetFor(state, 'custom-cardio', undefined, undefined, index)?.set.min).toBe(30)
  })
  it('preserves null mode as an explicit historical fallback', () => {
    const state = { workouts: [{ id: 'mixed', d: '2026-08-27', start: 1, entries: [{ id: 'synthetic', target: { mode: 'time' }, sets: [{ sec: 30, done: true }] }] }] }
    expect(bestSetFor(state, 'synthetic', null)?.set.sec).toBe(30)
  })
  it('forwards the index through every muscle-load reader and respects snapshots', () => {
    const routine = { id: 'r', ex: [{ id: 'synthetic', sets: 2 }] }
    const active = { entries: [entry] }
    const plan = { routines: [routine], week: { '1': 'r' } }
    for (const [index, slug] of [[assisted, 'chest'], [loaded, 'quadriceps']] as const) {
      expect(loadOf([{ id: 'synthetic', sets: 2 }], index)).toEqual({ [slug]: 2 })
      expect(loadOfWorkouts(S.workouts, undefined, index)).toEqual({ [slug]: 2 })
      expect(loadOfRoutine(routine, {}, index)).toEqual({ [slug]: 2 })
      expect(loadOfWeeklyPlan(plan, index)).toEqual({ [slug]: 2 })
      expect(loadOfActive(active, index)).toEqual({ [slug]: 2 })
      expect(loadOf([{ id: 'synthetic', sets: 2, ex: { muscleWeights: { triceps: 0.4 } } }], index)).toEqual({ triceps: 0.8 })
    }
    expect(loadOf([{ id: 'synthetic', sets: 2 }])).toEqual({})
  })
})


it('keeps real one-arm dumbbell conversion and volume through native analytics', () => {
  const id = 'custom-one-bell'
  const index = createExerciseIndex([{ id, n: 'Single arm lift', eq: 'dumbbell' }])
  const state: AnalyticsState = { dbLoad: { [id]: { mode: 'total' } }, workouts: [{ id: 'bell-workout', d: '2026-08-27', start: 1, entries: [{ id, target: { mode: 'reps', dbLoad: 'each' }, sets: [{ w: 20, r: 8, done: true }] }] }] }
  expect(e1rmSeries(state, id, undefined, 'total', index)[0]).toMatchObject({ w: 20, y: 25.3 })
  const history = exerciseHistory(state, id, {}, index)
  expect(history).toMatchObject({ metric: 'weight', best: 20 })
  expect(history.sessions[0]).toMatchObject({ value: 20, e1rm: 25.3, volume: 160 })
  expect(bestSetFor(state, id, 'reps', 'total', index)?.set.w).toBe(20)
})

it('retains loaded custom shadows of catalogue-assisted estimators', () => {
  const id = '1027'
  const index = createExerciseIndex([{ id, n: 'Loaded bar lift', eq: 'barbell', assisted: false }])
  const state: AnalyticsState = { workouts: [{ id: 'loaded-shadow', d: '2026-08-27', start: 1, entries: [{ id, sets: [{ w: 30, r: 8, done: true }] }] }] }
  expect(e1rmSeries(state, id, undefined, undefined, index)[0]).toMatchObject({ w: 30, y: 38 })
  expect(best1RM(state, id, undefined, undefined, index)).toMatchObject({ w: 30, est: 38 })
  expect(is1RMRecord(state, id, { id, sets: [{ w: 40, r: 8, done: true }] }, undefined, index)).toMatchObject({ est: 50.7, prev: 38 })
})

it('keeps assisted topW fallback as a load metric and custom cardio empty mode', () => {
  const state: AnalyticsState = { workouts: [{ id: 'top-only', d: '2026-08-27', start: 1, entries: [{ id: 'synthetic', topW: 20, target: { mode: 'reps' }, sets: [{ w: 0, r: 8, done: true }] }] }] }
  expect(exerciseHistory(state, 'synthetic', {}, assisted)).toMatchObject({ metric: 'weight', best: 20 })
  const cardio = createExerciseIndex([{ id: 'custom-cardio', n: 'Synthetic cardio', bp: 'cardio' }])
  expect(exerciseHistory({}, 'custom-cardio', {}, cardio)).toMatchObject({ mode: 'cardio', total: 0 })
})


// Inert: history's metric selector only uses index after finding no completed rows,
// where bestWeightForEntry reads its index-independent legacy topW fallback.
// Exercise history discards those zero-row records anyway. Preserve the forward
// for future selector changes while its actual native outputs stay covered above.
it('preserves the inert index edge into the native metric-entry selector', () => {
  const ast = parse(readFileSync(new URL('../src/exercise-history.ts', import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['typescript'] })
  type Node = { type?: string; callee?: { type?: string; name?: string }; arguments?: { type?: string; name?: string }[]; [key: string]: unknown }
  const calls: Node[] = []
  function walk(value: unknown) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(walk); return }
    const n = value as Node
    if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && n.callee.name === 'metricEntriesForExercise') calls.push(n)
    for (const [key, child] of Object.entries(n)) if (!['loc', 'comments'].includes(key)) walk(child)
  }
  walk(ast)
  expect(calls).toHaveLength(1)
  expect(calls[0]!.arguments?.at(-1)).toMatchObject({ type: 'Identifier', name: 'index' })
})
