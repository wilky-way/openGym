import './workout-sheet-environment'
// @vitest-environment happy-dom
import { act } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { beginWorkout } from '../src/sheets-d'
import { DEF, useStore, type StoreDocument } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { startProgramme } from '@opengym/core/programme-lifecycle'
const TODAY = '2026-10-12'
const definition = () => ({id: 'synthetic', name: 'Synthetic', unit: 'lb', weeks: [1,2].map(index => ({index, days: [{key:'d1',sessions:[{routineSnapshot:{name:'Day 1',ex:[{id:'0025',sets:3,reps:10,weight:100,prog:'off'}]}}]}]}))})
const state = (): StoreDocument => ({...structuredClone(DEF), unit:'lb', routines: [], workouts:[], sound:false,weighIn:false})
beforeEach(() => {vi.setSystemTime(new Date('2026-10-12T17:00:00Z'));useStore.setState({S:state(),user:null});useUI.setState({sheets:[],toastMsg:''})})
it('beginWorkout rejects a future program even in a combined session and allows the start date', () => {
  const S = state(); startProgramme(S, definition(), { cycleId: 'future', today: TODAY, startsOn: '2026-10-19' }); S.routines.push({ id: 'ordinary', name: 'Ordinary', ex: [] }); useStore.setState({ S })
  const before = structuredClone(S)
  act(() => beginWorkout(['ordinary','future-w1d1'], null))
  expect(useStore.getState().S).toEqual(before)
  expect(useUI.getState().toastMsg).toContain('2026-10-19')
  vi.setSystemTime(new Date('2026-10-19T12:00:00-05:00'))
  act(() => beginWorkout(['future-w1d1'], null))
  expect(useStore.getState().S.active.routineIds).toEqual(['future-w1d1'])
})

