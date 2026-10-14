import './workout-sheet-environment'
// @vitest-environment happy-dom
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { DEF, useStore } from '../src/store/useStore'
import { todayISO } from '@opengym/core/format'
import { beginWorkout, finishWorkout } from '../src/sheets'
const clone = (v: any) => JSON.parse(JSON.stringify(v))
// An id no catalogue of this build knows: v1.3.11 shipped this test with '4321', which v1.4.0 made a
// real exercise, so it has to be one past every id the pack can have.
const UNK = '99999'
const SQUAT = '0043'   // barbell full squat, one this build does know
const DAY = 86400000

const done = (w: any, r: any) => ({ w, r, done: true })
const past = (n: any, entries: any) => ({
  id: 'w' + n, d: new Date(Date.now() - n * 7 * DAY).toISOString().slice(0, 10),
  start: Date.now() - n * 7 * DAY, end: Date.now() - n * 7 * DAY + 3600000,
  name: 'Push', vol: 0, prs: n === 1 ? [UNK] : [], routineIds: ['r1'], entries,
})
const pastEntries = (w: any) => [
  { id: UNK, target: { id: UNK, mode: 'reps', sets: 2, reps: 8 }, sets: [done(w, 8), done(w, 8)] },
  { id: SQUAT, target: { id: SQUAT, mode: 'reps', sets: 2, reps: 5 }, sets: [done(100, 5), done(100, 5)] },
]
const activeEntries = () => [
  { id: UNK, target: { id: UNK, mode: 'reps', sets: 2, reps: 8, weight: 50 }, sets: [{ w: 50, r: 8, done: true }, { w: 50, r: 8, done: false }] },
  { id: SQUAT, target: { id: SQUAT, mode: 'reps', sets: 1, reps: 5, weight: 100 }, sets: [{ w: 100, r: 5, done: false }] },
]

function seed(view: any = 'cards', extra: any = {}) {
  const S = clone(DEF)
  Object.assign(S, {
    unit: 'kg', weighIn: false,
    routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [{ id: UNK, mode: 'reps', sets: 3, reps: 8, weight: 50 }, { id: SQUAT, mode: 'reps', sets: 3, reps: 5, weight: 100 }] }],
    week: { 0: ['r1'], 1: ['r1'], 2: ['r1'], 3: ['r1'], 4: ['r1'], 5: ['r1'], 6: ['r1'] },
    dayPlan: { [todayISO()]: 'r1' },
    workouts: [past(1, pastEntries(55)), past(2, pastEntries(50))],
    favEx: [UNK, SQUAT],
    exWeights: { [UNK]: { w: 55, d: '2026-09-01' } }, exNotes: { [UNK]: 'seat 4' }, barWeights: { [UNK]: 15 },
    active: { id: 'a1', d: todayISO(), start: Date.now(), routineIds: ['r1'], name: 'Push', bw: null, cur: 0, entries: activeEntries(), workoutView: view },
    ...extra,
  })
  useStore.setState({ S, user: null })
}

// Every place the seed put the id, read back from whatever copy is handed in.
function expectKept(S: any, { active = true }: any = {}) {
  expect(S.routines.find((r: any) => r.id === 'r1').ex.map((e: any) => e.id)).toEqual([UNK, SQUAT])
  expect(S.week[1]).toEqual(['r1'])
  expect(S.favEx).toEqual([UNK, SQUAT])
  expect(S.exWeights[UNK]?.w).toBeGreaterThan(0)   // finishing a session moves it on, never away
  expect(S.exNotes[UNK]).toBe('seat 4')
  expect(S.barWeights[UNK]).toBe(15)
  for (const id of ['w1', 'w2']) expect(S.workouts.find((w: any) => w.id === id).entries.map((e: any) => e.id)).toEqual([UNK, SQUAT])
  expect(S.workouts.find((w: any) => w.id === 'w1').prs).toEqual([UNK])
  if (active) expect(S.active.entries.map((e: any) => e.id)).toEqual([UNK, SQUAT])
}

describe('exercise ids this build does not know', () => {
  it('starting the routine and finishing the session keep it, in the new workout too', () => {
    seed('cards', { active: null })
    act(() => beginWorkout(['r1'], null))
    const A = useStore.getState().S.active
    expect(A.entries.map((e: any) => e.id)).toEqual([UNK, SQUAT])
    act(() => useStore.getState().update((s: any) => { s.active.entries.forEach((e: any) => e.sets.forEach((set: any) => { set.done = true })) }))
    act(() => finishWorkout())
    const S = useStore.getState().S
    expect(S.active).toBeNull()
    expect(S.workouts.find((w: any) => w.id === A.id).entries.map((e: any) => e.id)).toEqual([UNK, SQUAT])
    expectKept(S, { active: false })
  })

})
