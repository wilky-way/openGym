import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createExerciseIndex, EXIDX } from '@opengym/core/exercises'
import { loadKindFor, baseWeightFor, dropGrid } from '../src/plates'
import { nextPrescription, readSession, weightIncrement, policyFor, plannedOf, planChanged, sessionsFor } from '../src/progression'
import type { Config, Entry, Profile } from '../src/progression'
import { programmeTMConfig } from '../src/programme-tm'
import { indexTrace } from './regression-index-trace'
import calls from './regression-index-calls.json'

// Real catalogue, set-kind and history functions; no predicate or increment stubs.
const index = createExerciseIndex([
  { id: 'customBar', eq: 'barbell', bp: 'back' },
  { id: 'customAssist', eq: 'leverage machine', assisted: true },
  { id: 'customBells', eq: 'dumbbell', bp: 'back' },
  { id: 'customBody', eq: 'body weight' },
  { id: 'customCardio', bp: 'cardio', eq: 'body weight' },
])
const cfg: Config = { id: 'customAssist', sets: 2, reps: 5, weight: 100, inc: 2.5 }
const entry: Entry = { id: cfg.id, target: cfg, sets: [{ w: 100, r: 5, done: true }, { w: 90, r: 5, done: true }] }
const state = (entries: Entry[]): Profile => ({ workouts: entries.map((entry, n) => ({ d: `2026-01-0${n + 1}`, entries: [entry] })) })
const zero = (id: string, planned?: Config): Entry => ({ id, target: { id, sets: 1, reps: 5 }, ...(planned ? { planned } : {}), sets: [{ w: 0, r: 5, done: true }] })
const bells: Profile = { unit: 'kg', dumbbells: { kg: { weights: [10, 15, 21] } } }
const plateState: Profile = { unit: 'kg', plates: { kg: { 5: 3 } } }
const resolvedDrop = (S: Profile, cfg: Config, weight: number) => {
  const grid = dropGrid(S, cfg, index)
  return typeof grid === 'function' ? grid(weight) : grid
}
const tmCfg = (id: string, percentage: number): Config => ({ id, pyramid: [5], tm: { key: 'lift', percentages: [percentage] } })
const tmState: Profile = { unit: 'kg', programmes: { cycles: [{ id: 'c', tm: { lift: 100 } }] } }
const routine = { programme: { cycleId: 'c' } }

beforeEach(() => { indexTrace.enabled = true; indexTrace.calls = [] })
afterEach(() => { indexTrace.enabled = false; indexTrace.calls = [] })

// Each row runs a real custom-exercise scenario and checks its result. Call
// observations also cover redundant forwarding/short-circuit paths, without
// altering the helpers. Every invocation is checked, rather than only the last.
const scenarios = {
  increment: () => ({ actual: weightIncrement({ id: 'customBar' }, 'kg', index), expected: 5 }),
  policy: () => ({ actual: policyFor({ id: 'customCardio' }, undefined, undefined, index), expected: 'off' }),
  planned: () => ({ actual: plannedOf({ id: 'customCardio', sets: 2, reps: 5 }, index), expected: { sets: 2 } }),
  changed: () => ({ actual: planChanged({ sets: 2 }, { id: 'customCardio', sets: 2, reps: 5 }, index), expected: false }),
  assistedRead: () => {
    const s = readSession(entry, undefined, index)
    return { actual: { mode: s.mode, weight: s.weight, ok: s.ok, reps: s.reps }, expected: { mode: 'reps', weight: 90, ok: true, reps: [5, 5] } }
  },
  timedRead: () => {
    const s = readSession({ id: 'customAssist', target: { mode: 'time', sets: 2, sec: 30 }, sets: [{ w: 100, sec: 30, done: true }, { w: 90, sec: 35, done: true }] }, undefined, index)
    return { actual: { mode: s.mode, weight: s.weight, ok: s.ok, held: s.held }, expected: { mode: 'time', weight: 90, ok: true, held: [30, 35] } }
  },
  ownHistory: () => {
    const own = { ...entry, rid: 'own' }
    const other = { ...entry, rid: 'other', sets: [{ w: 10, r: 5, done: true }, { w: 5, r: 5, done: true }] }
    const sessions = sessionsFor(state([own, other]), cfg.id, cfg, 'own', index)
    return { actual: sessions.map(s => ({ rid: s.rid, weight: s.weight, ok: s.ok })), expected: [{ rid: 'own', weight: 90, ok: true }] }
  },
  borrowedHistory: () => {
    const sessions = sessionsFor(state([{ ...entry, rid: 'other' }]), cfg.id, cfg, 'new', index)
    return { actual: sessions.map(s => ({ rid: s.rid, weight: s.weight, ok: s.ok })), expected: [{ rid: 'other', weight: 90, ok: true }] }
  },
  assistedNext: () => {
    const p = nextPrescription(state([entry]), cfg, undefined, index)
    return { actual: { kind: p.kind, weight: p.weight, policy: p.policy }, expected: { kind: 'up', weight: 87.5, policy: 'linear' } }
  },
  heavyNext: () => {
    const c = { id: 'customBar', sets: 1, reps: 5 }
    const p = nextPrescription(state([{ id: c.id, target: c, sets: [{ w: 100, r: 5, done: true }] }]), c, undefined, index)
    return { actual: { kind: p.kind, weight: p.weight }, expected: { kind: 'up', weight: 105 } }
  },
  cardioNext: () => ({ actual: nextPrescription({}, { id: 'customCardio', reps: 5 }, undefined, index), expected: { policy: 'off', kind: 'off' } }),
  ownedNext: () => {
    const c = { id: 'customBells', sets: 1, reps: 5 }
    const p = nextPrescription({ ...bells, ...state([{ id: c.id, target: c, sets: [{ w: 15, r: 5, done: true }] }]) }, c, undefined, index)
    return { actual: { kind: p.kind, weight: p.weight }, expected: { kind: 'up', weight: 21 } }
  },
  zeroLoaded: () => {
    const p = nextPrescription(state([zero('customBar')]), { id: 'customBar', sets: 1, reps: 5 }, undefined, index)
    return { actual: { kind: p.kind, weight: p.weight, reps: p.reps }, expected: { kind: 'hold', weight: undefined, reps: undefined } }
  },
  zeroAssisted: () => {
    const p = nextPrescription(state([zero('customAssist')]), { id: 'customAssist', sets: 1, reps: 5 }, undefined, index)
    return { actual: { kind: p.kind, weight: p.weight, reps: p.reps }, expected: { kind: 'up', weight: 0, reps: 6 } }
  },
  editedZero: () => {
    const p = nextPrescription(state([zero('customBar', { sets: 1, reps: 5 })]), { id: 'customBar', sets: 1, reps: 10 }, undefined, index)
    return { actual: { kind: p.kind, weight: p.weight, reps: p.reps, why: p.why }, expected: { kind: 'hold', weight: undefined, reps: 10, why: ['Plan changed, so starting from your new target.'] } }
  },
  bodyDeload: () => {
    const c = { id: 'customBody', sets: 1, reps: 5, weight: 100 }
    const e = { id: c.id, target: c, sets: [{ w: 100, r: 3, done: true }] }
    const p = nextPrescription(state([e, e, e]), c, undefined, index)
    return { actual: { kind: p.kind, weight: p.weight, reps: p.reps, target1RM: p.target1RM }, expected: { kind: 'deload', weight: 90, reps: undefined, target1RM: undefined } }
  },
  barKind: () => ({ actual: loadKindFor({}, 'customBar', index), expected: 'pairs' }),
  bodyKind: () => ({ actual: loadKindFor({}, 'customBody', index), expected: 'single' }),
  base: () => ({ actual: baseWeightFor({ unit: 'kg' }, 'customBar', index), expected: 20 }),
  plateDrop: () => ({ actual: resolvedDrop(plateState, { id: 'customBar' }, 48.74), expected: 40 }),
  ownedDrop: () => ({ actual: resolvedDrop(bells, { id: 'customBells' }, 16.8), expected: 15 }),
  incrementDrop: () => ({ actual: resolvedDrop({}, { id: 'customBar' }, 48.74), expected: 5 }),
  ownedTM: () => ({ actual: programmeTMConfig({ ...tmState, ...bells }, tmCfg('customBells', 20), routine, index).pyramidWeight, expected: [15] }),
  heavyTM: () => ({ actual: programmeTMConfig(tmState, tmCfg('customBar', 83), routine, index).pyramidWeight, expected: [85] }),
} satisfies Record<string, () => { actual: unknown; expected: unknown }>

type Scenario = keyof typeof scenarios
const regression: Scenario[] = [
  'increment', 'policy', 'planned', 'zeroLoaded', 'zeroLoaded', 'zeroAssisted', 'changed',
  'assistedRead', 'timedRead', 'timedRead', 'assistedRead', 'ownHistory', 'borrowedHistory',
  'ownHistory', 'cardioNext', 'cardioNext', 'heavyNext', 'assistedNext', 'ownedNext',
  'assistedNext', 'editedZero', 'editedZero', 'zeroLoaded', 'bodyDeload',
  'barKind', 'barKind', 'bodyKind', 'base', 'ownedDrop', 'plateDrop', 'plateDrop',
  'incrementDrop', 'ownedTM', 'heavyTM',
]

describe('real custom-index forwarding regressions', () => {
  it.each(calls.map((row, n) => ({ ...row, scenario: regression[n]! })))('$site — $scenario', ({ site, scenario }) => {
    const result = scenarios[scenario]()
    expect(result.actual).toEqual(result.expected)
    if (process.env.PROGRESSION_OUTPUT_ONLY !== '1') {
      const invoked = indexTrace.calls.filter(call => call.site === site)
      expect(invoked.length, `${site} must actually execute`).toBeGreaterThan(0)
      for (const call of invoked) expect(call.args.at(-1), `${site} must forward this caller's index`).toBe(index)
    }
  })
  it('keeps the catalogue isolated and distinguishes custom equipment from missing ids', () => {
    expect(EXIDX.customBar).toBeUndefined()
    expect(loadKindFor({}, 'customBar')).toBe('none')
    expect(weightIncrement({ id: 'customBar' }, 'kg')).toBe(2.5)
    expect(loadKindFor({}, 'customBody')).toBe('none')
    expect(dropGrid(bells, { id: 'customBells' })).toBe(2.5)
    expect(calls).toHaveLength(34)
    expect(regression).toHaveLength(calls.length)
  })
})


it('readSession derives custom cardio mode from the real caller index', () => {
  const cardio: Entry = { id: 'customCardio', sets: [{ min: 30, speed: 8, done: true }] }
  expect(readSession(cardio, undefined, index).mode).toBe('cardio')
  expect(readSession(cardio).mode).toBe('reps')
})

// Compatibility inert edges: nextPrescription supplies its resolved mode to policyFor.
// loadKindFor hands usesBar the resolved exercise object, so usesBar needs no lookup.
it('preserves the two provably inert progression index forwards', () => {
  const edges = new Map([
    ['progression.ts:nextPrescription:policyFor', 1],
    ['plates.ts:loadKindFor:usesBar', 1],
  ])
  const found = new Map<string, number>()
  type Node = { type?: string; id?: { name?: string }; callee?: { type?: string; name?: string }; arguments?: { type?: string; name?: string }[]; [key: string]: unknown }
  for (const file of ['progression.ts', 'plates.ts']) {
    const ast = parse(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['typescript'] })
    function walk(value: unknown, owner = '', parent?: Node) {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(n => walk(n, owner, parent)); return }
      const n = value as Node
      if (n.type === 'FunctionDeclaration' || n.type === 'ArrowFunctionExpression') owner = n.id?.name ?? (parent?.type === 'VariableDeclarator' ? parent.id?.name : undefined) ?? owner
      const edge = file + ':' + owner + ':' + n.callee?.name
      if (n.type === 'CallExpression' && n.callee?.type === 'Identifier' && edges.has(edge)) {
        expect(n.arguments?.at(-1), edge).toMatchObject({ type: 'Identifier', name: 'index' })
        found.set(edge, (found.get(edge) ?? 0) + 1)
      }
      for (const [key, child] of Object.entries(n)) if (!['loc', 'comments'].includes(key)) walk(child, owner, n)
    }
    walk(ast)
  }
  expect(found).toEqual(edges)
})


it('custom loaded shadows of catalogue bodyweight stay on load progression', () => {
  const shadow = createExerciseIndex([{ id: '1049', eq: 'barbell', bp: 'back' }])
  const cfg: Config = { id: '1049', sets: 1, reps: 5 }
  const s = state([{ id: cfg.id, target: cfg, sets: [{ w: 0, r: 5, done: true }] }])
  const next = nextPrescription(s, cfg, undefined, shadow)
  expect({ kind: next.kind, weight: next.weight, reps: next.reps }).toEqual({ kind: 'hold', weight: undefined, reps: undefined })
})

it('custom loaded shadows of catalogue cardio preserve their saved reps plan', () => {
  const shadow = createExerciseIndex([{ id: '1160', eq: 'barbell', bp: 'back' }])
  const cfg: Config = { id: '1160', sets: 1, reps: 5 }
  const s = state([{ id: cfg.id, target: cfg, planned: { sets: 1, reps: 5 }, sets: [{ w: 40, r: 5, done: true }] }])
  const next = nextPrescription(s, cfg, undefined, shadow)
  expect({ kind: next.kind, weight: next.weight }).toEqual({ kind: 'up', weight: 45 })
})
