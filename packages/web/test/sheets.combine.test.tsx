// GM safety divergence from legacy: callbacks bind owner/session/editor/row identity; stale targets abort.
import './workout-sheet-environment'
// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { beginWorkout, finishWorkout } from '../src/sheets-d'
import { activate } from '@opengym/core/programme'
import { buildSessionEntries } from '@opengym/core/session-start'
import { buildCompletedWorkout } from '@opengym/core/finish-workout'
import { EXDB } from '@opengym/core/exercises'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'

const clone = (v: any) => JSON.parse(JSON.stringify(v))
const ids = EXDB.filter((e: any) => e.bp !== 'cardio').slice(0, 3).map((e: any) => e.id)

function install(routines: any, week: any = {}) {
  const S = clone(DEF)
  S.routines = routines
  S.week = week
  S.active = null
  S.workouts = []
  useStore.setState({ S, user: null })
}

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [] })
  install([
    { id: 'strength', name: 'Strength', emoji: '🏋️', prog: 'off', ex: [{ id: ids[0], sets: 3, reps: 5, weight: 60 }] },
    { id: 'core', name: 'Core', emoji: '🧘', prog: 'off', ex: [{ id: ids[1], sets: 3, reps: 12, weight: 0 }, { id: ids[2], sets: 3, reps: 10, weight: 0 }] },
    { id: 'rehab', name: 'Rehab', emoji: '🩹', excludeFromProgression: true, ex: [{ id: ids[1], sets: 2, reps: 15, weight: 5 }] },
  ])
})

describe('beginWorkout with a routine-id list', () => {
  it('real finished sessions keep a skipped-week deload on its own latest load by date', () => {
    const st = clone(DEF)
    st.unit = 'lb'; st.sound = false; st.weighIn = false
    const def = { id: 'synthetic', name: 'Synthetic', unit: 'lb', weeks: [4, 5, 6].map((index: any) => ({ index, mode: index === 6 ? 'deload' : 'train', days: [1, 2].map((day: any) => ({ key: `d${day}`, sessions: [{ routineSnapshot: { name: `D${day}`, ex: [{ id: '0025', sets: 1, reps: 8, weight: 100, prog: 'off' }] } }] })) })) }
    activate(st, def, { cycleId: 'synthetic', today: '2026-10-12', now: 10 })
    useStore.setState({ S: st, user: null })
    const finish = (id: any, weight: any, date: any) => {
      act(() => beginWorkout([id], null))
      act(() => useStore.getState().update((s: any) => {
        s.active.d = date
        s.active.entries.forEach((e: any) => e.sets.forEach((row: any) => { row.w = weight; row.done = true }))
      }))
      act(() => finishWorkout())
    }
    finish('synthetic-w4d1', 150, '2026-10-12')
    finish('synthetic-w5d2', 260, '2026-10-14')
    finish('synthetic-w4d1', 140, '2026-10-11') // backdated append comes last in the array
    act(() => useStore.getState().update((s: any) => { s.programmes.cycles[0].occurrences.find((o: any) => o.instanceId === 'synthetic:w5d1').status = 'skipped' }))
    const saved = useStore.getState().S
    expect(saved.exWeights['0025'].w).toBe(260)
    const r = saved.routines.find((r: any) => r.id === 'synthetic-w6d1')
    const [e] = buildSessionEntries(saved, r)
    expect(e.target.weight).toBe(105)
    expect(e.deload).toMatchObject({ baseline: 'series-last', fallback: true, lastDate: '2026-10-12', lastWeekIndex: 4 })
  })

  it('finishing a programme week persists its frozen occurrence and advances the queue', () => {
    const st = clone(DEF)
    st.sound = false
    st.weighIn = false
    const def = { id: 'synthetic', name: 'Synthetic', unit: st.unit, weeks: [1, 2].map((index: any) => ({ index, days: [{ key: 'd1', sessions: [{ sessionTemplateId: 'd1', routineSnapshot: { name: 'Strength', ex: [{ id: '0025', sets: 1, reps: 5, weight: 60 }] } }] }] })) }
    activate(st, def, { cycleId: 'synthetic', today: '2026-10-12', now: 10 })
    useStore.setState({ S: st, user: null })
    act(() => beginWorkout(['synthetic-w1d1'], null))
    act(() => useStore.getState().update((s: any) => { s.active.entries.forEach((e: any) => e.sets.forEach((row: any) => { row.done = true })) }))
    act(() => finishWorkout())
    const saved = useStore.getState().S
    expect(saved.active).toBeNull()
    expect(saved.workouts[0].programmeInstance.instanceId).toBe('synthetic:w1d1')
    expect(saved.programmes.cycles[0].weekIndex).toBe(2)
    expect(saved.queue.ids).toEqual(['synthetic-w2d1'])
  })

  it('freezes programme lineage on live entries and keeps it through finish', () => {
    const st = clone(useStore.getState().S)
    st.routines[0].programme = { cycleId: 'synthetic', instanceId: 'synthetic:w4d1', weekIndex: 4, ordinal: 1, series: 'synthetic:d1' }
    useStore.setState({ S: st })
    act(() => beginWorkout(['strength', 'core'], null))
    const active = clone(useStore.getState().S.active)
    expect(active.programmeInstance).toEqual({ cycleId: 'synthetic', instanceId: 'synthetic:w4d1', weekIndex: 4, ordinal: 1 })
    expect(active.entries[0].series).toBe('synthetic:d1')
    expect(active.entries[1].series).toBeUndefined()
    active.entries.forEach((e: any) => e.sets.forEach((s: any) => { s.done = true }))
    expect(buildCompletedWorkout(active).entries[0].series).toBe('synthetic:d1')
    expect(buildCompletedWorkout(active).programmeInstance).toEqual(active.programmeInstance)
  })

  it('concatenates the routines’ entries in order, stamps rid, derives the name', () => {
    act(() => beginWorkout(['strength', 'core'], null))
    const a = useStore.getState().S.active
    expect(a.routineIds).toEqual(['strength', 'core'])
    expect(a.name).toBe('Strength + Core')
    expect(a.entries.map((e: any) => e.rid)).toEqual(['strength', 'core', 'core'])
    expect(a).not.toHaveProperty('routineId')
    expect(a).not.toHaveProperty('excludeFromProgression')
  })

  it('a single-element list is an ordinary single-routine session', () => {
    act(() => beginWorkout(['strength'], null))
    const a = useStore.getState().S.active
    expect(a.routineIds).toEqual(['strength'])
    expect(a.name).toBe('Strength')
    expect(a.entries.every((e: any) => e.rid === 'strength')).toBe(true)
  })

  it('an empty list is a freestyle session — no entries, no rid', () => {
    act(() => beginWorkout([], null))
    const a = useStore.getState().S.active
    expect(a.routineIds).toEqual([])
    expect(a.name).toBe('Freestyle')
    expect(a.entries).toEqual([])
  })

  it('carries a merged excluded routine’s per-entry noProg', () => {
    act(() => beginWorkout(['strength', 'rehab'], null))
    const a = useStore.getState().S.active
    expect(a.entries.find((e: any) => e.rid === 'rehab').noProg).toBe(true)
    expect(a.entries.find((e: any) => e.rid === 'strength').noProg).toBeUndefined()
  })

  it('drops an unknown id and de-dupes a repeat (first wins)', () => {
    act(() => beginWorkout(['core', 'gone', 'core'], null))
    expect(useStore.getState().S.active.routineIds).toEqual(['core'])
  })
})
