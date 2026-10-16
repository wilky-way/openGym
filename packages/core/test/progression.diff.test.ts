import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import * as port from '../src/progression'
import * as plates from '../src/plates'
import * as tm from '../src/programme-tm'
import { progressionGuidance } from '../src/progression-copy'
// @ts-expect-error Frozen JavaScript oracle intentionally has no TypeScript declaration.
import * as oracle from '../../../packages/parity/fixtures/oracle/frontend/src/lib/progression.js'
// @ts-expect-error Frozen JavaScript oracle intentionally has no TypeScript declaration.
import * as oldPlates from '../../../packages/parity/fixtures/oracle/frontend/src/lib/plates.js'
// @ts-expect-error Frozen JavaScript oracle intentionally has no TypeScript declaration.
import * as oldTM from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-tm.js'
// @ts-expect-error Frozen JavaScript oracle intentionally has no TypeScript declaration.
import { progressionGuidance as oldGuidance } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/progression-copy.js'
import { EXDB } from '@opengym/core/exercises-data'
import type { Config, Profile, SetRow } from '../src/progression'

const equal = (a: unknown, b: unknown) => {
  expect(a).toEqual(b)
  expect(JSON.stringify(a)).toBe(JSON.stringify(b))
}
const catalogue = EXDB as { id: string; eq?: string; bp?: string }[]
const ids = ['barbell', 'dumbbell', 'body weight', 'assisted', 'sled machine', 'cable'].map(eq => catalogue.find(e => e.eq === eq)?.id).filter((id): id is string => !!id)
const options = { seed: 8082026, numRuns: Number(process.env.PARITY_RUNS || 1000) }
const load = fc.integer({ min: 0, max: 400 }).map(n => n / 4)
const row = fc.record({ w: load, r: fc.integer({ min: 0, max: 32 }), sec: fc.integer({ min: 0, max: 120 }), done: fc.boolean(), type: fc.constantFrom('work', 'warmup') })
const cfgArb = fc.record({ id: fc.constantFrom(...ids), sets: fc.integer({ min: 1, max: 6 }), setsMax: fc.integer({ min: 1, max: 10 }), reps: fc.integer({ min: 1, max: 24 }), repsMin: fc.integer({ min: 1, max: 12 }), repsMax: fc.integer({ min: 0, max: 30 }), sec: fc.integer({ min: 1, max: 90 }), weight: load, inc: fc.constantFrom(0, 1.25, 2.5, 5, 10), prog: fc.constantFrom(...port.POLICIES, 'unknown'), mode: fc.constantFrom('reps', 'time', 'cardio'), side: fc.boolean(), deloadFactor: fc.constantFrom(0.5, 0.9, 0.95, 1, 'junk') })

describe('K08 seeded differential parity', () => {
  it('keeps progression decisions, history reads, explanations and open-row application byte-identical', () => {
    fc.assert(fc.property(cfgArb, fc.array(fc.array(row, { maxLength: 10 }), { maxLength: 8 }), fc.boolean(), fc.boolean(), (cfg, rows, stamped, ownRoutine) => {
      const routine = { id: 'synthetic-r', prog: 'linear', ex: [cfg] }
      const state: Profile = { unit: 'kg', routines: [routine], workouts: rows.map((sets, i) => ({ d: `2026-02-${String(i + 1).padStart(2, '0')}`, entries: [{ id: cfg.id, ...(ownRoutine ? { rid: routine.id } : {}), ...(stamped ? { target: cfg, planned: port.plannedOf(cfg) } : {}), sets }] })) }
      const input = JSON.stringify(state)
      const a = port.nextPrescription(state, cfg, routine), b = oracle.nextPrescription(state, cfg, routine)
      equal(a, b)
      equal(port.sessionsFor(state, cfg.id, cfg, routine.id), oracle.sessionsFor(state, cfg.id, cfg, routine.id))
      equal(progressionGuidance(a), oldGuidance(b))
      equal(port.applyPrescription(structuredClone(rows[0] || []), a), oracle.applyPrescription(structuredClone(rows[0] || []), b))
      expect(JSON.stringify(state)).toBe(input)
    }), options)
  })
  it('keeps plate inventories, stacks, deltas and drop grids byte-identical', () => {
    fc.assert(fc.property(fc.constantFrom('kg', 'lb'), load, fc.array(fc.record({ w: fc.constantFrom(1.25, 2.5, 5, 10, 15, 20, 25, 35, 45), n: fc.integer({ min: 0, max: 3 }) }), { maxLength: 8 }), fc.constantFrom(...ids), (unit, weight, inv, id) => {
      const state: Profile = { unit, plates: { [unit]: Object.fromEntries(inv.map(p => [p.w, p.n])) } }
      equal(plates.inventoryFor(state), oldPlates.inventoryFor(state))
      equal(plates.plateStack(weight, inv), oldPlates.plateStack(weight, inv))
      equal(plates.rowLoad('pairs', weight, 20, inv), oldPlates.rowLoad('pairs', weight, 20, inv))
      equal(plates.rowLoad('single', weight, 0, inv), oldPlates.rowLoad('single', weight, 0, inv))
      equal(plates.plateDelta(inv.map(p => p.w), inv.slice(1).map(p => p.w)), oldPlates.plateDelta(inv.map(p => p.w), inv.slice(1).map(p => p.w)))
      const grid = plates.dropGrid(state, { id }), oldGrid = oldPlates.dropGrid(state, { id })
      equal(typeof grid === 'function' ? grid(weight) : grid, typeof oldGrid === 'function' ? oldGrid(weight) : oldGrid)
    }), options)
  })
  it('keeps training-max prescriptions and missing-key order byte-identical', () => {
    fc.assert(fc.property(load, fc.array(fc.integer({ min: 1, max: 150 }), { minLength: 1, maxLength: 6 }), fc.boolean(), fc.constantFrom(...ids), (max, percentages, counted, id) => {
      const cfg: Config = { id, sets: percentages.length, pyramid: percentages.map(() => 5), tm: { key: 'synthetic-lift', percentages } }
      const routine = { programme: { cycleId: 'synthetic-cycle' }, ex: [cfg, cfg] }
      const state: Profile = { unit: 'lb', programmes: { cycles: [{ id: 'synthetic-cycle', tm: { 'synthetic-lift': max } }] }, ...(counted ? { plates: { lb: { 45: 2, 5: 2 } } } : {}) }
      equal(tm.programmeTMConfig(state, cfg, routine), oldTM.programmeTMConfig(state, cfg, routine))
      equal(tm.missingProgrammeTMs(state, routine), oldTM.missingProgrammeTMs(state, routine))
    }), options)
  })
  it('contract-unsure: retains nullable historical targets and unknown planned fields', () => {
    const cfg: Config = { id: ids[0], sets: 1, reps: 5, weight: 60 }
    const entry = { id: ids[0], target: null, planned: { extension: 'kept' }, sets: [{ w: 60, r: 5, done: true }] }
    equal(port.readSession(entry, cfg), oracle.readSession(entry, cfg))
    equal(port.planChanged(entry.planned, cfg), oracle.planChanged(entry.planned, cfg))
    const max: Config = { ...cfg, reps: 'max', pyramid: [5, 'max'] }
    equal(port.plannedOf(max), oracle.plannedOf(max))
    equal(port.readSession({ ...entry, target: max }), oracle.readSession({ ...entry, target: max }))
    equal(port.applyPrescription([{ w: 60, r: 5 }], { kind: 'hold', reps: 'max' }), oracle.applyPrescription([{ w: 60, r: 5 }], { kind: 'hold', reps: 'max' }))
    const warmups = [{ w: 10, r: 5, phase: 'warmup' }, { w: 30, r: 5 }]
    equal(port.applyPrescription(warmups, { kind: 'up', weight: 35 }, [10, 15, 20, 25, 30, 35]), oracle.applyPrescription(warmups, { kind: 'up', weight: 35 }, [10, 15, 20, 25, 30, 35]))
    equal(port.nextPrescription({}, max), oracle.nextPrescription({}, max))
    const percentage: Config = { ...cfg, pyramid: [5], tm: { key: 'lift', percentages: [80], reference: 'synthetic', extension: 'kept' } }
    const state: Profile = { programmes: { cycles: [{ id: 'c', tm: { lift: 100 } }] } }
    equal(tm.programmeTMConfig(state, percentage, { programme: { cycleId: 'c' } }), oldTM.programmeTMConfig(state, percentage, { programme: { cycleId: 'c' } }))
    expect(percentage.tm?.extension).toBe('kept')
  })
  it('preserves invalid percentage failures and leaves a non-TM config unchanged', () => {
    const cfg = { id: ids[0], pyramid: [5, 5], tm: { key: 'synthetic-lift', percentages: [80] } }
    expect(() => tm.programmeTMConfig({}, cfg)).toThrow('Invalid percentage prescription')
    expect(() => oldTM.programmeTMConfig({}, cfg)).toThrow('Invalid percentage prescription')
    const flat: Config = { id: ids[0] }
    expect(tm.programmeTMConfig({}, flat)).toBe(flat)
    equal(tm.missingProgrammeTMs({}, { ex: [{ id: 'b', tm: { percentages: [50] } }, { id: 'a', tm: { percentages: [50] } }, { id: 'b', tm: { percentages: [50] } }] }), ['b', 'a'])
  })
})
