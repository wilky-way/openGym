import { expect, it } from 'vitest'
import fc from 'fast-check'
import * as backfill from '../src/backfill'
import * as dates from '../src/workout-date'
import * as edits from '../src/session-edit'
// @ts-expect-error Frozen read-only oracle has no TypeScript declarations.
import * as legacyBackfill from '../../../packages/parity/fixtures/oracle/frontend/src/lib/backfill.js'
// @ts-expect-error Frozen read-only oracle has no TypeScript declarations.
import * as legacyDates from '../../../packages/parity/fixtures/oracle/frontend/src/lib/workout-date.js'
// @ts-expect-error Frozen read-only oracle has no TypeScript declarations.
import * as legacyEdits from '../../../packages/parity/fixtures/oracle/frontend/src/lib/session-edit.js'
import type { Workout } from '../../contract/domain/state-doc'
const equal = (actual: unknown, expected: unknown) => {
  expect(actual).toEqual(expected)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
}
const opts = { seed: 151515, numRuns: Number(process.env.PARITY_RUNS || 1000) }
const workout = fc.record({ id: fc.string({ minLength: 1 }), d: fc.constantFrom('2026-01-01', '2026-01-02', '2026-01-03'), start: fc.integer({ min: 1, max: 1000000 }), note: fc.string(), entries: fc.array(fc.record({ id: fc.constantFrom('0025', '0017'), sets: fc.array(fc.record({ w: fc.integer({ min: 1, max: 1000 }), r: fc.integer({ min: 1, max: 20 }), done: fc.boolean() }), { minLength: 1, maxLength: 3 }) }), { maxLength: 3 }), prs: fc.array(fc.constantFrom('0025', '0017'), { maxLength: 2 }) })
it('date moves, PR surgery, durations and backfill views keep legacy values and key order (1000 seeded cases)', () => {
  fc.assert(fc.property(fc.array(workout, { minLength: 1, maxLength: 6 }), fc.integer({ min: 0, max: 2000 }), (raw, minutes) => {
    const ws: Workout[] = raw.map(w => ({ ...w, end: w.start + 60000 })).sort((a, b) => a.d.localeCompare(b.d) || a.start - b.start)
    const ref = ws[0]!
    equal(dates.moveWorkout(ws, ref, '2025-12-30', '07:30', 777), legacyDates.moveWorkout(ws, ref, '2025-12-30', '07:30', 777))
    equal(dates.setWorkoutDuration(ws, ref, minutes, 777), legacyDates.setWorkoutDuration(ws, ref, minutes, 777))
    const state = { workouts: ws, exWeights: { '0025': { w: 100, d: '2026-01-03' } }, opaque: { kept: true } }
    equal(backfill.historyAsOf(state, { d: '2026-01-02', start: 500000, replaceId: ref.id }), legacyBackfill.historyAsOf(state, { d: '2026-01-02', start: 500000, replaceId: ref.id }))
    const a = structuredClone(ref), b = structuredClone(ref)
    equal(backfill.completeBackfill(ws, { backfill: { replaceId: ws.at(-1)!.id } }, a, 777), legacyBackfill.completeBackfill(ws, { backfill: { replaceId: ws.at(-1)!.id } }, b, 777))
  }), opts)
})
it('saved session edits and deletions keep legacy values, mutation and key order (1000 seeded cases)', () => {
  fc.assert(fc.property(workout, fc.integer({ min: 1, max: 1000 }), (raw, load) => {
    const original: Workout = { ...raw, end: raw.start + 60000, entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ w: 40, r: 5, done: true }] }] }
    const a: edits.EditState = { workouts: [original], exWeights: { '0025': { w: 40, d: original.d } }, active: null }
    const b = structuredClone(a)
    equal(edits.editCompletedSession(a, original.id!), legacyEdits.editCompletedSession(b, original.id!))
    equal(edits.editChangesNothing(a), legacyEdits.editChangesNothing(b))
    a.active!.entries[0]!.sets[0]!.w = load
    b.active!.entries[0]!.sets[0]!.w = load
    equal(edits.saveWorkoutEdit(a, 777), legacyEdits.saveWorkoutEdit(b, 777))
    equal(a, b)
    edits.editCompletedSession(a, original.id!)
    legacyEdits.editCompletedSession(b, original.id!)
    equal(edits.deleteEditedWorkout(a), legacyEdits.deleteEditedWorkout(b))
    equal(a, b)
  }), opts)
})
it('opaque saved fields retain legacy editor bytes while media is absent from the draft', () => {
  const original: Workout = {
    id: 'opaque', d: '2026-01-01', start: 1, end: 2,
    entries: [{ id: '0025', sets: [{ w: 40, r: 5, done: true }] }],
    media: [{ hash: 'a'.repeat(64), opaque: { retained: true } }],
    future: { owner: 'synthetic', fields: [1, 2] },
  }
  const a: edits.EditState = { workouts: [original], active: null }
  const b = structuredClone(a)
  equal(edits.editCompletedSession(a, 'opaque'), legacyEdits.editCompletedSession(b, 'opaque'))
  expect(a.active).not.toHaveProperty('media')
  expect(a.active!.future).toEqual(original.future)
  a.active!.entries[0]!.sets[0]!.w = 50
  b.active!.entries[0]!.sets[0]!.w = 50
  const saved = edits.saveWorkoutEdit(a, 777)
  equal(saved, legacyEdits.saveWorkoutEdit(b, 777))
  expect(saved!.media).toEqual(original.media)
  expect(saved!.future).toEqual(original.future)
  equal(a, b)
})
