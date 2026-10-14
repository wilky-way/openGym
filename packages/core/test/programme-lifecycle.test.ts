import {t} from '@opengym/core/i18n-core'
import {beforeEach,afterEach,vi} from 'vitest'
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-12T12:00:00Z'))})
afterEach(()=>vi.useRealTimers())
// Synthetic legacy fixtures deliberately exercise tolerant and malformed persisted shapes.
type LegacyFixture = any
import { describe, it, expect } from 'vitest'
import { activate, pause } from '../src/programme'
import { endProgramme, startProgramme, switchProgramme, resumeProgramme } from '../src/programme-lifecycle'
import { projectCycle } from '@opengym/core/programme-calendar'
import { mergeStates, stampChange } from '@opengym/core/sync-merge'

const TODAY: LegacyFixture = '2026-10-12'
const definition: LegacyFixture = (id: LegacyFixture = 'synthetic') => ({ id, name: id, unit: 'lb', weeks: [1, 2].map((index: LegacyFixture) => ({ index, days: [{ key: 'd1', sessions: [{ routineSnapshot: { name: 'Day 1', ex: [{ id: '0025', sets: 3, reps: 8, weight: 100 }] } }] }] })) })
const setup: LegacyFixture = () => {
  const S: LegacyFixture = { unit: 'lb', routines: [], workouts: [], dayPlan: {}, week: {}, exWeights: {}, active: null }
  activate(S, definition(), { cycleId: 'old', today: TODAY, now: 100 })
  const o: LegacyFixture = S.programmes.cycles[0].occurrences[0]
  S.workouts.push({ id: 'logged', d: TODAY, start: 200, routineIds: [o.routineId], entries: [{ id: '0025', occurrenceId: o.instanceId, series: 'old:d1', sets: [{ done: true, w: 100, r: 8 }] }] })
  return S
}

describe('program lifecycle transitions', () => {
  it.each(['active', 'paused'])('ends a %s run without changing logs or prescriptions and releases scheduling ownership', (status: LegacyFixture) => {
    const S: LegacyFixture = setup(), before: LegacyFixture = structuredClone(S)
    S.programmes.cycles[0].status = status
    S.dayPlan = { '2026-10-11': 'old-w1d1', '2026-10-13': 'old-w2d1', '2026-10-14': 'other' }
    const archived: LegacyFixture = endProgramme(S, 'old', { today: TODAY })
    expect(archived).toMatchObject({ status: 'archived', archivedOn: TODAY })
    expect(archived.occurrences.map((o: LegacyFixture) => o.status)).toEqual(['done', 'pending'])
    expect(S.workouts).toEqual(before.workouts)
    expect(S.routines).toEqual(before.routines.map(({ programme, ...r }: LegacyFixture) => ({...r,programmeHistory:{cycleId:programme.cycleId,series:programme.series}})))
    expect(S.queue).toBeNull()
    expect(S.dayPlan).toEqual({ '2026-10-11': 'old-w1d1', '2026-10-14': 'other' })
    expect(projectCycle(archived, S.workouts, TODAY, S.queue).pending.every((o: LegacyFixture) => !o.date)).toBe(true)
  })
  it('leaves a separately owned queue and routines untouched when ending', () => {
    const S: LegacyFixture = setup()
    S.queue = { ids: ['personal'], startsOn: TODAY }
    S.routines.push({ id: 'personal', name: 'Personal', ex: [] })
    endProgramme(S, 'old', { today: TODAY })
    expect(S.queue).toEqual({ ids: ['personal'], startsOn: TODAY })
    expect(S.routines.at(-1)).toEqual({ id: 'personal', name: 'Personal', ex: [] })
  })
  it.each(['active', 'paused'])('switches from %s atomically, honoring the chosen date and keeping finished history', (status: LegacyFixture) => {
    const S: LegacyFixture = setup(), logs: LegacyFixture = structuredClone(S.workouts)
    S.programmes.cycles[0].status = status
    S.programmes.cycles.push({ id: 'finished', status: 'finished', occurrences: [], completedOn: '2026-09-01' })
    const next: LegacyFixture = switchProgramme(S, 'old', definition('next'), { today: TODAY, startsOn: '2026-10-20', cycleId: 'new', now: 300 })
    expect(S.programmes.cycles.map((c: LegacyFixture) => c.status)).toEqual(['archived', 'finished', 'active'])
    expect(next).toMatchObject({ id: 'new', startsOn: '2026-10-20', week1StartDate: '2026-10-20' })
    expect(S.queue).toMatchObject({ programmeCycleId: 'new', startsOn: '2026-10-20', ids: ['new-w1d1'] })
    expect(projectCycle(next, S.workouts, TODAY, S.queue).next.date).toBe('2026-10-20')
    expect(S.routines.filter((r: LegacyFixture) => !r.programme).map((r: LegacyFixture) => r.id)).toEqual(['old-w1d1', 'old-w2d1'])
    expect(S.workouts).toEqual(logs)
  })
  it.each([
    { weeks: [{ index: 1, days: [{ key: 'd1', sessions: [{ routineSnapshot: { name: 'Invalid' } }] }] }] },
    { weeks: [{ index: 0, days: [] }] },
  ])('failed switch validation leaves every field unchanged', (invalid: LegacyFixture) => {
    const S: LegacyFixture = setup(), before: LegacyFixture = structuredClone(S)
    expect(() => switchProgramme(S, 'old', { ...definition('next'), ...invalid }, { today: TODAY })).toThrow()
    expect(S).toEqual(before)
  })
  it.each([
    { sets: -1 }, { reps: 'invalid' }, { weight: -100 }, { weight: Infinity }, { id: 'missing-exercise' }, { target: { rir: -1 } },
  ])('validates prescriptions and mappings before any archival or materialization', (invalid: LegacyFixture) => {
    const S: LegacyFixture = setup(), before: LegacyFixture = structuredClone(S), next: LegacyFixture = definition('next')
    Object.assign(next.weeks[0].days[0].sessions[0].routineSnapshot.ex[0], invalid)
    expect(() => switchProgramme(S, 'old', next, { today: TODAY })).toThrow()
    expect(S).toEqual(before)
    endProgramme(S, 'old', { today: TODAY }); const ended: LegacyFixture = structuredClone(S)
    expect(() => startProgramme(S, next, { today: TODAY })).toThrow()
    expect(S).toEqual(ended)
  })
  it('supports saved definitions using a custom exercise in the current catalogue', () => {
    const S: LegacyFixture = setup(), next: LegacyFixture = definition('next')
    S.customEx = [{ id: 'custom-synthetic', n: 'Synthetic exercise' }]
    next.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].id = 'custom-synthetic'
    switchProgramme(S, 'old', next, { today: TODAY, cycleId: 'new' })
    expect(S.routines.find((r: LegacyFixture) => r.id === 'new-w1d1').ex[0].id).toBe('custom-synthetic')
  })
  it('validates persisted definitions without mistaking field clocks for text metadata', () => {
    const S: LegacyFixture = setup(), next: LegacyFixture = definition('next')
    next._ts = 100; next._f = { name: 100, id: 100 }
    next.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]._f = { id: 100 }
    switchProgramme(S, 'old', next, { today: TODAY, cycleId: 'new' })
    expect(S.programmes.definitions.find((d: LegacyFixture) => d.id === 'next')._f).toEqual({ name: 100, id: 100 })
  })
  it.each(['2026-02-30', '', 'not-a-date'])('rejects invalid start date %s before archiving', (startsOn: LegacyFixture) => {
    const S: LegacyFixture = setup(), before: LegacyFixture = structuredClone(S)
    expect(() => switchProgramme(S, 'old', definition('next'), { today: TODAY, startsOn })).toThrow()
    expect(S).toEqual(before)
  })
  it('rejects duplicate generated ids and stale confirmations without archiving', () => {
    const S: LegacyFixture = setup(), before: LegacyFixture = structuredClone(S)
    expect(() => switchProgramme(S, 'old', definition('next'), { today: TODAY, cycleId: 'old' })).toThrow('already exists')
    expect(() => switchProgramme(S, 'replaced', definition('next'), { today: TODAY })).toThrow('changed')
    expect(S).toEqual(before)
  })
  it('starts a saved program after end and adopts with an explicit start date without losing progress', () => {
    const S: LegacyFixture = setup()
    endProgramme(S, 'old', { today: TODAY })
    S.queue = { ids: ['old-w2d1'], since: 50, startsOn: '2026-10-01' }
    const next: LegacyFixture = startProgramme(S, definition('next'), { today: TODAY, startsOn: '2026-10-19', cycleId: 'new', existingRoutineIds: { d1: 'old-w2d1' } })
    expect(next.startsOn).toBe('2026-10-19')
    expect(S.queue).toMatchObject({ ids: ['old-w2d1'], since: 50, startsOn: '2026-10-19' })
    expect(S.workouts).toHaveLength(1)
  })
  it('resumes a paused cycle while preserving future pins and a separate finished cycle', () => {
    const S: LegacyFixture = setup()
    pause(S, 'old', TODAY)
    S.programmes.cycles[0].occurrences[1].pinnedOn = '2026-10-20'
    S.programmes.cycles.push({ id: 'finished', status: 'finished', occurrences: [] })
    resumeProgramme(S, 'old', { today: TODAY, now: 300 })
    expect(S.programmes.cycles[0]).toMatchObject({ status: 'active', weekIndex: 2 })
    expect(S.programmes.cycles[0].occurrences[1].pinnedOn).toBe('2026-10-20')
    expect(S.programmes.cycles[1].status).toBe('finished')
  })
  it.each([
    (S: LegacyFixture) => endProgramme(S, 'old'),
    (S: LegacyFixture) => switchProgramme(S, 'old', definition('next')),
    (S: LegacyFixture) => startProgramme(S, definition('next')),
    (S: LegacyFixture) => resumeProgramme(S, 'old'),
  ])('refuses every lifecycle transition during an active workout', (action: LegacyFixture) => {
    const S: LegacyFixture = setup(); S.active = { id: 'running' }; const before: LegacyFixture = structuredClone(S)
    expect(() => action(S)).toThrow('Finish the current workout')
    expect(S).toEqual(before)
  })
  it('cannot end finished history or resume an archived run', () => {
    const S: LegacyFixture = setup(); S.programmes.cycles[0].status = 'finished'; const before: LegacyFixture = structuredClone(S)
    expect(() => endProgramme(S, 'old', { today: TODAY })).toThrow('changed')
    expect(() => resumeProgramme(S, 'old', { today: TODAY })).toThrow('changed')
    expect(S).toEqual(before)
  })
  it('archival, detached routine fields, logs and replacement queue survive stale sync in either direction', () => {
    const base: LegacyFixture = setup(), switched: LegacyFixture = structuredClone(base), stale: LegacyFixture = structuredClone(base)
    switchProgramme(switched, 'old', definition('next'), { today: TODAY, startsOn: '2026-10-20', cycleId: 'new', now: 300 })
    switched._ts = stampChange(base, switched, 400)
    stale.programmes.cycles[0].end = 'repeat'; stale._ts = stampChange(base, stale, 500)
    for (const merged of [mergeStates(switched, stale), mergeStates(stale, switched)]) {
      expect(merged.programmes.cycles.find((c: LegacyFixture) => c.id === 'old').status).toBe('archived')
      expect(merged.programmes.cycles.find((c: LegacyFixture) => c.id === 'new').status).toBe('active')
      expect(merged.queue.programmeCycleId).toBe('new')
      expect(merged.routines.filter((r: LegacyFixture) => r.id.startsWith('old-')).every((r: LegacyFixture) => !r.programme)).toBe(true)
      expect(merged.workouts).toEqual(switched.workouts)
    }
  })
})

it('carries lifecycle labels, confirmations and stale-choice errors in all 18 locale packs', () => {
  // English-only: the translation seam passes each retained UI string through.
  const keys: LegacyFixture = ['End program?', 'End program', 'Switch program', 'Program history', 'Program ended', 'Choose next program', 'Switch to this program', 'Start this program', 'Program start date', 'Confirm switch', 'Needs review', 'The program changed. Review your choice again.',
    'Archive {0} and release its training queue. Logged workouts stay in history, and generated routines remain as plain routines.',
    'Switch from {0} to {1}? The current cycle will be archived and its queue released. Logged workouts are kept, and its routines become plain routines. The new program starts on {2} and takes over the queue.']
  const packs: LegacyFixture = {en: Object.fromEntries(keys.map((key: string) => [key, t(key)]))}
  expect(Object.keys(packs)).toHaveLength(1)
  for (const [file, pack] of Object.entries(packs)) for (const key of keys) {
    expect((pack as LegacyFixture)[key], `${file}: ${key}`).toEqual(expect.any(String))
    expect((pack as LegacyFixture)[key].trim()).not.toBe('')
    const markers: LegacyFixture = (s: LegacyFixture) => [...s.matchAll(/\{\d+\}/g)].map((m: LegacyFixture) => m[0]).sort()
    expect(markers((pack as LegacyFixture)[key]), `${file}: ${key}`).toEqual(markers(key))
  }
})
