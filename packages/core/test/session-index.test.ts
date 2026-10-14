import { afterEach, describe, expect, it, vi } from 'vitest'
import * as history from '@opengym/core/history'
import * as progression from '@opengym/core/progression'
import * as plates from '@opengym/core/plates'
import * as dumbbells from '@opengym/core/dumbbells'
import * as backoff from '@opengym/core/backoff'
import { buildPlannedEntry, programmeDeloadConfig } from '../src/session-start'
import * as tm from '@opengym/core/programme-tm'
import { createExerciseIndex, EXIDX } from '../src/exercises'
import { buildCombinedEntries } from '../src/session-merge'
import { buildCompletedWorkout } from '../src/finish-workout'
import { routineFromSession } from '../src/session-routines'
import { repeatSessionEntries } from '../src/session-repeat'
import { finishCompare, finishCardio } from '../src/finish-compare'
import { replaceSlotExercise, routineChangesFromEntry, updateRoutineFromEntry } from '../src/routines'
import type { Session, State } from '../src/session-types'

afterEach(() => vi.restoreAllMocks())
const fixture = () => {
  const index = createExerciseIndex([{ id: 'custom-cardio', n: 'Synthetic cardio', eq: 'body weight', bp: 'cardio', cat: 'cardio' }])
  const routine = { id: 'r', name: 'Synthetic', ex: [{ id: '0025', sets: 2, reps: 5, weight: 40 }] }
  const state: State = { unit: 'kg', workouts: [], exWeights: {}, routines: [routine] }
  return { index, routine, state }
}

describe('caller-owned exercise index', () => {
  it('forwards the index through combined building and every exercise-sensitive dependency', () => {
    const { index, state } = fixture()
    const spies = [vi.spyOn(history, 'buildSets'), vi.spyOn(history, 'barFloor'), vi.spyOn(history, 'modeOf'),
      vi.spyOn(backoff, 'backoffStepOf'), vi.spyOn(progression, 'nextPrescription'), vi.spyOn(progression, 'weightIncrement'), vi.spyOn(progression, 'plannedOf'), vi.spyOn(history, 'applyIntensifierPlan'),
      vi.spyOn(plates, 'dropGrid'), vi.spyOn(dumbbells, 'dbLoadFor'), vi.spyOn(dumbbells, 'historyAs'),
      vi.spyOn(dumbbells, 'ownedWeightsFor'), vi.spyOn(tm, 'programmeTMConfig')]
    const { entries } = buildCombinedEntries(state, ['r'], index)
    expect(entries).toHaveLength(1)
    for (const spy of spies) {
      expect(spy.mock.calls.length).toBeGreaterThan(0)
      expect((spy.mock.calls as unknown[][]).some(args => args.at(-1) === index)).toBe(true)
    }
    const best = vi.spyOn(history, 'bestWeightForEntry')
    buildCompletedWorkout({ entries: entries.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s, done: true })) })) }, { end: 1000 }, index)
    expect((best.mock.calls as unknown[][])[0]?.at(-1) === index).toBe(true)
  })

  it('forwards the index through copy, repeat and finish summaries; custom repeat existence is local', () => {
    const { index, state } = fixture()
    const session: Session = { id: 'w', d: '2026-01-01', start: 1000,
      entries: [{ id: '0025', rid: 'r', target: { sets: 1, reps: 5, weight: 40 }, sets: [{ w: 40, r: 5, done: true }] }] }
    const config = vi.spyOn(history, 'defaultConfig'), count = vi.spyOn(history, 'setsFromRows'), mode = vi.spyOn(history, 'modeOf'), build = vi.spyOn(history, 'buildSets')
    routineFromSession(session, undefined, state.routines, index)
    for (const spy of [config, count, mode]) {
      expect(spy.mock.calls.length).toBeGreaterThan(0)
      expect((spy.mock.calls as unknown[][]).some(args => args.at(-1) === index)).toBe(true)
      spy.mockClear()
    }
    repeatSessionEntries(state, session, {}, index)
    for (const spy of [build, mode]) {
      expect(spy.mock.calls.length).toBeGreaterThan(0)
      expect((spy.mock.calls as unknown[][]).some(args => args.at(-1) === index)).toBe(true)
      spy.mockClear()
    }
    finishCompare({ ...state, workouts: [session] }, session, index)
    expect(mode.mock.calls.length).toBeGreaterThan(0)
    expect((mode.mock.calls as unknown[][]).some(args => args.at(-1) === index)).toBe(true)
    mode.mockClear()
    finishCardio(session, index)
    expect(mode.mock.calls.length).toBeGreaterThan(0)
    expect((mode.mock.calls as unknown[][]).some(args => args.at(-1) === index)).toBe(true)
    const custom: Session = { entries: [{ id: 'custom-cardio', sets: [{ done: true, min: 10, speed: 4 }] }] }
    expect(repeatSessionEntries(state, custom, {}, index).skipped).toBe(0)
    expect(repeatSessionEntries(state, custom).skipped).toBe(1)
    expect(EXIDX['custom-cardio']).toBeUndefined()
  })

  it('uses custom classification when replacing or writing a routine slot', () => {
    const { index, state } = fixture()
    const config = vi.spyOn(history, 'defaultConfig')
    replaceSlotExercise({ id: '0025', weight: 100 }, 'custom-cardio', state, 'r', index)
    expect((config.mock.calls as unknown[][])[0]?.at(-1) === index).toBe(true)
    const routine = { id: 'r', ex: [{ id: 'custom-cardio' }] }
    const entries = [{ id: 'custom-cardio', rid: 'r', target: {}, sets: [{ warmup: true }] }]
    expect(routineChangesFromEntry(routine, entries, 0, index)).toBeNull()
    expect(updateRoutineFromEntry(routine, entries, 0, index)).toBeNull()
  })
  it('forwards default increments for timed entries and deload history independently', () => {
    const { index, state } = fixture()
    const step = vi.spyOn(progression, 'defaultIncrement')
    const sessions = vi.spyOn(progression, 'sessionsFor')
    const cfg = { id: '0025', mode: 'time', sets: 2, sec: 30, weight: 40 }
    buildPlannedEntry(state, cfg, null, {}, index)
    expect(step).toHaveBeenCalledWith(cfg.id, 'kg', index)
    step.mockClear(); sessions.mockClear()
    programmeDeloadConfig(state, cfg, { id: 'r', ex: [cfg], programme: { series: 's', weekIndex: 1 }, deload: {} }, index)
    expect(sessions).toHaveBeenCalledWith(state, cfg.id, cfg, 'r', index)
    expect(step).toHaveBeenCalledWith(cfg.id, 'kg', index)
    sessions.mockClear()
    replaceSlotExercise({ id: '0001' }, cfg.id, state, 'r', index)
    expect(sessions.mock.calls.length).toBeGreaterThan(0)
    expect((sessions.mock.calls as unknown[][]).some(args => args.at(-1) === index)).toBe(true)
  })

  it('builds, repeats, copies and finishes custom cardio through the real history port', () => {
    const { index } = fixture()
    const routine = { id: 'r', ex: [{ id: 'custom-cardio', sets: 1, min: 7, speed: 5 }] }
    const state: State = { unit: 'kg', routines: [routine], workouts: [] }
    const { entries } = buildCombinedEntries(state, ['r'], index)
    expect(entries[0]?.sets).toEqual([{ min: 7, speed: 5, done: false }])
    const session: Session = { entries: entries.map(e => ({ ...e, sets: e.sets.map(s => ({ ...s, done: true })) })) }
    expect(repeatSessionEntries(state, session, {}, index).entries[0]?.sets).toEqual([{ min: 7, speed: 5, done: false }])
    expect(routineFromSession(session, undefined, [], index).ex[0]).toMatchObject({ min: 7, speed: 5 })
    expect(finishCardio(session, index)[0]?.sets).toEqual([{ min: 7, speed: 5, done: true }])
    expect(EXIDX['custom-cardio']).toBeUndefined()
  })

})
