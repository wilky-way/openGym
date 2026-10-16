import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error frozen untyped oracle is imported only for differential tests
import { WC_DEFAULT as legacyDefault, workoutControls as legacyControls } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/workout-controls.js'
import { WC_DEFAULT, workoutControls } from '../src/workout-controls'
const runs = Math.max(1000, Number(process.env.PARITY_RUNS) || 1000)

describe('workout controls legacy twin', () => {
  it('matches defaults, saved flags, passthrough values and serialized key order', () => {
    fc.assert(fc.property(fc.oneof(fc.jsonValue(), fc.record({ wc: fc.jsonValue() })), S => {
      const before = structuredClone(S)
      const old = legacyControls(S), next = workoutControls(S)
      expect(next).toEqual(old)
      expect(JSON.stringify(next)).toBe(JSON.stringify(old))
      expect(S).toEqual(before)
    }), { seed: 142020, numRuns: runs })
  }, Math.max(30_000, runs * 5))

  it('retains the exact frozen defaults and returns fresh results', () => {
    expect(WC_DEFAULT).toEqual(legacyDefault)
    expect(JSON.stringify(WC_DEFAULT)).toBe(JSON.stringify(legacyDefault))
    expect(Object.isFrozen(WC_DEFAULT)).toBe(true)
    const first = workoutControls(null), second = workoutControls(undefined)
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    first.steppers = false
    expect(second.steppers).toBe(true)
    expect(WC_DEFAULT.steppers).toBe(true)
  })

  it('preserves saved false, null, missing, string and unknown settings', () => {
    for (const S of [null, undefined, false, 0, '', 'state', Symbol('state'), 1n,
      {}, { wc: null }, { wc: false }, { wc: 'xy' }, { wc: 1n },
      { wc: { steppers: false, setShortcuts: null, exerciseChips: undefined, extra: 'kept' } }]) {
      expect(workoutControls(S)).toEqual(legacyControls(S))
      expect(JSON.stringify(workoutControls(S))).toBe(JSON.stringify(legacyControls(S)))
    }
  })

  it('copies own enumerable controls without mutating their references', () => {
    const nested = { value: true }, symbol = Symbol('control')
    const wc = Object.assign(Object.create({ steppers: false }), { nested, [symbol]: 'kept' })
    Object.defineProperty(wc, 'hidden', { value: true, enumerable: false })
    Object.defineProperty(wc, '__proto__', { value: 'literal', enumerable: true })
    const S = { wc }, result = workoutControls(S)
    expect(result).toEqual(legacyControls(S))
    expect(result.nested).toBe(nested)
    expect(Object.getOwnPropertyDescriptor(result, symbol)?.value).toBe('kept')
    expect(Object.hasOwn(result, 'hidden')).toBe(false)
    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
    expect(result.steppers).toBe(true)
    expect(Object.getPrototypeOf(wc).steppers).toBe(false)
  })

  it('reads document and setting getters once just like the oracle', () => {
    let documentReads = 0, flagReads = 0
    const S = { get wc() { documentReads++; return { get swipeSets() { flagReads++; return false } } } }
    expect(workoutControls(S)).toEqual(legacyControls(S))
    expect(documentReads).toBe(2)
    expect(flagReads).toBe(2)
  })
})
