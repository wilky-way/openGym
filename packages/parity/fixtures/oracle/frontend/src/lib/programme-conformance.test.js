import {it,expect} from 'vitest'
import {readFileSync} from 'node:fs'
import {programmeConformance} from './programme-conformance.js'
import {programmeModelSchema,programmeSchemaIssues} from './programme-model-schema.js'
import {validateProgrammeDefinition,importProgramme} from './programme-import.js'
import {improveProgrammeDefinition} from './programme-quality.js'
import {programmeRuleText} from './programme-rule-text.js'
const ready=()=>({id:'synthetic',name:'Synthetic authored block',unit:'lb',goal:'Strength',level:'Intermediate',daysPerWeek:1,lengthWeeks:1,equipment:['barbell'],licence:'Author permission; private',source:{kind:'own',ref:'Synthetic test',private:true},endPlan:{kind:'stop',instructions:'End the block and review the completed log.'},weeks:[{index:1,mode:'train',days:[{key:'d1',sessions:[{sessionTemplateId:'main',routineSnapshot:{ex:[{id:'0025',slotId:'bench',role:'main',sets:2,reps:5,target:{rpe:8},progression:{kind:'manual',instructions:'Keep the prescribed reps and effort; choose loads yourself.'}}]}}]}]}]})
const slot=d=>d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
it('checks the exported schema against the exact source used by the validator',()=>{
 expect(readFileSync(new URL('../../../docs/programme-model.schema.json',import.meta.url),'utf8')).toBe(JSON.stringify(programmeModelSchema,null,2)+'\n')
 expect(programmeSchemaIssues(ready())).toEqual([]);expect(()=>validateProgrammeDefinition(ready())).not.toThrow()
 const d=ready();slot(d).progression.kind='invented';expect(programmeSchemaIssues(d)).not.toEqual([]);expect(()=>validateProgrammeDefinition(d)).toThrow()
})
it('returns Ready without mutating the definition and includes zero RIR as effort',()=>{
 const d=ready();slot(d).target={rir:0};const before=structuredClone(d);expect(programmeConformance(d)).toEqual({level:'Ready',issues:[]});expect(d).toEqual(before)
})
it('uses Invalid for structural failures and locates a semantic slot failure',()=>{
 const d=ready();slot(d).id='unresolved-synthetic';const c=programmeConformance(d);expect(c.level).toBe('Invalid');expect(c.issues[0]).toMatchObject({requiredFor:'Valid',location:{week:1,day:'d1',session:'main',slot:'bench'}})
})
it('does not treat a rep placeholder as an explicit prescription',()=>{
 const d=ready();delete slot(d).reps;expect(programmeConformance(d).level).toBe('Invalid')
})
it('reports missing effort on each working row with inherited and per-set overrides',()=>{
 const d=ready();delete slot(d).target;slot(d).setTargets=[{rpe:8},{}];const c=programmeConformance(d)
 expect(c.level).toBe('Valid');expect(c.issues.find(i=>i.code==='slot.effort')).toMatchObject({sets:[2],requiredFor:'Complete',location:{week:1,day:'d1',slot:'bench'}})
 d.weeks[0].rir=2;expect(programmeConformance(d).level).toBe('Ready')
 slot(d).setTargets=[{rir:0},{pct:75}];expect(programmeConformance(d).level).toBe('Ready')
})
it('checks every pyramid row and respects legacy percentages',()=>{
 const d=ready(),e=slot(d);delete e.target;e.sets=2;e.pyramid=[5,'max'];e.tm={key:'0025',percentages:[65,80]};expect(programmeConformance(d).level).toBe('Ready')
 delete e.tm;e.setTargets=[{pct:65},{}];expect(programmeConformance(d).issues.find(i=>i.code==='slot.effort').sets).toEqual([2])
})
it('requires a category for open slots even when a label exists',()=>{
 const d=ready(),e=slot(d);delete e.id;e.open=true;e.label='Your accessory';e.role='accessory';delete e.progression;expect(programmeConformance(d).issues.map(i=>i.code)).toContain('slot.category')
 e.category='upper-back pull';expect(programmeConformance(d).level).toBe('Ready')
})
it('supports explicit timed strength GPP while still requiring authored effort',()=>{
 const d=ready(),e=slot(d);delete e.reps;e.mode='time';e.sec=60;e.role='gpp';delete e.progression;expect(programmeConformance(d).level).toBe('Ready');delete e.target;expect(programmeConformance(d).level).toBe('Valid')
})
it('requires role and progression rather than counting generic instructions as a rule',()=>{
 const d=ready(),e=slot(d);delete e.progression;e.instructions='Use a comfortable grip.';expect(programmeConformance(d).issues.map(i=>i.code)).toContain('slot.progression')
 delete e.role;expect(programmeConformance(d).issues.map(i=>i.code)).toContain('slot.role')
})
it('distinguishes Complete from Ready using metadata, end planning and unresolved review',()=>{
 const d=ready();delete d.goal;delete d.endPlan;d.needsReview=['Source stage is ambiguous.'];const c=programmeConformance(d);expect(c.level).toBe('Complete');expect(c.issues.map(i=>i.code)).toEqual(['metadata.goal','program.end-plan','review.unresolved'])
 d.weeks[0].mode='deload';expect(programmeConformance(d).issues.map(i=>i.code)).not.toContain('program.end-plan')
})
it('retains structure-only and multi-session review gates',()=>{
 const d=ready();d.importWarnings=['Structure only; source needs review.'];expect(programmeConformance(d).level).toBe('Valid')
 d.importWarnings=['Multiple sessions on one source day are queued separately. Review the schedule before loading.'];expect(programmeConformance(d).issues.map(i=>i.code)).toContain('review.schedule');d.scheduleReviewed=true;expect(programmeConformance(d).level).toBe('Ready')
})
it('derives count/frequency/equipment and week effort without inventing source metadata',()=>{
 const d=ready();for(const k of ['lengthWeeks','daysPerWeek','equipment','goal','licence'])delete d[k];delete slot(d).target;d.weeks[0].rir=2
 const {definition,changes}=improveProgrammeDefinition(d);expect(definition).toMatchObject({lengthWeeks:1,daysPerWeek:1,equipment:['barbell']});expect(slot(definition).target).toEqual({rir:2});expect(definition.goal).toBeUndefined();expect(definition.licence).toBeUndefined();expect(changes).toContain('/lengthWeeks');expect(slot(d).target).toBeUndefined()
})
it('does not choose an effort value from an authored range or fabricate blank open-slot prescriptions in strict refresh mode',()=>{
 const raw={id:'synthetic-range',name:'Synthetic range',unit:'lb',weeks:[{n:1,days:[{n:1,exercises:[{id:'0025',role:'main',sets:[{count:2,reps:5,rpe:[7,8]}]}]}]}]}
 const p=importProgramme(raw);expect(p.definition.needsReview.join(' ')).toContain('RPE range');expect(slot(p.definition).instructions).toContain('RPE 7–8');expect(slot(p.definition).setTargets).toEqual([{},{}])
 raw.weeks[0].days[0].exercises=[{open:true,name:'Your accessory',sets:[]}];expect(importProgramme(raw,{strictPrescriptions:true}).unprescribed).toHaveLength(1)
})
it('accepts the legacy source-document instruction index but rejects an object in displayed instructions',()=>{
 const d=ready();d.libraryRules={instructions:{pdf:'synthetic.pdf',by_topic:{setup:'Source material'}}};expect(()=>validateProgrammeDefinition(d)).not.toThrow();slot(d).instructions={bad:'display'};expect(()=>validateProgrammeDefinition(d)).toThrow('metadata')
 const raw={id:'synthetic-index',name:'Synthetic index',unit:'lb',rules:{instructions:{pdf:'synthetic.pdf'}},weeks:[{n:1,days:[{n:1,exercises:[{id:'0025',sets:[{count:2,reps:5,rpe:8}]}]}]}]}
 expect(importProgramme(raw).definition.needsReview.join(' ')).toContain('instruction index needs review')
})
it('applies explicit decisions and refuses stale or unsupported slot patches',()=>{
 const d=ready();expect(slot(improveProgrammeDefinition(d,{decisions:{slots:{'/weeks/0/days/0/sessions/0/slots/0':{target:{rir:1}}}}}).definition).target).toEqual({rir:1})
 expect(()=>improveProgrammeDefinition(d,{decisions:{slots:{'/weeks/99/days/0/sessions/0/slots/0':{role:'main'}}}})).toThrow('existing slot')
 expect(()=>improveProgrammeDefinition(d,{decisions:{slots:{'/weeks/0/days/0/sessions/0/slots/0':{weight:100}}}})).toThrow('Unsupported')
})
it('recovers explicit source role/effort only with stable source identity and aligned reps',()=>{
 const raw={id:'synthetic-source',name:'Synthetic source',unit:'lb',weeks:[{n:1,days:[{n:1,exercises:[{id:'0025',slot:'bench',role:'main',sets:[{count:2,reps:5,rpe:8}],rules:[{kind:'progress',summary:'progress: none (progression disabled)'}]}]}]}]}
 const d=importProgramme(raw).definition,e=slot(d);delete e.role;delete e.progression;delete e.setTargets
 const fixed=improveProgrammeDefinition(d,{sourceRaw:raw}).definition;expect(slot(fixed)).toMatchObject({role:'main',setTargets:[{rpe:8},{rpe:8}],progression:{kind:'authored'}})
 e.slotId='unrelated';expect(slot(improveProgrammeDefinition(d,{sourceRaw:raw}).definition).role).toBeUndefined()
 e.slotId=slot(fixed).slotId;e.pyramid=[6,6];expect(slot(improveProgrammeDefinition(d,{sourceRaw:raw}).definition).setTargets).toBeUndefined()
})
it('matches mixed percentage/absolute chunks without assuming every part has ten sets',()=>{
 const raw={id:'synthetic-mixed',name:'Synthetic mixed',unit:'lb',weeks:[{n:1,days:[{n:1,exercises:[{id:'0025',slot:'mixed',sets:[{count:1,reps:3,pct:75,rpe:7},{count:2,reps:8,rpe:8}]}]}]}]}
 const d=importProgramme(raw).definition;for(const e of d.weeks[0].days[0].sessions[0].routineSnapshot.ex)delete e.setTargets
 const fixed=improveProgrammeDefinition(d,{sourceRaw:raw}).definition.weeks[0].days[0].sessions[0].routineSnapshot.ex
 expect(fixed.map(e=>e.setTargets)).toEqual([[{rpe:7}],[{rpe:8},{rpe:8}]])
})
it('requires a real session and repairs mismatched explicit week count',()=>{
 const d=ready();d.weeks[0].days[0].sessions[0].routineSnapshot.ex=[]
 expect(programmeConformance(d).issues.map(i=>i.code)).toContain('session.empty')
 d.lengthWeeks=4;expect(improveProgrammeDefinition(d).definition.lengthWeeks).toBe(4)
})
it('keeps an author-stated length that disagrees with the weeks and flags it, filling only a missing one',()=>{
 const d=ready();d.lengthWeeks=4;const {definition,changes}=improveProgrammeDefinition(d)
 expect(definition.lengthWeeks).toBe(4);expect(changes).not.toContain('/lengthWeeks');expect(programmeConformance(definition).issues.map(i=>i.code)).toContain('metadata.length')
 delete d.lengthWeeks;expect(improveProgrammeDefinition(d).definition.lengthWeeks).toBe(1)
})
it('does not count rules that reference nonexistent working sets as Ready progression',()=>{
 for(const index of ['99','-1','1.5','0']) {
  const exercise={id:'0025',role:'main',sets:[{count:2,reps:5,rpe:8}],rules:[{kind:'progress',summary:`custom(): if (completedReps[${index}] >= 5) { weights += 1lb }`}]}
  const raw={id:'synthetic-set-ref',name:'Synthetic',unit:'lb',goal:'Strength',level:'Intermediate',licence:'Author',source:{kind:'own',ref:'x',private:true},endPlan:{kind:'stop',instructions:'End.'},weeks:[{n:1,days:[{n:1,exercises:[exercise]}]}]}
  const {definition}=importProgramme(raw),c=programmeConformance(definition)
  expect(c.level,index).not.toBe('Ready');expect(definition.needsReview.length+c.issues.length,index).toBeGreaterThan(0)
  expect(programmeRuleText(exercise).complete,index).toBe(false)
 }
 const ok={id:'0025',role:'main',sets:[{count:2,reps:5}],rules:[{kind:'progress',summary:'custom(): if (completedReps[2] >= 5) { weights += 1lb }'}]}
 expect(programmeRuleText(ok).complete).toBe(true)
})
it('blocks Ready when rulesSupported is false even with blank review reasons',()=>{
 for(const needsReview of [[''],['   '],['',' ']]) {
  const d=ready();d.rulesSupported=false;d.needsReview=needsReview;const c=programmeConformance(d)
  expect(c.level,JSON.stringify(needsReview)).not.toBe('Ready');expect(c.issues.map(i=>i.code)).toContain('review.unresolved')
 }
})
it('adds a review reason for both archival instruction indexes and bounds every string in them',()=>{
 for(const key of ['rules','libraryRules']) {
  const raw={id:'synthetic-index',name:'Synthetic',unit:'lb',[key]:{instructions:{pdf:'synthetic.pdf'}},weeks:[{n:1,days:[{n:1,exercises:[{id:'0025',sets:[{count:2,reps:5,rpe:8}]}]}]}]}
  const p=importProgramme(raw);expect(p.definition.needsReview.join(' '),key).toContain('instruction index');expect(p.definition.rulesSupported,key).toBe(false)
  const d=ready();d[key]={instructions:{pdf:'synthetic.pdf'}};expect(programmeConformance(d).issues.map(i=>i.code),key).toContain('review.unresolved')
  raw[key]={instructions:{nested:{deep:['x'.repeat(10001)]}}};expect(()=>importProgramme(raw),key).toThrow('metadata')
  raw[key]={instructions:{count:'x'.repeat(10001)}};expect(()=>importProgramme(raw),key).toThrow('metadata')
 }
})

it('round-trips generated rules, authored instructions and note provenance in both effort scales',async()=>{
 const {programmeInstructions}=await import('./programme-instructions.js')
 const raw={id:'synthetic-provenance',name:'Synthetic',unit:'lb',weeks:[{n:1,days:[{n:1,exercises:[{id:'0025',instructions:'Authored RPE 8 stays verbatim.',sets:[{count:2,reps:5,rpe:[7,8],until_rpe:8},{count:1,reps:5,rir:[0,2]}]}]}]}]}
 const d=importProgramme(raw).definition,e=slot(d);e.note='W1 · 2 RIR';e.noteKind='planner'
 const roundTrip=importProgramme(JSON.stringify(d)).definition
 expect(roundTrip).toEqual(d);expect(programmeSchemaIssues(roundTrip)).toEqual([])
 expect(e.generatedRules).toEqual([{rpe:[7,8],until_rpe:8},{rir:[0,2]}])
 expect(e.authoredInstructions).toBe('Authored RPE 8 stays verbatim.')
 expect(programmeInstructions({effort:'rpe'},slot(roundTrip))).toContain('RPE 7–8')
 expect(programmeInstructions({effort:'rpe'},slot(roundTrip))).toContain('RPE 8–10')
 expect(programmeInstructions({effort:'rir'},slot(roundTrip))).toContain('RIR 2–3')
 expect(programmeInstructions({effort:'rir'},slot(roundTrip))).toContain('RIR 0–2')
 expect(programmeInstructions({effort:'rir'},slot(roundTrip))).toContain(e.authoredInstructions)
 for(const range of [[8,7],['7',8],[0,8],[7,11]]) {
  e.generatedRules=[{rpe:range}];expect(()=>importProgramme(d)).toThrow('generated rules')
 }
 e.generatedRules=[{rir:[0,0]}];expect(()=>importProgramme(d)).not.toThrow()
})
