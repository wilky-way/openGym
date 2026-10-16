import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
// @ts-expect-error — the read-only JS oracle has no TS declarations.
import * as legacyStart from '../../../packages/parity/fixtures/oracle/frontend/src/lib/session-start.js'
// @ts-expect-error — the read-only JS oracle has no TS declarations.
import * as legacyFinish from '../../../packages/parity/fixtures/oracle/frontend/src/lib/finish-workout.js'
// @ts-expect-error — the read-only JS oracle has no TS declarations.
import * as legacyFlow from '../../../packages/parity/fixtures/oracle/frontend/src/lib/supersetFlow.js'
import { buildSessionEntries } from '../src/session-start'
import { buildCompletedWorkout, sessionEnd } from '../src/finish-workout'
import { restSecFor, supersetFlowStep, nextUnfinishedUnit } from '../src/supersetFlow'
import type { Entry, Session, State } from '../src/session-types'

const check = (next: unknown, old: unknown) => {
  expect(next).toEqual(old)
  expect(JSON.stringify(next)).toBe(JSON.stringify(old))
}
const runs = { seed: 141414, numRuns: Number(process.env.PARITY_RUNS ?? 1000) }
const config = fc.record({
  id: fc.constantFrom('0025', '0001', '0220', '0431'),
  sets: fc.integer({ min: 1, max: 5 }), reps: fc.integer({ min: 1, max: 20 }),
  weight: fc.integer({ min: 0, max: 160 }), warmupSets: fc.integer({ min: 0, max: 3 }),
  prog: fc.constantFrom('off', 'linear', 'double', 'triple', 'greyskull'),
  mode: fc.constantFrom('reps', 'time', 'cardio'), sec: fc.integer({ min: 1, max: 120 }),
  min: fc.integer({ min: 1, max: 60 }), speed: fc.integer({ min: 1, max: 12 }),
})

describe('K14 session model differential parity', () => {
  it('buildSessionEntries preserves prescriptions, rows and JSON key order', () => {
    fc.assert(fc.property(config, fc.boolean(), fc.boolean(), fc.constantFrom('kg', 'lb'), (cfg, excluded, last, unit) => {
      const routine = { id: 'synthetic-routine', name: 'Synthetic', ex: [cfg], excludeFromProgression: excluded }
      const st: State = { unit, routines: [routine], workouts: [], exWeights: {}, startFrom: last ? 'last' : 'plan' }
      // Previous progress is itself saved through the legacy persisted boundary, as in the app.
      const prior = legacyStart.buildSessionEntries(st, routine)
      const w = legacyFinish.buildCompletedWorkout({ id: 'synthetic-prior', d: '2026-01-01', start: 1000,
        entries: prior.map((e: Entry) => ({ ...e, rid: routine.id, sets: e.sets!.map(s => ({ ...s, done: true })) })) }, { end: 2000 })
      const state = { ...st, workouts: [w] }
      check(buildSessionEntries(structuredClone(state), routine), legacyStart.buildSessionEntries(structuredClone(state), routine))
    }), runs)
  })

  it('finish preserves row cleanup, optional fields, duration and JSON key order', () => {
    const row = fc.record({ w: fc.integer({ min: 0, max: 160 }), r: fc.integer({ min: 0, max: 20 }), done: fc.boolean(),
      phase: fc.constantFrom('warmup', 'work'), sec: fc.integer({ min: 0, max: 60 }), min: fc.integer({ min: 0, max: 40 }),
      at: fc.integer({ min: 1000, max: 8_000_000 }), planSec: fc.option(fc.integer({ min: 1, max: 60 }), { nil: undefined }),
      weightOrigin: fc.option(fc.constant('manual'), { nil: undefined }) })
    fc.assert(fc.property(fc.array(fc.record({ id: fc.constantFrom('0025', '0001'), sets: fc.array(row, { maxLength: 6 }),
      rid: fc.option(fc.constant('r'), { nil: undefined }), noProg: fc.boolean(), sg: fc.constantFrom('', 'g'),
      note: fc.constantFrom('', ' synthetic note '), notePin: fc.boolean() }), { maxLength: 5 }), entries => {
      const active: Session = { id: 'synthetic-w', d: '2026-01-02', start: 1000, entries, routineIds: ['r'], note: ' synthetic ' }
      const original = structuredClone(active)
      check(buildCompletedWorkout(active, { end: 9_000_000 }), legacyFinish.buildCompletedWorkout(original, { end: 9_000_000 }))
      check(sessionEnd(active, 9_000_000), legacyFinish.sessionEnd(original, 9_000_000))
      expect(active).toEqual(original)
    }), runs)
  })

  it('superset navigation and rest preserve uneven rounds and re-checks', () => {
    fc.assert(fc.property(fc.array(fc.array(fc.boolean(), { maxLength: 5 }), { minLength: 2, maxLength: 6 }), fc.nat(30), (done, from) => {
      const entries: Entry[] = done.map(sets => ({ sets: sets.map(done => ({ done })), target: { restSec: 120 } }))
      const unit = entries.map((_, i) => i), idx = from % entries.length
      check(supersetFlowStep(entries, unit, idx), legacyFlow.supersetFlowStep(entries, unit, idx))
      check(nextUnfinishedUnit(entries, unit.map(i => [i]), idx), legacyFlow.nextUnfinishedUnit(entries, unit.map(i => [i]), idx))
      check(restSecFor(entries, unit, 90), legacyFlow.restSecFor(entries, unit, 90))
    }), runs)
  })
})
