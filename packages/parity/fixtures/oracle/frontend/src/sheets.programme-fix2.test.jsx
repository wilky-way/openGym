// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { beginWorkout } from './sheets.jsx'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { activate, insertDeload, shiftNotToday } from './lib/programme.js'
import { startProgramme } from './lib/programme-lifecycle.js'
import { projectCycle } from './lib/programme-calendar.js'
import { buildSessionEntries } from './lib/session-start.js'

const TODAY = '2026-10-12'
const targets = [null, { rpe: 8, pct: 75 }, { rir: 2 }]
const definition = () => ({ id: 'synthetic', name: 'Synthetic', unit: 'lb', weeks: [1, 2].map(index => ({
  index, days: [1, 2].map(n => ({ key: `d${n}`, sessions: [{ routineSnapshot: {
    name: `Day ${n}`, ex: [{ id: '0025', sets: 3, reps: 10, weight: 100, prog: 'off', setTargets: structuredClone(targets) }],
  } }] })),
})) })
const state = () => ({ ...structuredClone(DEF), unit: 'lb', routines: [], workouts: [], sound: false, weighIn: false })
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00-05:00'))
  useStore.setState({ S: state(), user: null }); useUI.setState({ sheets: [], toastMsg: '' })
  _setLangState('en', null, null, null)
})
afterEach(() => vi.useRealTimers())

it.each(['c-w1d1', 'c-w1d2'])('R2-2 Not today still allows manually starting %s today', routineId => {
  const S = state(); activate(S, definition(), { cycleId: 'c', today: TODAY })
  expect(shiftNotToday(S, 'c', TODAY)).toBe(true)
  expect(projectCycle(S.programmes.cycles[0], S.workouts, TODAY, S.queue).next.date).toBe('2026-10-13')
  useStore.setState({ S })
  act(() => beginWorkout([routineId], null))
  expect(useStore.getState().S.active?.routineIds).toEqual([routineId])
  expect(useUI.getState().toastMsg).toBe('')
})

it('R2-2 Not today keeps a selected future launch date enforced', () => {
  const S = state(); startProgramme(S, definition(), { cycleId: 'c', today: TODAY, startsOn: '2026-10-19' })
  shiftNotToday(S, 'c', TODAY); useStore.setState({ S })
  const before = structuredClone(S)
  act(() => beginWorkout(['c-w1d1'], null))
  expect(useStore.getState().S).toEqual(before)
  expect(useUI.getState().toastMsg).toContain('2026-10-19')
})

it('R2-3 inserted deload accepts null targets and preserves source and percentages', () => {
  const S = state(); activate(S, definition(), { cycleId: 'c', today: TODAY })
  const before = structuredClone(S.routines)
  insertDeload(S, 'c', { key: 'easy' })
  const r = S.routines.find(r => r.programme.weekId === 'deload-easy')
  expect(r.ex[0].setTargets).toEqual([{ rir: 8 }, { pct: 75, rir: 8 }, { rir: 8 }])
  expect(buildSessionEntries(S, r)[0].sets[0].target).toEqual({ rir: 8 })
  expect(S.routines.slice(0, before.length)).toEqual(before)
  expect(S.programmes.cycles[0].snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].setTargets).toEqual(targets)
})
