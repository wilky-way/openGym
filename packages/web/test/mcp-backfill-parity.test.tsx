// @vitest-environment happy-dom
import './workout-sheet-environment'
import { act } from 'react'
import { expect, it, vi } from 'vitest'
import { useStore, DEF, clone } from '../src/store/useStore'
import { finishWorkout } from '../src/sheets-d'
import { createExerciseIndex } from '@opengym/core/exercises'
import { activate } from '@opengym/core/programme'
import { buildBackfillSession } from '../../core/src/past-workout'
import { prepareLoggedWorkout } from '../../mcp/src/workout-tools'

const now = Date.parse('2026-10-14T23:00:00Z')
it.each(['rotation', 'programme'])('MCP routine log queue equals actual UI past-workout finish (%s)', kind => {
  vi.setSystemTime(now)
  const S: any = { ...clone(DEF), _rev: 7, _wid: 'epoch', sound: false }
  let routineId = 'r'
  if (kind === 'programme') {
    const definition: any = {id:'synthetic',name:'Synthetic',unit:'kg',weeks:[1,2].map(index=>({index,
      days:[{key:'d1',sessions:[{routineSnapshot:{ex:[{id:'0025',sets:1,reps:5,weight:50,mode:'reps',prog:'off'}]}}]}]}))}
    activate(S, definition, {cycleId:'c',today:'2026-10-11',now:Date.parse('2026-10-11T00:00:00Z')})
    routineId = 'c-w1d1'
  } else {
    S.routines = [{id:routineId,name:'Synthetic bench',ex:[{id:'0025',sets:1,reps:5,weight:50,mode:'reps',prog:'off'}]}]
    S.rotation = {id:'rot',sequence:[routineId],label:'Split'}
    S.queue = {ids:[routineId],since:1,startsOn:'2026-10-11',rotationId:'rot',label:'Old pass'}
    S.dayPlan = {'2026-10-14':routineId}
  }
  const input = {date:'2026-10-12',routine_id:routineId,exercises:[{exercise:'0025',sets:[{reps:5,weight:50}]}]}
  const mcp = prepareLoggedWorkout(S, input, {id:'same',now})
  const index = createExerciseIndex(S.customEx)
  const active = buildBackfillSession(S, {id:'same',iso:input.date,durationMin:60,routineIds:[routineId]}, index)
  active.entries.forEach(e => e.sets!.forEach(s => {s.done = true}))
  useStore.setState({S:{...structuredClone(S),active},index,user:null})
  act(() => finishWorkout())
  const ui = useStore.getState().S
  expect(ui.active).toBeNull()
  expect(JSON.stringify(mcp.state.queue)).toBe(JSON.stringify(ui.queue))
  expect(JSON.stringify(mcp.state.dayPlan)).toBe(JSON.stringify(ui.dayPlan))
  if (kind === 'programme') {
    expect(mcp.state.programmes.cycles[0].weekIndex).toBe(2)
    expect(ui.programmes.cycles[0].weekIndex).toBe(2)
  } else expect(ui.queue.startsOn).toBe('2026-10-13')
})
