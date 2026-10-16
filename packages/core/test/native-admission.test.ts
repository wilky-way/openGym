import {describe,it,expect} from 'vitest'
import {importProgramme} from '../src/programme-import'
import {activate,materializeWeek} from '../src/programme'
import {buildSessionEntries} from '../src/session-start'
import {EXIDX,createExerciseIndex,isAssisted,type ExerciseIndex} from '../src/exercises'
import type {ProgrammeDefinition} from '../../contract/domain/state-doc'

const source=():any=>({schema:'opengym-library/1',id:'invented-admission',name:'Invented admission',unit:'kg',rules:{},source:{workbook_sha256:'e'.repeat(64),private:true},weeks:[{n:1,days:[{n:1,kind:'lift',exercises:[{id:'0030',name:EXIDX['0030']!.n,source_id:'invented:slot',source:{workbook_sha256:'e'.repeat(64),sheet:'Invented',prescription_cell:'A1'},parsed:true,rules_supported:true,sets:[{count:1,reps:5,kind:'work',source_template_id:'invented:row'}]}]}]}]})
const definition=():any=>importProgramme(source()).definition!
const slot=(d:any)=>d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
const state=():any=>({unit:'kg',routines:[],workouts:[],customEx:[]})

// Every refusal must hold at all public entrypoints, before normalization or installation.
function refuses(d:any,index:ExerciseIndex=EXIDX,customEx:any[]=[]) {
 const original=structuredClone(d)
 for(const input of [d,JSON.stringify(d)])expect(()=>importProgramme(input,{customEx},index)).toThrow()
 const S={...state(),customEx},before=structuredClone(S)
 expect(()=>activate(S,d,{today:'2026-10-16',cycleId:'bad'},index)).toThrow()
 expect(S).toEqual(before)
 expect(()=>materializeWeek(d,d.weeks[0],{id:'bad',seriesId:'invented'},{},index)).toThrow()
 const routine={id:'direct',ex:[structuredClone(slot(d))]},snapshot=structuredClone(routine)
 expect(()=>buildSessionEntries(S,routine,index)).toThrow()
 expect(routine).toEqual(snapshot);expect(S).toEqual(before);expect(d).toEqual(original)
}

describe('shared native admission before mutation',()=>{
 const conflicts:Record<string,unknown>={sets:2,prog:'linear',progression:{rules:['invented']},tm:{key:'invented',percentages:[50]},pyramid:[5],pyramidWeight:[20],target:{rpe:8},setTargets:[{rir:2}],setRepsMin:[3],reps:5,weight:0,repsMin:3,restSec:90,side:'each',intensifier:'drop',mode:'time',repsMax:8,sec:30,min:1,speed:2,pyramidRest:[90],rowReps:[5],lastToFailure:true,warmupSets:1,generatedRules:[{from:'top_set',drop_pct:10}],authoredInstructions:'Repeat until RPE 9',instructions:'Drop load after top set'}
 for(const [field,value] of Object.entries(conflicts))it(`refuses conflicting ${field} at import, activation, materialization and Start`,()=>{
  const d=definition();slot(d)[field]=value;refuses(d)
 })
 for(const count of [0,-1,1.5,101,'1',null,undefined,NaN])it(`refuses invalid count ${String(count)} before installation`,()=>{
  const d=definition();slot(d).sets=count;refuses(d)
 })
 for(const rule of [{until_rpe:9},{open_count:true},{total_reps:30}])it(`refuses ignored generated semantics ${Object.keys(rule)[0]}`,()=>{
  const d=definition();slot(d).generatedRules=[rule];refuses(d)
 })
 it('checks later weeks before normalizing state, retaining prior frozen entries',()=>{
  const good=definition(),S=state();activate(S,good,{today:'2026-10-16',cycleId:'good'})
  const entry=buildSessionEntries(S,S.routines[0])[0],frozen=structuredClone(entry)
  const d=definition();d.weeks.push({...structuredClone(d.weeks[0]),index:2});slot({weeks:[d.weeks[1]]}).sets=2
  const fresh=state(),before=structuredClone(fresh)
  expect(()=>activate(fresh,d,{today:'2026-10-16',cycleId:'bad-later'})).toThrow();expect(fresh).toEqual(before)
  S.routines[0].ex[0].generatedRules=[{from:'top_set',drop_pct:10}]
  const changed=structuredClone(S);expect(()=>buildSessionEntries(S,S.routines[0])).toThrow();expect(S).toEqual(changed);expect(entry).toEqual(frozen)
 })
 it('keeps native opaque metadata and legacy opaque extensions supported',()=>{
  const d=definition();slot(d).inventedOpaque={colour:'blue'}
  const S=state();activate(S,importProgramme(JSON.stringify(d)).definition! as ProgrammeDefinition,{today:'2026-10-16',cycleId:'opaque'})
  expect(buildSessionEntries(S,S.routines[0])[0]!.sets).toHaveLength(1)
  const legacy=definition(),cfg=slot(legacy);delete cfg.nativePrescription;Object.assign(cfg,{reps:5,weight:20,generatedRules:[{from:'top_set',drop_pct:10}],instructions:'Legacy instruction',inventedOpaque:{colour:'blue'}})
  expect(importProgramme(legacy).definition).toBeDefined()
  const L=state();activate(L,legacy,{today:'2026-10-16',cycleId:'legacy'});expect(buildSessionEntries(L,L.routines[0])[0]!.sets[0]!.w).toBe(20)
 })
})

describe('assisted and caller-owned native identity admission',()=>{
 const assisted=Object.keys(EXIDX).find(id=>isAssisted(id,EXIDX))!
 const custom={id:'invented-assisted',n:'Invented counterweighted lift',eq:'machine',bp:'back',assisted:true}
 for(const [id,customEx] of [[assisted,[]],[custom.id,[custom]]] as [string,any[]][]) {
  const index=createExerciseIndex(customEx)
  const selected=()=>{
   const d=definition(),cfg=slot(d);cfg.id=id;cfg.label=index[id]!.n
   cfg.nativePrescription.variantKey=`source-variant:${encodeURIComponent(id)}:${encodeURIComponent(cfg.label.toLowerCase())}:`
   return d
  }
  for(const role of ['guide','prescribed'])it(`refuses ${role} percentage for assisted ${id} everywhere`,()=>{
   const d=selected();d.maxBasis='1rm';const cfg=slot(d)
   cfg.nativePrescription.sets[0].percentage={min:50,max:50,role,basis:'1rm',key:cfg.nativePrescription.variantKey}
   refuses(d,index,customEx)
   slot(d).assisted=false;refuses(d,index,customEx)
   const raw=source(),e=raw.weeks[0].days[0].exercises[0];Object.assign(e,{id,name:index[id]!.n});Object.assign(e.sets[0],{pct:50,pct_basis:'1RM',pct_role:role})
   for(const input of [raw,JSON.stringify(raw)])expect(()=>importProgramme(input,{customEx},index)).toThrow()
  })
  for(const effort of [undefined,{scale:'rir',min:1,max:3},{scale:'rpe',min:6,max:8}])it(`retains assisted ${id} ${effort?.scale ?? 'reps'} and legacy fixed-load support`,()=>{
   const d=selected();slot(d).nativePrescription.sets[0].effort=effort
   const S={...state(),customEx};const admitted=importProgramme(JSON.stringify(d),{customEx},index).definition!
   activate(S,admitted as ProgrammeDefinition,{today:'2026-10-16',cycleId:'positive'},index)
   const row=buildSessionEntries(S,S.routines[0],index)[0]!.sets[0]!
   expect(row.r).toBe(5);expect(row.w).toBeUndefined();expect(row.nativeTarget!.effort).toEqual(effort)
   const legacy=selected(),cfg=slot(legacy);delete cfg.nativePrescription;Object.assign(cfg,{weight:20,reps:5})
   const L={...state(),customEx};activate(L,importProgramme(legacy,{customEx},index).definition! as ProgrammeDefinition,{today:'2026-10-16',cycleId:'fixed'},index)
   expect(buildSessionEntries(L,L.routines[0],index)[0]!.sets[0]!.w).toBe(20)
  })
 }
 it('refuses built-in/custom collisions including explicit mapping and reverse shadow',()=>{
  const customEx=[{id:'0030',n:'Invented cable movement',eq:'cable',bp:'back',custom:true}],index=createExerciseIndex(customEx)
  for(const raw of [source(),JSON.stringify(source())]) {
   expect(()=>importProgramme(raw,{customEx},index)).toThrow()
   expect(()=>importProgramme(raw,{customEx,mappings:{[EXIDX['0030']!.n+'|']:'0030'}},index)).toThrow()
  }
  refuses(definition(),index,customEx)
  const reverse=source();Object.assign(reverse.weeks[0].days[0].exercises[0],{name:customEx[0]!.n,equipment:'cable'})
  for(const raw of [reverse,JSON.stringify(reverse)])expect(()=>importProgramme(raw,{customEx})).toThrow()
 })
 it('preserves unique custom and built-in identities',()=>{
  for(const customEx of [[],[{id:'invented-unique',n:'Invented unique lift',eq:'cable',bp:'back'}]]) {
   const index=createExerciseIndex(customEx),raw=source(),e=raw.weeks[0].days[0].exercises[0]
   if(customEx.length)Object.assign(e,{id:customEx[0]!.id,name:customEx[0]!.n,equipment:'cable'})
   const d=importProgramme(raw,{customEx},index).definition!,S={...state(),customEx}
   activate(S,d as ProgrammeDefinition,{today:'2026-10-16',cycleId:'identity'},index)
   expect(buildSessionEntries(S,S.routines[0],index)[0]!.id).toBe(e.id)
  }
 })
 it('preserves explicitly reviewed source mapping to a unique custom movement',()=>{
  const customEx=[{id:'invented-mapped',n:'Invented cable row',eq:'cable',bp:'back'}],index=createExerciseIndex(customEx)
  const raw=source(),key=raw.weeks[0].days[0].exercises[0].name+'|'
  const d=importProgramme(raw,{customEx,mappings:{[key]:customEx[0]!.id}},index).definition! as ProgrammeDefinition
  const S={...state(),customEx};activate(S,d,{today:'2026-10-16',cycleId:'mapped'},index)
  const entry=buildSessionEntries(S,S.routines[0],index)[0]!
  expect(entry.id).toBe(customEx[0]!.id);expect(entry.target.label).toBe(EXIDX['0030']!.n);expect(entry.sets[0]!.w).toBeUndefined()
 })
})
