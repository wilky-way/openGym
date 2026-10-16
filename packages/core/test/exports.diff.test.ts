import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error frozen JS oracle has no declaration; test-only differential import.
import * as oldPlan from '../../../packages/parity/fixtures/oracle/frontend/src/lib/plan-share.js'
// @ts-expect-error frozen JS oracle has no declaration; test-only differential import.
import * as oldFit from '../../../packages/parity/fixtures/oracle/frontend/src/lib/fit-export.js'
// @ts-expect-error frozen JS oracle has no declaration; test-only differential import.
import { registerCustom as legacyCustom } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/exercises.js'
import { buildPlanBundle, parsePlan, mergePlan, planPrintHTML } from '../src/plan-share'
import { encodeFit, workoutFit, workoutFitMessages } from '../src/fit-export'
import type { FitMessage, FitField, FitBaseType } from '../src/fit-export'
import { createExerciseIndex } from '../src/exercises'
import type { ExportPlan, ExportWorkout } from '../src/export-types'

const runs = Number(process.env.PARITY_RUNS || 1000)
const same = (a: unknown, b: unknown) => {
  expect(a).toEqual(b)
  expect(JSON.stringify(a)).toBe(JSON.stringify(b))
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z')) })
afterEach(() => { legacyCustom([]); vi.restoreAllMocks(); vi.useRealTimers() })
const config = fc.record({
  id: fc.constantFrom('0025', '0031', 'c-body', 'c-cardio'),
  mode: fc.constantFrom('reps', 'time', 'cardio'), sets: fc.integer({ min: 1, max: 8 }),
  reps: fc.integer({ min: 0, max: 20 }), sec: fc.integer({ min: 1, max: 120 }),
  weight: fc.integer({ min: 0, max: 200 }), inc: fc.integer({ min: 0, max: 10 }),
  min: fc.integer({ min: 1, max: 30 }), speed: fc.integer({ min: 0, max: 20 }),
  bodyweight: fc.boolean(), side: fc.boolean(), backoff: fc.boolean(),
  warmupSets: fc.integer({ min: -1, max: 12 }), restSec: fc.integer({ min: -1, max: 200 }),
  note: fc.string({ maxLength: 30 }), lastToFailure: fc.boolean(),
  pyramid: fc.array(fc.integer({ min: 0, max: 20 }), { maxLength: 6 }),
  pyramidWeight: fc.array(fc.integer({ min: 0, max: 100 }), { maxLength: 6 }),
  intensifier: fc.oneof(fc.constant(undefined), fc.record({ type: fc.constantFrom('dropset', 'restpause', 'bad'), count: fc.integer({ min: -3, max: 4 }), pct: fc.integer({ min: -10, max: 40 }), totalReps: fc.integer({ min: 0, max: 30 }), restSec: fc.integer({ min: 0, max: 30 }) })),
})
const plan = fc.record({ unit: fc.constantFrom('kg', 'lb'), name: fc.string({ maxLength: 40 }), exercises: fc.array(config, { maxLength: 8 }), week: fc.constantFrom<ExportPlan['week']>({}, { 1: 'r' }, { 1: ['r'], 2: ['gone'] }) }).map(({ exercises, ...data }): ExportPlan => ({
  ...data, routines: [{ id: 'r', name: data.name, ex: exercises }],
  customEx: [
    { id: 'c-body', n: 'Synthetic custom hold', bp: 'chest', eq: 'body weight', tg: 'pectorals', primaries: ['chest'], url: 'example.com/guide' },
    { id: 'c-cardio', n: 'Synthetic custom ride', bp: 'cardio', eq: 'stationary bike' },
  ],
}))

describe('K16 plan codec and HTML differential', () => {
  it('exports, decodes, converts and generates exactly the legacy JSON/key order and HTML', () => {
    fc.assert(fc.property(plan, fc.constantFrom('kg', 'lb'), (s, destination) => {
      // The compat dependency graph is still legacy; seed its caller-owned counterpart for
      // oracle comparison only. Separate call-site tests verify explicit-index forwarding.
      legacyCustom(s.customEx)
      const index = createExerciseIndex(s.customEx)
      const next = buildPlanBundle(s, s.name, index), old = oldPlan.buildPlanBundle(s, s.name)
      same(next, old)
      same(parsePlan(JSON.stringify(next), destination, index), oldPlan.parsePlan(JSON.stringify(old), destination))
      same(planPrintHTML(s, '<Owner & "name">', {}, index), oldPlan.planPrintHTML(s, '<Owner & "name">'))
      same(planPrintHTML(s, '', { routineId: 'r' }, index), oldPlan.planPrintHTML(s, '', { routineId: 'r' }))
      const a: ExportPlan = { unit: destination, routines: [], customEx: [], week: { 5: ['old'] } }
      const b = structuredClone(a)
      // UIDs are intentionally generated. Fix the random input to compare the complete merge.
      vi.spyOn(Math, 'random').mockReturnValue(0.125)
      same(mergePlan(a, parsePlan(next, destination, index), { schedule: true }, index), oldPlan.mergePlan(b, oldPlan.parsePlan(old, destination), { schedule: true }))
      same(a, b)
    }), { seed: 161601, numRuns: runs })
  }, 120000)
  it('retains legacy failure behavior for arbitrary JSON inputs', () => {
    const outcome = (fn: () => unknown) => { try { return { result: fn() } } catch (e) { return { error: (e as Error).message, code: (e as {code?: string}).code } } }
    fc.assert(fc.property(fc.jsonValue(), raw => same(outcome(() => parsePlan(raw)), outcome(() => oldPlan.parsePlan(raw)))), { seed: 161602, numRuns: runs })
  })
})

const row = fc.record({ w: fc.integer({ min: -2, max: 220 }), r: fc.integer({ min: 0, max: 30 }), done: fc.boolean(), sec: fc.integer({ min: 0, max: 120 }), min: fc.integer({ min: 0, max: 30 }), speed: fc.integer({ min: 0, max: 25 }), phase: fc.constantFrom('work', 'warmup'), at: fc.integer({ min: 1791565200000, max: 1791568800000 }), drops: fc.array(fc.record({ w: fc.integer({ min: 0, max: 100 }), r: fc.integer({ min: 0, max: 20 }) }), { maxLength: 2 }) })
const workout = fc.record({ id: fc.string({ maxLength: 20 }), d: fc.constant('2026-10-09'), start: fc.constant(1791565200000), end: fc.integer({ min: 1791565200000, max: 1791568800000 }), entries: fc.array(fc.record({ id: fc.constantFrom('0025', '0031', '2259', '2138'), target: fc.record({ mode: fc.constantFrom('reps', 'time', 'cardio') }), sets: fc.array(row, { maxLength: 6 }) }), { maxLength: 5 }) })
const field = fc.tuple(fc.integer({ min: 0, max: 255 }), fc.constantFrom<FitBaseType>('enum', 'uint8', 'uint16', 'uint32', 'uint32z', 'string'), fc.oneof(fc.integer({ min: -100, max: 4294967395 }), fc.string({ maxLength: 30 }), fc.constant(undefined), fc.constant(null), fc.constant(NaN)), fc.integer({ min: 1, max: 32 })).map((v): FitField => v)
const messages = fc.array(fc.record({ global: fc.integer({ min: 0, max: 65535 }), fields: fc.array(field, { maxLength: 8 }) }), { maxLength: 20 })

describe('K16 FIT bytes differential', () => {
  it('encodes all base types, invalid numbers, UTF-8 strings and local-slot reuse byte-identically', () => {
    fc.assert(fc.property(messages, (m: FitMessage[]) => { expect(encodeFit(m)).toEqual(oldFit.encodeFit(m)) }), { seed: 161603, numRuns: runs })
  })
  it('produces identical workout messages and complete FIT files', () => {
    fc.assert(fc.property(workout, fc.constantFrom('kg', 'lb'), (w: ExportWorkout, unit) => {
      const options = { unit, version: '1.4.0-test' }
      same(workoutFitMessages(w, options), oldFit.workoutFitMessages(w, options))
      expect(workoutFit(w, options)).toEqual(oldFit.workoutFit(w, options))
    }), { seed: 161604, numRuns: runs })
  })
})
