import {activate} from '../../src/programme'
import {syntheticProgramme} from './synthetic-programme'
export function maxState(typed=true): any {
  const d=syntheticProgramme();d.maxBasis='tm';d.lengthWeeks=2
  d.tmSeeds={bench:{value:200,unit:'lb'}}
  d.weeks=[1,2].map(index=>({...structuredClone(d.weeks[0]),index}))
  for (const w of d.weeks) {
    const e=w.days[0].sessions[0].routineSnapshot.ex[0]
    e.pyramid=[5,5];e.tm={key:'bench',percentages:[50,50],reference:'as-authored'}
    if (typed) e.progression.rules=['percent']
  }
  if (typed) d.progressionRules=[{id:'percent',kind:'percentage',ref:{lift:'bench',basis:'tm'},rounding:{increment:5,mode:'nearest',usePlates:false},weeks:{'1':[{pct:.5,reps:5},{pct:.5,reps:5}],'2':[{pct:.5,reps:5},{pct:.5,reps:5}]}}]
  const S:any={unit:'lb',routines:[],workouts:[]}
  const c=activate(S,d,{today:'2026-10-12',cycleId:'c',tm:{bench:200},now:1})
  c.tmSeed={bench:200};c.tmUnit='lb'
  return S
}
export function customAdaptiveState():any {
 const S=maxState(),c=S.programmes.cycles[0],custom={id:'synthetic-custom-assisted',n:'Synthetic custom assistance',eq:'leverage machine',assisted:true,custom:true}
 S.customEx=[custom]
 for(const w of c.snapshot.weeks)w.days[0].sessions[0].routineSnapshot.ex[0].id=custom.id
 for(const r of S.routines)r.ex[0].id=custom.id
 c.snapshot.progressionRules.push({id:'bump',kind:'amrap-tm',lift:'bench',source:{slot:{week:1,day:'d1',session:'main',slot:'bench'},set:1},at:'end-of-week',bands:[{minRepsOver:0,tmDelta:5}],unit:'lb'})
 for(const w of c.snapshot.weeks)w.days[0].sessions[0].routineSnapshot.ex[0].progression.rules.push('bump')
 for(const rows of Object.values(c.snapshot.progressionRules[0].weeks) as any[])rows[1]={pct:.5,reps:'amrap',repsMin:5}
 c.snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].pyramid[1]='max'
 S.workouts=[{id:'log',d:'2026-10-12',start:2,entries:[{id:custom.id,occurrenceId:c.occurrences[0].instanceId,target:{slotId:'bench'},sets:[{done:true,w:100,r:5},{done:true,w:100,r:6}]}]}]
 return S
}
