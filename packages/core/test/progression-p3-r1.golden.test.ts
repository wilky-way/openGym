import { describe, expect, it } from 'vitest'
import { evaluate } from '../src/progression-engine'
import { bestSetOf } from '../src/onerm'
import { createExerciseIndex } from '../src/exercises'
import { p3Input, p3Log, rpeRule, percentage, bumpRule, stallRule, rounding } from './fixtures/synthetic-p3'
import type { LinearRule } from '../../contract/domain/progression'

const first = (out: ReturnType<typeof evaluate>) => out.weeks[0]!.slots[0]!.sets[0]!
const linear = (): LinearRule => ({ id: 'linear', kind: 'linear', increment: 5, unit: 'lb', every: { sessions: 1 }, success: 'all-sets-all-reps', rounding })

describe('P3 fix-round independent hand goldens', () => {
  it('100x6 per limb estimates120, not parent100x12=140; target6/RIR2 rounds to95', () => {
    const rule = rpeRule(); rule.weeks['*'] = [{ reps: 6, rir: 2 }]
    const x = p3Input(rule), log = p3Log(1, 100, 12, { sides: { L: { w: 100, r: 6, done: true }, R: { w: 100, r: 6, done: true } } })
    const index = createExerciseIndex([{ id: 'custom-one-bell', n: 'Custom single arm press', eq: 'dumbbell', bp: 'chest' }])
    for (const w of (x.definition as any).weeks) w.days[0].sessions[0].routineSnapshot.ex[0].id = 'custom-one-bell'
    log.entries[0]!.id = 'custom-one-bell'; (log.entries[0]!.target as any).side = true
    x.logs = [log]
    const set = first(evaluate(x, undefined, index))
    expect(bestSetOf(log.entries[0], 'epley', index)!.est).toBe(120)
    expect(set.why[0]!.inputs.e1rm).toBe(120)
    expect(set.load).toBe(95) // 120 / (1+8/30) = 94.7368
    expect(set.why[0]!.inputs.source0Reps).toBe(6)
    expect(set.why[0]!.inputs.source0Side).toBe('L')
    expect(set.why[0]!.inputs.source1Side).toBe('R')
  })
  it('asymmetric limbs never combine max weight with summed reps, and partial rows keep completed limbs', () => {
    const x = p3Input(), log = p3Log(1, 100, 16, { sides: { L: { w: 100, r: 6, done: true }, R: { w: 80, r: 10, done: true } } })
    x.logs = [log]
    expect(first(evaluate(x)).why[0]!.inputs.e1rm).toBe(120)
    expect(first(evaluate(x)).load).toBe(100)
    log.entries[0]!.sets[0]!.done = false
    const sides = (log.entries[0]!.sets[0]! as any).sides
    sides.R = { w: 1000, r: 1, done: false }
    expect(bestSetOf(log.entries[0])!.est).toBe(120)
    expect(first(evaluate(x)).load).toBe(100)
    sides.L.done = false
    expect(first(evaluate(x)).load).toBeNull()
  })
  for (const pick of ['best', 'latest', 'median'] as const) it(`${pick} picks individual limb estimates120 and180`, () => {
    const rule = rpeRule(); rule.e1rm.pick = pick
    const x = p3Input(rule)
    x.logs = [p3Log(1, 150, 12, { sides: { L: { w: 100, r: 6, done: true }, R: { w: 150, r: 6, done: true } } })]
    expect(first(evaluate(x)).why[0]!.inputs.e1rm).toBe(pick === 'median' ? 150 : 180)
    expect(first(evaluate(x)).load).toBe(pick === 'median' ? 125 : 150)
  })
  for (const after of [1, 2]) it(`duplicate workout identity adds no stall failure with after=${after}`, () => {
    const x = p3Input(percentage(), [stallRule({ kind: 'reset', pct: 0.9 }, 'tm', after)])
    const log = p3Log(1, 200, 4); x.logs = [log]
    const once = evaluate(x); x.logs.push(structuredClone(log))
    expect(evaluate(x)).toEqual(once)
    expect(evaluate(x).tm.bench!.map(p => p.value)).toEqual(after === 1 ? [200, 180] : [200])
    // Distinct workout id still counts, even if it names the same occurrence.
    x.logs.push({ ...structuredClone(log), id: 'distinct-workout', start: 99 })
    expect(evaluate(x).tm.bench!.map(p => p.value)).toEqual(after === 1 ? [200, 180, 162] : [200, 180])
    expect(first(evaluate(x)).load).toBe(after === 1 ? 162 : 180)
  })
  for (const date of ['malformed', '2026-02-30']) it(`${date} is excluded before RPE day-window, AMRAP and stall arithmetic`, () => {
    const rule = rpeRule(); rule.e1rm.window = { days: 180 }
    for (const x of [p3Input(rule), p3Input(percentage(), [bumpRule(), stallRule({ kind: 'deload', setsFactor: 0.5, loadFactor: 0.8, weeks: 1 }, 'tm', 1)]), p3Input(linear(), [stallRule({ kind: 'reset', pct: 0.9 }, 'load', 1)])]) {
      const clean = evaluate(x); x.logs = [p3Log(1, 200, 4, {}, date)]
      const out = evaluate(x)
      expect(out.weeks).toEqual(clean.weeks)
      expect(out.tm).toEqual(clean.tm)
      expect(out.warnings.map(w => w.code)).toContain('log.date-invalid')
    }
  })
  for (const effort of [{ rpe: -1 }, { rpe: 0 }, { rpe: 11 }, { rir: -1 }, { rir: 11 }, { rpe: Infinity }, { rir: NaN }]) it(`invalid effort ${JSON.stringify(effort)} is missing for weighted prescriptions and stall success`, () => {
    const rule = rpeRule(); rule.e1rm.formula = 'weighted'; rule.weeks['*'] = [{ reps: 2, rir: 4 }]
    const x = p3Input(rule, [stallRule({ kind: 'reset', pct: 0.9 }, 'tm', 1)])
    x.logs = [p3Log(1, 100, 2)]
    const clean = evaluate(x)
    expect(first(clean).load).toBe(89) // weighted100x2=105.8; target effective reps=6.
    x.logs = [p3Log(1, 100, 2, effort)]
    const before = JSON.stringify(x), out = evaluate(x)
    expect(out.weeks).toEqual(clean.weeks)
    expect(out.tm.bench!.map(p => p.value)).toEqual([200])
    expect(first(out).why[0]!.inputs.source0Rir).toBeNull()
    expect(out.warnings.map(w => w.code)).toContain('log.effort-invalid')
    expect(JSON.stringify(x)).toBe(before)
  })
  it('limb effort is read per limb, and invalid limb effort warns without inflating the target', () => {
    const rule = rpeRule(); rule.e1rm.formula = 'weighted'; rule.weeks['*'] = [{ reps: 2, rir: 4 }]
    const x = p3Input(rule)
    x.logs = [p3Log(1, 100, 4, { sides: { L: { w: 100, r: 2, done: true, rpe: -1 }, R: { w: 100, r: 2, done: false, rir: 10 } } })]
    const out = evaluate(x)
    expect(first(out).load).toBe(89)
    expect(first(out).why[0]!.inputs.estimates).toBe(1)
    expect(out.warnings.map(w => w.code)).toContain('log.effort-invalid')
  })
  it('valid logged effort includes RPE1/10 and RIR0/10 boundaries', () => {
    const rule = rpeRule(); rule.e1rm.formula = 'weighted'
    const x = p3Input(rule)
    for (const [effort, rir] of [[{ rpe: 1 }, 9], [{ rpe: 10 }, 0], [{ rir: 0 }, 0], [{ rir: 10 }, 10]] as const) {
      x.logs = [p3Log(1, 100, 1, effort)]
      const out = evaluate(x)
      expect(first(out).why[0]!.inputs.source0Rir).toBe(rir)
      expect(out.warnings).toEqual([])
    }
  })
  it('assisted stall reset reflects ordinary100*.9=90 to110 assistance, exactly once', () => {
    const x = p3Input(linear(), [stallRule({ kind: 'reset', pct: 0.9 }, 'load', 1)])
    for (const w of (x.definition as any).weeks) w.days[0].sessions[0].routineSnapshot.ex[0].id = 'custom-assist'
    const log = p3Log(1, 100, 5); log.entries[0]!.id = 'custom-assist'; x.logs = [log]
    const index = createExerciseIndex([{ id: 'custom-assist', eq: 'leverage machine', assisted: true }])
    const out = evaluate(x, undefined, index)
    expect(first(out).load).toBe(110)
    expect(first(out).why.some(w => w.inputs.assisted === true && w.inputs.loadBefore === 100 && w.inputs.loadAfter === 110)).toBe(true)
    expect(first(evaluate(x)).load).toBe(90) // Index deletion changes real output.
    expect(out.warnings).toEqual([])
  })
  for (const sides of [false, true]) it(`core numeric-string estimator inputs survive for ${sides ? 'limbs' : 'scalar rows'}`, () => {
    const x = p3Input(), log = p3Log(1, 100, 6)
    const row = log.entries[0]!.sets[0]! as any
    if (sides) row.sides = { L: { w: '100', r: '6', done: true }, R: { w: '80', r: '6', done: true } }
    else { row.w = '100'; row.r = '6' }
    x.logs = [log]
    expect(bestSetOf(log.entries[0])!.est).toBe(120)
    expect(first(evaluate(x)).why[0]!.inputs.e1rm).toBe(120)
    expect(first(evaluate(x)).load).toBe(100)
  })
  for (const source of ['row', 'target', 'limbs'] as const) it(`explicit time mode in ${source} is not rep-mode e1RM evidence`, () => {
    const x = p3Input(), log = p3Log(1, 100, 6)
    if (source === 'target') (log.entries[0]!.target as any).mode = 'time'
    else (log.entries[0]!.sets[0]! as any).mode = 'time'
    if (source === 'limbs') (log.entries[0]!.sets[0]! as any).sides = { L: { w: 100, r: 6, done: true }, R: { w: 100, r: 6, done: true } }
    x.logs = [log]
    expect(bestSetOf(log.entries[0])).toBeNull()
    expect(first(evaluate(x)).load).toBeNull()
    expect(first(evaluate(x)).why[0]!.inputs.estimates).toBe(0)
  })
  for (const action of [{ kind: 'repeat' }, { kind: 'reset', pct: 0.9 }] as const) it(`assisted ${action.kind} after success then incomplete workout anchors to actual100`, () => {
    const x = p3Input(linear(), [stallRule(action, 'load', 1)])
    for (const w of (x.definition as any).weeks) w.days[0].sessions[0].routineSnapshot.ex[0].id = 'custom-assist'
    const success = p3Log(1, 100, 6), incomplete = p3Log(2, 95, 5, { done: false })
    success.entries[0]!.id = incomplete.entries[0]!.id = 'custom-assist'; x.logs = [success, incomplete]
    const index = createExerciseIndex([{ id: 'custom-assist', eq: 'leverage machine', assisted: true }])
    // Progressed baseline95 differs from actual100: repeat retains100,
    // reset.9 reflects the actual-based reduction10 to assistance110.
    const out = evaluate(x, undefined, index)
    expect(first(out).load).toBe(action.kind === 'repeat' ? 100 : 110)
    expect(first(evaluate(x)).load).toBe(action.kind === 'repeat' ? 100 : 90)
    expect(out.warnings).toEqual([])
  })
  for (const action of [{ kind: 'repeat' }, { kind: 'reset', pct: 0.9 }] as const) it(`assisted ${action.kind} honors both later actual zero assistance and zero trigger`, () => {
    const x = p3Input(linear(), [stallRule(action, 'load', 1)])
    for (const w of (x.definition as any).weeks) w.days[0].sessions[0].routineSnapshot.ex[0].id = 'custom-assist'
    const failure = p3Log(1, 100, 5), zero = p3Log(2, 0, 6)
    failure.entries[0]!.id = zero.entries[0]!.id = 'custom-assist'
    const index = createExerciseIndex([{ id: 'custom-assist', eq: 'leverage machine', assisted: true }])
    x.logs = [failure, zero]
    expect(first(evaluate(x, undefined, index)).load).toBe(0)
    zero.entries[0]!.sets[0]!.r = 5 // Failure at zero must also remain at zero.
    expect(first(evaluate(x, undefined, index)).load).toBe(0)
    const singleFailure = p3Log(1, 0, 5); singleFailure.entries[0]!.id = 'custom-assist'; x.logs = [singleFailure]
    expect(first(evaluate(x, undefined, index)).load).toBe(0)
  })
})
