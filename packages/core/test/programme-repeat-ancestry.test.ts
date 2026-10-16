import { expect, it } from 'vitest'
import { activate, skip } from '../src/programme'
import { finishProgrammeBlock } from '../src/programme-rollover'
import { repeatProgrammeWeek } from '../src/programme-today'
import { syntheticProgramme } from './fixtures/synthetic-programme'

it('retains repeat and restart ancestry on the stored cycle after activation normalization',()=>{
  const state:any={unit:'lb',routines:[],workouts:[]}
  const definition=syntheticProgramme()
  definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].progression.parameters={continuityKey:'synthetic'}
  const first=activate(state,definition,{cycleId:'first',today:'2026-01-05'})
  const restarted=repeatProgrammeWeek(state,first.id,'2026-01-06') as typeof first
  expect(state.programmes.cycles.find((c:any)=>c.id===first.id).restartedAs).toBe(restarted.id)
  skip(state,restarted.id,restarted.occurrences[0]!.instanceId,{today:'2026-01-06'})
  const next=finishProgrammeBlock(state,restarted.id,'repeat',{today:'2026-01-12'}) as typeof first
  expect(state.programmes.cycles.find((c:any)=>c.id===restarted.id).repeatedAs).toBe(next.id)
  expect(state.programmes.cycles.find((c:any)=>c.id===first.id).restartedAs).toBe(restarted.id)
  expect(state.workouts).toEqual([])
})
