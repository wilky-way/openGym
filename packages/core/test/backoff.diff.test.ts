// Differential: the TS port against the legacy lib/backoff.js on generated inputs (R6).
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error untyped legacy oracle (R6): the port is compared to it at runtime, not by type
import * as legacy from '../../../packages/parity/fixtures/oracle/frontend/src/lib/backoff.js'
import * as port from '@opengym/core/backoff.js'

const same = (a: unknown, b: unknown) => {
  expect(b).toEqual(a)
  expect(JSON.stringify(b)).toBe(JSON.stringify(a))
}
const runs = { numRuns: 1000, seed: 20261013 }
const step = fc.constantFrom(0, 0.5, 1, 2, 2.5, 5, 10, 1.25)
const top = fc.oneof(fc.oneof(fc.double({ min: 0, max: 300, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), fc.constantFrom(20, 26, 27.5, 0, -4))

describe('backoff differential', () => {
  it('steps each back-off set identically', () => {
    fc.assert(fc.property(top, fc.nat({ max: 10 }), step, (t, k, s) => {
      same(legacy.backoffAt(t, k, s), port.backoffAt(t, k, s))
    }), runs)
  })

  it('plans the same weights for every count', () => {
    fc.assert(fc.property(top, fc.integer({ min: -2, max: 8 }), step, (t, n, s) => {
      same(legacy.backoffWeights(t, n, s), port.backoffWeights(t, n, s))
    }), runs)
  })

  it('steps open rows down from the first work row identically', () => {
    const row = fc.record({ w: fc.oneof(fc.integer({ min: 0, max: 120 }), fc.constant(undefined)), r: fc.integer({ min: 1, max: 12 }), done: fc.boolean() })
    fc.assert(fc.property(fc.array(row, { maxLength: 6 }), step, (rows, s) => {
      same(legacy.applyBackoff(rows, s), port.applyBackoff(rows, s))
    }), runs)
  })

  it('decides whether a plan asks for back-off sets identically', () => {
    const cfg = fc.record({
      backoff: fc.option(fc.boolean(), { nil: undefined }),
      mode: fc.option(fc.constantFrom('reps', 'time'), { nil: undefined }),
      pyramid: fc.option(fc.array(fc.integer({ min: 1, max: 12 }), { maxLength: 2 }), { nil: undefined }),
      intensifier: fc.option(fc.record({ type: fc.constantFrom('restpause', 'drop') }), { nil: undefined }),
    })
    fc.assert(fc.property(fc.option(cfg, { nil: null }), c => {
      same(legacy.isBackoff(c), port.isBackoff(c))
    }), runs)
  })

  it('takes the planned step identically', () => {
    const cfg = fc.record({ id: fc.constantFrom('dumbbell-row', 'leg-press', 'lat-pulldown'), backoff: fc.constant(true), inc: fc.oneof(fc.constantFrom(2, 2.5, 5), fc.constant(undefined)) })
    fc.assert(fc.property(cfg, fc.constantFrom('kg', 'lb'), (c, unit) => {
      same(legacy.backoffStepOf(c, unit), port.backoffStepOf(c, unit))
    }), runs)
  })
})
