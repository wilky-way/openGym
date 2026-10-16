import {beforeEach,afterEach,vi} from 'vitest'
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))})
afterEach(()=>vi.useRealTimers())
// Synthetic legacy fixtures deliberately exercise tolerant and malformed persisted shapes.
type LegacyFixture = any
import { describe, it, expect } from 'vitest'
import { activate, adopt, advanceProgramme } from '../src/programme'
import { buildSessionEntries, programmeInstanceFor, plannedConfigOf, buildPlannedEntry } from '@opengym/core/session-start'
import { buildCombinedEntries } from '@opengym/core/session-merge'
import { buildCompletedWorkout } from '@opengym/core/finish-workout'
import { sessionsFor, nextPrescription } from '@opengym/core/progression'
import { resolveOccurrences } from '@opengym/core/programme-sync'
// @ts-expect-error Frozen oracle JS has no declarations; differential-test-only.
import { resolveOccurrences as apiResolve } from '../../../packages/parity/fixtures/oracle/api/programme-sync.js'
import { lastEntryFor } from '@opengym/core/history'

const BENCH: LegacyFixture = '0025', CURL: LegacyFixture = '0030'
const cfg: LegacyFixture = (id: LegacyFixture = BENCH, sets: LegacyFixture = 4) => ({ id, sets, reps: 8, weight: 100, prog: 'linear', target: { rir: 2 } })
const definition: LegacyFixture = () => ({ id: 'synthetic', name: 'Synthetic block', short: 'SYN', unit: 'lb', end: 'next', days: [{ key: 'd1', name: 'Upper' }, { key: 'd2', name: 'Lower' }], weeks: [4, 5, 6].map((index: LegacyFixture) => ({ index, mode: index === 6 ? 'deload' : 'train', rir: index === 6 ? 8 : 1, days: [1, 2].map((day: LegacyFixture) => ({ key: `d${day}`, ordinal: day, sessions: [{ sessionTemplateId: `d${day}`, routineSnapshot: { name: `Day ${day}`, ex: [cfg(), cfg(CURL, 3)] } }] })) })) })
const state: LegacyFixture = () => ({ unit: 'lb', workouts: [], routines: [], exWeights: {}, queue: null })
const activateIn: LegacyFixture = (S: LegacyFixture) => activate(S, definition(), { cycleId: 'cycle', today: '2026-10-12', now: 10, preApp: { weeks: [1, 2, 3] } })
const routine: LegacyFixture = (S: LegacyFixture, week: LegacyFixture, day: LegacyFixture = 1) => S.routines.find((r: LegacyFixture) => r.id === `cycle-w${week}d${day}`)
function train(S: LegacyFixture, r: LegacyFixture, weight: LegacyFixture = 150, d: LegacyFixture = '2026-10-12') {
  const entries: LegacyFixture = buildCombinedEntries(S, [r.id]).entries.map((e: LegacyFixture) => ({ ...e, sets: e.sets.map((s: LegacyFixture) => ({ ...s, w: weight, done: true })) }))
  const active: LegacyFixture = { id: 'w' + S.workouts.length, d, start: 20 + S.workouts.length, name: r.name, routineIds: [r.id], entries, programmeInstance: programmeInstanceFor([r]) }
  const w: LegacyFixture = buildCompletedWorkout(active, { end: active.start + 1 })
  S.workouts.push(w)
  return w
}

describe('programme materialization', () => {
  it('creates one runnable routine per occurrence and only queues the current week', () => {
    const S: LegacyFixture = state(), def: LegacyFixture = definition(), cycle: LegacyFixture = activate(S, def, { cycleId: 'cycle', today: '2026-10-12', now: 10 })
    expect(S.routines).toHaveLength(6)
    expect(cycle.occurrences).toHaveLength(6)
    expect(S.queue.ids).toEqual(['cycle-w4d1', 'cycle-w4d2'])
    expect(S.queue.programmeCycleId).toBe('cycle')
    expect(routine(S, 5).programme).toMatchObject({ cycleId: 'cycle', instanceId: 'cycle:w5d1', weekIndex: 5, series: 'cycle:d1' })
    expect(routine(S, 5).name).toBe('SYN D1 · Upper · W5')
    expect(routine(S, 6)).toMatchObject({ prog: 'off', excludeFromProgression: true, deload: { setsFactor: .5, loadFactor: .7 } })
    expect(routine(S, 6).ex.every((e: LegacyFixture) => e.prog === 'off')).toBe(true)
    def.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight = 999
    expect(cycle.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(100)
    expect(routine(S, 4).ex[0].weight).toBe(100)
  })
  it('adopts existing ids and queue progress, but materializes the later weeks', () => {
    const S: LegacyFixture = state()
    S.routines = [{ id: 'old1', name: 'Existing upper', ex: [cfg()] }, { id: 'old2', name: 'Existing lower', ex: [cfg()] }]
    S.queue = { ids: ['old2', 'old1'], since: 3, startsOn: '2026-10-11', label: 'Existing', strict: true }
    const before: LegacyFixture = structuredClone(S)
    const c: LegacyFixture = adopt(S, definition(), ['old1', 'old2'], { cycleId: 'cycle', today: '2026-10-12', now: 10 })
    expect(S.queue).toEqual({ ...before.queue, programmeCycleId: 'cycle' })
    expect(S.routines.slice(0, 2).map((r: LegacyFixture) => ({ id: r.id, name: r.name, ex: r.ex.map(({slotId,slotScope,...prescription}: LegacyFixture)=>prescription) }))).toEqual(before.routines)
    expect(c.occurrences.slice(0, 2).map((o: LegacyFixture) => o.routineId)).toEqual(['old1', 'old2'])
    expect(S.routines).toHaveLength(6)
    // An unstamped historical entry becomes this series through the adopted routine.
    S.workouts.push({ id: 'legacy', d: '2026-10-11', routineId: 'old1', entries: [{ id: BENCH, sets: [{ w: 135, r: 8, done: true }] }] })
    expect(sessionsFor(S, BENCH, cfg(), 'cycle-w5d1')[0].series).toBe('cycle:d1')
  })
  it('adopts by dayKey independent of map order and resolves already logged sessions', () => {
    const S: LegacyFixture = state()
    S.routines = [{ id: 'old1', name: 'Existing D1', ex: [cfg()] }, { id: 'old2', name: 'Existing D2', ex: [cfg()] }]
    S.queue = { ids: ['old2', 'old1'], since: 10, startsOn: '2026-10-12', strict: true }
    S.workouts = [{ id: 'old-log', d: '2026-10-11', start: 1, routineIds: ['old2'] }, { id: 'current-log', d: '2026-10-12', start: 20, routineIds: ['old1'] }]
    const cycle: LegacyFixture = adopt(S, definition(), { d2: 'old2', d1: 'old1' }, { cycleId: 'cycle', today: '2026-10-12', now: 30 })
    expect(S.routines.find((r: LegacyFixture) => r.id === 'old1').programme.series).toBe('cycle:d1')
    expect(S.routines.find((r: LegacyFixture) => r.id === 'old2').programme.series).toBe('cycle:d2')
    expect(cycle.occurrences.slice(0, 2).map((o: LegacyFixture) => o.status)).toEqual(['done', 'pending'])
    expect(cycle.occurrences[0].date).toBe('2026-10-12')
    expect(S.queue.ids).toEqual(['old2', 'old1'])
  })

  it('rejects invalid adoption, collisions, and a second running cycle without partial writes', () => {
    const S: LegacyFixture = state(), before: LegacyFixture = structuredClone(S)
    expect(() => adopt(S, definition(), ['missing'], { cycleId: 'cycle' })).toThrow()
    expect(S).toEqual(before)
    S.routines.push({ id: 'cycle-w5d1', ex: [] })
    expect(() => activateIn(S)).toThrow('already exists')
    expect(S.programmes).toBeUndefined()
    S.routines = []
    activateIn(S)
    expect(() => activate(S, definition(), { cycleId: 'other' })).toThrow('already running')
  })
  it('converts template weights to the state unit without modifying the frozen definition', () => {
    const S: LegacyFixture = state(); S.unit = 'kg'
    const c: LegacyFixture = activateIn(S)
    expect(routine(S, 4).ex[0].weight).toBe(45.25)
    expect(c.snapshot.unit).toBe('lb')
    expect(c.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight).toBe(100)
  })
})

describe('series progression and frozen session stamps', () => {
  it('W5 D1 continues W4 D1, not the more recent other-day bench or curl', () => {
    const S: LegacyFixture = state(); activateIn(S)
    train(S, routine(S, 4, 1), 150)
    train(S, routine(S, 4, 2), 70, '2026-10-13')
    const next: LegacyFixture = buildSessionEntries(S, routine(S, 5, 1))
    expect(next.map((e: LegacyFixture) => e.target.weight)).toEqual([155, 155])
    expect(next.every((e: LegacyFixture) => e.series === 'cycle:d1')).toBe(true)
    expect(buildSessionEntries(S, routine(S, 5, 2)).map((e: LegacyFixture) => e.target.weight)).toEqual([75, 75])
    expect(lastEntryFor(S, BENCH, 'cycle-w5d1')!.sets[0].w).toBe(150)
  })
  it('a new series falls back exactly as an ordinary new routine does', () => {
    const S: LegacyFixture = state(); activateIn(S)
    train(S, routine(S, 4, 2), 130)
    const r: LegacyFixture = routine(S, 5, 1)
    expect(nextPrescription(S, r.ex[0], r)).toEqual(nextPrescription(S, r.ex[0], { ...r, programme: undefined }))
  })
  it('a +1 set still reports planChanged despite matching lineage', () => {
    const S: LegacyFixture = state(); activateIn(S)
    train(S, routine(S, 4), 150)
    const r: LegacyFixture = routine(S, 5); r.ex[0].sets++
    const plan: LegacyFixture = nextPrescription(S, r.ex[0], r)
    expect(plan.kind).toBe('hold')
    expect(plan.why[0]).toBe('Plan changed, so starting from your new target.')
    expect(buildSessionEntries(S, r)[0].sets).toHaveLength(5)
  })
  it('combined weeks freeze and read each entry’s own week after its routine is deleted', () => {
    const S: LegacyFixture = state(); activateIn(S)
    const rs: LegacyFixture = [routine(S, 5, 1), routine(S, 4, 2)]
    const active: LegacyFixture = { id: 'combined', d: '2026-10-13', start: 30, routineIds: rs.map((r: LegacyFixture) => r.id), programmeInstance: programmeInstanceFor(rs), entries: buildCombinedEntries(S, rs.map((r: LegacyFixture) => r.id)).entries }
    active.entries.forEach((e: LegacyFixture) => e.sets.forEach((s: LegacyFixture) => { s.w = 150; s.done = true }))
    const w: LegacyFixture = buildCompletedWorkout(active)
    S.workouts.push(w)
    expect(w.entries.map((e: LegacyFixture) => e.weekIndex)).toEqual([5, 5, 4, 4])
    S.routines = S.routines.filter((r: LegacyFixture) => !rs.includes(r))
    expect(sessionsFor(S, BENCH, cfg(), 'cycle-w6d2')[0].weekIndex).toBe(4)
  })

  it('only the combined occurrence with surviving logged entries counts done', () => {
    const S: LegacyFixture = state(); activateIn(S)
    const rs: LegacyFixture = [routine(S, 4, 1), routine(S, 4, 2)]
    const active: LegacyFixture = { id: 'combined', d: '2026-10-12', start: 30, routineIds: rs.map((r: LegacyFixture) => r.id), programmeInstance: programmeInstanceFor(rs), entries: buildCombinedEntries(S, rs.map((r: LegacyFixture) => r.id)).entries }
    active.entries.filter((e: LegacyFixture) => e.rid === rs[1].id).forEach((e: LegacyFixture) => e.sets.forEach((s: LegacyFixture) => { s.done = true }))
    const w: LegacyFixture = buildCompletedWorkout(active)
    expect(w.entries.every((e: LegacyFixture) => e.occurrenceId === 'cycle:w4d2')).toBe(true)
    for (const resolve of [resolveOccurrences, apiResolve]) expect(resolve(S.programmes.cycles[0], [w]).slice(0, 2).map((o: LegacyFixture) => o.status)).toEqual(['pending', 'done'])
  })

  it('finishing preserves lineage and occurrence stamps, independent of later routine edits', () => {
    const S: LegacyFixture = state(); activateIn(S)
    const r: LegacyFixture = routine(S, 4), w: LegacyFixture = train(S, r)
    expect(w.programmeInstance).toEqual({ cycleId: 'cycle', instanceId: 'cycle:w4d1', weekIndex: 4, ordinal: 1 })
    expect(w.entries[0]).toMatchObject({ rid: 'cycle-w4d1', series: 'cycle:d1', occurrenceId: 'cycle:w4d1' })
    r.programme.series = 'different'
    S.routines = S.routines.filter((r: LegacyFixture) => r.id !== 'cycle-w4d1')
    expect(sessionsFor(S, BENCH, cfg(), 'cycle-w5d1')[0].series).toBe('cycle:d1')
    expect(programmeInstanceFor([routine(S, 5, 1), routine(S, 5, 2)])!.instanceId).toBe('cycle:w5d1')
  })
})

describe('deload prescriptions', () => {
  it('uses the previous week of its series, rounds loads and floors half sets (min 1)', () => {
    const S: LegacyFixture = state(); activateIn(S)
    train(S, routine(S, 5), 155)
    train(S, routine(S, 5, 2), 75, '2026-10-13')
    const r: LegacyFixture = routine(S, 6), entries: LegacyFixture = buildSessionEntries(S, r)
    expect(entries.map((e: LegacyFixture) => e.sets.length)).toEqual([2, 1])
    expect(entries.map((e: LegacyFixture) => e.target.weight)).toEqual([110, 110])
    expect(entries.every((e: LegacyFixture) => e.noProg && e.plan.kind === 'off' && e.deload.baseline === 'series-last')).toBe(true)
    expect(entries[0].target.target.rir).toBe(8)
    // The plan kept unscaled allows a sheet rebuild to apply the factor exactly once.
    const rebuilt: LegacyFixture = buildPlannedEntry(S, plannedConfigOf(entries[0]), r)
    expect(rebuilt.sets).toHaveLength(2)
    const w: LegacyFixture = train(S, r, 110)
    expect(w.entries[0].deload.baseline).toBe('series-last')
    expect(sessionsFor(S, BENCH, cfg(), routine(S, 5).id)).toHaveLength(1)
  })
  it('missing W5 keeps the earlier series load and flags fallback, never another day as history', () => {
    const S: LegacyFixture = state(); activateIn(S)
    train(S, routine(S, 4), 150)
    train(S, routine(S, 5, 2), 200, '2026-10-13')
    const [e] = buildSessionEntries(S, routine(S, 6))
    expect(e.deload).toMatchObject({ baseline: 'series-last', fallback: true, lastWeekIndex: 4 })
    expect(e.target.weight).toBe(105)
    const noHistory: LegacyFixture = state(); activateIn(noHistory)
    train(noHistory, routine(noHistory, 5, 2), 260)
    const r: LegacyFixture = routine(noHistory, 6), seed: LegacyFixture = buildSessionEntries(noHistory, r)[0]
    expect(seed.deload).toMatchObject({ baseline: 'seed', fallback: true })
    expect(seed.target.weight).toBe(70)
    expect(buildPlannedEntry(noHistory, plannedConfigOf(seed), r).target.weight).toBe(70)
  })
})

it('adoption keeps an existing queue skip through advancement without inventing its date',()=>{
 const S: LegacyFixture=state();S.routines=['old1','old2'].map((id: LegacyFixture)=>({id,name:id,ex:[cfg()]}));S.queue={ids:['old1','old2'],since:1,startsOn:'2026-10-11',skipped:['old1']}
 const c: LegacyFixture=adopt(S,definition(),['old1','old2'],{cycleId:'cycle',today:'2026-10-12'});advanceProgramme(S,'2026-10-12')
 expect(c.occurrences[0]).toMatchObject({status:'skipped',reason:'adopted-queue'});expect(c.occurrences[0].date).toBeUndefined();expect(S.queue.skipped).toEqual(['old1'])
})
it('activation assigns stable identities for distinct slots and local identities for ambiguous twins',()=>{
 const S: LegacyFixture=state(),d: LegacyFixture=definition();d.weeks[0].days[0].sessions[0].routineSnapshot.ex=[cfg(),cfg(BENCH,2)]
 const c: LegacyFixture=activate(S,d,{cycleId:'cycle'});expect(S.routines.every((r: LegacyFixture)=>r.ex.every((e: LegacyFixture)=>typeof e.slotId==='string'))).toBe(true);expect(S.routines[0].ex.every((e: LegacyFixture)=>e.slotScope==='session')).toBe(true);expect(S.routines[1].ex[0].slotId).toBe(S.routines[3].ex[0].slotId);expect(c.occurrences).toHaveLength(6)
})
