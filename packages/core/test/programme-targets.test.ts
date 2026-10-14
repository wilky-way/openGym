import type { SetTarget } from '../../contract/domain/state-doc'
import {it,expect} from 'vitest'
import {importProgramme} from '@opengym/core/programme-import'
import {activate} from '@opengym/core/programme'
import {buildSessionEntries} from '@opengym/core/session-start'
import {createExerciseIndex} from '@opengym/core/exercises'
import {targetLabel,validateSetTarget,targetForScale,effortRangeLabel,programmeNote,programmeQueueLabel} from '../src/programme-targets.js'
export const synthetic = (): any => ({id:'synthetic-targets',name:'Synthetic targets',unit:'lb',weeks:[{n:1,days:[{n:1,exercises:[{id:'0025',sets:[{count:1,reps:1,rpe:8},{count:3,reps:5,rpe:7}]}]}]}]})
it('preserves authored per-set effort through import, export, activation and workout rows',()=>{
 const p=importProgramme(synthetic());expect(p.warnings).toEqual([]);expect(p.definition.rulesSupported).toBe(true)
 const d=importProgramme(JSON.stringify(p.definition)).definition,S: any={unit:'lb',routines:[],workouts:[]}
 activate(S,d,{today:'2026-10-12',cycleId:'c'});const entry=buildSessionEntries(S,S.routines[0])[0]
 expect(entry.sets.map((s: any)=>s.target)).toEqual([{rpe:8},{rpe:7},{rpe:7},{rpe:7}]);expect(entry.sets.map((s: any)=>s.r)).toEqual([1,5,5,5]);expect(entry.sets.every((s: any)=>s.rpe==null)).toBe(true)
 expect(targetLabel({rpe:8})).toBe('@8');expect(targetLabel({rir:2},(s,n)=>s.replace('{0}',String(n)))).toBe('2 RIR')
})
it('keeps row targets off warmups and validates authored values',()=>{
 const S: any={unit:'lb',routines:[],workouts:[]},p=importProgramme(synthetic());activate(S,p.definition,{today:'2026-10-12',cycleId:'c'})
 const cfg=S.routines[0].ex[0];cfg.warmup=[{w:45,r:5}];const e=buildSessionEntries(S,S.routines[0])[0]
 expect(e.sets.filter((s: any)=>s.warmup).every((s: any)=>s.target==null)).toBe(true)
 for(const bad of [{rpe:11},{rir:-1},{pct:0},{rpe:NaN},{rpe:'8'},[]]) expect(()=>validateSetTarget(bad)).toThrow()
})
it('imports synthetic top-set and conditional backoff instructions without predicting loads',()=>{
 const raw=synthetic(),e=raw.weeks[0].days[0].exercises[0];e.instructions="Back-offs: −10% of today's top set, 3×5 @7";e.sets[1]={count:3,reps:5,rpe:7,kind:'backoff',drop_pct:10,until_rpe:8,total_reps:15}
 const p=importProgramme(raw);expect(p.warnings).toEqual([]);const cfg=p.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
 expect(cfg.instructions).toContain("Drop 10% from today's top set; repeat until @8; 15 total reps");expect(importProgramme(JSON.stringify(p.definition)).definition).toEqual(p.definition)
 const S: any={unit:'lb',routines:[],workouts:[]};activate(S,p.definition,{cycleId:'c',today:'2026-10-12'});expect(buildSessionEntries(S,S.routines[0])[0].target.instructions).toBe(cfg.instructions)
 expect(cfg.pyramidWeight).toEqual([0,0,0,0])
})
it('starts percentages with optional TM, keeping authored percentage targets in both units',()=>{
 for(const unit of ['kg','lb']) {
 const raw=synthetic();raw.unit=unit;raw.weeks[0].days[0].exercises[0].sets=[{count:1,reps:5,pct:75,rpe:8}]
 const p=importProgramme(raw),S: any={unit,routines:[],workouts:[]};const c=activate(S,p.definition,{cycleId:'c',today:'2026-10-12'})
 let e=buildSessionEntries(S,S.routines[0])[0];expect(e.sets[0].target).toEqual({pct:75,rpe:8});expect(e.sets[0].w).toBe(0)
 c.tm={'0025':200};e=buildSessionEntries(S,S.routines[0])[0];expect(e.sets[0].w).toBe(150);expect(targetLabel(e.sets[0].target)).toBe('@8 · 75%')
 }
})
it('imports synthetic restricted-b blank accessories as open slots and remembers chosen exercises by stable slot',async()=>{
 const {chooseOpenSlot}=await import('@opengym/core/programme-open-slots'),{buildCombinedEntries}=await import('@opengym/core/session-merge'),{buildCompletedWorkout}=await import('@opengym/core/finish-workout')
 const raw=synthetic();raw.id=[String.fromCharCode(115,98,115),'synthetic-targets'].join('-');raw.weeks[0].days[0].exercises=[{name:'Back accessory',slot:'back',sets:[],parsed:true}];raw.weeks.push({...structuredClone(raw.weeks[0]),n:2})
 const p=importProgramme(raw);expect(p.unknown).toEqual([]);expect(p.unprescribed).toEqual([])
 const cfg=p.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0];expect(cfg).toMatchObject({open:true,sets:3,repsMin:10,reps:15})
 const S: any={unit:'lb',routines:[],workouts:[]};activate(S,p.definition,{cycleId:'c',today:'2026-10-12'});S.active={id:'a',entries:buildCombinedEntries(S,[S.routines[0].id]).entries}
 const index=createExerciseIndex(S.customEx)
 expect(S.active.entries[0].sets).toEqual([]);expect(chooseOpenSlot(S,0,'0025','wrong',cfg.slotId,index)).toBe(false)
 expect(chooseOpenSlot(S,0,'0025','a',cfg.slotId,index)).toBe(true);expect(S.routines.map((r: any)=>r.ex[0].id)).toEqual(['0025','0025'])
 expect(S.programmes.cycles[0].snapshot.weeks[1].days[0].sessions[0].routineSnapshot.ex[0].id).toBe('0025')
 const entry=S.active.entries[0];expect(entry.sets).toHaveLength(3);entry.sets[0].w=100;entry.sets[0].done=true
 expect(chooseOpenSlot(S,0,'0033','a',cfg.slotId,index)).toBe(false)
 const log=buildCompletedWorkout(S.active);expect(log.entries[0]).toMatchObject({id:'0025',series:'c:d1',occurrenceId:'c:w1d1',target:{slotId:cfg.slotId,open:true}})
 expect(buildSessionEntries(S,S.routines[1])[0].id).toBe('0025')
})
it('validates a native open slot without a catalogue id and keeps it across re-import',()=>{
 const raw=synthetic(),d=importProgramme(raw).definition,e=d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
 delete e.id;e.open=true;e.label='Your pick';expect(importProgramme(d).definition).toEqual(d)
 e.open=false;expect(()=>importProgramme(d)).toThrow('unknown exercises')
})
it('preserves native rep ranges and differing per-set ranges in the workout and roundtrip',()=>{
 const raw=synthetic(),e=raw.weeks[0].days[0].exercises[0];e.sets=[{count:3,reps:[10,15],rir:2}]
 let p=importProgramme(raw),cfg=p.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0];expect(cfg).toMatchObject({sets:3,repsMin:10,reps:15});expect(cfg.pyramid).toBeUndefined();expect(p.warnings).toEqual([])
 const S: any={unit:'lb',routines:[],workouts:[]};activate(S,p.definition,{cycleId:'c',today:'2026-10-12'});expect(buildSessionEntries(S,S.routines[0])[0].sets.map((s: any)=>s.repTarget)).toEqual(Array(3).fill({min:10,max:15}))
 e.sets=[{count:1,reps:[4,6]},{count:2,reps:[8,10]}];p=importProgramme(raw);expect(importProgramme(JSON.stringify(p.definition)).definition).toEqual(p.definition);const T: any={unit:'lb',routines:[],workouts:[]};activate(T,p.definition,{cycleId:'d',today:'2026-10-12'});expect(buildSessionEntries(T,T.routines[0])[0].sets.map((s: any)=>s.repTarget)).toEqual([{min:4,max:6},{min:8,max:10},{min:8,max:10}])
})
it('checks allocation bounds for missing rows and refuses nonfinite native weights before JSON conversion',()=>{
 const raw=synthetic(),e=raw.weeks[0].days[0].exercises[0];delete e.sets
 raw.weeks[0].days[0].exercises=Array.from({length:100},()=>structuredClone(e));raw.weeks.push({...structuredClone(raw.weeks[0]),n:2})
 expect(()=>importProgramme(raw,{prescriptions:{'0025|':{sets:100,reps:5}}})).toThrow('size limit')
 const d=importProgramme(synthetic()).definition;d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].weight=Infinity;expect(()=>importProgramme(d)).toThrow('prescription')
})
it('validates persisted definitions with field clocks while still rejecting malformed UI text',()=>{
 const d=importProgramme(synthetic()).definition;d._f={name:123,instructions:124};d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]._f={instructions:124,target:125}
 expect(importProgramme(d).definition).toEqual(d);d.name={bad:true};expect(()=>importProgramme(d)).toThrow('metadata')
})
it('reimports synthetic private strength templates without losing varying effort or conditional rules',()=>{
 const raw=synthetic();raw.id=[String.fromCharCode(98,98,109),'synthetic-targets'].join('-');raw.weeks[0].days[0].exercises[0].sets[1]={count:3,reps:5,rpe:7,drop_pct:10,until_rpe:8,kind:'backoff'}
 const p=importProgramme(raw);expect(p.definition.source.private).toBe(true);expect(p.definition.rulesSupported).toBe(true);expect(p.definition.needsReview).toEqual([])
 const cfg=p.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0];expect(cfg.sourcePrescription).toBeUndefined();expect(cfg.setTargets).toEqual([{rpe:8},{rpe:7},{rpe:7},{rpe:7}]);expect(cfg.instructions).toContain('repeat until @8')
 expect(importProgramme(JSON.stringify(p.definition)).definition).toEqual(p.definition)
})
it('imports synthetic progression rules as actionable instructions, without executing code',()=>{
 const raw=synthetic();raw.weeks[0].days[0].exercises[0].rules=[{kind:'progress',summary:'custom(): if (completedReps[ns] >= 10) { weights += 5lb }'}]
 const p=importProgramme(raw),cfg=p.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0];expect(p.definition.rulesSupported).toBe(true);expect(p.definition.needsReview).toEqual([]);expect(cfg.instructions).toContain('10');expect(cfg.instructions).toContain('5 lb');expect(cfg.instructions).not.toContain('completedReps');expect(cfg.prog).toBe('off')
})

it('renders targets in either profile scale including zero, half-points, percentages and none without mutating them',()=>{
 for(const [target,kind,shown] of [[{rpe:8},'rir',{rir:2}],[{rir:2},'rpe',{rpe:8}],[{rpe:8.5,pct:75},'rir',{rir:1.5,pct:75}],[{rir:1.5},'rpe',{rpe:8.5}],[{rir:0},'rpe',{rpe:10}],[{rir:8},'rpe',{rpe:2}],[{pct:75},'rpe',{pct:75}],[{rpe:8.5},'none',{rpe:8.5}]] as [SetTarget, string, SetTarget][]) {
  const before=JSON.stringify(target);expect(targetForScale(target,kind)).toEqual(shown);expect(JSON.stringify(target)).toBe(before)
 }
 expect(targetLabel({rir:1.5,pct:75},undefined,'rpe')).toBe('RPE 8.5 · 75%')
 expect(targetLabel({rpe:8},undefined,'none')).toBe('@8')
 expect(effortRangeLabel('rpe',7,8,'rir')).toBe('RIR 2–3')
 expect(effortRangeLabel('rir',1.5,2.5,'rpe')).toBe('RPE 7.5–8.5')
 expect(effortRangeLabel('rpe',7,8,'none')).toBe('RPE 7–8')
})
it('converts structurally marked planner notes and leaves unmarked identical prose untouched',()=>{
 const S: any={effort:'rpe'},cfg={note:'W4 · 1 RIR · bodyweight (no added load)',noteKind:'planner'}
 expect(programmeNote(S,cfg)).toBe('W4 · RPE 9 · bodyweight (no added load)')
 expect(programmeNote(S,{note:cfg.note})).toBe(cfg.note)
 expect(programmeNote(S,{note:'8 RIR deload',noteKind:'planner'})).toBe('RPE 2 deload')
 S.effort='rir';expect(programmeNote(S,cfg)).toBe(cfg.note)
 S.queue={label:'Keep 2 RIR in name · W4/6 · 1 RIR',labelKind:'planner'}
 S.effort='rpe';expect(programmeQueueLabel(S)).toBe('Keep 2 RIR in name · W4/6 · RPE 9')
 delete S.queue.labelKind;expect(programmeQueueLabel(S)).toBe(S.queue.label)
 S.effort='none';expect(programmeNote(S,cfg)).toBe(cfg.note)
})
it('converts numeric generated rules while preserving authored instructions',async()=>{
 const {programmeInstructions}=await import('@opengym/core/programme-instructions')
 const raw=synthetic(),e=raw.weeks[0].days[0].exercises[0]
 e.instructions='Source says RPE 8, never rewrite this';e.sets[1]={count:3,reps:5,rpe:7,drop_pct:10,until_rpe:8,kind:'backoff'}
 const cfg=importProgramme(raw).definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0],before=JSON.stringify(cfg)
 const shown=programmeInstructions({effort:'rir'},cfg)
 expect(shown).toContain('repeat until RIR 2');expect(shown).toContain(e.instructions);expect(JSON.stringify(cfg)).toBe(before)
 expect(programmeInstructions({effort:'none'},cfg)).toBe(cfg.instructions)
 delete cfg.sourcePrescription;expect(programmeInstructions({effort:'rir'},cfg)).toBe(shown)
})

it('converts generated rules on every split config, including private imports',async()=>{
 const {programmeInstructions}=await import('@opengym/core/programme-instructions')
 for (const privateProgram of [false,true]) {
  const raw=synthetic();raw.source={private:privateProgram}
  raw.weeks[0].days[0].exercises[0].sets=[{count:11,reps:5,rpe:8,until_rpe:8},{count:1,reps:3,pct:75,rpe:8}]
  const ex=importProgramme(raw).definition.weeks[0].days[0].sessions[0].routineSnapshot.ex
  expect(ex).toHaveLength(3)
  for(const cfg of ex) {
   expect(programmeInstructions({effort:'rir'},cfg)).toBe('repeat until RIR 2')
   if(privateProgram) expect(cfg.sourcePrescription).toBeUndefined()
  }
 }
})
it('keeps authored text distinct even when identical to a generated rule',async()=>{
 const {programmeInstructions}=await import('@opengym/core/programme-instructions')
 const raw=synthetic(),e=raw.weeks[0].days[0].exercises[0]
 e.instructions='repeat until @8';e.sets=[{count:1,reps:5,rpe:8,until_rpe:8}]
 const cfg=importProgramme(raw).definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
 expect(programmeInstructions({effort:'rir'},cfg)).toBe('repeat until RIR 2\n\nrepeat until @8')
 expect(programmeInstructions({effort:'none'},cfg)).toBe(cfg.instructions)
 const S: any={unit:'lb',routines:[],workouts:[]};activate(S,importProgramme(raw).definition,{cycleId:'rules',today:'2026-10-12'})
 expect(programmeInstructions({effort:'rir'},buildSessionEntries(S,S.routines[0])[0].target)).toBe('repeat until RIR 2\n\nrepeat until @8')
})

it('validates numeric generated rules and rejects source prose in their structural record',()=>{
 const raw=synthetic();raw.weeks[0].days[0].exercises[0].sets=[{count:1,reps:5,until_rpe:8}]
 const d=importProgramme(raw).definition,cfg=d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
 expect(importProgramme(JSON.stringify(d)).definition).toEqual(d)
 for(const rules of [[{until_rpe:11}],[{until_rpe:'8'}],[{kind:'private source prose'}],Array(101).fill({until_rpe:8})]) {
  cfg.generatedRules=rules;expect(()=>importProgramme(d)).toThrow('generated rules')
 }
})
