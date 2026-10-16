// Differential: the TS port against the legacy lib/speed.js on generated inputs (R6).
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error untyped legacy oracle (R6): the port is compared to it at runtime, not by type
import * as legacy from '../../../packages/parity/fixtures/oracle/frontend/src/lib/speed.js'
import * as port from '@opengym/core/speed.js'

const same = (a: unknown, b: unknown) => {
  expect(b).toEqual(a)
  expect(JSON.stringify(b)).toBe(JSON.stringify(a))
}
const runs = { numRuns: 1000, seed: 20261013 }
const unit = fc.constantFrom('kmh', 'mph', 'km/h', '', undefined as unknown as string)
const value = fc.oneof(fc.oneof(fc.double({ min: -20, max: 60, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), fc.constantFrom(0, '', null, undefined, '6', '12.5'))

describe('speed differential', () => {
  it('converts to and from km/h identically', () => {
    fc.assert(fc.property(value, unit, (v, u) => {
      same(legacy.toSpeed(v, u as string), port.toSpeed(v, u as string))
      same(legacy.fromSpeed(v, u as string), port.fromSpeed(v, u as string))
    }), runs)
  })

  it('formats and labels identically', () => {
    fc.assert(fc.property(value, unit, (v, u) => {
      same(legacy.fmtSpeed(v, u as string), port.fmtSpeed(v, u as string))
      same(legacy.speedLabel(u as string), port.speedLabel(u as string))
    }), runs)
  })

  it('picks the speed unit from the profile identically', () => {
    const S = fc.option(fc.record({ unit: fc.constantFrom('kg', 'lb', undefined), speedUnit: fc.constantFrom('kmh', 'mph', 'other', undefined) }), { nil: null })
    fc.assert(fc.property(S, s => {
      same(legacy.speedUnitOf(s as never), port.speedUnitOf(s as never))
    }), runs)
  })

  it('keeps the mile constant', () => {
    expect(port.KMH_PER_MPH).toBe(legacy.KMH_PER_MPH)
  })
})
