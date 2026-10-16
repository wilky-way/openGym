import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import * as calendar from '../src/programme-calendar'
import * as queue from '../src/queue'
import * as rotation from '../src/rotation'
import * as sync from '../src/programme-sync'
import * as edit from '../src/programme-edit'
import { programmeRuleText } from '../src/programme-rule-text'
// @ts-expect-error Frozen oracle is JavaScript and has no module declarations.
import * as oracleCalendar from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-calendar.js'
// @ts-expect-error Frozen oracle is JavaScript and has no module declarations.
import * as oracleQueue from '../../../packages/parity/fixtures/oracle/frontend/src/lib/queue.js'
// @ts-expect-error Frozen oracle is JavaScript and has no module declarations.
import * as oracleRotation from '../../../packages/parity/fixtures/oracle/frontend/src/lib/rotation.js'
// @ts-expect-error Frozen oracle is JavaScript and has no module declarations.
import * as oracleSync from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-sync.js'
// @ts-expect-error Frozen oracle is JavaScript and has no module declarations.
import * as oracleEdit from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-edit.js'
// @ts-expect-error Frozen oracle is JavaScript and has no module declarations.
import { programmeRuleText as oracleRuleText } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-rule-text.js'

const oldCalendar = oracleCalendar as typeof calendar
const oldQueue = oracleQueue as typeof queue
const oldRotation = oracleRotation as typeof rotation
const oldSync = oracleSync as typeof sync
const oldEdit = oracleEdit as typeof edit
const oldRuleText = oracleRuleText as typeof programmeRuleText
const options = { seed: 4042026, numRuns: Number(process.env.FC_RUNS || 1000) }
const same = (actual: unknown, expected: unknown) => {
  expect(actual).toEqual(expected)
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
}
const date = fc.constantFrom('2026-03-07', '2026-03-08', '2026-09-12', '2026-10-31', '2026-11-01')
const ids = fc.uniqueArray(fc.constantFrom('a', 'b', 'c'), { minLength: 1 })
const occurrence = fc.record({
  instanceId: fc.constantFrom('o1', 'o2', 'o3', 'o4'), routineId: fc.constantFrom('a', 'b', 'c'),
  weekIndex: fc.integer({ min: 1, max: 3 }), ordinal: fc.integer({ min: 1, max: 4 }), dayKey: fc.constantFrom('d1', 'd2'),
  status: fc.constantFrom('pending', 'done', 'skipped'), pinnedOn: date, date,
  _ts: fc.nat(100), _f: fc.record({ status: fc.nat(100) }), extra: fc.jsonValue(),
})
const cycle = fc.record({ id: fc.constant('c'), programmeId: fc.constant('p'), status: fc.constantFrom('active', 'paused', 'finished', 'archived'),
  since: fc.constant(100), startsOn: date, cadence: fc.record({ perWeek: fc.integer({ min: 1, max: 9 }) }),
  weekIndex: fc.constant(1), snapshot: fc.constant<sync.Snapshot>({ name: 'Synthetic', weeks: [{ index: 1, mode: 'train' }, { index: 2, mode: 'deload' }] }),
  occurrences: fc.array(occurrence, { maxLength: 8 }), _ts: fc.nat(100), _f: fc.record({ status: fc.nat(100) }), extra: fc.jsonValue(),
})
const log = fc.record({ id: fc.constant('w'), d: date, start: fc.integer({ min: 0, max: 200 }), name: fc.constantFrom('A', 'B + Core', ''),
  routineIds: ids, entries: fc.array(fc.record({ occurrenceId: fc.constantFrom('o1', 'o2', 'o3', 'o4') }), { maxLength: 2 }),
})
const programme = fc.record({ version: fc.nat(3), fork: fc.constant('future'),
  definitions: fc.array(fc.record({ id: fc.constantFrom('p', 'q', 'p'), _ts: fc.nat(100), extra: fc.jsonValue() }), { maxLength: 5 }),
  cycles: fc.array(cycle, { maxLength: 3 }), _ts: fc.nat(100), unknownRoot: fc.jsonValue(),
})
const state = fc.record({
  routines: fc.constant<sync.SchedulingRoutine[]>([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }, { id: 'own', name: 'Core' }]),
  workouts: fc.array(log, { maxLength: 5 }),
  queue: fc.record({ ids, since: fc.integer({ min: 0, max: 200 }), startsOn: date, label: fc.constant('Synthetic'), strict: fc.boolean(), rotationId: fc.constant('r') }),
  rotation: fc.record({ id: fc.constant('r'), sequence: ids, label: fc.constant('Synthetic') }),
  dayPlan: fc.constant<NonNullable<sync.SchedulingState['dayPlan']>>({ '2026-11-01': 'a' }), week: fc.constant<NonNullable<sync.SchedulingState['week']>>({ Mon: ['own', 'a'], Tue: 'b' }),
})
const merge: sync.MergeEntry = (a, b) => ({ ...b, ...a })
const stamp: sync.StampEntry = (_a, b, now) => { b._ts = now; b._f = { ...b._f as Record<string, number>, synthetic: now } }

describe('K04 differential parity: deep values and stored JSON order', () => {
  it('calendar projection and month cells across pins, history, malformed duplicate occurrences and DST', () => {
    fc.assert(fc.property(cycle, fc.array(log, { maxLength: 6 }), date, ids, (c, logs, today, order) => {
      const actual = calendar.projectCycle(c, logs, today, { ids: order })
      const expected = oldCalendar.projectCycle(c, logs, today, { ids: order })
      same(actual, expected)
      same(calendar.monthCells(actual, today.slice(0, 7), { workouts: logs, today, weekStartsOn: 1 }), oldCalendar.monthCells(expected, today.slice(0, 7), { workouts: logs, today, weekStartsOn: 1 }))
    }), options)
  })
  it('queue selectors and rotation mutations preserve the done rule, pins, tally and refill boundaries', () => {
    fc.assert(fc.property(state, date, (input, today) => {
      const s = input as sync.SchedulingState
      same(queue.queueOf(s), oldQueue.queueOf(s))
      same(queue.queueDone(s), oldQueue.queueDone(s))
      same(queue.queueRemaining(s), oldQueue.queueRemaining(s))
      same(queue.queueNext(s, today, today), oldQueue.queueNext(s, today, today))
      same(queue.queueLiveOn(s, today, today), oldQueue.queueLiveOn(s, today, today))
      same(queue.queueView(s, today), oldQueue.queueView(s, today))
      same(queue.weekTally(s, today), oldQueue.weekTally(s, today))
      same(queue.pinState(s, 'a'), oldQueue.pinState(s, 'a'))
      for (const method of ['startPass', 'startNewPass', 'refillIfComplete', 'chooseRotation', 'chooseFixedWeek', 'stopPass'] as const) {
        const a = structuredClone(s), b = structuredClone(s)
        same(rotation[method](a, today, 300), oldRotation[method](b, today, 300)); same(a, b)
      }
    }), options)
  })
  it('programme normalisation, reset, union, ownership and recursive stamps preserve unknown fields and clocks without manifests', () => {
    fc.assert(fc.property(programme, programme, fc.array(log, { maxLength: 5 }), (a, b, logs) => {
      same(sync.normaliseProgrammes(a), oldSync.normaliseProgrammes(a))
      same(sync.programmesSinceReset(a, 50, { programmeDefinitions: ['p'], programmeCycles: ['c'] }), oldSync.programmesSinceReset(a, 50, { programmeDefinitions: ['p'], programmeCycles: ['c'] }))
      same(sync.mergeProgrammes(a, b, logs, merge), oldSync.mergeProgrammes(a, b, logs, merge))
      same(sync.programmeStamp({ programmes: a }), oldSync.programmeStamp({ programmes: a }))
      const x = structuredClone(b), y = structuredClone(b)
      sync.stampProgrammes(a, x, 200, stamp); oldSync.stampProgrammes(a, y, 200, stamp); same(x, y)
      const sa: sync.SchedulingState = { routines: [{ id: 'a', ex: [], programme: { cycleId: 'c', instanceId: 'o1', series: 's' } }], workouts: logs, programmes: structuredClone(a), queue: { ids: ['a'], programmeCycleId: 'c' } }
      const sb = structuredClone(sa); sync.reconcileProgrammeOwnership(sa); oldSync.reconcileProgrammeOwnership(sb); same(sa, sb)
    }), options)
  })
  it('rule text renders authored arithmetic and rejects unsupported or hostile text byte-identically', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 20 }), fc.integer({ min: 1, max: 5 }), fc.constantFrom('lb', 'kg', '%'), fc.constantFrom('>=', '==', '<'), fc.string(), (increase, count, unit, op, unknown) => {
      for (const summary of [
        `linear: add ${increase}${unit} after ${count} successful session(s)`,
        `custom(increase: ${increase}${unit}): if (completedReps ${op} reps) { weights += state.increase }`,
        'custom(): ' + unknown,
      ]) {
        const exercise = { sets: [{ count, reps: 5 }], rules: [{ kind: 'progress', summary }] }
        same(programmeRuleText(exercise), oldRuleText(exercise))
      }
    }), options)
  })
  it('scoped prescription edits preserve stable slots and later-stage ordering', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 20 }), fc.boolean(), (sets, reverse) => {
      const s: sync.SchedulingState = { workouts: [], routines: [1, 2].map(i => ({ id: 'r' + i, ex: [{ id: 'press', sets: i, slotId: 'lift' }, { id: 'row', sets: 2, slotId: 'row' }], programme: { cycleId: 'c', instanceId: 'o' + i } })), programmes: { cycles: [{ id: 'c', occurrences: [1, 2].map(i => ({ instanceId: 'o' + i, routineId: 'r' + i, weekIndex: i, dayKey: 'd', status: 'pending' })) }] } }
      const old = structuredClone(s)
      const update = (ex: import('../../contract/domain/state-doc').RoutineExercise[]) => { ex[0]!.sets = sets; if (reverse) ex.reverse() }
      edit.editProgrammeSessions(s, 'r1', update, true); oldEdit.editProgrammeSessions(old, 'r1', update, true); same(s, old)
    }), options)
  })
})
