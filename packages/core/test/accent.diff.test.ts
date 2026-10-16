import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error frozen untyped oracle is imported only for differential tests
import * as legacy from '../../../packages/parity/fixtures/oracle/frontend/src/lib/accent.js'
import * as native from '../src/accent'
const runs = Math.max(1000, Number(process.env.PARITY_RUNS) || 1000)
const hex = fc.integer({ min: 0, max: 0xffffff }).map(v => '#' + v.toString(16).padStart(6, '0'))

describe('accent pure core legacy twin', () => {
  it('matches cleanHex and in-place sanitisation for stored values and preserves JSON bytes', () => {
    fc.assert(fc.property(fc.oneof(fc.jsonValue(), fc.record({ accent: fc.jsonValue(), accentCustom: fc.oneof(fc.jsonValue(), hex) })), S => {
      expect(native.cleanHex(S)).toBe(legacy.cleanHex(S))
      const before = structuredClone(S), oldState = structuredClone(S), nextState = structuredClone(S)
      const old = legacy.sanitizeAccent(oldState), next = native.sanitizeAccent(nextState)
      expect(next).toBe(nextState)
      expect(old).toBe(oldState)
      expect(next).toEqual(old)
      expect(JSON.stringify(next)).toBe(JSON.stringify(old))
      expect(S).toEqual(before)
    }), { seed: 104004, numRuns: runs })
  }, Math.max(30_000, runs * 5))

  it('retains valid custom colours, newer preset words and inherited-field behavior', () => {
    for (const values of [{ accent: 'custom', accentCustom: ' #AaBbCc ' }, { accent: 'future-mint', accentCustom: null },
      { accent: '<script>', accentCustom: 'url(x)' }, { accent: '', accentCustom: '#abc' }]) {
      for (const inherited of [false, true]) {
        const oldState = inherited ? Object.create(values) : { ...values }
        const nextState = inherited ? Object.create(values) : { ...values }
        expect(native.sanitizeAccent(nextState)).toEqual(legacy.sanitizeAccent(oldState))
        expect(JSON.stringify(nextState)).toBe(JSON.stringify(oldState))
        expect(nextState.accent).toBe(oldState.accent)
        expect(nextState.accentCustom).toBe(oldState.accentCustom)
      }
    }
    for (const v of [undefined, null, false, Symbol('accent'), 1n]) {
      expect(native.sanitizeAccent(v)).toBe(v)
      expect(native.cleanHex(v)).toBe(legacy.cleanHex(v))
    }
    expect(native.cleanHex('#ABCDEF')).toBe('#abcdef')
  })

  it('keeps the reviewed pure colour helpers equivalent to legacy', () => {
    fc.assert(fc.property(hex, hex, fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom('dark', 'light', 'future'), (a, b, amount, theme) => {
      const observe = (f: typeof native) => ({ luminance: f.luminance(a), contrast: f.contrast(a, b), mix: f.mix(a, b, amount),
        ink: f.inkOn(a), grey: f.isGrey(a), readable: f.readableIn(a, theme), adjusted: f.adjustedIn(a, theme),
        both: f.inkOnBoth(a, b), vars: f.customAccentVars(a, theme), pair: f.accentPair(a) })
      const old = observe(legacy), next = observe(native)
      expect(next).toEqual(old)
      expect(JSON.stringify(next)).toBe(JSON.stringify(old))
    }), { seed: 104005, numRuns: runs })
  }, Math.max(30_000, runs * 5))

  it('keeps the reviewed own-preset lookup and excludes DOM application from core', () => {
    expect(native.accentKey({ accent: 'toString' })).toBe('lime')
    expect(native.accentPair('__proto__')).toEqual(native.accentPair('lime'))
    expect(native.accentValue({ accent: 'custom', accentCustom: '#123ABC' })).toBe('#123abc')
    expect(Object.hasOwn(native, 'applyAccent')).toBe(false)
  })
})
