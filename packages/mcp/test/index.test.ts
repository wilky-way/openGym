import { beforeEach, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { PROFILE_TOOLS } from '../src/tools'
import { _seedStateForTests } from '../src/state'
import { exLine } from '../src/labels'
import { createExerciseIndex, EXIDX } from '@opengym/core/exercises'
const customEx = [
  { id: 'c-cardio', n: 'Synthetic cardio', bp: 'cardio', eq: 'body weight' },
  { id: 'c-body', n: 'Synthetic bodyweight', bp: 'waist', eq: 'body weight' },
  { id: 'c-single', n: 'Synthetic single arm curl', bp: 'upper arms', eq: 'dumbbell' },
  { id: 'c-help', n: 'Synthetic assistance', bp: 'chest', eq: 'leverage machine', assisted: true },
  { id: 'c-leg', n: 'Synthetic leg lift', bp: 'upper legs', eq: 'barbell', tg: 'quads' },
]
let S: any
beforeEach(() => {
  S = { unit: 'kg', customEx, routines: [{ id: 'r', name: 'Synthetic', prog: 'off', ex: [
    { id: 'c-cardio', sets: 1, min: 20, speed: 8 }, { id: 'c-body', sets: 1, reps: 8, weight: 0 },
  ] }], workouts: [{ id: 'w', d: '2026-07-26', entries: [
    { id: 'c-cardio', target: { min: 20, speed: 8 }, sets: [{ done: true, min: 20, speed: 8 }] },
    { id: 'c-body', target: { sets: 1, reps: 8 }, sets: [{ done: true, w: 0, r: 8 }] },
    { id: 'c-single', target: { dbLoad: 'each', mode: 'reps' }, sets: [{ done: true, w: 30, r: 8 }] },
    { id: 'c-help', target: { mode: 'reps' }, sets: [{ done: true, w: 30, r: 8 }] },
  ] }], week: {}, dayPlan: {}, exWeights: {} }
  _seedStateForTests(S)
})
const call = (name: string, params: any = {}): any => PROFILE_TOOLS.find(t => t.name === name)!.handler(params)
test('custom cardio is classified and summarized by each routine and preview call site', () => {
  const routine = call('get_routine', { routine_id: 'r' })
  expect(routine.exercises[0].mode).toBe('cardio'); expect(routine.exercises[0].summary).toBe('1 × 20 min @ 8 km/h')
  const preview = call('preview_session', { routine_id: 'r', date: '2026-07-27' })
  expect(preview.exercises[0].mode).toBe('cardio'); expect(preview.exercises[0].planned.summary).toBe('1 × 20 min @ 8 km/h')
  expect(preview.exercises[1].opening_sets[0].label).toBe('8')
  expect(exLine(S.routines[0].ex[0], 'kg', createExerciseIndex(customEx))).toBe('1 × 20 min @ 8 km/h')
  expect(EXIDX['c-cardio']).toBeUndefined()
})
test('custom workout modes and labels use the profile index', () => {
  const workout = call('get_workout', { workout_id: 'w' })
  expect(workout.entries[0].mode).toBe('cardio'); expect(workout.entries[0].sets[0].label).toBe('20 min @ 8 km/h')
  expect(workout.entries[1].sets[0].label).toBe('8')
})
test('custom single-bell volume is correct in list, detail and ambiguous-date outputs', () => {
  const value = 480 // single-bell curl 240 plus the assistance row 240
  expect(call('list_workouts', { to: '2026-07-27' }).workouts[0].volume).toBe(value)
  expect(call('get_workout', { workout_id: 'w' }).volume).toBe(value)
  S.workouts.push({ ...S.workouts[0], id: 'w2' })
  expect(call('get_workout', { date: '2026-07-26' }).workouts.map((w: any) => w.volume)).toEqual([value, value])
})
test('custom assistance is excluded from both PR table and per-exercise estimates and trends', () => {
  expect(call('estimate_1rm').pr_table.some((p: any) => p.exId === 'c-help')).toBe(false)
  const estimate = call('estimate_1rm', { exercise_id: 'c-help' })
  expect(estimate.best).toBeNull(); expect(estimate.trend).toEqual([])
})
test('custom leg load drives the actual opening warmup step', () => {
  S.routines[0] = { id: 'r', name: 'Leg', prog: 'off', ex: [{ id: 'c-leg', sets: 2, reps: 8, weight: 90, warmupSets: 2 }] }
  const preview = call('preview_session', { routine_id: 'r', date: '2026-07-27' })
  expect(preview.exercises[0].opening_sets.filter((s: any) => s.phase === 'warmup').map((s: any) => s.w)).toEqual([45, 65])
})
test('inert index edges retain AST forwarding with their explicit reason', () => {
  // Forced reps mode means policyFor never reaches modeOf/index.
  // exerciseOf resolves customs before exOr; fallback only resolves unchanged catalogue ids.
  // muscle_balance attaches each current custom as exercise metadata, preserving snapshots.
  // Lifecycle output tests prove activation's validation aliases and unit conversion are inert.
  for (const [file, callee, count] of [['tools', 'policyFor', 6], ['tools', 'exOr', 1], ['tools', 'loadOfWorkouts', 1], ['programme-tools', 'applyProgrammeAgentAction', 1]] as const) {
    const ast = parse(readFileSync(new URL(`../src/${file}.ts`, import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['typescript'] })
    const calls: any[] = []
    function walk(node: any) { if (!node || typeof node !== 'object') return; if (Array.isArray(node)) { node.forEach(walk); return }
      if (node.type === 'CallExpression' && node.callee?.name === callee) calls.push(node)
      for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end'].includes(key)) walk(value)
    }
    walk(ast); expect(calls, `${file}.${callee} inventory`).toHaveLength(count)
    for (const call of calls) expect(call.arguments.at(-1)?.callee?.name, `${file}.${callee} forwarding`).toBe(callee === 'applyProgrammeAgentAction' ? 'createExerciseIndex' : 'indexOf')
  }
})
