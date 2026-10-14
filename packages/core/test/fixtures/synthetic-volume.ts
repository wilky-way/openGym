import type { EngineInput } from '../../src/progression-engine/types'
import type { VolumeRampRule, ScheduledDeloadRule, LinearRule } from '../../../contract/domain/progression'
import { createExerciseIndex } from '../../src/exercises'
import { syntheticProgramme, syntheticSlot } from './synthetic-programme'

// Synthetic exercise metadata, budgets and arithmetic; no athlete or private plan data.
export const volumeIndex = createExerciseIndex([
  {id:'synthetic-chest-a',n:'Synthetic press A',eq:'barbell',bp:'chest',muscleWeights:{chest:1}},
  {id:'synthetic-chest-b',n:'Synthetic press B',eq:'barbell',bp:'chest',muscleWeights:{chest:0.4,triceps:1}},
  {id:'synthetic-leg',n:'Synthetic leg',eq:'barbell',bp:'upper legs',muscleWeights:{quadriceps:1,chest:0}},
])
export function volumeProgramme(distribute: VolumeRampRule['distribute']='round-robin-by-slot-order') {
  const d=syntheticProgramme(), base=syntheticSlot(d)
  const ramp: VolumeRampRule={id:'ramp',kind:'volume-ramp',scope:{muscles:['chest']},startSets:6,addPerWeek:3,maxSets:16,weeks:[1,2,3,4,5],distribute,holdIfMissedReps:true}
  const deload: ScheduledDeloadRule={id:'deload',kind:'scheduled-deload',weeks:[6],setsFactor:0.5,loadFactor:0.6,effort:{rir:4},progressionDuring:'off'}
  const linear: LinearRule={id:'linear',kind:'linear',increment:5,unit:'lb',every:{sessions:1},success:'all-sets-all-reps',rounding:{increment:5,mode:'nearest',usePlates:false}}
  d.lengthWeeks=6;d.progressionRules=[ramp,deload,linear]
  d.weeks=Array.from({length:6},(_,i)=>({index:i+1,mode:i===5?'deload':'train',days:[{key:'d1',sessions:[{sessionTemplateId:'main',routineSnapshot:{ex:[
    {...structuredClone(base),id:'synthetic-chest-a',slotId:'a',sets:2,reps:8,weight:100,progression:{...base.progression,rules:['ramp','linear','deload']}},
    {...structuredClone(base),id:'synthetic-chest-b',slotId:'b',sets:4,reps:8,weight:100,progression:{...base.progression,rules:['ramp','linear','deload']}},
    {...structuredClone(base),id:'synthetic-leg',slotId:'leg',sets:3,reps:8,weight:100,progression:{...base.progression,rules:['ramp','linear','deload']}},
  ]}}]}]}))
  return d
}
export function volumeInput(d=volumeProgramme(), weeks=[1,2,3,4,5,6]): EngineInput {
  return {definition:d,cycle:{id:'synthetic-cycle',week1StartDate:'2026-01-05',weekIndex:1,occurrences:Array.from({length:d.lengthWeeks},(_,i)=>({instanceId:`o${i+1}`,weekIndex:i+1,dayKey:'d1',ordinal:1,routineId:`r${i+1}`,sessionTemplateId:'main',status:'pending'}))},logs:[],profile:{unit:'lb',effortScale:'rir'},weeks}
}
export function volumeLog(week: number, reps: number[], slot='a', extra: Record<string,unknown>={}) {
  return {id:`synthetic-${week}-${slot}`,d:new Date(Date.UTC(2026,0,5+(week-1)*7)).toISOString().slice(0,10),start:week,unit:'lb',end:week+1,entries:[{id:`synthetic-chest-${slot}`,occurrenceId:`o${week}`,target:{slotId:slot,sets:reps.length,reps:8},sets:reps.map(r=>({done:true,w:100,r}))}],...extra}
}

// Hand calculation: MEV 6 +3/wk -> 6,9,12,15,16 (MRV cap), then deload.
// Round robin from zero: split alternating slots, odd set goes to first slot.
export const roundRobinGolden=[[3,3,3],[5,4,3],[6,6,3],[8,7,3],[8,8,3],[1,2,2]]
// Proportional authored ratio 2:4 = 1:2; Hamilton remainders at 16 give 5:11.
export const proportionalGolden=[[2,4,3],[3,6,3],[4,8,3],[5,10,3],[5,11,3],[1,2,2]]
