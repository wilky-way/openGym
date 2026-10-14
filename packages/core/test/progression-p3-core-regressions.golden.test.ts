import { describe, expect, it } from 'vitest'
import { evaluate } from '../src/progression-engine'
import { createExerciseIndex } from '../src/exercises'
import { p3Input, p3Log, rpeRule, stallRule, rounding } from './fixtures/synthetic-p3'
import type { LinearRule } from '../../contract/domain/progression'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
const linear: LinearRule = { id: 'linear', kind: 'linear', increment: 5, unit: 'lb', every: { sessions: 1 }, success: 'all-sets-all-reps', rounding }
const loads = (x: ReturnType<typeof p3Input>, index?: ReturnType<typeof createExerciseIndex>) => evaluate(x, {}, index).weeks[0]!.slots[0]!.sets.map(s => s.load)

describe('adaptive handler goldens against corrected load replay semantics', () => {
  it('inert dbLoadFor index edge is forwarded in the AST (helper reads explicit mode only)', () => {
    const ast = parse(readFileSync(new URL('../src/progression-engine/adaptive-load.ts', import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['typescript'] })
    const calls: any[] = []
    const visit = (value: any): void => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(visit); return }
      if (value.type === 'CallExpression' && value.callee?.name === 'dbLoadFor') calls.push(value)
      Object.values(value).forEach(visit)
    }
    visit(ast); expect(calls).toHaveLength(1)
    expect(calls[0].arguments[2].object.name).toBe('context'); expect(calls[0].arguments[2].property.name).toBe('index')
  })
  it('RPE success/stall counts both pyramid working rows even when scalar sets says1', () => {
    const r = rpeRule(); r.weeks['*'] = [{ reps: 6, rir: 0 }, { reps: 6, rir: 0 }]
    const x = p3Input(r, [stallRule({ kind: 'reset', pct: 0.9 }, 'load', 1)])
    for (const w of (x.definition as any).weeks) { const s = w.days[0].sessions[0].routineSnapshot.ex[0]; s.pyramid = [6, 6]; s.sets = 1 }
    const log = p3Log(1, 100, 6); delete (log.entries[0]!.target as any).sets
    log.entries[0]!.sets.push({ done: true, w: 100, r: 5 }); x.logs = [log]
    expect(loads(x)).toEqual([90, 90])
  })
  it('custom two-bell total80 log becomes each40 for e1RM48 and inverted load40', () => {
    const x = p3Input(), d = x.definition as any
    for (const w of d.weeks) { const s = w.days[0].sessions[0].routineSnapshot.ex[0]; s.id = 'custom-bells'; s.dbLoad = 'each' }
    const log = p3Log(1, 80, 6); log.entries[0]!.id = 'custom-bells'; (log.entries[0]!.target as any).dbLoad = 'total'; x.logs = [log]
    const index = createExerciseIndex([{ id: 'custom-bells', eq: 'dumbbell', bp: 'chest' }])
    const out = evaluate(x, {}, index), s = out.weeks[0]!.slots[0]!.sets[0]!
    expect(s.why[0]!.inputs.e1rm).toBe(48); expect(s.load).toBe(40)
  })
  it('stall reset reads custom dumbbell total80 as each40 before .9 ->36', () => {
    const x = p3Input(linear, [stallRule({ kind: 'reset', pct: 0.9 }, 'load', 1)]), d = x.definition as any
    for (const w of d.weeks) { const s = w.days[0].sessions[0].routineSnapshot.ex[0]; s.id = 'custom-bells'; s.dbLoad = 'each' }
    const log = p3Log(1, 80, 5); log.entries[0]!.id = 'custom-bells'; (log.entries[0]!.target as any).dbLoad = 'total'; x.logs = [log]
    const index = createExerciseIndex([{ id: 'custom-bells', eq: 'dumbbell', bp: 'chest' }])
    expect(loads(x, index)).toEqual([36])
  })
  it('real custom single-arm index prevents halving RPE and reset loads', () => {
    const index = createExerciseIndex([{ id: 'custom-one-bell', n: 'Custom single arm press', eq: 'dumbbell', bp: 'chest' }])
    for (const [rule, others, reps, expected] of [[rpeRule(), [], 6, 80], [linear, [stallRule({ kind: 'reset', pct: 0.9 }, 'load', 1)], 5, 72]] as const) {
      const x = p3Input(rule, [...others]), d = x.definition as any
      for (const w of d.weeks) { const s = w.days[0].sessions[0].routineSnapshot.ex[0]; s.id = 'custom-one-bell'; s.dbLoad = 'each' }
      const log = p3Log(1, 80, reps); log.entries[0]!.id = 'custom-one-bell'; (log.entries[0]!.target as any).dbLoad = 'total'; x.logs = [log]
      // One bell: each and total are both80. RPE e1RM96/1.2=80; reset80*.9=72.
      expect(loads(x, index)).toEqual([expected]); expect(loads(x)).toEqual([expected / 2])
    }
  })
  it('linear AMRAP misses per-set floor5 despite scalar repsMin1; stall resets100*.9=90', () => {
    const x = p3Input(linear, [stallRule({ kind: 'reset', pct: 0.9 }, 'load', 1)])
    for (const w of (x.definition as any).weeks) { const s = w.days[0].sessions[0].routineSnapshot.ex[0]; s.pyramid = ['amrap']; s.repsMin = 1; s.setRepsMin = [5] }
    const log = p3Log(1, 100, 4); (log.entries[0]!.target as any).rowReps = ['amrap']; log.entries[0]!.target.repsMin = 1
    ;(log.entries[0]!.target as any).setRepsMin = [5]; x.logs = [log]
    expect(loads(x)).toEqual([90])
  })
})
