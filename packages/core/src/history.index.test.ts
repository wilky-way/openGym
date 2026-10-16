import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExerciseIndex, EXIDX } from '@opengym/core/exercises'
import * as Exercises from '@opengym/core/exercises'
import * as Bells from '@opengym/core/dumbbells'
import * as Bar from '@opengym/core/bar'
import * as Backoff from '@opengym/core/backoff'
import * as H from './history'

const assisted = { id: 'custom-assisted', n: 'Assisted pull', bp: 'back', eq: 'leverage machine', assisted: true }
const loaded = { id: 'custom-loaded', n: 'Single arm lift', bp: 'upper legs', eq: 'dumbbell' }
const bar = { id: 'custom-bar', n: 'Bar lift', bp: 'upper legs', eq: 'barbell' }
const bw = { id: 'custom-bw', n: 'Bodyweight lift', bp: 'back', eq: 'body weight' }
const cardio = { id: 'custom-cardio', n: 'Cardio', bp: 'cardio', eq: 'machine' }
const index = createExerciseIndex([assisted, loaded, bar, bw, cardio])
const entry = (id: string, weights = [40, 20, 0]) => ({ id, sets: weights.map(w => ({ w, r: 8, done: true })) })
const state = { unit: 'kg', workouts: [{ entries: [entry(assisted.id)] }, { entries: [entry(assisted.id, [10, 30])] }], routines: [] }

afterEach(() => vi.restoreAllMocks())

describe('history forwards caller-owned exercise indexes', () => {
  it('entryExcluded accepts the contract 1.7.2 index for custom saved entries', () => {
    expect(H.entryExcluded({}, entry(assisted.id), index)).toBe(false)
    expect(H.entryExcluded({}, { ...entry(loaded.id), noProg: true }, index)).toBe(true)
    expect(H.entryExcluded({ excludeFromProgression: true }, entry(assisted.id), index)).toBe(true)
  })
  it('modeOf resolves custom cardio while explicit modes win', () => {
    expect(H.modeOf({ id: cardio.id }, index)).toBe('cardio')
    expect(H.modeOf({ id: cardio.id })).toBe('reps')
    expect(H.modeOf({ id: cardio.id, mode: 'time' }, index)).toBe('time')
  })
  it('isTimed forwards the index even with an explicit time mode', () => {
    const lookup = vi.spyOn(Exercises, 'isCardio')
    expect(H.isTimed({ id: cardio.id }, index)).toBe(false)
    expect(lookup).toHaveBeenCalledWith(cardio.id, index)
    expect(H.isTimed({ id: bw.id, mode: 'time' }, index)).toBe(true)
  })
  it('isBw resolves custom equipment and honors explicit overrides', () => {
    expect(H.isBw({ id: bw.id }, index)).toBe(true)
    expect(H.isBw({ id: loaded.id }, index)).toBe(false)
    expect(H.isBw({ id: bw.id, bodyweight: false }, index)).toBe(false)
  })
  it('setsFromRows forwards mode lookup and preserves timed side pairs', () => {
    const lookup = vi.spyOn(Exercises, 'isCardio')
    expect(H.setsFromRows({ id: cardio.id }, 3, index)).toBe(3)
    expect(lookup).toHaveBeenCalledWith(cardio.id, index)
    expect(H.setsFromRows({ id: bw.id, mode: 'time', side: true }, 3, index)).toBe(2)
  })
  it('setLabel forwards mode, bodyweight and bell-name lookups', () => {
    expect(H.setLabel(cardio.id, { min: 4, speed: 5 }, {}, undefined, index)).toBe('4 min @ 5 km/h')
    expect(H.setLabel(bw.id, { w: 10, r: 8 }, {}, undefined, index)).toBe('+10 × 8')
    expect(H.setLabel(loaded.id, { w: 20, r: 8 }, { dbLoad: 'each' }, undefined, index)).toBe('20×8')
    expect(H.setLabel(loaded.id, { w: 20, r: 8 }, { dbLoad: 'each' })).toBe('20 each × 8')
  })
  it('defaultConfig forwards both mode and equipment lookups', () => {
    expect(H.defaultConfig(cardio.id, undefined, index)).toEqual({ sets: 1, min: 20, speed: 8 })
    expect(H.defaultConfig(bw.id, undefined, index)).toMatchObject({ bodyweight: true, mode: 'reps' })
    expect(H.defaultConfig(bw.id, 'time', index)).toMatchObject({ bodyweight: true, mode: 'time' })
    expect(H.defaultConfig(loaded.id, undefined, index)).not.toHaveProperty('bodyweight')
  })
  it('setsRepsOf uses custom cardio mode', () => {
    expect(H.setsRepsOf({ id: cardio.id, sets: 2, min: 7 }, index)).toBe('2 × 7 min')
  })
  it('exLine forwards mode, backoff, bodyweight and nested summary lookups', () => {
    const step = vi.spyOn(Backoff, 'backoffStepOf')
    const cfg = { id: assisted.id, sets: 3, reps: 8, weight: 40, backoff: true }
    expect(H.exLine(cfg, 'kg', undefined, index)).toBe('3 × 8 · 40 kg')
    expect(step).toHaveBeenCalledWith(cfg, 'kg', index)
    expect(H.exLine({ ...cfg, id: loaded.id }, 'kg', undefined, index)).toBe('3 × 8 · 40 → 35 → 30 kg')
    expect(H.exLine({ id: bw.id, sets: 2, reps: 8, weight: 10 }, 'kg', undefined, index)).toBe('2 × 8 · +10 kg')
    expect(H.exLine({ id: bw.id, sets: 3, reps: 8, weight: 10, backoff: true, inc: 2.5 }, 'kg', undefined, index)).toBe('3 × 8 · +10 → 7.5 → 5 kg')
    expect(H.exLine({ id: bw.id, sets: 2, sec: 30, mode: 'time', weight: 10 }, 'kg', undefined, index)).toBe('2 × 0:30 · +10 kg')
    expect(H.exLine({ id: cardio.id, min: 7, speed: 5 }, 'kg', undefined, index)).toBe('1 × 7 min @ 5 km/h')
  })
  it('bestWeightForEntry filters zero assistance and chooses the smallest completed load', () => {
    expect(H.bestWeightForEntry(entry(assisted.id), index)).toBe(20)
    expect(H.bestWeightForEntry(entry(assisted.id))).toBe(40)
    expect(H.bestWeightForEntry(entry(loaded.id), index)).toBe(40)
  })
  it('bestWeightFor forwards entry comparison and across-workout comparisons', () => {
    expect(H.bestWeightFor(state, assisted.id, undefined, index)).toBe(10)
    expect(H.bestWeightFor(state, assisted.id)).toBe(40)
    const loadedState = { workouts: [{ entries: [{ ...entry(loaded.id, [40]), target: { dbLoad: 'total' } }] }] }
    const conversion = vi.spyOn(Bells, 'historyAs')
    expect(H.bestWeightFor(loadedState, loaded.id, 'each', index)).toBe(40)
    expect(conversion).toHaveBeenCalledWith(loadedState, loaded.id, 'each', index)
    // The same custom id can denote two bells in another profile, with no global mutation.
    const otherIndex = createExerciseIndex([{ ...loaded, n: 'Two hand lift' }])
    expect(H.bestWeightFor(loadedState, loaded.id, 'each', otherIndex)).toBe(20)
  })
  it('buildSets forwards mode in work/warmup paths and the custom bar floor', () => {
    expect(H.buildSets({ workouts: [] }, { id: cardio.id, sets: 1, min: 7, speed: 5 }, {}, index)).toEqual([{ min: 7, speed: 5, done: false }])
    const floor = vi.spyOn(Bar, 'barWeightFor')
    const cfg = { id: bar.id, sets: 1, reps: 8, weight: 30, warmupSets: 1 }
    const rows = H.buildSets({ workouts: [], unit: 'kg' }, cfg, { step: 2.5 }, index)
    expect(rows[0]?.w).toBe(20)
    expect(floor).toHaveBeenCalledWith({ workouts: [], unit: 'kg' }, bar.id, index)
    expect(H.buildSets({ workouts: [] }, { id: cardio.id, sets: 1, warmupSets: 1 }, {}, index)[0]).toMatchObject({ min: 20, speed: 8, phase: 'warmup' })
  })
  it('barFloor uses custom loaded equipment and stored overrides', () => {
    expect(H.barFloor({ unit: 'kg' }, bar.id, index)).toBe(20)
    expect(H.barFloor({ unit: 'kg', barWeights: { [bar.id]: 0 } }, bar.id, index)).toBe(0)
    expect(H.barFloor({ unit: 'kg' }, loaded.id, index)).toBe(0)
  })
  it('applyFailurePlan skips custom cardio but marks a custom loaded lift', () => {
    const rows = [{ w: 20, r: 8, done: false }]
    expect(H.applyFailurePlan(rows, { id: cardio.id, lastToFailure: true }, index)).toBe(rows)
    expect(H.applyFailurePlan(rows, { id: loaded.id, lastToFailure: true }, index)[0]).toHaveProperty('failure', true)
  })
  it('applyIntensifierPlan forwards the index to the failure-plan mode lookup', () => {
    const rows = [{ w: 20, r: 8, done: false }]
    expect(H.applyIntensifierPlan(rows, { id: cardio.id, lastToFailure: true }, {}, index)).toBe(rows)
    expect(H.applyIntensifierPlan(rows, { id: assisted.id, lastToFailure: true }, {}, index)[0]).toHaveProperty('failure', true)
  })
  it('workoutVolume forwards the index to per-bell volume accounting', () => {
    const e = { ...entry(loaded.id, [20]), target: { dbLoad: 'each' } }
    expect(H.workoutVolume({ entries: [e] }, index)).toBe(160)
    expect(H.workoutVolume({ entries: [e] })).toBe(320)
    expect(H.workoutVolume({ entries: [entry(assisted.id, [20])] }, index)).toBe(160)
  })
  it('metricEntriesForExercise forwards the index on its legacy topW-only fallback', () => {
    const lookup = vi.spyOn(Exercises, 'isAssisted')
    const e = { id: assisted.id, topW: 20, sets: [] }
    expect(H.metricEntriesForExercise({ entries: [e] }, assisted.id, index)).toEqual([{ entry: e, mode: 'reps', rows: [] }])
    expect(lookup).toHaveBeenCalledWith({ id: assisted.id }, index)
    expect(EXIDX[assisted.id]).toBeUndefined()
    expect(EXIDX[loaded.id]).toBeUndefined()
  })
})

// GM-approved AST checks supplement real custom-index outputs where forwarding is inert:
// isTimed/setsFromRows distinguish explicit time only; catalogue fallback is reps or cardio.
// exLine's time branch already has explicit time, and its reps branch excludes catalogue cardio.
// metricEntries' fallback has no completed work rows, so only the index-independent topW remains.
it('preserves forwarding on inert mode and legacy-metric edges', () => {
  const ast = parse(readFileSync(new URL('./history.ts', import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['typescript'] })
  type Node = { type?: string; id?: { name?: string }; callee?: { type?: string; name?: string }; arguments?: { type?: string; name?: string }[]; [key: string]: unknown }
  const edges = new Map([['isTimed:modeOf', 1], ['setsFromRows:modeOf', 1], ['exLine:setsRepsOf', 2], ['metricEntriesForExercise:bestWeightForEntry', 1]])
  const found = new Map<string, number>()
  function walk(value: unknown, owner = '', parent?: Node) {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(n => walk(n, owner, parent)); return }
    const n = value as Node
    if (n.type === 'FunctionDeclaration' || n.type === 'ArrowFunctionExpression') owner = n.id?.name ?? (parent?.type === 'VariableDeclarator' ? parent.id?.name : undefined) ?? owner
    const edge = owner + ':' + n.callee?.name
    if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && edges.has(edge)) {
      expect(n.arguments?.at(-1), edge).toMatchObject({ type: 'Identifier', name: 'index' })
      found.set(edge, (found.get(edge) ?? 0) + 1)
    }
    for (const [key, child] of Object.entries(n)) if (!['loc', 'comments'].includes(key)) walk(child, owner, n)
  }
  walk(ast)
  expect(found).toEqual(edges)
})
