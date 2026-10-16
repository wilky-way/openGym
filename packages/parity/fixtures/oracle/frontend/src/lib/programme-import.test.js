import {it,expect} from 'vitest'
import {importProgramme,saveImportedProgramme,validateProgrammeDefinition,importExerciseKey} from './programme-import.js'
import {activate} from './programme.js'
import {buildSessionEntries} from './session-start.js'
const fixture=()=>({schema:'opengym-library/1',id:'public-sample',name:'Public percentage sample',unit:'lb',length_weeks:1,source:{name:'Public'},rules:{},weeks:[{n:'1',days:[{n:1,name:'Upper',exercises:[{id:'0025',slot:'1',name:'Bench Press',parsed:true,sets:[{count:1,reps:5,pct:65},{count:1,reps:3,pct:75},{count:1,reps:1,pct:85,amrap:true}]}]}]}]})
it('converts, saves and round-trips a public percentage + AMRAP template',()=>{const raw=fixture(),p=importProgramme(raw),S={unit:'lb',routines:[],workouts:[]};expect(p.unknown).toEqual([]);saveImportedProgramme(S,p);expect(S.queue).toBeUndefined();expect(importProgramme(JSON.stringify(p.definition)).definition).toEqual(p.definition);const c=activate(S,p.definition,{today:'2026-10-12',cycleId:'c',tm:{'0025':200}});const en=buildSessionEntries(S,S.routines[0])[0];expect(en.sets.map(s=>s.w)).toEqual([130,150,170]);expect(en.sets.at(-1).max).toBe(true);expect(c.occurrences).toHaveLength(1);expect(raw.weeks[0].days[0].exercises[0].sets[0].pct).toBe(65)})
it('flags unknowns and resolves them with explicit catalogue mapping before saving',()=>{const raw=fixture(),e=raw.weeks[0].days[0].exercises[0];delete e.id;e.name='Unknown synthetic lift';const p=importProgramme(raw);expect(p.unknown).toHaveLength(1);expect(()=>saveImportedProgramme({},p)).toThrow('unknown exercises');const mapped=importProgramme(raw,{mappings:{[importExerciseKey(e)]:'0025'}});expect(mapped.unknown).toEqual([]);expect(mapped.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].id).toBe('0025')})
it('reports genuinely untranslatable scripts without evaluating them',()=>{const raw=fixture();raw.rules.progression_scripts=['throw new Error("must never execute")'];const p=importProgramme(raw);expect(p.definition.rulesSupported).toBe(false);expect(p.definition.needsReview.length).toBeGreaterThan(0)})
it('skips the flagged index, duplicate worksheets and placeholders',()=>{expect(importProgramme([], {filename:'pub-_flagged.json'}).skipped).toBe(true);const raw=fixture();raw.weeks.push({...structuredClone(raw.weeks[0]),n:'2',repeat_of:'1'});expect(importProgramme(raw).definition.weeks).toHaveLength(1)})
it('protects existing runs when confirming replacement of a definition',()=>{const p=importProgramme(fixture()),S={unit:'lb',routines:[],workouts:[]};saveImportedProgramme(S,p);activate(S,p.definition,{cycleId:'c',today:'2026-10-12'});const old=structuredClone(S.programmes.cycles);expect(()=>saveImportedProgramme(S,p)).toThrow('already exists');p.definition.name='Updated';saveImportedProgramme(S,p,{replace:true});expect(S.programmes.cycles).toEqual(old)})
it('keeps authored deload prescriptions without scaling them a second time',()=>{const raw=fixture();raw.weeks[0].block_type='deload';const p=importProgramme(raw),S={unit:'lb',routines:[],workouts:[]};activate(S,p.definition,{cycleId:'c',tm:{'0025':200},today:'2026-10-12'});expect(buildSessionEntries(S,S.routines[0])[0].sets).toHaveLength(3);expect(buildSessionEntries(S,S.routines[0])[0].sets[0].w).toBe(130)})
it('splits more than ten authored sets into supported native slots',()=>{const raw=fixture();raw.weeks[0].days[0].exercises[0].sets=[{count:12,reps:8,weight:100}];const p=importProgramme(raw);expect(p.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex.map(e=>e.sets)).toEqual([10,2])})
it('rejects invalid structures and percentage rows before any activation',()=>{const raw=fixture();raw.weeks[0].days[0].exercises[0].sets[0].pct=-1;expect(()=>importProgramme(raw)).toThrow();expect(()=>validateProgrammeDefinition({id:'bad'})).toThrow()})
it('requires explicit prescriptions for blank slots and preserves timed strength GPP',()=>{const raw=fixture(),e=raw.weeks[0].days[0].exercises[0];e.sets=[];const p=importProgramme(raw);expect(p.unprescribed).toHaveLength(1);expect(()=>saveImportedProgramme({},p,{reviewed:true})).toThrow('sets and reps');const q=importProgramme(raw,{prescriptions:{[importExerciseKey(e)]:{sets:3,reps:8,weight:100}}});expect(q.unprescribed).toEqual([]);expect(q.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].sets).toBe(3);e.minutes=5;const timed=importProgramme(raw);expect(timed.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]).toMatchObject({mode:'time',sec:300})})
it('keeps mixed absolute/percentage groups separate and ranges visible for review',()=>{const raw=fixture(),e=raw.weeks[0].days[0].exercises[0];e.sets=[{count:[1,2],reps:[5,8],pct:[65,70]},{count:2,reps:'max',weight:100}];const p=importProgramme(raw),ex=p.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex;expect(p.definition.rulesSupported).toBe(true);expect(ex).toHaveLength(2);expect(ex[0].tm.percentages).toEqual([65]);expect(ex[1].pyramid).toEqual(['max','max']);expect(()=>saveImportedProgramme({},p)).not.toThrow();const S={};saveImportedProgramme(S,p,{reviewed:true});expect(S.programmes.definitions).toHaveLength(1)})
it('rejects expansion before allocating rows and stores public provenance once per source slot',()=>{
 const raw=fixture(),e=raw.weeks[0].days[0].exercises[0]
 e.sets=Array.from({length:1000},()=>({count:100,reps:5}))
 expect(()=>importProgramme(raw)).toThrow('prescription')
 e.sets=[{count:100,reps:5},{count:1,reps:5}]
 expect(()=>importProgramme(raw)).toThrow('prescription')
 e.sets=[{count:12,reps:5}]
 const ex=importProgramme(raw).definition.weeks[0].days[0].sessions[0].routineSnapshot.ex
 expect(ex.filter(x=>x.sourcePrescription)).toHaveLength(1)
 const native=importProgramme(raw).definition
 native.weeks=Array.from({length:64},(_,index)=>({...structuredClone(native.weeks[0]),index:index+1,days:Array.from({length:14},(_,i)=>({...structuredClone(native.weeks[0].days[0]),key:String(i)}))}))
 expect(()=>importProgramme(native)).toThrow('size limit')
})
it('requires explicit mapping on an equipment mismatch even when the id or name matches',()=>{
 const raw=fixture(),e=raw.weeks[0].days[0].exercises[0];e.equipment='dumbbell'
 expect(importProgramme(raw).unknown).toHaveLength(1)
 delete e.id;expect(importProgramme(raw).unknown).toHaveLength(1)
 expect(importProgramme(raw,{mappings:{[importExerciseKey(e)]:'0025'}}).unknown).toEqual([])
})
it('rejects malformed display metadata in both library and native definitions',()=>{
 const raw=fixture();raw.source.name={bad:true};expect(()=>importProgramme(raw)).toThrow('metadata')
 delete raw.source.name
 const native=importProgramme(raw).definition;native.weeks[0].label={bad:true}
 expect(()=>importProgramme(native)).toThrow('metadata')
 native.weeks[0].label='Week one';native.weeks[0].days[0].sessions[0].routineSnapshot.name=['bad']
 expect(()=>saveImportedProgramme({}, {definition:native,unknown:[]})).toThrow('metadata')
})
it('rejects malformed or negative loads and requires native rep, time or AMRAP targets',()=>{
 for(const weight of ['heavy',-1,Infinity]){
  const raw=fixture();raw.weeks[0].days[0].exercises[0].sets[0].weight=weight
  expect(()=>importProgramme(raw)).toThrow('prescription')
 }
 const native=importProgramme(fixture()).definition,e=native.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
 delete e.pyramid;delete e.pyramidWeight;delete e.tm;delete e.reps
 expect(()=>importProgramme(native)).toThrow('prescription')
 e.reps='max';expect(()=>importProgramme(native)).not.toThrow()
 delete e.reps;e.mode='time';e.sec=60;expect(()=>importProgramme(native)).not.toThrow()
 e.sec=0;expect(()=>importProgramme(native)).toThrow('prescription')
 e.sec=60;e.weight='heavy';expect(()=>importProgramme(native)).toThrow('prescription')
})
it('orders authored week and day numbers and rejects mixed, duplicate or invalid numbers',()=>{
 const raw=fixture();raw.weeks=[3,1,2].map(n=>({...structuredClone(raw.weeks[0]),n:String(n)}))
 for(const w of raw.weeks)w.days=[2,1].map(n=>({...structuredClone(w.days[0]),n,name:`Day ${n}`}))
 const d=importProgramme(raw).definition
 expect(d.weeks.map(w=>w.sourceWeek)).toEqual(['1','2','3'])
 expect(d.weeks[0].days.map(x=>x.sessions[0].routineSnapshot.name)).toEqual(['Day 1','Day 2'])
 raw.weeks[0].n='1';expect(()=>importProgramme(raw)).toThrow('numbering')
 raw.weeks[0].n='3';delete raw.weeks[0].n;expect(()=>importProgramme(raw)).toThrow('numbering')
})
it('infers private provenance in native imports and excludes raw prescriptions from private imports',()=>{
 const raw=fixture();raw.id=['bbm','synthetic'].join('-')
 const p=importProgramme(raw);expect(p.definition.source.private).toBe(true)
 expect(p.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].sourcePrescription).toBeUndefined()
 delete p.definition.source.private
 expect(importProgramme(p.definition).definition.source.private).toBe(true)
})
it('keeps separately authored strength and GPP sessions on the same numbered day',()=>{
 const raw=fixture(),day=raw.weeks[0].days[0];day.kind='lift'
 raw.weeks[0].days.push({...structuredClone(day),kind:'gpp',name:'Timed GPP',exercises:[{id:'0025',name:'Bench',sets:[],minutes:5}]})
 const d=importProgramme(raw).definition
 expect(d.rulesSupported).toBe(true)
 expect(d.importWarnings.join(' ')).toContain('queued separately')
 expect(d.weeks[0].days).toHaveLength(1)
 expect(d.weeks[0].days[0].sessions).toHaveLength(2)
 expect(new Set(d.weeks[0].days[0].sessions.map(s=>s.sessionTemplateId)).size).toBe(2)
 raw.weeks[0].days[1].kind='lift';expect(()=>importProgramme(raw)).toThrow('numbering')
})
it('bounds manual expansion for initially blank slots before compiling',()=>{
 const raw=fixture(),e=raw.weeks[0].days[0].exercises[0];e.sets=[]
 raw.weeks[0].days[0].exercises=Array.from({length:100},()=>structuredClone(e))
 raw.weeks.push({...structuredClone(raw.weeks[0]),n:2})
 expect(()=>importProgramme(raw,{prescriptions:{[importExerciseKey(e)]:{sets:100,reps:5}}})).toThrow('size limit')
})
