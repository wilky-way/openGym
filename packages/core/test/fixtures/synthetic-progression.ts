import type { ProgressionRule, SlotRef } from '../../../contract/domain/progression'
import { syntheticProgramme, syntheticSlot } from './synthetic-programme'
export const sourceRef: SlotRef={week:1,day:'d1',session:'main',slot:'bench'}
const rounding={increment:2.5,mode:'nearest' as const,usePlates:false}
export const syntheticRules = (): ProgressionRule[] => structuredClone<ProgressionRule[]>([
 {id:'percent',kind:'percentage',ref:{lift:'bench',basis:'tm'},weeks:{'1':[{pct:0.65,reps:5},{pct:0.8,reps:'amrap',repsMin:5}]},rounding},
 {id:'rpe',kind:'rpe-load',lift:'bench',weeks:{'*':[{reps:5,rpe:8},{reps:5,rir:2}]},e1rm:{window:{sessions:3},pick:'best',formula:'epley',useLoggedEffort:true},rounding,whenNoData:{kind:'athlete-picks'}},
 {id:'double',kind:'double',repsLow:5,repsHigh:8,condition:'all-sets',increment:5,unit:'lb',afterIncrease:'reset-to-low',rounding},
 {id:'linear',kind:'linear',increment:5,unit:'lb',every:{sessions:2},success:'all-sets-all-reps',rounding},
 {id:'amrap',kind:'amrap-tm',lift:'bench',source:{slot:sourceRef,set:1},bands:[{minRepsOver:5,tmDelta:10},{minRepsOver:0,tmDelta:0}],unit:'lb',at:'end-of-week'},
 {id:'stall',kind:'stall',after:3,action:{kind:'reset',pct:0.9},appliesTo:'load'},
 {id:'deload',kind:'scheduled-deload',weeks:[1],setsFactor:0.5,loadFactor:0.6,effort:{rir:4},progressionDuring:'off'},
 {id:'ramp',kind:'volume-ramp',scope:{slots:[sourceRef]},startSets:2,addPerWeek:1,maxSets:6,weeks:[1],distribute:'round-robin-by-slot-order',holdIfMissedReps:true},
])
export const progressionProgramme = () => {
 const d=syntheticProgramme();d.tmSeeds={bench:{value:100,unit:'lb'}}
 d.progressionRules=[structuredClone(syntheticRules()[0])]
 syntheticSlot(d).progression.rules=['percent']
 return d
}
