// Differential: the TS port against the legacy lib/bar.js on generated inputs (R6).
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error untyped legacy oracle (R6): the port is compared to it at runtime, not by type
import * as legacy from '../../../packages/parity/fixtures/oracle/frontend/src/lib/bar.js'
import * as port from '@opengym/core/bar.js'

const same = (a: unknown, b: unknown) => {
  expect(b).toEqual(a)
  expect(JSON.stringify(b)).toBe(JSON.stringify(a))
}
const runs = { numRuns: 1000, seed: 20261013 }
const eq = fc.constantFrom('barbell', 'olympic barbell', 'ez barbell', 'smith machine', 'trap bar', 'dumbbell', 'cable machine', undefined)
const num = fc.oneof(fc.oneof(fc.double({ min: -10, max: 400, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), fc.constantFrom(0, 20, 45, null, undefined))

describe('bar differential', () => {
  it('splits plates identically', () => {
    fc.assert(fc.property(num, num, (total, bar) => {
      same(legacy.plateSplit(total as number, bar as number), port.plateSplit(total as number, bar as number))
    }), runs)
  })

  it('reads default and effective bar weights identically', () => {
    const S = fc.option(fc.record({
      unit: fc.constantFrom('kg', 'lb', undefined),
      barWeights: fc.option(fc.dictionary(fc.constantFrom('x1', 'x2'), fc.oneof(fc.oneof(fc.double({ min: 0, max: 60, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), fc.constant(0), fc.constant(-1))), { nil: undefined }),
    }), { nil: null })
    const ex = fc.record({ id: fc.constantFrom('x1', 'x2', 'x3'), eq })
    fc.assert(fc.property(S, ex, fc.constantFrom('kg', 'lb'), (s, e, unit) => {
      same(legacy.defaultBarWeight(e.eq ?? '', unit), port.defaultBarWeight(e.eq ?? '', unit))
      same(legacy.barWeightFor(s as never, e), port.barWeightFor(s as never, e))
      same(legacy.usesBar(e), port.usesBar(e))
      same(legacy.hasBarOverride(s as never, e.id), port.hasBarOverride(s as never, e.id))
      same(legacy.isNoBar(s as never, e.id), port.isNoBar(s as never, e.id))
    }), runs)
  })

  it('keeps the bar tables as they were', () => {
    same([...legacy.BAR_EQ], [...port.BAR_EQ])
    same(legacy.DEFAULT_BAR_KG, port.DEFAULT_BAR_KG)
    same(legacy.DEFAULT_BAR_LB, port.DEFAULT_BAR_LB)
  })
})
