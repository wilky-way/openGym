import { describe, expect, it } from 'vitest'
import { createExerciseIndex, EXIDX } from '../src/exercises'
import { buildPlannedEntry, buildSessionEntries, programmeDeloadConfig } from '../src/session-start'
import { buildCombinedEntries } from '../src/session-merge'
import { routineFromSession, saveSessionAsRoutine } from '../src/session-routines'
import { repeatSessionEntries } from '../src/session-repeat'
import { buildCompletedWorkout } from '../src/finish-workout'
import { finishCardio, finishCompare } from '../src/finish-compare'
import { replaceSlotExercise, routineChangesFromEntry, updateRoutineFromEntry } from '../src/routines'
import type { State, Routine, Session } from '../src/session-types'

const index = createExerciseIndex([
  { id: 'custom-cardio', n: 'Cardio', bp: 'cardio', eq: 'machine' },
  { id: 'custom-assisted', n: 'Assisted pull', bp: 'back', eq: 'leverage machine', assisted: true },
  { id: 'custom-bar', n: 'Bar lift', bp: 'upper legs', eq: 'barbell' },
  { id: 'custom-bw', n: 'Bodyweight lift', bp: 'back', eq: 'body weight' },
  { id: 'custom-one', n: 'Single arm lift', bp: 'back', eq: 'dumbbell' },
  { id: 'custom-cardio-two', n: 'Other cardio', bp: 'cardio', eq: 'machine' },
  { id: 'custom-db', n: 'Two hand lift', bp: 'upper legs', eq: 'dumbbell' },
])
const routine: Routine = { id: 'r', ex: [{ id: 'custom-cardio', sets: 1, min: 7, speed: 5 }] }
const state: State = { unit: 'kg', workouts: [], routines: [routine] }
const cardio: Session = { entries: [{ id: 'custom-cardio', target: { id: 'custom-cardio' }, sets: [{ done: true, min: 7, speed: 5, r: 9 }] }] }

describe('K14 custom-index output semantics without stubs', () => {
  it('classifies custom cardio in every session construction wrapper', () => {
    expect(buildPlannedEntry(state, routine.ex[0]!, routine, {}, index).sets).toEqual([{ min: 7, speed: 5, done: false }])
    expect(buildSessionEntries(state, routine, index)[0]?.sets).toEqual([{ min: 7, speed: 5, done: false }])
    expect(buildCombinedEntries(state, ['r'], index).entries[0]?.sets).toEqual([{ min: 7, speed: 5, done: false }])
  })
  it('copies and saves custom cardio defaults and logged values', () => {
    expect(routineFromSession(cardio, undefined, [], index).ex[0]).toMatchObject({ min: 7, speed: 5, sets: 1 })
    const draft: State & { routines: Routine[] } = { routines: [] }
    saveSessionAsRoutine(draft, cardio, undefined, index)
    expect(draft.routines[0]?.ex[0]).toMatchObject({ min: 7, speed: 5 })
    const empty: Session = { entries: [{ id: 'custom-cardio', sets: [{ done: false }] }] }
    expect(routineFromSession(empty, undefined, [], index).ex[0]).toMatchObject({ min: 20, speed: 8 })
  })
  it('repeats custom cardio and keeps completed assisted minimum loads', () => {
    expect(repeatSessionEntries(state, cardio, {}, index).entries[0]?.sets).toEqual([{ min: 7, speed: 5, done: false }])
    const assisted: Session = { entries: [{ id: 'custom-assisted', sets: [{ w: 40, r: 8, done: true }, { w: 20, r: 8, done: true }] }] }
    expect(buildCompletedWorkout(assisted, { end: 1000 }, index).entries[0]?.topW).toBe(20)
    expect(buildCompletedWorkout(assisted, { end: 1000 }).entries[0]?.topW).toBe(40)
  })
  it('uses custom classification independently in both finish summaries', () => {
    expect(finishCompare(state, cardio, index)).toEqual([])
    expect(finishCardio(cardio, index)[0]?.sets).toEqual(cardio.entries?.[0]?.sets)
    expect(finishCompare(state, cardio)).toHaveLength(1)
    expect(finishCardio(cardio)).toEqual([])
  })
  it('uses real custom bar warm-up floors and assisted backoff classification', () => {
    const bar = { id: 'custom-bar', sets: 1, reps: 8, weight: 30, warmupSets: 1, prog: 'off' }
    expect(buildPlannedEntry(state, bar, null, {}, index).sets[0]?.w).toBe(20)
    const assisted = { id: 'custom-assisted', sets: 3, reps: 8, weight: 40, backoff: true, prog: 'off' }
    expect(buildPlannedEntry(state, assisted, null, {}, index).sets.map(s => s.w)).toEqual([40, 40, 40])
    expect(buildPlannedEntry(state, assisted, null).sets.map(s => s.w)).not.toEqual([40, 40, 40])
  })
  it('replaces slots using custom cardio, bodyweight and assistance classifications', () => {
    expect(replaceSlotExercise({ id: '0025', weight: 100 }, 'custom-cardio', state, 'r', index)).toEqual({ id: 'custom-cardio', sets: 1, min: 20, speed: 8 })
    expect(replaceSlotExercise({ id: '0025', weight: 100 }, 'custom-bw', state, 'r', index).weight).toBe(0)
    expect(replaceSlotExercise({ id: '0025', weight: 100 }, 'custom-assisted', state, 'r', index).weight).toBe(0)
    expect(replaceSlotExercise({ id: 'custom-assisted', weight: 100 }, '0025', state, 'r', index).weight).toBe(0)
    expect(replaceSlotExercise({ id: 'custom-bw', weight: 100 }, '0025', state, 'r', index).weight).toBe(0)
  })
  it('ignores custom cardio warmups through both routine-write wrappers', () => {
    const r = { id: 'r', ex: [{ id: 'custom-cardio' }] }
    const entries = [{ id: 'custom-cardio', rid: 'r', target: {}, sets: [{ warmup: true }] }]
    expect(routineChangesFromEntry(r, entries, 0, index)).toBeNull()
    expect(updateRoutineFromEntry(r, entries, 0, index)).toBeNull()
    expect(routineChangesFromEntry(r, entries, 0)).not.toBeNull()
    expect(EXIDX['custom-cardio']).toBeUndefined()
  })
  it('deloads custom bar work without violating its real floor', () => {
    const cfg = { id: 'custom-bar', sets: 2, reps: 8, weight: 20 }
    const r = { id: 'r', ex: [cfg], programme: { series: 's', weekIndex: 1 }, deload: {} }
    expect(programmeDeloadConfig(state, cfg, r, index)?.cfg.weight).toBe(20)
    expect(buildPlannedEntry(state, cfg, r, {}, index).sets[0]?.w).toBe(20)
  })
  it('uses custom assisted history in deload filtering and slot replacement', () => {
    const cfg = { id: 'custom-assisted', sets: 2, reps: 8, weight: 100 }
    const r = { id: 'r', ex: [cfg], programme: { series: 's', weekIndex: 1 }, deload: {} }
    const st: State = { ...state, routines: [r], workouts: [{ entries: [{ id: cfg.id, rid: 'r', series: 's', weekIndex: 0, target: { sets: 2, reps: 8 }, sets: [{ w: 40, r: 8, done: true }, { w: 20, r: 8, done: true }] }] }] }
    expect(programmeDeloadConfig(st, cfg, r, index)?.cfg.weight).toBe(15)
    expect(replaceSlotExercise({ id: '0001' }, cfg.id, st, 'r', index).weight).toBe(20)
  })
  it('seeds custom heavy timed and rep warmups on their own increments', () => {
    const cfg = { id: 'custom-db', sets: 1, reps: 8, weight: 33, warmupSets: 2, prog: 'off' }
    expect(buildPlannedEntry(state, cfg, null, {}, index).sets.map(s => s.w)).toEqual([15, 20, 33])
    const timed = { ...cfg, mode: 'time', sec: 30 }
    expect(buildPlannedEntry(state, timed, null, {}, index).sets.map(s => s.w)).toEqual([15, 20, 33])
    const r = { id: 'r', ex: [timed], programme: { series: 's', weekIndex: 1 }, deload: {} }
    expect(programmeDeloadConfig(state, timed, r, index)?.cfg.weight).toBe(25)
  })
  it('converts custom dumbbell history, owned warmups, percentage prescriptions and drop grids', () => {
    const cfg = { id: 'custom-db', sets: 2, reps: 8, weight: 20, warmupSets: 1, dbLoad: 'each' }
    const st: State = { ...state, dumbbells: { kg: { weights: [3, 9, 21] } }, workouts: [{ entries: [{ id: cfg.id, target: { sets: 2, reps: 8, dbLoad: 'total' }, sets: [{ w: 40, r: 8, done: true }, { w: 40, r: 8, done: true }] }] }] }
    const built = buildPlannedEntry(st, cfg, null, {}, index)
    expect(built.target.weight).toBe(21)
    expect(built.sets.map(s => s.w)).toEqual([9, 21, 21])
    const tmCfg = { ...cfg, tm: { key: 'lift', percentages: [50, 75] }, pyramid: [8, 8] }
    const tmState: State = { ...st, programmes: { cycles: [{ id: 'cycle', tm: { lift: 40 } }] } }
    expect(buildPlannedEntry(tmState, tmCfg, { id: 'r', ex: [tmCfg], programme: { cycleId: 'cycle' } }, {}, index).target.pyramidWeight).toEqual([9, 21])
    const drop = { ...cfg, prog: 'off', warmupSets: 0, intensifier: { type: 'dropset', count: 1, pct: 20 } }
    expect(buildPlannedEntry(st, drop, null, {}, index).sets).not.toEqual(buildPlannedEntry(st, drop, null).sets)
    const r = { id: 'r', ex: [cfg], programme: { series: 's', weekIndex: 1 }, deload: {} }
    expect(programmeDeloadConfig(st, cfg, r, index)?.cfg.weight).toBe(9)
  })
  it('preserves the custom cardio planned stamp and failure-plan classification', () => {
    const cfg = { ...routine.ex[0]!, reps: 8, setsMax: 5, lastToFailure: true, backoff: true }
    const e = buildPlannedEntry(state, cfg, routine, {}, index)
    expect(e.target).not.toHaveProperty('backoffStep')
    expect(e.planned).toEqual({ sets: 1 })
    expect(e.sets[0]).not.toHaveProperty('failure')
    expect(repeatSessionEntries(state, { entries: [{ id: cfg.id, target: cfg, sets: [{ min: 7, speed: 5, done: true }] }] }, {}, index).entries[0]?.sets?.[0]).not.toHaveProperty('failure')
  })

  it('uses deload cardio mode for history selection and explicit timed increments', () => {
    const cfg = { id: 'custom-cardio', sets: 1, min: 7, inc: 7, weight: 40 }
    const r = { id: 'r', ex: [cfg], programme: { series: 's', weekIndex: 1 }, deload: {} }
    const st: State = { ...state, routines: [r], workouts: [{ entries: [{ id: cfg.id, rid: 'r', series: 's', weekIndex: 0, target: {}, sets: [{ w: 80, min: 7, done: true }] }] }] }
    expect(programmeDeloadConfig(st, cfg, r, index)?.deload.baseline).toBe('series-last')
    expect(programmeDeloadConfig(state, cfg, r, index)?.cfg.weight).toBe(27.5)
    const heavy = { id: 'custom-db', sets: 1, reps: 8, weight: 33 }
    expect(programmeDeloadConfig(state, heavy, { ...r, ex: [heavy] }, index)?.cfg.weight).toBe(25)
  })
  it('converts single-arm custom history without halving and uses it in next-time summaries', () => {
    const cfg = { id: 'custom-one', sets: 1, reps: 8, weight: 40, dbLoad: 'each' }
    const r = { id: 'r', ex: [cfg] }
    const session: Session = { entries: [{ id: cfg.id, rid: 'r', target: { sets: 1, reps: 8, dbLoad: 'total' }, sets: [{ w: 40, r: 8, done: true }] }] }
    const st: State = { ...state, routines: [r], workouts: [session] }
    expect(buildPlannedEntry(st, cfg, r, {}, index).target.weight).toBe(45)
    expect(finishCompare(st, session, index)[0]?.next?.w).toBe(45)
  })
  it('repeats custom heavy warmups and owned dumbbell drops on their actual grids', () => {
    const st: State = { ...state, dumbbells: { kg: { weights: [3, 9, 21] } } }
    const cfg = { id: 'custom-db', reps: 8, weight: 33 }
    const rows = [{ w: 15, r: 8, done: true, phase: 'warmup' }, { w: 20, r: 8, done: true, phase: 'warmup' }, { w: 33, r: 8, done: true }]
    const session: Session = { entries: [{ id: cfg.id, target: cfg, sets: rows }] }
    expect(repeatSessionEntries(state, session, {}, index).entries[0]?.sets?.map(s => s.w)).toEqual([15, 20, 33])
    const timed: Session = { entries: [{ id: cfg.id, target: { ...cfg, mode: 'time', sec: 30 }, sets: rows.map(s => ({ ...s, sec: 30 })) }] }
    expect(repeatSessionEntries(state, timed, {}, index).entries[0]?.sets?.map(s => s.w)).toEqual([15, 20, 33])
    const drop: Session = { entries: [{ id: cfg.id, target: { ...cfg, intensifier: { type: 'dropset', count: 1, pct: 20 } }, sets: [{ w: 33, r: 8, done: true }] }] }
    expect(repeatSessionEntries(st, drop, {}, index).entries[0]?.sets?.[0]?.drops).toEqual([{ w: 21, r: 8 }])
  })
  it('replaces custom cardio in both directions and skips its irrelevant history', () => {
    expect(replaceSlotExercise({ id: 'custom-cardio', min: 7, speed: 5 }, '0025', state, 'r', index)).toMatchObject({ id: '0025', sets: 3, reps: 10 })
    const st: State = { ...state, workouts: [{ entries: [{ id: 'custom-cardio-two', target: {}, sets: [{ w: 99, r: 8, done: true }] }] }] }
    expect(replaceSlotExercise({ id: 'custom-cardio', min: 7 }, 'custom-cardio-two', st, 'r', index)).toEqual({ id: 'custom-cardio-two', min: 7 })
  })

  it('retains the custom bar floor when prescription reramps a raised load', () => {
    const cfg = { id: 'custom-bar', sets: 1, reps: 8, weight: 20, warmupSets: 1 }
    const st: State = { ...state, workouts: [{ entries: [{ id: cfg.id, target: { sets: 1, reps: 8, weight: 20 }, sets: [{ w: 20, r: 8, done: true }] }] }] }
    expect(buildPlannedEntry(st, cfg, null, {}, index).sets.map(s => s.w)).toEqual([20, 25])
  })

  it('honors a caller index that shadows a catalogue cardio id with a loaded lift', () => {
    const id = Object.values(EXIDX).find(e => e.bp === 'cardio')!.id!
    const local = createExerciseIndex([{ id, n: 'Custom loaded override', bp: 'back', eq: 'dumbbell' }])
    const cfg = { id, sets: 1, reps: 8, weight: 33, inc: 1, warmupSets: 2, mode: '' }
    expect(buildPlannedEntry(state, cfg, null, {}, local).sets.map(s => s.w)).toEqual([16, 24, 33])
    const rack: State = { ...state, dumbbells: { kg: { weights: [3, 9, 21] } } }
    expect(buildPlannedEntry(rack, cfg, null, {}, local).sets.map(s => s.w)).toEqual([9, 21, 33])
    const session: Session = { entries: [{ id, target: cfg, sets: [{ w: 15, r: 8, done: true, phase: 'warmup' }, { w: 20, r: 8, done: true, phase: 'warmup' }, { w: 33, r: 8, done: true }] }] }
    expect(repeatSessionEntries(state, session, {}, local).entries[0]?.sets?.map(s => s.w)).toEqual([16, 24, 33])
    const st: State = { ...state, startFrom: 'last', workouts: [{ entries: [{ id, sets: [{ w: 40, r: 9, done: true }] }] }] }
    expect(buildPlannedEntry(st, { id, sets: 1, reps: 8, weight: 40, mode: '' }, null, {}, local).carried).toBe(true)
    expect(replaceSlotExercise({ id: '0025', weight: 5 }, id, st, 'r', local).weight).toBe(40)
  })

})
