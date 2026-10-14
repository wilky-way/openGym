import { describe, it, expect } from 'vitest'
import { evaluate, exposureSuccess, authoredSlots, replayExposures } from '../src/progression-engine'
import { estimate1RM, FORMULAS } from '../src/onerm'
import { createExerciseIndex } from '../src/exercises'
import { p3Input, p3Log, rpeRule } from './fixtures/synthetic-p3'
const sets = (x: ReturnType<typeof p3Input>, index?: ReturnType<typeof createExerciseIndex>) => evaluate(x, {}, index).weeks[0]!.slots[0]!.sets
const estimate = (x: ReturnType<typeof p3Input>) => sets(x)[0]!.why[0]!.inputs.e1rm

describe('hand-computed RPE load goldens', () => {
  it('Epley: 100x6=120 e1RM; six reps at RIR2 invert 1+8/30 to 94.7368 ->95', () => {
    const r = rpeRule(); r.weeks['*']![0]!.rir = 2
    const x = p3Input(r); x.logs = [p3Log(1, 100, 6, { rir: 4 })]
    expect(estimate(x)).toBe(120); expect(sets(x)[0]!.load).toBe(95); expect(sets(x)[0]!.target).toEqual({ rir: 2 })
    x.profile.effortScale = 'rpe'; expect(sets(x)[0]!.target).toEqual({ rpe: 8 })
    expect(sets(x)[0]!.why[0]!.inputs.multiplier).toBeCloseTo(19 / 15, 12)
  })
  it('Brzycki: 100x7=120; target 5+RIR2 has multiplier36/30 and load100', () => {
    const r = rpeRule(); r.e1rm.formula = 'brzycki'; r.weeks['*'] = [{ reps: 5, rpe: 8 }]
    const x = p3Input(r); x.logs = [p3Log(1, 100, 7)]
    expect(estimate(x)).toBe(120); expect(sets(x)[0]!.load).toBe(100)
  })
  it('Lombardi: 100x10=125.9; target5+RIR5 inverts 10^.1 ->100', () => {
    const r = rpeRule(); r.e1rm.formula = 'lombardi'; r.weeks['*'] = [{ reps: 5, rir: 5 }]
    const x = p3Input(r); x.logs = [p3Log(1, 100, 10)]
    expect(estimate(x)).toBe(125.9); expect(sets(x)[0]!.load).toBe(100)
  })
  for (const formula of [...Object.keys(FORMULAS), 'weighted']) it(`exact core estimate parity for ${formula}, including logged effort`, () => {
    const r = rpeRule(); r.e1rm.formula = formula
    const x = p3Input(r); x.logs = [p3Log(1, 100, 6, { rpe: 8 })]
    expect(estimate(x)).toBe(estimate1RM(100, 6, formula, 2))
    r.e1rm.useLoggedEffort = false; expect(estimate(x)).toBe(estimate1RM(100, 6, formula, null))
  })
  it('profile formula and unknown profile setting follow core selection', () => {
    const r = rpeRule(); r.e1rm.formula = 'profile'; const x = p3Input(r); x.logs = [p3Log(1, 100, 7)]
    x.profile.oneRmFormula = 'brzycki'; expect(estimate(x)).toBe(120)
    x.profile.oneRmFormula = 'constructor'; expect(estimate(x)).toBe(123.3)
  })
  it('session windows count workouts; best/latest/even median pick from 120,180,240,300', () => {
    const r = rpeRule(); r.e1rm.window = { sessions: 4 }; const x = p3Input(r)
    x.logs = [p3Log(1, 1000, 6), p3Log(2, 100, 6), p3Log(3, 150, 6), p3Log(4, 200, 6), p3Log(5, 250, 6)]
    expect(estimate(x)).toBe(300); r.e1rm.pick = 'latest'; expect(estimate(x)).toBe(300)
    r.e1rm.pick = 'median'; expect(estimate(x)).toBe(210); expect(sets(x)[0]!.load).toBe(175)
    r.e1rm.window = { sessions: 3 }; expect(estimate(x)).toBe(240)
    x.logs = [p3Log(5, 250, 6), p3Log(4, 200, 6), p3Log(3, 150, 6), p3Log(2, 100, 6), p3Log(1, 1000, 6)]
    expect(estimate(x)).toBe(240)
  })
  it('latest pick differs from best; windows include boundary day and exclude next-day/asOf logs', () => {
    const r = rpeRule(); r.e1rm.window = { days: 8 }; const x = p3Input(r); x.asOf = '2026-01-12'
    x.logs = [p3Log(1, 200, 6, {}, '2026-01-04'), p3Log(2, 150, 6, {}, '2026-01-05'), p3Log(3, 100, 6, {}, '2026-01-12'), p3Log(4, 300, 6, {}, '2026-01-13')]
    expect(estimate(x)).toBe(180); r.e1rm.pick = 'latest'; expect(estimate(x)).toBe(120)
    r.e1rm.window = { days: 7 }; expect(estimate(x)).toBe(120)
  })
  it('day windows are relative to the prescription cutoff, so ancient logs expire', () => {
    const r = rpeRule(); r.e1rm.window = { days: 7 }; const x = p3Input(r); x.logs = [p3Log(1, 100, 6)]
    expect(sets(x)[0]!.load).toBeNull()
    x.weeks = [2]; expect(sets(x)[0]!.load).toBeNull() // Jan5 is outside Jan6-Jan12.
    r.e1rm.window = { days: 8 }; expect(sets(x)[0]!.load).toBe(100)
  })
  it('later asOf leaves historical day-window prescriptions unchanged', () => {
    const r = rpeRule(); r.e1rm.window = { days: 8 }; const x = p3Input(r); x.weeks = [2]; x.logs = [p3Log(1, 100, 6)]
    x.asOf = '2026-01-12'; expect(sets(x)[0]!.load).toBe(100)
    x.asOf = '2026-02-23'; expect(sets(x)[0]!.load).toBe(100)
    x.logs.push(p3Log(3, 300, 6)); expect(sets(x)[0]!.load).toBe(100)
  })
  it('empty, skipped, warmup, undone and over-cap rows use explicit fallback; never invented estimates', () => {
    const r = rpeRule(), x = p3Input(r)
    expect(sets(x)[0]!.load).toBeNull(); expect(sets(x)[0]!.target).toEqual({ rir: 0 })
    x.logs = [p3Log(1, 999, 13), p3Log(2, 999, 6, { warmup: true }), p3Log(3, 999, 6, { done: false }), p3Log(4, 999, 6)]
    x.cycle!.occurrences[3]!.status = 'skipped'; expect(estimate(x)).toBeNull()
    r.whenNoData = { kind: 'percent-of-tm', pct: 0.75 }; expect(sets(x)[0]!.load).toBe(150)
    x.cycle!.tm = { bench: 900 }; delete x.cycle!.tmSeed
    ;(x.definition as any).tmSeeds = { bench: { fromE1rm: { pct: 0.9 } } }
    expect(sets(x)[0]!.load).toBeNull(); expect(evaluate(x).warnings.map(w => w.code)).toContain('tm.seed-unfrozen')
  })
  it('one-rep measurement and precise kg-to-lb conversion precede the only load rounding', () => {
    const r = rpeRule(); r.weeks['*'] = [{ reps: 1, rir: 0 }]; const x = p3Input(r), log = p3Log(1, 100, 1)
    log.unit = 'kg'; x.logs = [log]
    expect(estimate(x)).toBe(220.5); expect(sets(x)[0]!.load).toBe(221)
  })
  it('formula inversion outside its representable range is explicit, finite and target-only', () => {
    const r = rpeRule(); r.e1rm.formula = 'brzycki'; r.weeks['*'] = [{ reps: 35, rir: 2 }]
    const x = p3Input(r); x.logs = [p3Log(1, 100, 7)]
    expect(sets(x)[0]!.load).toBeNull(); expect(sets(x)[0]!.why[0]!.inputs.multiplier).toBeNull()
    expect(evaluate(x).warnings.map(w => w.code)).toContain('e1rm.inversion-unavailable')
    expect(JSON.stringify(evaluate(x))).not.toContain('Infinity')
  })
  it('Why records exact estimator source loads, units, reps, effort and date', () => {
    const r = rpeRule(), x = p3Input(r); x.logs = [p3Log(1, 100, 6, { rpe: 8 })]
    const inputs = sets(x)[0]!.why[0]!.inputs
    expect(inputs.source0Load).toBe(100); expect(inputs.source0Unit).toBe('lb'); expect(inputs.source0Reps).toBe(6)
    expect(inputs.source0Rir).toBe(2); expect(inputs.source0Date).toBe('2026-01-05'); expect(inputs.source0Estimate).toBe(120)
  })
  it('real custom assisted exercise excludes e1RM; deleting the index argument changes output', () => {
    const r = rpeRule(), x = p3Input(r), d = x.definition as any
    const log = p3Log(1); log.entries[0]!.id = 'custom-assist'; x.logs = [log]
    x.liftExercises = { bench: ['custom-assist'] }
    const index = createExerciseIndex([{ id: 'custom-assist', eq: 'leverage machine', assisted: true }])
    expect(sets(x, index)[0]!.load).toBeNull(); expect(sets(x)[0]!.load).toBe(100)
    for (const w of d.weeks) w.days[0].sessions[0].routineSnapshot.ex[0].id = 'custom-assist'
    expect(evaluate(x, {}, index).slotErrors?.[0]?.code).toBe('UNSUPPORTED_ASSISTED')
  })
  it('effort failure uses inclusive target±1, missing effort uses reps, incomplete sets fail', () => {
    const r = rpeRule(); r.weeks['*'] = [{ reps: 6, rpe: 8 }]; const x = p3Input(r)
    const success = (extra: Record<string, unknown>, reps = 6) => { x.logs = [p3Log(1, 100, reps, extra)]; const a = authoredSlots(x.definition as never); return exposureSuccess(r, replayExposures(x, a)[0]!, a[0]!) }
    expect(success({ rpe: 9 })).toBe(true); expect(success({ rpe: 9.1 })).toBe(false)
    expect(success({ rir: 1 })).toBe(true); expect(success({ rir: 0.9 })).toBe(false)
    expect(success({})).toBe(true); expect(success({}, 5)).toBe(false); expect(success({ done: false })).toBe(false)
  })
})
