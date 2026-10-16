import type {ProgrammeDefinition,Unit} from '../../contract/domain/state-doc'
import {describe,it,expect} from 'vitest'
import {importProgramme,saveImportedProgramme} from '../src/programme-import'
import {activate} from '../src/programme'
import {buildSessionEntries} from '../src/session-start'
import {buildCompletedWorkout} from '../src/finish-workout'
import {repeatSessionEntries} from '../src/session-repeat'
import {assessNativeSet,canCompleteNativeSet,nativeMaxLabel,nativeTargetLabel,validateNativePrescription} from '../src/native-prescription'
import {createExerciseIndex} from '../src/exercises'
import {restSecFor} from '../src/supersetFlow'
import {retainProgrammePrescription} from '../src/programme-prescription'
import {setTrainingMax} from '../src/programme-max'
import {vi,afterEach} from 'vitest'
import {programmeTMConfig} from '../src/programme-tm'
const source=():any=>({schema:'opengym-library/1',id:'invented-native',name:'Invented source',unit:'kg',rules:{},source:{workbook_sha256:'1'.repeat(64),private:true},weeks:[{n:'1',days:[{n:1,kind:'lift',exercises:[{
 id:'0030',name:'barbell close-grip bench press',source_id:'invented:w1:d1:s1',source:{workbook_sha256:'1'.repeat(64),sheet:'WEEK 1',prescription_cell:'C7'},parsed:true,rules_supported:true,sets:[
 {count:1,reps:5,kind:'work',rpe:[6,8],pct:[61,69],pct_basis:'1RM',pct_role:'guide',effort_priority:'rpe',source_template_id:'invented:t1'},
 {count:1,reps:[7,11],kind:'work',rir:[1,3],source_template_id:'invented:t2'},
 {count:1,reps:9,kind:'amrap',rpe_max_exclusive:8.5,source_template_id:'invented:t3'},
 ]}]}]}]})
const exercise=(raw:any)=>raw.weeks[0].days[0].exercises[0]
const state=(unit='kg'):any=>({unit,routines:[],workouts:[],customEx:[],exWeights:{'0030':{w:999}}})
afterEach(()=>vi.useRealTimers())
describe('bounded source-to-native lifecycle',()=>{
 it('imports, activates, starts, logs and repeats frozen interval goals without defaulting actual entries',()=>{
  const raw=source();exercise(raw).source.line=7;raw.source.members=['invented source member']
  const before=structuredClone(raw),S=state(),preview=importProgramme(raw)
  saveImportedProgramme(S,preview);const d=S.programmes.definitions[0]
  expect(importProgramme(JSON.stringify(d)).definition).toEqual(d)
  activate(S,d,{today:'2026-10-16',cycleId:'native-cycle'})
  const entry=buildSessionEntries(S,S.routines[0])[0]!
  expect(entry.sets.map(r=>r.r)).toEqual([5,undefined,undefined])
  expect(entry.sets.every(r=>!Object.hasOwn(r,'w') && !r.done && r.rpe===undefined && r.rir===undefined)).toBe(true)
  expect(entry.sets.map(canCompleteNativeSet)).toEqual([false,false,false])
  expect(entry.sets[0]!.nativeLoadReason).toContain('guidance')
  expect(nativeTargetLabel(entry.sets[1]!.nativeTarget!)).toContain('7–11 reps · RIR 1–3')
  expect(nativeTargetLabel(entry.sets[2]!.nativeTarget!)).toBe('AMRAP ≥9 · RPE <8.5')
  const goals=structuredClone(entry.sets.map(r=>r.nativeTarget))
  entry.sets.forEach((r,i)=>Object.assign(r,{r:i===1?12:10,w:40,done:true,...(i===2?{rpe:8.5}:{})}))
  expect(assessNativeSet(entry.sets[1]!,goals[1]!)).toEqual({reps:'above',effort:'unknown'})
  expect(assessNativeSet(entry.sets[2]!,goals[2]!)).toEqual({reps:'within',effort:'above'})
  expect(assessNativeSet({r:8,rir:2},goals[0]!)).toEqual({reps:'above',effort:'within'})
  const log=buildCompletedWorkout({id:'logged',d:'2026-10-16',start:1,entries:[entry]})
  S.workouts=[log];S.programmes.cycles[0].tm={unrelated:999};S.routines[0].ex[0].nativePrescription.sets[0].effort.max=4
  entry.sets[0]!.nativeTarget!.effort!.max=2
  expect(log.entries![0]!.sets!.map(r=>r.nativeTarget)).toEqual(goals)
  const repeated=repeatSessionEntries(S,log).entries[0]!
  expect(repeated.sets!.map(r=>r.nativeTarget)).toEqual(goals)
  expect(repeated.sets!.map(r=>r.r)).toEqual([10,12,10]);expect(repeated.sets!.every(r=>r.done===false)).toBe(true);expect(repeated.sets!.every(r=>r.rpe===undefined && r.rir===undefined)).toBe(true)
  repeated.sets![0]!.nativeTarget!.effort!.max=3
  expect(log.entries![0]!.sets![0]!.nativeTarget!.effort!.max).toBe(8)
  expect(raw).toEqual(before)
 })
 it('uses only the exact explicit max basis and variant, in either unit, and freezes active targets',()=>{
  for(const unit of ['kg','lb'] as Unit[]) {
   const raw=source(),e=exercise(raw);e.sets=[{count:2,reps:5,kind:'work',pct:75,pct_basis:'1RM',pct_role:'prescribed',source_template_id:'invented:pct'}]
   const S=state(unit),d=importProgramme(raw).definition! as ProgrammeDefinition,cycle=activate(S,d,{today:'2026-10-16',cycleId:'pct-cycle'})
   const key=d.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!.nativePrescription!.variantKey
   cycle.tm={'0030':999};expect(buildSessionEntries(S,S.routines[0])[0]!.sets[0]!.w).toBeUndefined()
   cycle.tm={[key]:200};cycle.tmUnit=unit
   const entry=buildSessionEntries(S,S.routines[0])[0]!
   expect(entry.sets.map(r=>r.w)).toEqual([150,150]);expect(entry.sets[0]!.nativeTarget!.percentage!.basis).toBe('1rm')
   cycle.tm[key]=300;expect(entry.sets.map(r=>r.w)).toEqual([150,150])
   expect(buildSessionEntries(S,S.routines[0])[0]!.sets.map(r=>r.w)).toEqual([225,225])
   expect(programmeTMConfig(S,S.routines[0].ex[0],S.routines[0])).toEqual(S.routines[0].ex[0])
  }
 })

 it('resolves dated exact-variant maxes across units without changing frozen active/logged goals',()=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-16T12:00:00Z'))
  const raw=source(),e=exercise(raw);e.sets=[{count:1,reps:5,kind:'work',pct:75,pct_basis:'1RM',pct_role:'prescribed',source_template_id:'invented:pct'}]
  const S=state('lb'),d=importProgramme(raw).definition! as ProgrammeDefinition,cycle=activate(S,d,{today:'2026-10-16',cycleId:'dated'})
  const key=d.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!.nativePrescription!.variantKey
  expect(nativeMaxLabel(d,key)).toBe(e.name);expect(nativeMaxLabel(d,'legacy-key')).toBe('legacy-key')
  const unknown=buildSessionEntries(S,S.routines[0])[0]!
  setTrainingMax(S,'dated',{lift:key,value:200,unit:'kg',today:'2026-10-17',now:1000})
  expect(buildSessionEntries(S,S.routines[0])[0]!.sets[0]!.w).toBeUndefined()
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'))
  const known=buildSessionEntries(S,S.routines[0])[0]!
  expect(known.sets[0]!.w).toBe(330);expect(unknown.sets[0]!.w).toBeUndefined()
  const frozen=structuredClone(known)
  setTrainingMax(S,'dated',{lift:key,value:240,unit:'kg',today:'2026-10-18',now:1001})
  expect(buildSessionEntries(S,S.routines[0])[0]!.sets[0]!.w).toBe(330)
  vi.setSystemTime(new Date('2026-10-18T12:00:00Z'))
  expect(buildSessionEntries(S,S.routines[0])[0]!.sets[0]!.w).toBe(395);expect(known).toEqual(frozen)
  const other=source();exercise(other).equipment='another explicitly selected variant'
  const mapped=importProgramme(other,{mappings:{[`${e.name}|another explicitly selected variant`]:'0030'}}).definition! as ProgrammeDefinition
  expect(mapped.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!.nativePrescription!.variantKey).not.toBe(key)
 })
 it('fails closed on contextual and conflicting encodings and flat legacy rewrites',()=>{
  const mutations=[(r:any)=>r.futureRules={sets:'conditional'},(r:any)=>r.rulesSupported=false,
   (r:any)=>r.weeks[0].optional=true,(r:any)=>r.weeks[0].days[0].condition='invented',
   (r:any)=>exercise(r).role='optional',
   (r:any)=>exercise(r).rules={stop:'invented'},(r:any)=>exercise(r).continuations=['unknown clause'],
   (r:any)=>exercise(r).sets[0].reps_min=3,(r:any)=>exercise(r).sets[1].reps_max=10,
   (r:any)=>exercise(r).sets[2].amrap=false,(r:any)=>exercise(r).sets[1].effort_priority='rpe',
   (r:any)=>{delete exercise(r).sets[0].pct},(r:any)=>exercise(r).rest_structure={seconds_min:0,seconds_max:0},
   (r:any)=>{exercise(r).sets[2].kind='work';exercise(r).sets[2].reps='max';exercise(r).sets[2].reps_min=9;exercise(r).sets[2].amrap=false},
   (r:any)=>{exercise(r).sets[0].pct=70;exercise(r).sets[0].pct_role='prescribed'},
   (r:any)=>exercise(r).equipment='invented incompatible equipment',(r:any)=>exercise(r).order=2,(r:any)=>exercise(r).sets[2].reps='invented unknown expression']
  for(const mutate of mutations){const raw=source();mutate(raw);expect(()=>importProgramme(raw)).toThrow(/pending/)}
  const hidden=source();exercise(hidden).id='unknown-exact';Object.defineProperty(hidden,'toJSON',{value:()=>source()});expect(()=>importProgramme(hidden)).toThrow(/exact catalogue/);expect(exercise(hidden).id).toBe('unknown-exact')
  expect(()=>importProgramme(source(),{prescriptions:{ignored:{sets:1}}})).toThrow(/legacy manual prescriptions/)
  const large=source();large.weeks=Array(65).fill(large.weeks[0]);expect(()=>importProgramme(large)).toThrow(/week limit/)
  const malformed=source();exercise(malformed).equipment=['barbell'];expect(()=>importProgramme(malformed)).toThrow(/pending/)
  const cfg=(importProgramme(source()).definition! as ProgrammeDefinition).weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!
  for(const change of [{sets:2},{reps:10},{weight:60},{pyramid:[5,5,5]}])expect(()=>retainProgrammePrescription(cfg,{...structuredClone(cfg),...change})).toThrow(/native source/)
  const row={nativeTarget:cfg.nativePrescription!.sets[0]!,done:true,r:5}
  expect(()=>buildCompletedWorkout({entries:[{id:'0030',sets:[row]}]})).toThrow(/actual reps and load/)
 })
 it('binds exported native exercise identities and governing max basis before import, activation and direct Start',()=>{
  const raw=source(),e=exercise(raw);e.sets=[{count:1,reps:5,kind:'work',pct:75,pct_basis:'1RM',pct_role:'prescribed',source_template_id:'invented:authority'}]
  const valid=importProgramme(raw).definition! as ProgrammeDefinition
  const slot=(d:ProgrammeDefinition)=>d.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!
  const mutations=[(d:ProgrammeDefinition)=>slot(d).id='0025',
   (d:ProgrammeDefinition)=>{slot(d).id='0025';slot(d).label='barbell bench press'},
   (d:ProgrammeDefinition)=>slot(d).label='another invented variant',
   (d:ProgrammeDefinition)=>d.maxBasis='tm',(d:ProgrammeDefinition)=>d.maxBasis='e1rm',
   (d:ProgrammeDefinition)=>delete d.maxBasis,
   (d:ProgrammeDefinition)=>d.weeks[0]!.rir=9,
   (d:ProgrammeDefinition)=>d.rulesSupported=false,(d:ProgrammeDefinition)=>d.needsReview=['Invented unresolved source context']]
  for(const mutate of mutations) {
   const bad=structuredClone(valid);mutate(bad)
   for(const input of [bad,JSON.stringify(bad)])expect(()=>importProgramme(input)).toThrow(/native.*(identity|basis|review)/i)
   const S=state(),before=structuredClone(S)
   expect(()=>activate(S,bad,{today:'2026-10-16',cycleId:'bad-authority'})).toThrow(/native.*(identity|basis|review)/i);expect(S).toEqual(before)
  }
  const S=state(),cycle=activate(S,valid,{today:'2026-10-16',cycleId:'good-authority'}),cfg=S.routines[0].ex[0]
  cycle.tm={[cfg.nativePrescription.variantKey]:200};cycle.tmUnit='kg'
  expect(buildSessionEntries(S,S.routines[0])[0]!.sets[0]!.w).toBe(150)
  const before=structuredClone(S);cfg.id='0025';cfg.label='barbell bench press'
  expect(()=>buildSessionEntries(S,S.routines[0])).toThrow(/native.*identity/i)
  Object.assign(cfg,structuredClone(before.routines[0].ex[0]));cycle.snapshot.maxBasis='tm'
  expect(()=>buildSessionEntries(S,S.routines[0])).toThrow(/native.*basis/i)
 })
 it('admits only explicit ordinary lift days for object and JSON canonical sources',()=>{
  for(const format of ['object','JSON']) {
   const input=(raw:any)=>format==='JSON'?JSON.stringify(raw):raw
   expect(importProgramme(input(source())).definition?.rulesSupported).toBe(true)
   for(const kind of ['invented-unknown-calendar','rest','gpp','',null,undefined]) {
    const raw=source();exercise(raw).source.line=7;raw.weeks[0].days[0].kind=kind
    const before=structuredClone(raw)
    expect(()=>importProgramme(input(raw))).toThrow(/day kind.*pending|pending.*day kind/i)
    expect(raw).toEqual(before)
   }
  }
 })
 it('refuses a non-repetition identity in native JSON and direct Start without creating timed/cardio defaults',()=>{
  const customEx=[{id:'invented-cardio',n:'Invented cardio',eq:'body weight',bp:'cardio'}],index=createExerciseIndex(customEx)
  const d=importProgramme(source()).definition! as ProgrammeDefinition,cfg=d.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!
  cfg.id='invented-cardio';cfg.label='Invented cardio'
  const key='source-variant:invented-cardio:invented%20cardio:';cfg.nativePrescription!.variantKey=key
  cfg.nativePrescription!.sets.forEach(row=>{if(row.percentage)row.percentage.key=key})
  expect(()=>importProgramme(JSON.stringify(d),{customEx},index)).toThrow(/native.*repetition|Conflicting native/i)
  const S={...state(),customEx},routine:any={id:'invented-direct',ex:[cfg]}
  expect(()=>buildSessionEntries(S,routine,index)).toThrow(/repetition/i)
  cfg.id='0030';cfg.mode='time'
  expect(()=>buildSessionEntries(S,routine,index)).toThrow(/repetition/i)
 })
 it('preserves authored exercise order, scalar pair rest and custom exact index',()=>{
  const raw=source(),first=exercise(raw);first.superset={group:'pair',position:1,rest_policy:'after_pair'};first.rest_structure={seconds_min:90,seconds_max:90,raw:'90 seconds'}
  const second=structuredClone(first);second.id='custom-exact';second.name='Invented custom movement';second.source_id='invented:w1:d1:s2';second.source.prescription_cell='F7';second.superset.position=2
  raw.weeks[0].days[0].exercises.push(second)
  const customEx=[{id:'custom-exact',n:'Invented custom movement',eq:'Dumbbell',bp:'back'}],index=createExerciseIndex(customEx),S={...state(),customEx}
  const p=importProgramme(raw,{customEx},index);activate(S,p.definition! as ProgrammeDefinition,{today:'2026-10-16',cycleId:'pair'},index)
  const entries=buildSessionEntries(S,S.routines[0],index)
  expect(entries.map(e=>e.id)).toEqual(['0030','custom-exact']);expect(entries[0]!.sg).toBe(entries[1]!.sg)
  expect(entries[0]!.target.sgRest).toBe(90);expect(restSecFor(entries,[0,1],180)).toBe(90)
 })
 it('refuses unresolved authority or any deferred semantic family rather than flattening it',()=>{
  const mutations=[(e:any)=>e.parsed=false,(e:any)=>e.rules_supported=false,(e:any)=>e.unparsed=['invented unresolved clause'],
   (e:any)=>e.sets[0].count=[1,3],(e:any)=>e.sets[0].count=null,(e:any)=>e.sets[0].stop_condition={metric:'rpe',value:9},
   (e:any)=>e.sets[0].volume_constraint={total_reps:29},(e:any)=>e.sets[0].load_reference={kind:'previous_work_set'},
   (e:any)=>e.time_block={seconds:90},(e:any)=>e.rest_structure={seconds_min:90,seconds_max:120},
   (e:any)=>e.rest_structure={seconds_min:90,seconds_max:90,applies_when:{metric:'rpe',value:7}},
   (e:any)=>e.sets[0].pct_basis='unspecified',(e:any)=>e.sets[0].pct_role='prescribed',
   (e:any)=>e.sets[0].future_condition={unknown:true}]
  for(const mutate of mutations) {const raw=source();mutate(exercise(raw));const before=structuredClone(raw);expect(()=>importProgramme(raw)).toThrow();expect(raw).toEqual(before)}
 })
 it('validates native bounds and distinguishes inclusive/exclusive ceilings and absent actuals',()=>{
  const cfg=importProgramme(source()).definition!.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!
  validateNativePrescription(cfg.nativePrescription)
  const target=cfg.nativePrescription!.sets[2]!
  expect(assessNativeSet({},target)).toEqual({reps:'unknown',effort:'unknown'})
  expect(canCompleteNativeSet({nativeTarget:target,r:9})).toBe(false)
  expect(canCompleteNativeSet({nativeTarget:target,r:9,w:0})).toBe(true)
  const inclusive=structuredClone(target);inclusive.effort!.maxExclusive=false
  expect(assessNativeSet({r:9,rpe:8.5},inclusive).effort).toBe('within')
  for(const mutate of [(p:any)=>p.sets[0].reps.min=10,(p:any)=>p.sets[0].effort.max=NaN,(p:any)=>p.sets[2].effort.max=0,(p:any)=>p.sets[0].percentage.key='parent',(p:any)=>p.future={ignored:true}]) {
   const p=structuredClone(cfg.nativePrescription);mutate(p);expect(()=>validateNativePrescription(p)).toThrow()
  }
 })
})
