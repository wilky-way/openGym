import { describe, it, expect } from 'vitest'
import { activate, pause } from './programme.js'
import { endProgramme, startProgramme, switchProgramme, resumeProgramme } from './programme-lifecycle.js'
import { projectCycle } from './programme-calendar.js'
import { mergeStates, stampChange } from './sync-merge.js'

const TODAY = '2026-10-12'
const definition = (id = 'synthetic') => ({ id, name: id, unit: 'lb', weeks: [1, 2].map(index => ({ index, days: [{ key: 'd1', sessions: [{ routineSnapshot: { name: 'Day 1', ex: [{ id: '0025', sets: 3, reps: 8, weight: 100 }] } }] }] })) })
const setup = () => {
  const S = { unit: 'lb', routines: [], workouts: [], dayPlan: {}, week: {}, exWeights: {}, active: null }
  activate(S, definition(), { cycleId: 'old', today: TODAY, now: 100 })
  const o = S.programmes.cycles[0].occurrences[0]
  S.workouts.push({ id: 'logged', d: TODAY, start: 200, routineIds: [o.routineId], entries: [{ id: '0025', occurrenceId: o.instanceId, series: 'old:d1', sets: [{ done: true, w: 100, r: 8 }] }] })
  return S
}

describe('program lifecycle transitions', () => {
  it.each(['active', 'paused'])('ends a %s run without changing logs or prescriptions and releases scheduling ownership', status => {
    const S = setup(), before = structuredClone(S)
    S.programmes.cycles[0].status = status
    S.dayPlan = { '2026-10-11': 'old-w1d1', '2026-10-13': 'old-w2d1', '2026-10-14': 'other' }
    const archived = endProgramme(S, 'old', { today: TODAY })
    expect(archived).toMatchObject({ status: 'archived', archivedOn: TODAY })
    expect(archived.occurrences.map(o => o.status)).toEqual(['done', 'pending'])
    expect(S.workouts).toEqual(before.workouts)
    expect(S.routines).toEqual(before.routines.map(({ programme, ...r }) => ({...r,programmeHistory:{cycleId:programme.cycleId,series:programme.series}})))
    expect(S.queue).toBeNull()
    expect(S.dayPlan).toEqual({ '2026-10-11': 'old-w1d1', '2026-10-14': 'other' })
    expect(projectCycle(archived, S.workouts, TODAY, S.queue).pending.every(o => !o.date)).toBe(true)
  })
  it('leaves a separately owned queue and routines untouched when ending', () => {
    const S = setup()
    S.queue = { ids: ['personal'], startsOn: TODAY }
    S.routines.push({ id: 'personal', name: 'Personal', ex: [] })
    endProgramme(S, 'old', { today: TODAY })
    expect(S.queue).toEqual({ ids: ['personal'], startsOn: TODAY })
    expect(S.routines.at(-1)).toEqual({ id: 'personal', name: 'Personal', ex: [] })
  })
  it.each(['active', 'paused'])('switches from %s atomically, honoring the chosen date and keeping finished history', status => {
    const S = setup(), logs = structuredClone(S.workouts)
    S.programmes.cycles[0].status = status
    S.programmes.cycles.push({ id: 'finished', status: 'finished', occurrences: [], completedOn: '2026-09-01' })
    const next = switchProgramme(S, 'old', definition('next'), { today: TODAY, startsOn: '2026-10-20', cycleId: 'new', now: 300 })
    expect(S.programmes.cycles.map(c => c.status)).toEqual(['archived', 'finished', 'active'])
    expect(next).toMatchObject({ id: 'new', startsOn: '2026-10-20', week1StartDate: '2026-10-20' })
    expect(S.queue).toMatchObject({ programmeCycleId: 'new', startsOn: '2026-10-20', ids: ['new-w1d1'] })
    expect(projectCycle(next, S.workouts, TODAY, S.queue).next.date).toBe('2026-10-20')
    expect(S.routines.filter(r => !r.programme).map(r => r.id)).toEqual(['old-w1d1', 'old-w2d1'])
    expect(S.workouts).toEqual(logs)
  })
  it.each([
    { weeks: [{ index: 1, days: [{ key: 'd1', sessions: [{ routineSnapshot: { name: 'Invalid' } }] }] }] },
    { weeks: [{ index: 0, days: [] }] },
  ])('failed switch validation leaves every field unchanged', invalid => {
    const S = setup(), before = structuredClone(S)
    expect(() => switchProgramme(S, 'old', { ...definition('next'), ...invalid }, { today: TODAY })).toThrow()
    expect(S).toEqual(before)
  })
  it.each([
    { sets: -1 }, { reps: 'invalid' }, { weight: -100 }, { weight: Infinity }, { id: 'missing-exercise' }, { target: { rir: -1 } },
  ])('validates prescriptions and mappings before any archival or materialization', invalid => {
    const S = setup(), before = structuredClone(S), next = definition('next')
    Object.assign(next.weeks[0].days[0].sessions[0].routineSnapshot.ex[0], invalid)
    expect(() => switchProgramme(S, 'old', next, { today: TODAY })).toThrow()
    expect(S).toEqual(before)
    endProgramme(S, 'old', { today: TODAY }); const ended = structuredClone(S)
    expect(() => startProgramme(S, next, { today: TODAY })).toThrow()
    expect(S).toEqual(ended)
  })
  it('supports saved definitions using a custom exercise in the current catalogue', () => {
    const S = setup(), next = definition('next')
    S.customEx = [{ id: 'custom-synthetic', n: 'Synthetic exercise' }]
    next.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].id = 'custom-synthetic'
    switchProgramme(S, 'old', next, { today: TODAY, cycleId: 'new' })
    expect(S.routines.find(r => r.id === 'new-w1d1').ex[0].id).toBe('custom-synthetic')
  })
  it('validates persisted definitions without mistaking field clocks for text metadata', () => {
    const S = setup(), next = definition('next')
    next._ts = 100; next._f = { name: 100, id: 100 }
    next.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]._f = { id: 100 }
    switchProgramme(S, 'old', next, { today: TODAY, cycleId: 'new' })
    expect(S.programmes.definitions.find(d => d.id === 'next')._f).toEqual({ name: 100, id: 100 })
  })
  it.each(['2026-02-30', '', 'not-a-date'])('rejects invalid start date %s before archiving', startsOn => {
    const S = setup(), before = structuredClone(S)
    expect(() => switchProgramme(S, 'old', definition('next'), { today: TODAY, startsOn })).toThrow()
    expect(S).toEqual(before)
  })
  it('rejects duplicate generated ids and stale confirmations without archiving', () => {
    const S = setup(), before = structuredClone(S)
    expect(() => switchProgramme(S, 'old', definition('next'), { today: TODAY, cycleId: 'old' })).toThrow('already exists')
    expect(() => switchProgramme(S, 'replaced', definition('next'), { today: TODAY })).toThrow('changed')
    expect(S).toEqual(before)
  })
  it('starts a saved program after end and adopts with an explicit start date without losing progress', () => {
    const S = setup()
    endProgramme(S, 'old', { today: TODAY })
    S.queue = { ids: ['old-w2d1'], since: 50, startsOn: '2026-10-01' }
    const next = startProgramme(S, definition('next'), { today: TODAY, startsOn: '2026-10-19', cycleId: 'new', existingRoutineIds: { d1: 'old-w2d1' } })
    expect(next.startsOn).toBe('2026-10-19')
    expect(S.queue).toMatchObject({ ids: ['old-w2d1'], since: 50, startsOn: '2026-10-19' })
    expect(S.workouts).toHaveLength(1)
  })
  it('resumes a paused cycle while preserving future pins and a separate finished cycle', () => {
    const S = setup()
    pause(S, 'old', TODAY)
    S.programmes.cycles[0].occurrences[1].pinnedOn = '2026-10-20'
    S.programmes.cycles.push({ id: 'finished', status: 'finished', occurrences: [] })
    resumeProgramme(S, 'old', { today: TODAY, now: 300 })
    expect(S.programmes.cycles[0]).toMatchObject({ status: 'active', weekIndex: 2 })
    expect(S.programmes.cycles[0].occurrences[1].pinnedOn).toBe('2026-10-20')
    expect(S.programmes.cycles[1].status).toBe('finished')
  })
  it.each([
    S => endProgramme(S, 'old'),
    S => switchProgramme(S, 'old', definition('next')),
    S => startProgramme(S, definition('next')),
    S => resumeProgramme(S, 'old'),
  ])('refuses every lifecycle transition during an active workout', action => {
    const S = setup(); S.active = { id: 'running' }; const before = structuredClone(S)
    expect(() => action(S)).toThrow('Finish the current workout')
    expect(S).toEqual(before)
  })
  it('cannot end finished history or resume an archived run', () => {
    const S = setup(); S.programmes.cycles[0].status = 'finished'; const before = structuredClone(S)
    expect(() => endProgramme(S, 'old', { today: TODAY })).toThrow('changed')
    expect(() => resumeProgramme(S, 'old', { today: TODAY })).toThrow('changed')
    expect(S).toEqual(before)
  })
  it('archival, detached routine fields, logs and replacement queue survive stale sync in either direction', () => {
    const base = setup(), switched = structuredClone(base), stale = structuredClone(base)
    switchProgramme(switched, 'old', definition('next'), { today: TODAY, startsOn: '2026-10-20', cycleId: 'new', now: 300 })
    switched._ts = stampChange(base, switched, 400)
    stale.programmes.cycles[0].end = 'repeat'; stale._ts = stampChange(base, stale, 500)
    for (const merged of [mergeStates(switched, stale), mergeStates(stale, switched)]) {
      expect(merged.programmes.cycles.find(c => c.id === 'old').status).toBe('archived')
      expect(merged.programmes.cycles.find(c => c.id === 'new').status).toBe('active')
      expect(merged.queue.programmeCycleId).toBe('new')
      expect(merged.routines.filter(r => r.id.startsWith('old-')).every(r => !r.programme)).toBe(true)
      expect(merged.workouts).toEqual(switched.workouts)
    }
  })
})

it('carries lifecycle labels, confirmations and stale-choice errors in all 18 locale packs', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
  const keys = ['End program?', 'End program', 'Switch program', 'Program history', 'Program ended', 'Choose next program', 'Switch to this program', 'Start this program', 'Program start date', 'Confirm switch', 'Needs review', 'The program changed. Review your choice again.',
    'Archive {0} and release its training queue. Logged workouts stay in history, and generated routines remain as plain routines.',
    'Switch from {0} to {1}? The current cycle will be archived and its queue released. Logged workouts are kept, and its routines become plain routines. The new program starts on {2} and takes over the queue.']
  expect(Object.keys(packs)).toHaveLength(18)
  for (const [file, pack] of Object.entries(packs)) for (const key of keys) {
    expect(pack[key], `${file}: ${key}`).toEqual(expect.any(String))
    expect(pack[key].trim()).not.toBe('')
    const markers = s => [...s.matchAll(/\{\d+\}/g)].map(m => m[0]).sort()
    expect(markers(pack[key]), `${file}: ${key}`).toEqual(markers(key))
  }
})
