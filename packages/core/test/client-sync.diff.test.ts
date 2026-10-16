import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import * as current from '../src/sync-merge'
import * as units from '../src/units'
import * as changes from '../src/sync-changes'
import * as upgrade from '../src/sync-legacy'
import type { SyncDoc, SyncEntry } from '../src/sync-types'
import * as legacy from '../../../packages/parity/fixtures/oracle/frontend/src/lib/sync-merge.js'
import * as legacyUnits from '../../../packages/parity/fixtures/oracle/frontend/src/lib/units.js'
import * as legacyChanges from '../../../packages/parity/fixtures/oracle/frontend/src/lib/sync-changes.js'
import * as legacyUpgrade from '../../../packages/parity/fixtures/oracle/frontend/src/lib/sync-legacy.js'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const clock = fc.integer({ min: 0, max: 2_000_000_000_000 })
const id = fc.constantFrom('a', 'b', 'c')
const day = fc.constantFrom('2026-10-01', '2026-10-02', '2026-10-03')
const fields = fc.dictionary(fc.constantFrom('name', 'entries', 'note', 'ex'), clock)
const undo = fc.dictionary(fc.constantFrom('name', 'entries', 'ex'), fc.tuple(clock, clock, clock))
const rows = fc.array(fc.record({ w: fc.integer({ min: 0, max: 300 }), r: fc.integer({ min: 1, max: 20 }), done: fc.boolean() }), { maxLength: 3 })
const entry = fc.record({ id, sets: rows })
const workout = fc.record({ id, d: day, start: clock, _ts: clock, _f: fields, _u: undo, entries: fc.array(entry, { maxLength: 2 }), note: fc.string({ maxLength: 6 }) })
const routine = fc.record({ id, name: fc.string({ maxLength: 6 }), _ts: clock, _f: fields, _u: undo, ex: fc.array(fc.record({ id, weight: fc.integer({ min: 0, max: 100 }), sets: fc.integer({ min: 1, max: 5 }) }), { maxLength: 2 }) })
const mapClocks = fc.dictionary(id, clock)
const doc: fc.Arbitrary<SyncDoc> = fc.record({
  unit: fc.constantFrom('kg', 'lb'), unitSet: fc.record({ at: clock, convert: fc.boolean() }), _ts: clock,
  restSec: fc.integer({ min: 0, max: 300 }), accent: fc.constantFrom('lime', 'custom', 'bad!'), accentCustom: fc.constantFrom('#ff0000', 'url(x)'),
  workouts: fc.array(workout, { maxLength: 3 }), routines: fc.array(routine, { maxLength: 3 }), customEx: fc.array(fc.record({ id, name: fc.string({ maxLength: 6 }), _ts: clock }), { maxLength: 2 }),
  bodyweight: fc.array(fc.record({ d: day, w: fc.integer({ min: 40, max: 120 }), t: clock }), { maxLength: 3 }),
  measurements: fc.array(fc.record({ d: day, t: clock, waist: fc.integer({ min: 60, max: 140 }) }), { maxLength: 2 }),
  equipProfiles: fc.array(fc.record({ id, name: fc.string({ maxLength: 5 }), _ts: clock }), { maxLength: 2 }), gymCards: fc.constant([]), favEx: fc.array(id, { maxLength: 3 }),
  exWeights: fc.dictionary(id, fc.record({ w: fc.integer({ min: 0, max: 300 }), d: day })),
  week: fc.dictionary(fc.constantFrom('1', '2'), fc.array(id, { maxLength: 2 })), dayPlan: fc.dictionary(day, id), exNotes: fc.dictionary(id, fc.string({ maxLength: 4 })), barWeights: fc.dictionary(id, fc.integer({ min: 0, max: 30 })),
  edited: fc.dictionary(fc.constantFrom('restSec', 'week.1', 'exNotes.a', 'routineOrder', 'future'), clock),
  undone: fc.dictionary(fc.constantFrom('restSec', 'week.1'), fc.tuple(clock, clock, clock)),
  deleted: fc.record({ workouts: mapClocks, routines: fc.dictionary(id, fc.integer({ min: -1_000_000, max: 1_000_000 })), favEx: mapClocks }),
  resetAt: fc.oneof(fc.constant(0), clock), resetIds: fc.record({ workouts: fc.array(id, { maxLength: 3 }), routines: fc.array(id, { maxLength: 3 }) }),
  dayNotes: fc.dictionary(day, fc.record({ text: fc.string({ maxLength: 4 }), _ts: clock })),
  loadKind: fc.dictionary(id, fc.record({ kind: fc.constantFrom('pairs', 'single', null), _ts: clock })),
  programmes: fc.record({ version: fc.constant(1), fork: fc.constant('wilky/1'), definitions: fc.array(fc.record({ id, name: id, unit: fc.constant('kg'), weeks: fc.constant([]), _ts: clock }), { maxLength: 2 }), cycles: fc.constant([]) }),
  future: fc.jsonValue({ maxDepth: 2 }),
})

function equal(actual: unknown, expected: unknown) {
  expect(actual).toEqual(expected)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
}

describe('K10 client-sync differential', () => {
  it('mergeStates/stampChange/stampEdits preserve values and key order over 100,000 seeded doc pairs', () => {
    fc.assert(fc.property(doc, doc, fc.constantFrom(undefined, 'a', 'b'), clock, (a, b, prefer, wall) => {
      const result = current.mergeStates(a, b, { prefer })!
      equal(result, legacy.mergeStates(a, b, { prefer }))
      equal(current.mergeStates(result, result, { prefer }), legacy.mergeStates(result, result, { prefer }))
      equal(current.mergeStates(result, b, { prefer }), legacy.mergeStates(result, b, { prefer }))
      const next = clone(b), oldNext = clone(b)
      equal(current.stampChange(a, next, wall), legacy.stampChange(a, oldNext, wall))
      equal(next, oldNext)
      equal(current.stampEdits(a, clone(b), wall), legacy.stampEdits(a, clone(b), wall))
    }), { seed: 101310, numRuns: 100_000 })
  }, 360_000)

  it('missing peers retain legacy clone values and JSON order when manifests are absent', () => {
    for (const a of [null, undefined]) for (const b of [null, undefined]) equal(current.mergeStates(a, b), legacy.mergeStates(a, b))
    fc.assert(fc.property(doc, value => {
      for (const missing of [null, undefined]) {
        for (const prefer of [undefined, 'a', 'b']) {
          const adopted = current.mergeStates(missing, value, { prefer })!
          equal(adopted, legacy.mergeStates(missing, value, { prefer }))
          equal(current.mergeStates(value, missing, { prefer }), legacy.mergeStates(value, missing, { prefer }))
          expect(adopted).not.toBe(value)
          expect(adopted.programmes).not.toBe(value.programmes)
        }
      }
    }), { seed: 101314, numRuns: 1_000 })
  })

  it('units, fingerprints, legacy lifting and reset-id keys retain the frozen algorithms', () => {
    fc.assert(fc.property(doc, doc, clock, (a, b, wall) => {
      equal(units.convertStateUnit(a, 'lb'), legacyUnits.convertStateUnit(a, 'lb'))
      equal(changes.syncFingerprint(a), legacyChanges.syncFingerprint(a))
      equal(changes.countChanges(b, changes.syncFingerprint(a)), legacyChanges.countChanges(b, legacyChanges.syncFingerprint(a)))
      equal(upgrade.restHash139(a), legacyUpgrade.restHash139(a))
      equal(upgrade.liftLegacy(a, b, { s: upgrade.restHash139(a) }, wall), legacyUpgrade.liftLegacy(a, b, { s: legacyUpgrade.restHash139(a) }, wall))
      for (const field of ['workouts', 'routines']) for (const entry of (a[field] as SyncEntry[])) equal(current.entryKey(field, entry), legacy.entryKey(field, entry))
    }), { seed: 101311, numRuns: 1_000 })
  })
})
