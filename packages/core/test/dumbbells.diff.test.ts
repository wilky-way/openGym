// Differential: the TS port against the legacy lib/dumbbells.js on generated inputs (R6).
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error untyped legacy oracle (R6): the port is compared to it at runtime, not by type
import * as legacy from '../../../packages/parity/fixtures/oracle/frontend/src/lib/dumbbells.js'
import * as port from '@opengym/core/dumbbells.js'

const same = (a: unknown, b: unknown) => {
  expect(b).toEqual(a)
  expect(JSON.stringify(b)).toBe(JSON.stringify(a))
}
const runs = { numRuns: 1000, seed: 20261013 }
const mode = fc.constantFrom('as', 'each', 'total', null, undefined, 'bogus')
const weights = fc.array(fc.oneof(fc.double({ min: 0.5, max: 80, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), { maxLength: 10 }).map(ws => [...new Set(ws.map(w => Math.round(w * 2) / 2))].sort((a, b) => a - b))

const outcome = (f: () => unknown) => {
  try { return { ok: f() } } catch (e) { return { threw: (e as Error).constructor.name } }
}

describe('dumbbells differential', () => {
  it('reads the stored meaning identically', () => {
    fc.assert(fc.property(fc.oneof(mode, fc.record({ mode, _ts: fc.integer() })), v => {
      same(legacy.dbLoadOf(v), port.dbLoadOf(v))
    }), runs)
  })

  it('resolves the meaning and the factors identically', () => {
    const S = fc.option(fc.record({ unit: fc.constantFrom('kg', 'lb'), dbLoad: fc.option(fc.dictionary(fc.constantFrom('d1', 'd2'), fc.record({ mode, _ts: fc.integer() })), { nil: undefined }) }), { nil: null })
    const cfg = fc.option(fc.record({ id: fc.constantFrom('d1', 'd2', 'pull-up'), side: fc.option(fc.boolean(), { nil: undefined }), dbLoad: mode }), { nil: null })
    fc.assert(fc.property(S, cfg, mode, mode, (s, c, a, b) => {
      same(legacy.dbLoadFor(s as never, c as never), port.dbLoadFor(s as never, c as never))
      same(legacy.isOneArm(c as never), port.isOneArm(c as never))
      same(legacy.bellsIn(c as never), port.bellsIn(c as never))
      same(legacy.meaningFactor(a as never, b as never, c as never), port.meaningFactor(a as never, b as never, c as never))
      same(legacy.currentDbLoad(s as never, 'd1'), port.currentDbLoad(s as never, 'd1'))
    }), runs)
  })

  it('cleans, lists and owns weights identically', () => {
    const S = fc.record({ unit: fc.constantFrom('kg', 'lb'), dumbbells: fc.dictionary(fc.constantFrom('kg', 'lb'), fc.record({ weights: weights }), { maxKeys: 2 }) })
    fc.assert(fc.property(weights, fc.constantFrom('kg', 'lb'), S, (ws, unit, s) => {
      same(legacy.cleanWeights(ws), port.cleanWeights(ws))
      same(legacy.presetWeights(unit), port.presetWeights(unit))
      same(legacy.dumbbellsOf(s as never), port.dumbbellsOf(s as never))
      same(legacy.ownsDumbbells(s as never), port.ownsDumbbells(s as never))
    }), runs)
  })

  it('walks owned weights identically', () => {
    fc.assert(fc.property(weights, fc.oneof(fc.double({ min: -5, max: 90, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), fc.integer({ min: 1, max: 3 }), fc.constantFrom(1, -1), fc.oneof(fc.double({ min: 0.5, max: 1, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), (ws, x, n, dir, factor) => {
      same(legacy.ownedUp(ws, x, n), port.ownedUp(ws, x, n))
      same(legacy.ownedDown(ws, x), port.ownedDown(ws, x))
      same(legacy.ownedFloor(ws, x), port.ownedFloor(ws, x))
      same(legacy.stepOwned(ws, x, dir), port.stepOwned(ws, x, dir))
      same(legacy.ownedDeload(ws, x, factor), port.ownedDeload(ws, x, factor))
      same(legacy.ownedAround(x, ws, x + 10, dir > 0), port.ownedAround(x, ws, x + 10, dir > 0))
    }), runs)
  })

  it('reads, stamps and converts meanings and inventories identically, throws included', () => {
    const entryArb = fc.record({
      id: fc.constantFrom('d1', 'pull-up'),
      target: fc.option(fc.record({ dbLoad: mode, side: fc.option(fc.boolean(), { nil: undefined }) }), { nil: undefined }),
      sets: fc.array(fc.record({
        w: fc.oneof(fc.oneof(fc.double({ min: 0, max: 80, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), fc.constant(undefined)),
        r: fc.integer({ min: 1, max: 12 }),
        done: fc.boolean(),
        drops: fc.option(fc.array(fc.record({ w: fc.oneof(fc.double({ min: 0, max: 40, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)) }), { maxLength: 2 }), { nil: undefined }),
      }), { maxLength: 3 }),
      topW: fc.option(fc.oneof(fc.double({ min: 0, max: 80, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), { nil: undefined }),
    })
    const S = fc.option(fc.record({ unit: fc.constantFrom('kg', 'lb'), workouts: fc.array(fc.record({ entries: fc.array(entryArb, { maxLength: 3 }) }), { maxLength: 3 }) }), { nil: null })
    fc.assert(fc.property(entryArb, mode, mode, S, fc.option(fc.record({ id: fc.constantFrom('d1', 'pull-up'), side: fc.option(fc.boolean(), { nil: undefined }), bodyweight: fc.option(fc.boolean(), { nil: undefined }) }), { nil: null }), (e, a, b, s, cfg) => {
      same(legacy.isBellEx(e as never), port.isBellEx(e as never))
      same(outcome(() => legacy.entryAs(e as never, b as never)), outcome(() => port.entryAs(e as never, b as never)))
      same(legacy.entryDbLoad(e as never), port.entryDbLoad(e as never))
      same(legacy.volumeFactor(e as never), port.volumeFactor(e as never))
      same(outcome(() => legacy.workoutAs({ entries: [e] } as never, e.id, b as never)), outcome(() => port.workoutAs({ entries: [e] } as never, e.id, b as never)))
      same(outcome(() => legacy.historyAs(s as never, e.id, b as never)), outcome(() => port.historyAs(s as never, e.id, b as never)))
      same(legacy.currentDbLoad(s as never, e.id), port.currentDbLoad(s as never, e.id))
      same(legacy.withMeaning(s as never, cfg as never), port.withMeaning(s as never, cfg as never))
      same(legacy.withDbLoad({ x: { mode: a } }, 'd1', a, 7), port.withDbLoad({ x: { mode: a } }, 'd1', a, 7))
      same(legacy.withDumbbells(s as never, [a, b], 9), port.withDumbbells(s as never, [a, b], 9))
      same(outcome(() => legacy.ownedWeightsFor(s as never, cfg as never)), outcome(() => port.ownedWeightsFor(s as never, cfg as never)))
    }), runs)
  })

  it('walks owned weights with null or missing entries identically', () => {
    fc.assert(fc.property(fc.array(fc.oneof(fc.oneof(fc.double({ min: 0, max: 80, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), fc.constant(null)), { maxLength: 6 }), fc.oneof(fc.double({ min: 0, max: 90, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), (ws, x) => {
      same(outcome(() => legacy.ownedFloor(ws as never, x)), outcome(() => port.ownedFloor(ws as never, x)))
    }), runs)
  })
})
