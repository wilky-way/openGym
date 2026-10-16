import { afterEach, describe, expect, it } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error frozen untyped oracle is imported only for differential tests
import { chooseOpenSlot as legacyChoose } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-open-slots.js'
// @ts-expect-error frozen oracle's private mutable catalogue is configured only in tests
import { registerCustom as legacyRegister } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/exercises.js'
import { chooseOpenSlot } from '../src/programme-open-slots'
import { createExerciseIndex } from '../src/exercises'
const runs = Math.max(1000, Number(process.env.PARITY_RUNS) || 1000)

const customs = [{ id: 'user-cardio', n: 'Synthetic cardio', bp: 'cardio', eq: 'bw' },
  { id: 'user-assisted', n: 'Synthetic assisted', bp: 'back', eq: 'ma', assisted: true }]
const state = (extra: any = {}): any => {
  const target = { open: true, slotId: 'open-a', sets: 2, reps: 8, weight: 40, inc: 2.5, min: 15, prog: 'off' }
  return { unit: 'kg', customEx: customs, workouts: [], exWeights: {},
    routines: [{ id: 'r1', ex: [{ ...target }] }],
    active: { id: 'w1', start: 1, entries: [{ rid: 'r1', target, sets: [], note: 'Keep this', occurrenceId: 'o1', sg: 'pair' }] },
    ...extra }
}
const observed = (choose: (...args: any[]) => unknown, S: any, at: number, id: string, activeId: unknown, slotId: unknown): any => {
  try { return { result: choose(S, at, id, activeId, slotId, createExerciseIndex(S.customEx)), state: S } }
  catch (error) { return { error: error instanceof Error ? { name: error.name, message: error.message } : String(error), state: S } }
}
afterEach(() => legacyRegister([]))

describe('programme open slot legacy twin', () => {
  it('matches exact occurrence guards, completed limbs, construction, exclusion and mutations', () => {
    legacyRegister(customs)
    fc.assert(fc.property(fc.constantFrom('0025', '1019', 'user-cardio', 'user-assisted', 'unknown'),
      fc.constantFrom(-1, 0, 1, NaN, 0.5), fc.boolean(), fc.boolean(), fc.boolean(),
      fc.constantFrom('none', 'aggregate', 'L', 'R'), fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 12 }),
      fc.constantFrom('off', 'linear'),
      (id, at, activeMatches, slotMatches, excluded, logged, sets, reps, prog) => {
        const S = state()
        S.routines[0].excludeFromProgression = excluded
        S.routines[0].ex[0].sets = S.active.entries[0].target.sets = sets
        S.routines[0].ex[0].reps = S.active.entries[0].target.reps = reps
        S.routines[0].ex[0].prog = S.active.entries[0].target.prog = prog
        if (logged !== 'none') S.active.entries[0].sets = [{ done: logged === 'aggregate',
          sides: { L: { done: logged === 'L' }, R: { done: logged === 'R' } } }]
        const args: [number, string, unknown, unknown] = [at, id, activeMatches ? 'w1' : 'stale', slotMatches ? 'open-a' : 'stale']
        const old = observed(legacyChoose, structuredClone(S), ...args)
        const next = observed(chooseOpenSlot, structuredClone(S), ...args)
        expect(next).toEqual(old)
        expect(JSON.stringify(next)).toBe(JSON.stringify(old))
      }), { seed: 121717, numRuns: runs })
  }, Math.max(30_000, runs * 5))

  it('propagates the exact open slot only to later pending matching sessions and snapshots', () => {
    const S = state()
    S.routines = [1, 2, 3, 4].map(i => ({ id: `r${i}`, ex: [{ open: true, slotId: 'open-a', sets: i, reps: 8, weight: 40 }],
      programme: { cycleId: 'c1', instanceId: `o${i}` } }))
    S.workouts = [{ entries: [{ occurrenceId: 'o2' }], d: '2026-10-12' }]
    S.programmes = { definitions: [{ id: 'saved', weeks: [] }], cycles: [{ id: 'c1', occurrences: [1, 2, 3, 4].map(i => ({
      instanceId: `o${i}`, routineId: `r${i}`, weekIndex: i, dayKey: i === 3 ? 'other' : 'd1', status: 'pending' })),
      snapshot: { weeks: [1, 2, 3, 4].map(i => ({ index: i, days: [{ key: i === 3 ? 'other' : 'd1', sessions: [{
        routineSnapshot: { ex: structuredClone(S.routines[i - 1].ex) } }] }] })) } }] }
    const before = structuredClone(S)
    const old = observed(legacyChoose, structuredClone(S), 0, '0025', 'w1', 'open-a')
    const next = observed(chooseOpenSlot, S, 0, '0025', 'w1', 'open-a')
    expect(next).toEqual(old)
    expect(S.routines.map((r: any) => r.ex[0].id)).toEqual(['0025', undefined, undefined, '0025'])
    expect(S.programmes.cycles[0].snapshot.weeks.map((w: any) => w.days[0].sessions[0].routineSnapshot.ex[0].id))
      .toEqual(['0025', undefined, undefined, '0025'])
    expect(S.programmes.definitions).toEqual(before.programmes.definitions)
    expect(S.active.entries[0]).toMatchObject({ id: '0025', rid: 'r1', note: 'Keep this', occurrenceId: 'o1', sg: 'pair' })
  })
})

describe('programme open slot caller catalogue', () => {
  it('constructs custom cardio rows from the supplied catalogue', () => {
    const S = state(), index = createExerciseIndex(S.customEx)
    expect(chooseOpenSlot(S, 0, 'user-cardio', 'w1', 'open-a', index)).toBe(true)
    expect(S.active.entries[0].sets).toHaveLength(2)
    expect(S.active.entries[0].sets.every((row: any) => row.min === 15 && !Object.hasOwn(row, 'r'))).toBe(true)
    expect(S.active.entries[0].target.id).toBe('user-cardio')
  })

  it('uses assisted progression direction from the supplied catalogue without global registration', () => {
    const S = state()
    S.active.entries[0].target.prog = 'linear'
    S.routines[0].ex[0].prog = 'linear'
    S.workouts = [{ d: '2026-10-10', routineIds: ['r1'], entries: [{ id: 'user-assisted', rid: 'r1',
      target: { sets: 2, reps: 8, weight: 40 }, sets: [{ w: 40, r: 8, done: true }, { w: 40, r: 8, done: true }] }] }]
    expect(chooseOpenSlot(S, 0, 'user-assisted', 'w1', 'open-a', createExerciseIndex(S.customEx))).toBe(true)
    expect(S.active.entries[0].target.weight).toBe(37.5)
    expect(S.active.entries[0].sets.map((row: any) => row.w)).toEqual([37.5, 37.5])
  })

  it('preserves a caller-owned custom alias shadow instead of the builtin alias', () => {
    const S = state({ customEx: [{ id: '1019', n: 'Synthetic alias shadow', bp: 'cardio' }] })
    expect(chooseOpenSlot(S, 0, '1019', 'w1', 'open-a', createExerciseIndex(S.customEx))).toBe(true)
    expect(S.active.entries[0].id).toBe('1019')
    expect(S.active.entries[0].sets.every((row: any) => row.min === 15)).toBe(true)
    expect(S.routines[0].ex[0].id).toBe('1019')
  })

  it('requires an explicit catalogue and rejects unknown choices without changing the slot', () => {
    const S = state(), before = structuredClone(S)
    expect(() => chooseOpenSlot(S, 0, '0025', 'w1', 'open-a', undefined!)).toThrow('explicit exercise index')
    expect(S).toEqual(before)
    expect(() => chooseOpenSlot(S, 0, 'user-cardio', 'w1', 'open-a', createExerciseIndex()))
      .toThrow('Resolve unknown exercises')
    expect(S).toEqual(before)
  })
})
