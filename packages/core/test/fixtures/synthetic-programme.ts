// Authored synthetic prescriptions only; no private library or training data.
export const syntheticProgramme = (): any => ({
  id:'synthetic',name:'Synthetic authored block',unit:'lb',goal:'Strength',level:'Intermediate',
  daysPerWeek:1,lengthWeeks:1,equipment:['barbell'],licence:'CC0',
  source:{kind:'own',ref:'Synthetic test',private:false},
  endPlan:{kind:'stop',instructions:'End the block and review the completed log.'},
  weeks:[{index:1,mode:'train',days:[{key:'d1',sessions:[{sessionTemplateId:'main',routineSnapshot:{ex:[{
    id:'0025',slotId:'bench',role:'main',sets:2,reps:5,target:{rpe:8},
    progression:{kind:'manual',instructions:'Keep the prescribed reps and effort; choose loads yourself.'}
  }]}}]}]}]
})
export const syntheticSlot = (d: any): any => d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
// Each legacy conformance issue has an independently addressable failing specimen.
export const conformanceCases: [string, (d: any, e: any) => void][] = [
  ['structure.invalid',(d,e)=>{e.id='synthetic-unknown'}],
  ['slot.category',(d,e)=>{delete e.id;e.open=true;e.label='Choose';delete e.category}],
  ['slot.effort',(d,e)=>{delete e.target;e.setTargets=[{rpe:8},{}]}],
  ['slot.structure-only',(d,e)=>{e.structureOnly=true}],
  ['slot.role',(d,e)=>{delete e.role}],
  ['slot.progression',(d,e)=>{delete e.progression;e.instructions='Grip comfortably.'}],
  ['session.empty',d=>{d.weeks[0].days[0].sessions[0].routineSnapshot.ex=[]}],
  ['program.structure-only',d=>{d.importWarnings=['Structure only']}],
  ['program.end-plan',d=>{delete d.endPlan}],
  ['metadata.goal',d=>{delete d.goal}],
  ['metadata.level',d=>{delete d.level}],
  ['metadata.licence',d=>{delete d.licence}],
  ['metadata.days-per-week',d=>{delete d.daysPerWeek}],
  ['metadata.length',d=>{d.lengthWeeks=4}],
  ['metadata.equipment',d=>{delete d.equipment}],
  ['metadata.source',d=>{delete d.source}],
  ['metadata.private',d=>{if(d.source)delete d.source.private}],
  ['review.unresolved',d=>{d.needsReview=['Untranslated source stage']}],
  ['review.schedule',d=>{d.importWarnings=['Review the schedule before loading.']}],
]
export const syntheticSource = (rows: any[] = [{count:2,reps:5,rpe:8}]): any => ({
  id:'synthetic-source',name:'Synthetic source',unit:'lb',
  weeks:[{n:1,days:[{n:1,exercises:[{
    id:'0025',slot:'bench',role:'main',sets:rows,
    rules:[{kind:'progress',summary:'progress: none (progression disabled)'}]
  }]}]}]
})
