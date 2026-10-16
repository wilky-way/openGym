import { test, expect } from 'bun:test'
import fc from 'fast-check'
// @ts-expect-error frozen JS oracle has no declarations; differential-test boundary only
import * as old from '../../../packages/parity/fixtures/oracle/api/nudge.js'
// @ts-expect-error frozen JS oracle has no declarations; differential-test boundary only
import { effectiveRoutineId as oldRoutine } from '../../../packages/parity/fixtures/oracle/api/queue.js'
import { serverNudgeFor, serverRoutineId, nudgeWindowOpen } from '../src/reminders'
import { nudgePush } from '../src/push-messages'
// @ts-expect-error frozen JS oracle has no declarations; differential-test boundary only
import { nudgePush as oldPush } from '../../../packages/parity/fixtures/oracle/api/push-messages.js'
const iso = '2026-09-07'
const RUNS = Math.max(1000, Number(process.env.DIFF_RUNS) || 1000)
const outcome = (fn: () => unknown) => {
  try { return { value: fn() } } catch (e) { return { error: (e as Error).name } }
}
test('server routine lookup preserves null-workout errors and queue short-circuit ordering', () => {
  for (const workouts of [[null], [null, { routineId: 'r1', start: 1 }], [{ routineId: 'r1', start: 1 }, null]]) {
    for (const queue of [null, { ids: ['r1'], since: 0, startsOn: iso }, { ids: ['r1'], since: 0, startsOn: iso, skipped: ['r1'] }]) {
      const s = { routines: [{ id: 'r1', name: 'First' }], workouts, week: { 1: 'r1' }, queue }
      expect(outcome(() => serverRoutineId(s, iso))).toEqual(outcome(() => oldRoutine(s, iso)))
    }
  }
})
test('seeded server nudge differential includes malformed states and user-zone queue apply dates', () => {
  const junk = fc.constantFrom(null, 'x', 7, true, {}, [], [null, false, 1, 'x'])
  const routines = [{ id: 'push', name: 'Push Day' }, { id: 'pull', name: 'Pull Day' }]
  const rid = fc.constantFrom('push', 'pull', 'rest', 0, false, '', null)
  const planned = fc.oneof(rid, fc.array(rid, { maxLength: 3 }))
  const dates = Array.from({ length: 18 }, (_, i) => new Date(Date.parse(iso + 'T12:00:00Z') + (i - 15) * 86400000).toISOString().slice(0, 10))
  const state = fc.record({
    routines: fc.oneof(fc.constant(routines), junk, fc.constant([null, ...routines]),
      fc.constant([...routines, { id: 'rest' }, { id: 0 }, { id: false }, { id: '' }, { id: null }])),
    workouts: fc.oneof(junk, fc.array(fc.record({ d: fc.constantFrom('2026-09-03', '2026-09-04', '2026-09-06', iso),
      routineId: fc.constantFrom('push', 'pull'), start: fc.integer({ min: 0, max: 9 }) }), { maxLength: 4 })),
    week: fc.oneof(junk, fc.constant({ 1: ['push', 'pull'], 3: 'push', 5: 'pull' }),
      fc.record({ 0: planned, 1: planned, 2: planned, 3: planned, 4: planned, 5: planned, 6: planned })),
    dayPlan: fc.oneof(junk, fc.constant({ [iso]: 'pull' }), fc.constant({ [iso]: 'rest' }), fc.dictionary(fc.constantFrom(...dates), rid)),
    queue: fc.oneof(junk, fc.constant({ ids: ['push', 'pull'], since: 0, startsOn: '2026-09-07' }),
      fc.constant({ ids: ['push', 'pull'], since: Date.parse('2026-09-07T01:00:00Z') }),
      fc.record({ ids: fc.array(rid, { maxLength: 4 }), since: fc.constantFrom(0, true, {}, [], 'invalid', '2026-09-07T00:00:00Z'),
        startsOn: fc.constantFrom(undefined, '2026-08-20', '2026-09-06', '2026-09-07') })),
    reminder: fc.constantFrom({ tz: 'UTC' }, { tz: 'America/Chicago' }, { tz: 'Etc/GMT-14' }, { tz: 'bad/zone' },
      { tz: ['Etc/GMT-14'] }, { tz: [] }, { tz: {} }, { tz: null }, { tz: true }),
    dayNotes: fc.oneof(junk, fc.constant({ [iso]: { tag: 'sick' } }), fc.constant({ [iso]: { text: 'Synthetic' } })),
  })
  fc.assert(fc.property(state, s => {
    expect(outcome(() => serverNudgeFor(s, iso))).toEqual(outcome(() => old.nudgeFor(s, iso)))
  }), { seed: 505, numRuns: RUNS })
  for (const s of [null, undefined, false, 4, 'x', {}, []]) expect(outcome(() => serverNudgeFor(s, iso))).toEqual(outcome(() => old.nudgeFor(s, iso)))
})
test('malformed rest routine IDs do not let a server adapter rewrite floating-queue pins', () => {
  const s = { routines: [{ id: 'push' }, { id: 'pull' }, { id: 'rest' }, { id: 0 }], workouts: [],
    week: { 0: null, 1: 'push', 2: [], 3: '', 4: 0, 5: null, 6: [] }, dayPlan: { '2026-09-03': 0 },
    queue: { ids: [0, 'rest'], since: 0, startsOn: '2026-08-20', skipped: [] } }
  expect(serverNudgeFor(s, iso)).toBe(old.nudgeFor(s, iso))
  expect(serverNudgeFor(s, iso)).toBeNull()
})
test('falsy queue pins remain visible to earlier scalar missed-day calculations', () => {
  const s = { routines: [{ id: 0 }, { id: 'push' }, { id: 'pull' }], workouts: [{ d: '2026-08-29' }],
    week: { 1: 'pull' }, dayPlan: { '2026-09-03': 0 }, queue: { ids: [0, 'push'], since: 0, startsOn: '2026-08-20' } }
  expect(serverNudgeFor(s, iso)).toBeNull()
  expect(serverNudgeFor(s, iso)).toBe(old.nudgeFor(s, iso))
})
test('server single routine and nudge window match legacy over seeded valid states', () => {
  fc.assert(fc.property(fc.array(fc.constantFrom('push', 'pull')), fc.constantFrom(undefined, 'push', 'pull', 'rest'), (ids, override) => {
    const s = { routines: [{ id: 'push' }, { id: 'pull' }], workouts: [], week: { 1: ids }, dayPlan: { [iso]: override } }
    expect(serverRoutineId(s, iso)).toEqual(oldRoutine(s, iso))
  }), { seed: 506, numRuns: 1000 })
  fc.assert(fc.property(fc.constantFrom('08:00', '19:00', '19:30', '20:00', undefined, 'garbage'), fc.integer({ min: 0, max: 1439 }), (time, m) => {
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    expect(nudgeWindowOpen(time, hhmm)).toEqual(old.nudgeWindowOpen(time, hhmm))
  }), { seed: 507, numRuns: 1000 })
})
test('server queue fallback uses the user zone even when it crosses the host calendar date', () => {
  for (const [since, tz] of [['2026-09-06T13:00:00Z', 'Etc/GMT-14'], ['2026-09-07T05:00:00Z', 'Etc/GMT+10']]) {
    const s = { routines: [{ id: 'push' }, { id: 'pull' }], workouts: [], week: {}, dayPlan: {},
      queue: { ids: ['push', 'pull'], since: Date.parse(since!) }, reminder: { tz } }
    for (const date of ['2026-09-06', '2026-09-07', '2026-09-08']) {
      expect(serverRoutineId(s, date)).toEqual(oldRoutine(s, date))
      expect(serverNudgeFor(s, date)).toEqual(old.nudgeFor(s, date))
    }
  }
})
test('malformed queue apply clocks retain legacy Date constructor semantics', () => {
  for (const since of ['2026-09-07T00:00:00Z', '2026-09-06', 'x', [], {}, true, null, 0]) {
    const s = { routines: [{ id: 'push' }], workouts: [], week: {}, dayPlan: {}, queue: { ids: ['push'], since }, reminder: { tz: 'UTC' } }
    expect(outcome(() => serverRoutineId(s, iso))).toEqual(outcome(() => oldRoutine(s, iso)))
    expect(outcome(() => serverNudgeFor(s, iso))).toEqual(outcome(() => old.nudgeFor(s, iso)))
  }
})
test('invalid queue clocks do not bypass trained, excused or rest-day early exits', () => {
  for (const over of [{ workouts: [{ d: iso }] }, { dayNotes: { [iso]: { tag: 'sick' } } }, { dayPlan: { [iso]: 'rest' } }]) {
    const s = { routines: [{ id: 'push' }], workouts: [], week: { 1: 'push' }, dayPlan: {},
      queue: { ids: ['push'], since: 'invalid' }, ...over }
    expect(serverNudgeFor(s, iso)).toBe(old.nudgeFor(s, iso))
    expect(serverNudgeFor(s, iso)).toBeNull()
  }
})
test('falsy first routine IDs are not missed days in the legacy server back-off', () => {
  for (const id of [0, false, '', null]) {
    const s = { routines: [{ id: 'push' }, { id }], workouts: [{ d: '2026-09-03' }], dayPlan: {},
      week: { 1: 'push', 5: [id], 6: [id], 0: [id] } }
    expect(serverNudgeFor(s, iso)).toBe('push')
    expect(serverNudgeFor(s, iso)).toBe(old.nudgeFor(s, iso))
    expect(serverRoutineId(s, '2026-09-04')).toBe(oldRoutine(s, '2026-09-04'))
  }
})
test('English nudge payload is byte-identical to legacy server', () => {
  for (const tone of ['friendly', 'guilt', 'drill', 'bad']) for (const name of ['Synthetic', '$& $1', '', undefined]) {
    expect(JSON.stringify(nudgePush('en', tone, { name }, iso))).toBe(JSON.stringify(oldPush('en', tone, { name }, iso)))
  }
})
test('legacy Intl and regex coercions accept singleton timezone/time arrays', () => {
  const s = { routines: [{ id: 'push' }], workouts: [], week: {}, dayPlan: {},
    queue: { ids: ['push'], since: Date.parse('2026-09-03T13:00:00Z') }, reminder: { tz: ['Etc/GMT-14'] } }
  expect(serverNudgeFor(s, '2026-09-06')).toBe('push')
  expect(serverNudgeFor(s, '2026-09-06')).toBe(old.nudgeFor(s, '2026-09-06'))
  expect(nudgeWindowOpen(['08:00'], ['20:00'])).toBe(old.nudgeWindowOpen(['08:00'], ['20:00']))
})
