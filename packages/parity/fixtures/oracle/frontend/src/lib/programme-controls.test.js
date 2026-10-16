import { describe, it, expect } from 'vitest'
import { activate, adopt, advanceProgramme, shiftNotToday, skip, pin, pause, resume, insertDeload } from './programme.js'
import { projectCycle, occurrenceWeekId } from './programme-calendar.js'
import { queueRemaining, queueDone, queueNext, queueView, weekTally, pinState } from './queue.js'
import { effectiveRoutineId, queueLiveOn as apiLive, pinState as apiPin } from '../../../api/queue.js'
import { effectiveRoutineIds } from './history.js'
import { refillAfter, refillIfComplete, startPass, saveRotation, startNewPass } from './rotation.js'
import { mergeStates, stampChange } from './sync-merge.js'

const TODAY = '2026-10-12'
const definition = () => ({ id: 'synthetic', name: 'Synthetic programme', short: 'SYN', unit: 'lb', weeks: [4, 5, 6].map(index => ({ index, mode: index === 6 ? 'deload' : 'train', rir: 2, days: [1, 2, 3, 4].map(n => ({ key: `d${n}`, ordinal: n, sessions: [{ sessionTemplateId: `d${n}`, routineSnapshot: { name: `D${n}`, ex: [{ id: '0025', weight: 100, sets: 4, reps: 8 }] } }] })) })) })
const setup = () => {
  const S = { unit: 'lb', workouts: [], routines: [], exWeights: {}, week: {}, dayPlan: {} }
  activate(S, definition(), { cycleId: 'c', today: TODAY, now: 10 })
  return S
}
const c = S => S.programmes.cycles[0]
const o = (S, w, d) => c(S).occurrences.find(o => o.instanceId === `c:w${w}d${d}`)
const train = (S, occurrence, date) => {
  const log = { id: occurrence.instanceId, d: date, start: 20, routineIds: [occurrence.routineId], programmeInstance: { cycleId: 'c', instanceId: occurrence.instanceId, weekIndex: occurrence.weekIndex, ordinal: occurrence.ordinal } }
  S.workouts.push(log)
  return log
}
const projection = (S, today = TODAY) => projectCycle(c(S), S.workouts, today, S.queue)

// The API asks only today's date; the frontend can preview a future date against today.
const parity = (S, day) => {
  expect(effectiveRoutineId(S, day)).toBe(effectiveRoutineIds(S, day, day)[0] || null)
  expect(apiLive(S, day)).toBe(queueView(S, day)?.remaining.length > 0)
}

describe('programme controls and rollover', () => {
  it('Shift changes only the lower bound, never dates or statuses, and clears after early training', () => {
    const S = setup(), before = structuredClone(c(S).occurrences)
    expect(shiftNotToday(S, 'c', TODAY)).toBe(true)
    expect(c(S).occurrences).toEqual(before)
    expect(projection(S).endDate).toBe('2026-11-01')
    expect(queueNext(S, TODAY, TODAY)).toBeNull()
    expect(effectiveRoutineId(S, TODAY)).toBeNull()
    expect(queueNext(S, '2026-10-13', TODAY)).toBe('c-w4d1')
    train(S, o(S, 4, 1), TODAY)
    advanceProgramme(S, TODAY, 30)
    expect(c(S).notBefore).toBeNull()
    expect(projection(S).next.date).toBe('2026-10-13')
  })
  it('skip is planned-not-done, pulls the end earlier and matches API pins/next', () => {
    const S = setup()
    skip(S, 'c', 'c:w4d1', { today: TODAY, now: 30 })
    expect(S.queue.skipped).toEqual(['c-w4d1'])
    expect(queueRemaining(S)).toEqual(['c-w4d2', 'c-w4d3', 'c-w4d4'])
    expect(queueDone(S)).toEqual([])
    expect(queueView(S, TODAY).items[0].state).toBe('skipped')
    expect(weekTally(S, TODAY)).toEqual({ done: 0, planned: 4 })
    expect(pinState(S, 'c-w4d1')).toBe('done')
    expect(apiPin(S, 'c-w4d1')).toBe('done')
    expect(projection(S).endDate).toBe('2026-10-29')
    parity(S, TODAY)
  })
  it('a finished log beats even a queue skip, and adherence credits it once', () => {
    const S = setup()
    skip(S, 'c', 'c:w4d1', { today: TODAY })
    train(S, o(S, 4, 1), TODAY)
    advanceProgramme(S, TODAY, 30)
    expect(S.queue.skipped).toEqual([])
    expect(queueView(S, TODAY).items[0].state).toBe('done')
    expect(weekTally(S, TODAY)).toEqual({ done: 1, planned: 4 })
    expect(effectiveRoutineId(S, TODAY)).toBeNull()
    parity(S, '2026-10-13')
  })
  it('closes the program week when every session is resolved, regardless of Sunday', () => {
    const S = setup()
    advanceProgramme(S, '2026-10-18', 25)
    expect(c(S).weekIndex).toBe(4)
    train(S, o(S, 4, 1), TODAY); train(S, o(S, 4, 2), '2026-10-13')
    skip(S, 'c', 'c:w4d3', { today: '2026-10-13', now: 30 })
    expect(projection(S, '2026-10-13').endDate).toBe('2026-10-28')
    train(S, o(S, 4, 4), '2026-10-14')
    advanceProgramme(S, '2026-10-14', 40)
    expect(c(S).weekIndex).toBe(5)
    expect(c(S).rollover).toMatchObject({ fromWeekIndex: 4, toWeekIndex: 5, closedOn: '2026-10-14' })
    expect(S.queue.ids).toEqual(['c-w5d1', 'c-w5d2', 'c-w5d3', 'c-w5d4'])
    expect(S.queue.startsOn).toBe('2026-10-14')
    expect(projection(S, '2026-10-14').next.date).toBe('2026-10-15')
    expect(advanceProgramme(S, '2026-10-14', 41)).toBe(false)
    for (const occ of c(S).occurrences.filter(o => o.status === 'pending')) Object.assign(occ, { status: 'skipped', date: '2026-10-15' })
    advanceProgramme(S, '2026-10-15', 50)
    expect(c(S).status).toBe('finished')
    expect(S.queue).toBeNull()
  })
  it('deleting a cached completed log reopens its occurrence and the earlier programme week', () => {
    const S = setup()
    for (const occ of c(S).occurrences.filter(o => o.weekIndex === 4)) train(S, occ, TODAY)
    advanceProgramme(S, TODAY, 30)
    expect(c(S).weekIndex).toBe(5)
    S.workouts = S.workouts.filter(w => w.id !== 'c:w4d2')
    advanceProgramme(S, '2026-10-13', 40)
    expect(o(S, 4, 2).status).toBe('pending')
    expect(o(S, 4, 2).date).toBeUndefined()
    expect(c(S).weekIndex).toBe(4)
    expect(queueRemaining(S)).toEqual(['c-w4d2'])
    expect(projection(S, '2026-10-13').next.instanceId).toBe('c:w4d2')
    expect(weekTally(S, '2026-10-13')).toEqual({ done: 3, planned: 4 })
  })

  it('reassigning a finished log derives completion for its new occurrence only', () => {
    const S = setup(), log = train(S, o(S, 4, 1), TODAY)
    advanceProgramme(S, TODAY, 30)
    log.programmeInstance.instanceId = 'c:w4d3'
    log.routineIds = ['c-w4d3']
    advanceProgramme(S, '2026-10-13', 40)
    expect(o(S, 4, 1).status).toBe('pending')
    expect(o(S, 4, 1).date).toBeUndefined()
    expect(o(S, 4, 3).status).toBe('done')
    expect(projection(S, '2026-10-13').next.instanceId).toBe('c:w4d1')
  })

  it('completion on two devices reconciles to a closed week without losing either log', () => {
    const base = setup()
    train(base, o(base, 4, 1), TODAY); train(base, o(base, 4, 2), '2026-10-13')
    advanceProgramme(base, '2026-10-13')
    const a = structuredClone(base), b = structuredClone(base)
    train(a, o(a, 4, 3), '2026-10-14'); advanceProgramme(a, '2026-10-14'); a._ts = stampChange(base, a, 100)
    skip(b, 'c', 'c:w4d4', { today: '2026-10-14', now: 110 }); b._ts = stampChange(base, b, 110)
    const merged = mergeStates(a, b)
    advanceProgramme(merged, '2026-10-14', 120)
    expect(c(merged).weekIndex).toBe(5)
    expect(c(merged).occurrences.slice(0, 4).map(o => o.status)).toEqual(['done', 'done', 'done', 'skipped'])
  })
  it('a legacy pin today cannot override Not today on either reader', () => {
    const S = setup()
    pin(S, 'c', 'c:w4d1', TODAY, TODAY)
    S.dayPlan[TODAY] = 'c-w4d1' // A pin written by the prior client.
    shiftNotToday(S, 'c', TODAY)
    expect(effectiveRoutineIds(S, TODAY, TODAY)).toEqual([])
    expect(effectiveRoutineId(S, TODAY)).toBeNull()
    expect(S.dayPlan[TODAY]).toBeUndefined()
  })
  it('a D2 Tuesday pin yields to slipped D1 in both readers and the Home row', () => {
    const S = setup(), tuesday = '2026-10-13'
    pin(S, 'c', 'c:w4d2', tuesday, TODAY)
    S.dayPlan[tuesday] = 'c-w4d2'
    expect(effectiveRoutineIds(S, tuesday, tuesday)).toEqual(['c-w4d1'])
    expect(effectiveRoutineId(S, tuesday)).toBe('c-w4d1')
    expect(queueView(S, tuesday).items[0].state).toBe('next')
    expect(queueView(S, tuesday).items[1]).toMatchObject({ state: 'pinned', on: '2026-10-14' })
    advanceProgramme(S, tuesday, 30)
    expect(S.dayPlan[tuesday]).toBeUndefined()
  })
  it('fulfilled prior-week pins cannot hide W5 after rollover or stale sync', () => {
    const S = setup(), pinned = '2026-10-20'
    pin(S, 'c', 'c:w4d1', pinned, TODAY)
    S.dayPlan[pinned] = 'c-w4d1'
    for (const occ of c(S).occurrences.filter(o => o.weekIndex === 4)) train(S, occ, '2026-10-19')
    advanceProgramme(S, '2026-10-19', 30)
    expect(S.dayPlan[pinned]).toBeUndefined()
    S.dayPlan[pinned] = 'c-w4d1' // A stale device sends the old override back.
    expect(pinState(S, 'c-w4d1')).toBe('done')
    expect(apiPin(S, 'c-w4d1')).toBe('done')
    expect(effectiveRoutineIds(S, pinned, pinned)).toEqual(['c-w5d1'])
    expect(effectiveRoutineId(S, pinned)).toBe('c-w5d1')
  })
  it('resume preserves a shift that is still in the future', () => {
    const S = setup()
    shiftNotToday(S, 'c', TODAY)
    pause(S, 'c', TODAY)
    resume(S, 'c', { today: TODAY, now: 30 })
    expect(c(S).notBefore).toBe('2026-10-13')
    expect(projection(S).next.date).toBe('2026-10-13')
    pause(S, 'c', TODAY)
    resume(S, 'c', { today: '2026-10-14', now: 40 })
    expect(c(S).notBefore).toBeNull()
    expect(projection(S, '2026-10-14').next.date).toBe('2026-10-14')
  })
  it('pins use pinnedOn, reject collisions, and can be cleared without changing a log', () => {
    const S = setup()
    pin(S, 'c', 'c:w4d3', '2026-10-14', TODAY)
    expect(S.dayPlan['2026-10-14']).toBeUndefined()
    expect(o(S, 4, 3).pinnedOn).toBe('2026-10-14')
    expect(projection(S).pending[3].date).toBe('2026-10-15')
    const before = structuredClone(S)
    expect(() => pin(S, 'c', 'c:w4d2', TODAY, TODAY)).toThrow('collide')
    expect(S).toEqual(before)
    expect(() => pin(S, 'c', 'c:w4d1', '2026-10-11', TODAY)).toThrow('future')
    pin(S, 'c', 'c:w4d3', null, TODAY)
    expect(S.dayPlan['2026-10-14']).toBeUndefined()
    expect(projection(S).endDate).toBe('2026-10-31')
    train(S, o(S, 4, 1), TODAY)
    expect(() => skip(S, 'c', 'c:w4d1')).toThrow('pending')
  })
  it('pause suppresses projections and reminders including pinned and weekday queue pointers', () => {
    const S = setup()
    pin(S, 'c', 'c:w4d1', '2026-10-15', TODAY)
    S.week[1] = ['c-w4d2']
    pause(S, 'c', TODAY)
    expect(S.dayPlan['2026-10-15']).toBeUndefined()
    expect(projection(S).next).toBeNull()
    expect(queueView(S, TODAY).paused).toBe(true)
    expect(effectiveRoutineId(S, TODAY)).toBeNull()
    expect(effectiveRoutineId(S, '2026-10-15')).toBeNull()
    expect(effectiveRoutineIds(S, TODAY, TODAY)).toEqual([])
    resume(S, 'c', { today: '2026-10-14', now: 40 })
    expect(projection(S, '2026-10-14').next.date).toBe('2026-10-15')
    expect(S.dayPlan['2026-10-15']).toBeUndefined()
    expect(o(S, 4, 1).pinnedOn).toBe('2026-10-15')
  })
  it('inserted deload keeps authored week numbers and separate ids, rolling through it before W5', () => {
    const S = setup(), beforeRoutines = structuredClone(S.routines)
    const w = insertDeload(S, 'c', { key: 'a' })
    expect(w).toMatchObject({ index: 5, weekId: 'deload-a', orderIndex: 4.5, fromWeekIndex: 4, mode: 'deload' })
    expect(S.routines.slice(0, 12)).toEqual(beforeRoutines)
    expect(S.routines).toHaveLength(16)
    expect(projection(S).weeks.map(w => w.weekId)).toEqual(['4', 'deload-a', '5', '6'])
    expect(S.routines.find(r => r.programme.weekId === 'deload-a')).toMatchObject({ prog: 'off', programme: { series: 'c:d1', fromWeekIndex: 4 } })
    for (const occ of c(S).occurrences.filter(o => o.weekIndex === 4)) Object.assign(occ, { status: 'skipped', date: TODAY })
    advanceProgramme(S, TODAY, 30)
    expect(c(S).weekId).toBe('deload-a')
    expect(S.queue.ids).toEqual(['c-deload-a-d1', 'c-deload-a-d2', 'c-deload-a-d3', 'c-deload-a-d4'])
    for (const occ of c(S).occurrences.filter(o => occurrenceWeekId(o) === 'deload-a')) Object.assign(occ, { status: 'skipped', date: TODAY })
    advanceProgramme(S, TODAY, 40)
    expect(c(S).weekIndex).toBe(5)
    expect(c(S).weekId).toBeUndefined()
    expect(S.queue.ids[0]).toBe('c-w5d1')
  })
  it('adopted legacy routine-id logs follow the existing DONE rule, without claiming earlier weeks', () => {
    const S = { unit: 'lb', workouts: [], exWeights: {}, routines: [1, 2, 3, 4].map(n => ({ id: `old${n}`, name: `Existing D${n}`, ex: [] })), queue: { ids: ['old2', 'old1', 'old3', 'old4'], since: 10, startsOn: TODAY } }
    adopt(S, definition(), ['old1', 'old2', 'old3', 'old4'], { cycleId: 'c', today: TODAY, now: 20 })
    S.workouts.push({ id: 'earlier', d: '2026-10-01', start: 1, routineIds: ['old1'], name: 'Existing D1' }, { id: 'backfill', d: TODAY, start: 1, routineIds: ['old2'], name: 'Existing D2' })
    advanceProgramme(S, TODAY, 30)
    expect(o(S, 4, 1).status).toBe('pending')
    expect(o(S, 4, 2).status).toBe('done')
    expect(projection(S).next.routineId).toBe('old1')
  })
  it('a programme queue is never adopted or refilled by rotation', () => {
    const S = setup(); S.rotation = { id: 'rotation', sequence: S.queue.ids.slice(), label: 'Loop' }
    S.queue.rotationId = 'rotation'
    const queue = structuredClone(S.queue)
    expect(startPass(S, TODAY, 30)).toBe(false)
    saveRotation(S, queue.ids, 'Edited', TODAY, 30)
    startNewPass(S, TODAY, 30)
    expect(refillAfter(S, { d: TODAY, routineIds: queue.ids }, TODAY, 30)).toBe(false)
    expect(refillIfComplete(S, TODAY, 30)).toBe(false)
    expect(S.queue).toEqual(queue)
  })
})

it('unowned queues also exclude skipped ids and keep them planned in the tally (API parity)', () => {
  const S = { routines: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], workouts: [], week: {}, dayPlan: {}, queue: { ids: ['a', 'b'], skipped: ['a'], since: 10, startsOn: TODAY } }
  expect(queueRemaining(S)).toEqual(['b'])
  expect(weekTally(S, TODAY)).toEqual({ done: 0, planned: 2 })
  expect(effectiveRoutineId(S, TODAY)).toBe(queueNext(S, TODAY, TODAY))
})
