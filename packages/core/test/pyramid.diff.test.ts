// Differential: the TS port against the legacy lib/pyramid.js on generated inputs (R6).
import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error untyped legacy oracle (R6): the port is compared to it at runtime, not by type
import * as legacy from '../../../packages/parity/fixtures/oracle/frontend/src/lib/pyramid.js'
import * as port from '@opengym/core/pyramid.js'

const same = (a: unknown, b: unknown) => {
  expect(b).toEqual(a)
  expect(JSON.stringify(b)).toBe(JSON.stringify(a))
}
const target = fc.oneof(fc.integer({ min: -3, max: 40 }), fc.oneof(fc.double({ min: -5, max: 50, noNaN: true }), fc.constantFrom(NaN, Infinity, -Infinity, -0)), fc.constantFrom('max', '', null, '12', undefined))
const runs = { numRuns: 1000, seed: 20261013 }

const outcome = (f: () => unknown) => {
  try { return { ok: f() } } catch (e) { return { threw: (e as Error).constructor.name } }
}

describe('pyramid differential', () => {
  it('normalizes targets identically for every stride', () => {
    fc.assert(fc.property(fc.array(target, { maxLength: 14 }), fc.constantFrom(1, 2), (list, stride) => {
      same(legacy.normalizePyramid(list, stride), port.normalizePyramid(list, stride))
    }), runs)
  })

  it('reads rest and weight lists identically at every length', () => {
    fc.assert(fc.property(fc.array(target, { maxLength: 12 }), fc.nat({ max: 12 }), (list, length) => {
      same(legacy.normalizePyramidRest(list, length), port.normalizePyramidRest(list, length))
      same(legacy.normalizePyramidWeight(list, length), port.normalizePyramidWeight(list, length))
    }), runs)
  })

  it('answers targets, labels and flat conversions identically', () => {
    fc.assert(fc.property(fc.array(fc.oneof(fc.integer({ min: 1, max: 30 }), fc.constant('max')), { minLength: 1, maxLength: 10 }), fc.nat({ max: 12 }), (list, i) => {
      same(legacy.pyramidTargetAt(list, i), port.pyramidTargetAt(list, i))
      same(legacy.pyramidLabel(list), port.pyramidLabel(list))
      same(legacy.flatFromPyramid(list), port.flatFromPyramid(list))
    }), runs)
  })

  it('builds a pyramid from a flat plan identically', () => {
    fc.assert(fc.property(fc.record({ sets: fc.oneof(fc.integer({ min: -2, max: 20 }), fc.constant(undefined)), reps: fc.oneof(fc.integer({ min: 0, max: 20 }), fc.constant(undefined)) }), cfg => {
      same(legacy.pyramidFromFlat(cfg), port.pyramidFromFlat(cfg))
    }), runs)
  })

  it('keeps the presets as they were', () => {
    same(legacy.PYRAMID_PRESETS, port.PYRAMID_PRESETS)
    expect(port.MAX_PYRAMID_SETS).toBe(legacy.MAX_PYRAMID_SETS)
  })

  it('reads the pyramid predicates, planned weights and rests identically, throws included', () => {
    const rowsArb = fc.array(fc.record({ w: fc.integer({ min: 0, max: 80 }), r: fc.integer({ min: 1, max: 12 }), phase: fc.constantFrom('warmup', 'work', undefined) }), { maxLength: 5 })
    const lists = fc.option(fc.array(target, { maxLength: 6 }), { nil: undefined })
    const cfg = fc.option(fc.record({ mode: fc.option(fc.constantFrom('reps', 'time'), { nil: undefined }), pyramid: lists, pyramidWeight: lists, pyramidRest: lists }), { nil: null })
    fc.assert(fc.property(cfg, rowsArb, fc.nat({ max: 7 }), (c, rows, i) => {
      same(legacy.isPyramid(c as never), port.isPyramid(c as never))
      same(outcome(() => legacy.pyramidWeightAt(c as never, i)), outcome(() => port.pyramidWeightAt(c as never, i)))
      same(outcome(() => legacy.pyramidRestFor(c as never, rows as never, i)), outcome(() => port.pyramidRestFor(c as never, rows as never, i)))
    }), runs)
  })

  it('finds the Max record and the Max series identically over generated history', () => {
    const set = fc.record({ w: fc.integer({ min: 0, max: 50 }), r: fc.integer({ min: 0, max: 12 }), done: fc.boolean(), max: fc.boolean() })
    const entry = fc.record({ id: fc.constantFrom('a', 'b'), sets: fc.array(set, { maxLength: 4 }) })
    const workout = fc.record({ d: fc.constantFrom('2026-01-01', '2026-01-02'), start: fc.integer({ min: 1, max: 3 }), entries: fc.array(entry, { maxLength: 3 }) })
    fc.assert(fc.property(fc.array(workout, { maxLength: 4 }), fc.integer({ min: 0, max: 60 }), (ws, w) => {
      same(legacy.maxRecordAt(ws as never, 'a', w), port.maxRecordAt(ws as never, 'a', w))
      same(legacy.maxRepsSeries(ws as never, 'a'), port.maxRepsSeries(ws as never, 'a'))
    }), runs)
  })
})
