import { describe, expect, it } from 'vitest'
import { evaluate, tmAt } from '../src/progression-engine'
import { p3Input, p3Log, percentage, stallRule, bumpRule, rpeRule, rounding } from './fixtures/synthetic-p3'
import type { LinearRule } from '../../contract/domain/progression'
const linear = (): LinearRule => ({ id: 'linear', kind: 'linear', increment: 5, unit: 'lb', every: { sessions: 1 }, success: 'all-sets-all-reps', rounding })
const load = (x: ReturnType<typeof p3Input>, week: number) => { x.weeks = [week]; return evaluate(x).weeks[0]!.slots[0]!.sets.map(s => s.load) }

describe('AMRAP hand-computed band and boundary goldens', () => {
  it('composition failures produce no guessed prescriptions or timeline changes', () => {
    const bump = bumpRule(), duplicate = structuredClone(bump); duplicate.id = 'second-bump'
    const multiple = evaluate(p3Input(percentage(), [bump, duplicate]))
    expect(multiple.error?.code).toBe('INVALID_RULES'); expect(multiple.warnings.map(w => w.code)).toContain('rule.multiple-amrap-bumps'); expect(multiple.weeks).toEqual([])
    const fixed = evaluate(p3Input(rpeRule(), [bumpRule()]))
    expect(fixed.error?.code).toBe('INVALID_RULES'); expect(fixed.warnings.map(w => w.code)).toContain('rule.amrap-source-not-amrap')
    const noKey = p3Input(percentage(), [stallRule({ kind: 'reset', pct: 0.9 }, 'tm')])
    for (const w of (noKey.definition as any).weeks) delete w.days[0].sessions[0].routineSnapshot.ex[0].tm
    const out = evaluate(noKey)
    expect(out.error?.code).toBe('INVALID_RULES'); expect(out.tm).toEqual({}); expect(out.warnings.map(w => w.code)).toContain('rule.tm-stall-without-key')
  })
  // Minimum5: below0 has no band; over0/1 earns0; over2/4 earns5; over5 earns10.
  for (const [reps, expected] of [[4, 200], [5, 200], [6, 200], [7, 205], [9, 205], [10, 210]] as const) it(`minimum5, actual${reps} -> TM${expected}`, () => {
    const x = p3Input(percentage(), [bumpRule()]); x.logs = [p3Log(1, 200, reps)]
    expect(load(x, 1)).toEqual([200]); expect(load(x, 2)).toEqual([expected])
    const timeline = evaluate(x).tm.bench!; expect(timeline.at(-1)!.value).toBe(expected)
    if (reps >= 5) expect(timeline.at(-1)!.at).toBe('2026-01-12')
  })
  it('shifted source after calendar boundary cannot bump until day after exposure', () => {
    const x = p3Input(percentage(), [bumpRule()]); x.logs = [p3Log(1, 200, 10, {}, '2026-01-14')]
    const out = evaluate(x); expect(out.tm.bench!.at(-1)!.at).toBe('2026-01-15')
    expect(load(x, 2)).toEqual([200]); expect(load(x, 3)).toEqual([210])
    expect(tmAt(out.tm, 'bench', '2026-01-14')).toBe(200); expect(tmAt(out.tm, 'bench', '2026-01-15')).toBe(210)
  })
  it('percentage AMRAP without repsMin uses core minimum1, overriding authored minimum5', () => {
    const wave = percentage(); delete wave.weeks['1']![0]!.repsMin
    const x = p3Input(wave, [bumpRule()]); x.logs = [p3Log(1, 200, 3)]
    expect(load(x, 2)).toEqual([205]); expect(evaluate(x).tm.bench!.at(-1)!.why.inputs.minimum).toBe(1)
  })
  it('lap boundary is after the final authored week, or after a later shifted result', () => {
    const bump = bumpRule(); bump.at = 'end-of-cycle-lap'
    const x = p3Input(percentage(3), [bump], 3); x.logs = [p3Log(1, 200, 10)]
    expect(evaluate(x).tm.bench!.at(-1)!.at).toBe('2026-01-26'); expect(load(x, 3)).toEqual([200])
    x.logs = [p3Log(1, 200, 10, {}, '2026-02-01')]
    expect(evaluate(x).tm.bench!.at(-1)!.at).toBe('2026-02-02')
  })
  it('one occurrence earns one bump; cache changes, replay reorder and repeated previews cannot accumulate', () => {
    const x = p3Input(percentage(), [bumpRule()]); x.logs = [p3Log(1, 200, 10), p3Log(1, 200, 10)]
    const before = JSON.stringify(evaluate(x)); expect(evaluate(x).tm.bench!.at(-1)!.value).toBe(210)
    x.cycle!.tm = { bench: 1000 }; expect(JSON.stringify(evaluate(x))).toBe(before)
    x.logs.reverse(); expect(JSON.stringify(evaluate(x))).toBe(before)
    expect(evaluate(x)).toEqual(evaluate(x))
  })
  it('skipped source is not AMRAP evidence; a missing frozen TM cannot be regenerated', () => {
    const x = p3Input(percentage(), [bumpRule()]); x.logs = [p3Log(1, 200, 10)]
    x.cycle!.occurrences[0]!.status = 'skipped'; expect(evaluate(x).tm.bench!.length).toBe(1)
    delete x.cycle!.tmSeed; (x.definition as any).tmSeeds = { bench: { fromE1rm: { pct: 0.9 } } }; x.cycle!.tm = { bench: 800 }; expect(evaluate(x).tm).toEqual({})
    expect(evaluate(x).warnings.map(w => w.code)).toContain('tm.seed-unfrozen'); expect(load(x, 2)).toEqual([null])
  })
})

describe('stall hand-computed failure-count and load goldens', () => {
  it('skipped occurrence neither counts nor resets; shifted second failure resets latest actual150*.9=135', () => {
    const x = p3Input(linear(), [stallRule({ kind: 'reset', pct: 0.9 })])
    x.logs = [p3Log(1, 100, 5), p3Log(2, 900, 5), p3Log(3, 150, 5, {}, '2026-01-22')]
    x.cycle!.occurrences[1]!.status = 'skipped'
    expect(load(x, 2)).toEqual([100]); expect(load(x, 3)).toEqual([100]); expect(load(x, 4)).toEqual([135])
    expect(evaluate(x).weeks[0]!.slots[0]!.sets[0]!.why.some(w => w.kind === 'stall' && w.inputs.failures === 2)).toBe(true)
  })
  it('counter resets on action and success: failures1,2 ->180; failure3 stays200; failure4 ->180', () => {
    const x = p3Input(percentage(), [stallRule({ kind: 'reset', pct: 0.9 }, 'tm')])
    x.logs = [p3Log(1, 200, 4), p3Log(2, 200, 4), p3Log(3, 200, 4), p3Log(4, 200, 4)]
    expect(evaluate(x).tm.bench!.map(p => p.value)).toEqual([200, 180, 162])
    expect(load(x, 3)).toEqual([180]); expect(load(x, 4)).toEqual([180]); expect(load(x, 5)).toEqual([162])
    x.logs = [p3Log(1, 200, 4), p3Log(2, 200, 5), p3Log(3, 200, 4), p3Log(4, 200, 4)]
    expect(evaluate(x).tm.bench!.map(p => p.value)).toEqual([200, 180]); expect(evaluate(x).tm.bench!.at(-1)!.at).toBe('2026-01-27')
  })
  it('repeat preserves each latest actual working load; no repeat increment or reset', () => {
    const x = p3Input(percentage(), [stallRule({ kind: 'repeat' })]); x.logs = [p3Log(1, 125, 4), p3Log(2, 150, 4)]
    expect(load(x, 3)).toEqual([150])
    x.logs.push(p3Log(3, 175, 5)); expect(load(x, 4)).toEqual([200])
  })
  it('load reset uses previous actual weights when the trigger has no completed working rows', () => {
    const x = p3Input(linear(), [stallRule({ kind: 'reset', pct: 0.9 })])
    x.logs = [p3Log(1, 150, 5), p3Log(2, 200, 5, { done: false })]
    expect(load(x, 3)).toEqual([135])
    x.logs.push(p3Log(3, 160, 6)); expect(load(x, 4)).toEqual([165])
  })
  it('reset converts actual kg working weights before multiplying and rounds once at the end', () => {
    const x = p3Input(linear(), [stallRule({ kind: 'reset', pct: 0.9 }, 'load', 1)]), log = p3Log(1, 100, 5)
    log.unit = 'kg'; x.logs = [log]
    // 100 kg * 2.20462262 * .9 =198.4160358 ->198 lb.
    expect(load(x, 2)).toEqual([198])
  })
  it('two-week load deload: Jan6-Jan19 load100*.5=50 and ceil(4*.5)=2; Jan20 restores', () => {
    const x = p3Input(linear(), [stallRule({ kind: 'deload', setsFactor: 0.5, loadFactor: 0.5, weeks: 2 }, 'load', 1)])
    for (const w of (x.definition as any).weeks) w.days[0].sessions[0].routineSnapshot.ex[0].sets = 4
    const log = p3Log(1, 100, 5); log.entries[0]!.target.sets = 4; log.entries[0]!.sets = Array.from({ length: 4 }, () => ({ done: true, w: 100, r: 5 }))
    x.logs = [log]
    expect(load(x, 2)).toEqual([50, 50]); expect(load(x, 3)).toEqual([50, 50]); expect(load(x, 4)).toEqual([100, 100, 100, 100])
    x.cycle!.weekIndex = 3; x.asOf = '2026-01-20'; expect(load(x, 3)).toEqual([100, 100, 100, 100])
  })
  it('RPE effort misses at9.1 count as stalls despite completed reps, target9 does not', () => {
    const r = rpeRule(); r.weeks['*'] = [{ reps: 6, rpe: 8 }]
    const x = p3Input(r, [stallRule({ kind: 'reset', pct: 0.9 })]); x.logs = [p3Log(1, 100, 6, { rpe: 9.1 }), p3Log(2, 100, 6, { rpe: 9.1 })]
    expect(load(x, 3)).toEqual([90])
    x.logs = [p3Log(1, 100, 6, { rpe: 9 }), p3Log(2, 100, 6, { rpe: 9.1 })]; expect(load(x, 3)).toEqual([95])
  })
})

describe('TM deload/restore hand-computed timeline goldens', () => {
  it('current-week asOf sees day-after TM reset without rewriting earlier week targets', () => {
    const x = p3Input(percentage(), [stallRule({ kind: 'reset', pct: 0.9 }, 'tm', 1)])
    x.cycle!.weekIndex = 1; x.logs = [p3Log(1, 200, 4)]
    x.asOf = '2026-01-05'; expect(load(x, 1)).toEqual([200])
    x.asOf = '2026-01-06'; expect(load(x, 1)).toEqual([180])
    x.cycle!.weekIndex = 2; expect(load(x, 1)).toEqual([200])
  })
  it('fixed numeric definition seed200 is safe fallback on an active cycle without tmSeed', () => {
    const x = p3Input(percentage()); delete x.cycle!.tmSeed; x.cycle!.tm = { bench: 900 }; x.logs = [p3Log(1, 300, 6)]
    expect(evaluate(x).tm.bench!.map(p => p.value)).toEqual([200]); expect(load(x, 2)).toEqual([200]); expect(evaluate(x).warnings).toEqual([])
  })
  it('from-e1rm seed without frozen value stays unavailable even after stronger later logs', () => {
    const x = p3Input(percentage()); delete x.cycle!.tmSeed; (x.definition as any).tmSeeds = { bench: { fromE1rm: { pct: 0.9 } } }
    x.cycle!.tm = { bench: 900 }; x.logs = [p3Log(1, 100, 6)]
    const before = evaluate(x); expect(before.tm).toEqual({}); expect(load(x, 2)).toEqual([null])
    expect(before.warnings.map(w => w.code)).toContain('tm.seed-unfrozen')
    x.logs.push(p3Log(2, 300, 6)); expect(evaluate(x).tm).toEqual({}); expect(load(x, 3)).toEqual([null])
    x.cycle!.tmSeed = { bench: 120 }; expect(load(x, 3)).toEqual([120])
  })
  it('TM200*.8=160 Jan6; AMRAP+10 Jan19=170; Jan20 restores original40 ->210', () => {
    const x = p3Input(percentage(), [stallRule({ kind: 'deload', setsFactor: 0.5, loadFactor: 0.8, weeks: 2 }, 'tm', 1), bumpRule(2)])
    x.logs = [p3Log(1, 200, 4), p3Log(2, 160, 10)]
    const tm = evaluate(x).tm.bench!
    expect(tm.map(p => [p.at, p.value])).toEqual([['seed', 200], ['2026-01-06', 160], ['2026-01-19', 170], ['2026-01-20', 210]])
    expect(load(x, 2)).toEqual([160]); expect(load(x, 3)).toEqual([170]); expect(load(x, 4)).toEqual([210])
    const before = JSON.stringify(evaluate(x)); x.cycle!.tm = { bench: 210 }; expect(JSON.stringify(evaluate(x))).toBe(before)
    const inputBefore = JSON.stringify(x); evaluate(x); expect(JSON.stringify(x)).toBe(inputBefore)
  })
  it('TM deload applies load factor once and working-set reduction once', () => {
    const wave = percentage(); for (const key of Object.keys(wave.weeks)) wave.weeks[key] = Array.from({ length: 4 }, () => ({ pct: 1, reps: 'amrap', repsMin: 5 }))
    const x = p3Input(wave, [stallRule({ kind: 'deload', setsFactor: 0.5, loadFactor: 0.8, weeks: 1 }, 'tm', 1)])
    for (const w of (x.definition as any).weeks) w.days[0].sessions[0].routineSnapshot.ex[0].sets = 4
    x.logs = [p3Log(1, 200, 4)]
    expect(load(x, 2)).toEqual([160, 160]); expect(load(x, 3)).toEqual([200, 200, 200, 200])
  })
  it('TM repeat records the event without changing immutable TM200', () => {
    const x = p3Input(percentage(), [stallRule({ kind: 'repeat' }, 'tm', 1)]); x.logs = [p3Log(1, 200, 4)]
    expect(evaluate(x).tm.bench!.map(p => [p.at, p.value])).toEqual([['seed', 200], ['2026-01-06', 200]])
    expect(load(x, 2)).toEqual([200])
  })
  it('completed reduced RPE deload sets reset the failure counter instead of deloading TM again', () => {
    const r = rpeRule(); r.weeks['*'] = Array.from({ length: 4 }, () => ({ reps: 6, rir: 2 }))
    const x = p3Input(r, [stallRule({ kind: 'deload', setsFactor: 0.5, loadFactor: 0.8, weeks: 2 }, 'tm', 1)])
    for (const w of (x.definition as any).weeks) w.days[0].sessions[0].routineSnapshot.ex[0].sets = 4
    const first = p3Log(1, 100, 5), reduced = p3Log(2, 100, 6, { rir: 2 })
    first.entries[0]!.target.sets = 4; first.entries[0]!.sets = Array.from({ length: 4 }, () => ({ done: true, w: 100, r: 5 }))
    reduced.entries[0]!.target.sets = 2; reduced.entries[0]!.sets.push({ done: true, w: 100, r: 6 })
    x.logs = [first, reduced]
    expect(evaluate(x).tm.bench!.map(p => p.value)).toEqual([200, 160, 200])
  })
  it('missed added RPE ramp set counts as failure although original sets passed', () => {
    const r = rpeRule(); r.weeks['*'] = Array.from({ length: 4 }, () => ({ reps: 6, rir: 2 }))
    const x = p3Input(r, [stallRule({ kind: 'reset', pct: 0.9 }, 'tm', 1)])
    for (const w of (x.definition as any).weeks) w.days[0].sessions[0].routineSnapshot.ex[0].sets = 4
    const log = p3Log(1); log.entries[0]!.target.sets = 5
    log.entries[0]!.sets = Array.from({ length: 5 }, (_, i) => ({ done: true, w: 100, r: i === 4 ? 5 : 6, rir: 2 }))
    x.logs = [log]; expect(evaluate(x).tm.bench!.map(p => p.value)).toEqual([200, 180])
  })
  it('completed reduced percentage sets avoid a false TM stall too', () => {
    const wave = percentage(); for (const key of Object.keys(wave.weeks)) wave.weeks[key] = Array.from({ length: 4 }, () => ({ pct: 1, reps: 'amrap', repsMin: 5 }))
    const x = p3Input(wave, [stallRule({ kind: 'reset', pct: 0.9 }, 'tm', 1)])
    for (const w of (x.definition as any).weeks) w.days[0].sessions[0].routineSnapshot.ex[0].sets = 4
    const log = p3Log(1, 100, 5); log.entries[0]!.target.sets = 2; log.entries[0]!.sets.push({ done: true, w: 100, r: 5 })
    x.logs = [log]; expect(evaluate(x).tm.bench!.map(p => p.value)).toEqual([200])
  })
})
