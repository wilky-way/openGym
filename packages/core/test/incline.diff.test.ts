// Differential: the TS port against the legacy lib/incline.js on generated inputs (R6).
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error untyped legacy oracle (R6): the port is compared to it at runtime, not by type
import * as legacy from '../../../packages/parity/fixtures/oracle/frontend/src/lib/incline.js'
import * as port from '@opengym/core/incline.js'

const same = (a: unknown, b: unknown) => {
  expect(b).toEqual(a)
  expect(JSON.stringify(b)).toBe(JSON.stringify(a))
}
const runs = { numRuns: 1000, seed: 20261013 }
const name = fc.constantFrom('Treadmill walk', 'Running', 'Stair stepper', 'Rowing machine', 'Bike sprint', 'Elliptical', 'Jumping jacks', 'Custom thing', 'Hiking trail', '', undefined as unknown as string)
const eqs = fc.constantFrom('elliptical machine', 'stepmill machine', 'bicycle', undefined as unknown as string)

describe('incline differential', () => {
  it('stores grades identically', () => {
    fc.assert(fc.property(fc.oneof(fc.oneof(fc.double({ min: -5, max: 60, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), fc.constantFrom('', null, undefined, '7.3', 'x')), v => {
      same(legacy.clampIncline(v), port.clampIncline(v))
    }), runs)
  })

  it('offers the column identically', () => {
    fc.assert(fc.property(fc.record({ n: name, eq: eqs, id: fc.option(fc.constant('c1'), { nil: undefined }) }, { requiredKeys: [] }), ex => {
      same(legacy.inclineFits(ex as never), port.inclineFits(ex as never))
    }), runs)
  })

  it('reads and carries a grade identically', () => {
    fc.assert(fc.property(fc.option(fc.record({ incline: fc.oneof(fc.oneof(fc.double({ min: -2, max: 20, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), fc.constant(undefined)) }), { nil: null }), s => {
      same(legacy.hasIncline(s as never), port.hasIncline(s as never))
      same(legacy.inclineFrom(s as never), port.inclineFrom(s as never))
    }), runs)
  })

  it('keeps the limits as they were', () => {
    expect(port.INCLINE_MAX).toBe(legacy.INCLINE_MAX)
    expect(port.INCLINE_STEP).toBe(legacy.INCLINE_STEP)
  })
})
