import { expect, it } from 'vitest'
import { syntheticProgramme, syntheticSlot } from './fixtures/synthetic-programme'
import { activate } from '../src/programme'
import { buildSessionEntries } from '../src/session-start'
import { programmeCommunityConfig } from '../src/community-session'
import { createExerciseIndex } from '../src/exercises'

function fixture(step=false) {
  const d=syntheticProgramme(),a=syntheticSlot(d)
  a.weight=100;a.pyramid=[5,5];a.progression.rules=['lp'];a.progression.parameters={continuityKey:'bench',...(step ? {repProgression:'step'} : {})}
  d.progressionRules=[{id:'lp',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{increment:5,mode:'nearest',usePlates:false}}]
  const day=structuredClone(d.weeks[0].days[0]);day.key='d2';d.weeks[0].days.push(day)
  const state:any={unit:'lb',routines:[],workouts:[]},c=activate(state,d,{cycleId:'c',today:'2026-01-05'})
  state.workouts=[{id:'w',d:'2026-01-05',start:1,unit:'lb',entries:[{id:'0025',occurrenceId:c.occurrences[0]!.instanceId,target:{slotId:'bench',sets:2,reps:5},sets:[{w:100,r:5,done:true},{w:100,r:5,done:true}]}]}]
  return {state,c,routine:state.routines[1]}
}
it('actual Start rows use current engine loads without writing routine, cycle or logs',()=>{
  const {state,routine}=fixture(),before=structuredClone(state)
  const entry=buildSessionEntries(state,routine)[0]!
  expect(entry.sets.map(s=>s.w)).toEqual([105,105]);expect(entry.target).toMatchObject({enginePrescription:true,communityPrescription:true})
  expect(state).toEqual(before)
  // Rebuilding an already-started entry must preserve the frozen target.
  state.workouts[0].entries[0].sets.forEach((s:any)=>s.w=200)
  expect(programmeCommunityConfig(state,entry.target,routine)).toEqual(entry.target)
})
it('no-seed loads remain athlete-picked and ordinary configs retain existing behavior',()=>{
  const {state,c,routine}=fixture();state.workouts=[]
  for(const day of c.snapshot.weeks[0]!.days) delete day.sessions[0]!.routineSnapshot.ex[0]!.weight
  delete routine.ex[0].weight
  expect(buildSessionEntries(state,routine)[0]!.sets.every(s=>s.w===undefined)).toBe(true)
  const plain={id:'0025',sets:2,reps:5,weight:100}
  expect(programmeCommunityConfig(state,plain,routine)).toBe(plain)
})
it('forwards custom assisted index through the Start adapter and evaluator',()=>{
  const {state,c,routine}=fixture(), custom={id:'custom-assist',n:'Synthetic assisted press',eq:'machine',assisted:true}
  const index=createExerciseIndex([custom]);state.customEx=[custom]
  for(const day of c.snapshot.weeks[0]!.days) day.sessions[0]!.routineSnapshot.ex[0]!.id=custom.id
  for(const r of state.routines) r.ex[0].id=custom.id
  state.workouts[0].entries[0].id=custom.id
  expect(buildSessionEntries(state,routine,index)[0]!.sets.map(s=>s.w)).toEqual([95,95])
  expect(programmeCommunityConfig(state,routine.ex[0],routine).pyramidWeight).toEqual([105,105])
})
it('rejects stale or ambiguous programme slot identity instead of guessing loads',()=>{
  const {state,routine}=fixture();const before=structuredClone(state)
  expect(()=>programmeCommunityConfig(state,{...routine.ex[0],slotId:'other'},routine)).toThrow('stable source slot')
  state.programmes.cycles.push(structuredClone(state.programmes.cycles[0]))
  expect(()=>programmeCommunityConfig(state,routine.ex[0],routine)).toThrow('frozen programme cycle')
  state.programmes.cycles.pop();expect(state).toEqual(before)
})
it('double progression opens actual rows at the next rep step even with start-from-last',()=>{
  const {state,c,routine}=fixture(true);state.startFrom='last'
  c.snapshot.progressionRules=[{id:'lp',kind:'double',increment:5,unit:'lb',repsLow:5,repsHigh:8,condition:'all-sets',afterIncrease:'reset-to-low',rounding:{increment:5,mode:'nearest',usePlates:false}}]
  const entry=buildSessionEntries(state,routine)[0]!
  expect(entry.sets.map(s=>[s.w,s.r])).toEqual([[100,6],[100,6]])
  expect(entry.target.reps).toBe(6)
})
