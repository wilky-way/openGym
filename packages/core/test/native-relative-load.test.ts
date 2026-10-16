import {describe,it,expect} from 'vitest'
import {relativeDefinition,relativeSlot,relativeFixture} from './native-relative-fixture'
import {importProgramme,saveImportedProgramme} from '../src/programme-import'
import {activate,materializeWeek} from '../src/programme'
import {buildSessionEntries} from '../src/session-start'
import {evaluateNativeRelativeLoad,prepareNativeCompletion} from '../src/native-relative-load'
import {buildCompletedWorkout} from '../src/finish-workout'
import {repeatSessionEntries} from '../src/session-repeat'
import {editCompletedSession,saveWorkoutEdit} from '../src/session-edit'
import {convertStateUnit} from '../src/units'
import {createExerciseIndex,EXIDX,isAssisted} from '../src/exercises'
import {nativeRowIdentity,nativeTargetLabel} from '../src/native-prescription'
const complete=(S:any,e:any,i:number,w:number)=>{const row=e.sets[i];Object.assign(row,{r:5,w});prepareNativeCompletion(S,e,row,true,createExerciseIndex(S.customEx));row.done=true;row.at=i+2}
function refuses(d:any,index=EXIDX,customEx:any[]=[]) {
 const input=structuredClone(d),S:any={unit:'kg',routines:[],workouts:[],customEx},before=structuredClone(S)
 for(const raw of [d,JSON.stringify(d)])expect(()=>importProgramme(raw,{customEx},index)).toThrow()
 expect(()=>saveImportedProgramme(S,{definition:d,unknown:[]},{},index)).toThrow();expect(S).toEqual(before)
 expect(()=>activate(S,d,{today:'2026-10-16',cycleId:'bad'},index)).toThrow();expect(S).toEqual(before)
 expect(()=>materializeWeek(d,d.weeks[0],{id:'bad',seriesId:'bad'},{},index)).toThrow()
 expect(()=>buildSessionEntries(S,{id:'direct',ex:[relativeSlot(d)]},index)).toThrow();expect(S).toEqual(before);expect(d).toEqual(input)
}
describe('explicit native same-entry relative load',()=>{
 it('imports model object/JSON, saves, activates, Starts and previews repeated template IDs by exact ordinal',()=>{
  const {S,definition,entry}=relativeFixture();expect(importProgramme(JSON.stringify(definition)).definition).toEqual(definition)
  expect(entry.sets.map(r=>r.nativeRowIdentity?.rowOrdinal)).toEqual([1,2,3]);expect(entry.sets.map(r=>r.w)).toEqual([undefined,undefined,undefined])
  expect(nativeTargetLabel(entry.sets[1]!.nativeTarget!)).toBe('5 reps · 10% below set 1 actual load')
  expect(evaluateNativeRelativeLoad(S,entry,entry.sets[1]!)).toMatchObject({status:'pending',reason:'Pending: complete anchor set 1'})
  complete(S,entry,0,100);expect(evaluateNativeRelativeLoad(S,entry,entry.sets[1]!)).toMatchObject({status:'resolved',evaluation:{plannedLoad:{value:90,unit:'kg'}}})
  expect(entry.sets[1]!.w).toBeUndefined()
 })
 const invalid:Record<string,(d:any)=>void>={
  missing:d=>delete relativeSlot(d).nativePrescription.sets[1].relativeLoad.anchor,
  future:d=>relativeSlot(d).nativePrescription.sets[1].relativeLoad.anchor.rowOrdinal=3,
  self:d=>relativeSlot(d).nativePrescription.sets[1].relativeLoad.anchor.rowOrdinal=2,
  absent:d=>relativeSlot(d).nativePrescription.sets[1].relativeLoad.anchor.rowOrdinal=0,
  fractional:d=>relativeSlot(d).nativePrescription.sets[1].relativeLoad.anchor.rowOrdinal=1.1,
  wrongTemplate:d=>relativeSlot(d).nativePrescription.sets[1].relativeLoad.anchor.sourceTemplateId='absent',
  crossEntry:d=>relativeSlot(d).nativePrescription.sets[1].relativeLoad.anchor.source.slotId='other-entry',
  crossExercise:d=>relativeSlot(d).nativePrescription.sets[1].relativeLoad.anchor.variantKey='source-variant:0025:other:',
  crossSession:d=>relativeSlot(d).nativePrescription.sets[1].relativeLoad.anchor.sessionId='other-session',
  wrongSource:d=>relativeSlot(d).nativePrescription.sets[1].relativeLoad.anchor.source.cell='B1',
  range:d=>Object.assign(relativeSlot(d).nativePrescription.sets[1].reps,{kind:'range',max:8}),
  amrap:d=>{relativeSlot(d).nativePrescription.sets[1].reps={kind:'amrap',min:5}},
  percentage:d=>{const p=relativeSlot(d).nativePrescription;d.maxBasis='1rm';p.sets[1].percentage={min:50,max:50,role:'prescribed',basis:'1rm',key:p.variantKey}},
  conditional:d=>relativeSlot(d).nativePrescription.sets[1].relativeLoad.untilRpe=9,
  adaptive:d=>relativeSlot(d).nativePrescription.sets[1].relativeLoad.kind='adaptive',
  generated:d=>relativeSlot(d).generatedRules=[{from:'anchor',drop:10}],
  instructions:d=>relativeSlot(d).instructions='until effort',
  openCount:d=>relativeSlot(d).sets=null,
  exactTotal:d=>relativeSlot(d).nativePrescription.sets[1].totalReps=30,
  timed:d=>relativeSlot(d).mode='time',
 }
 for(const [name,mutate] of Object.entries(invalid))it(`atomically refuses ${name} at all admission boundaries`,()=>{const d=relativeDefinition();mutate(d);refuses(d)})
 for(const n of [0,-10,100,110,NaN,Infinity,'10',[5,10],null])it(`refuses unsupported reduction ${String(n)}`,()=>{const d=relativeDefinition();relativeSlot(d).nativePrescription.sets[1].relativeLoad.reductionPercent=n;refuses(d)})
 for(const w of [undefined,null,NaN,Infinity,-1,'100'])it(`keeps invalid anchor ${String(w)} pending without overwriting manual actual`,()=>{
  const {S,entry}=relativeFixture();Object.assign(entry.sets[0]!,{done:true,w});const row=entry.sets[1]!;row.w=77;const before=structuredClone(entry)
  expect(evaluateNativeRelativeLoad(S,entry,row).status).toBe('pending');expect(()=>prepareNativeCompletion(S,entry,row,true)).toThrow();expect(entry).toEqual(before)
 })
 it('retains explicit zero against positive equipment floors',()=>{const {S,entry}=relativeFixture();S.plates={kg:[{w:20,n:2}]};complete(S,entry,0,0);complete(S,entry,1,0);expect(entry.sets[1]!.nativeLoadEvaluation).toMatchObject({anchor:{actualLoad:{value:0,unit:'kg'}},plannedLoad:{value:0,unit:'kg'}})})
 for(const unit of ['kg','lb'])it(`rounds ${unit} with existing increment and owned equipment`,()=>{
  const {S,entry}=relativeFixture(unit);entry.target.inc=2.5;complete(S,entry,0,101);expect(evaluateNativeRelativeLoad(S,entry,entry.sets[1]!)).toMatchObject({evaluation:{plannedLoad:{value:90,unit}}})
  S.plates={[unit]:[{w:20,n:2}]};const gridResult=evaluateNativeRelativeLoad(S,entry,entry.sets[1]!);expect(gridResult).toMatchObject({status:'resolved'});if(gridResult.status==='resolved')expect(gridResult.evaluation.plannedLoad.value).toBeLessThanOrEqual(101*.9)
 })
 it('freezes exact snapshots and manual overrides through later anchor edits, Finish, log editing and Repeat',()=>{
  const {S,entry}=relativeFixture();complete(S,entry,0,100);complete(S,entry,1,77)
  const frozen=structuredClone(entry.sets[1]!.nativeLoadEvaluation);expect(frozen?.plannedLoad.value).toBe(90);entry.sets[0]!.w=200
  expect(entry.sets[1]!.nativeLoadEvaluation).toEqual(frozen);expect(entry.sets[1]!.w).toBe(77)
  complete(S,entry,2,180);const log:any=buildCompletedWorkout(S.active);S.workouts=[log];S.active=null
  editCompletedSession(S,log);S.active.entries[0].sets[0].w=300;S.active.entries[0].sets[1].w=79;const saved:any=saveWorkoutEdit(S,500)
  expect(saved.entries[0].sets[1].nativeLoadEvaluation).toEqual(frozen);expect(saved.entries[0].sets[1].w).toBe(79);expect(log.entries[0].sets[1].w).toBe(77)
  const before=structuredClone(saved),repeated=repeatSessionEntries(S,saved).entries[0]!
  expect(repeated.sets).toHaveLength(3);for(const row of repeated.sets!)expect(row).toMatchObject({done:false})
  for(const row of repeated.sets!)for(const key of ['w','r','rpe','rir','at','failure','nativeActualLoad','nativeLoadEvaluation'])expect(row[key]).toBeUndefined()
  expect(repeated.target).toEqual(saved.entries[0].target);expect(evaluateNativeRelativeLoad(S,repeated,repeated.sets![1]!).status).toBe('pending')
  complete(S,repeated,0,50);complete(S,repeated,1,45);expect(repeated.sets![1]!.nativeLoadEvaluation?.plannedLoad.value).toBe(45);expect(saved).toEqual(before)
 })
 it('undo discards evaluation, pending preserves manual actual, recompletion deliberately evaluates again',()=>{
  const {S,entry}=relativeFixture();complete(S,entry,0,100);complete(S,entry,1,82)
  prepareNativeCompletion(S,entry,entry.sets[1]!,false);entry.sets[1]!.done=false;expect(entry.sets[1]!.nativeLoadEvaluation).toBeUndefined();expect(entry.sets[1]!.w).toBe(82)
  prepareNativeCompletion(S,entry,entry.sets[0]!,false);entry.sets[0]!.done=false
  expect(()=>prepareNativeCompletion(S,entry,entry.sets[1]!,true)).toThrow(/complete anchor/)
  complete(S,entry,0,200);prepareNativeCompletion(S,entry,entry.sets[1]!,true);entry.sets[1]!.done=true
  expect(entry.sets[1]!.nativeLoadEvaluation?.plannedLoad.value).toBe(180);expect(entry.sets[1]!.w).toBe(82)
 })
 it('unit conversion preserves exact anchor and completed evaluation units while new goals convert and round',()=>{
  const {S,entry}=relativeFixture();complete(S,entry,0,100);complete(S,entry,1,87);const frozen=structuredClone(entry.sets[1]!.nativeLoadEvaluation)
  const converted:any=convertStateUnit(S,'lb'),e=converted.active.entries[0]
  expect(e.sets[1].nativeLoadEvaluation).toEqual(frozen);expect(e.sets[0].nativeActualLoad).toEqual({value:100,unit:'kg'});expect(e.sets[1].w).toBe(192)
  expect(evaluateNativeRelativeLoad(converted,e,e.sets[2])).toMatchObject({evaluation:{anchor:{actualLoad:{value:100,unit:'kg'}},plannedLoad:{value:200,unit:'lb'}}})
 })
 for(const mode of ['missing','duplicate-anchor','copied-dependent','future-order','identity','wrong-movement'])it(`refuses runtime ${mode} without creating a receipt`,()=>{
  const {S,entry}=relativeFixture();complete(S,entry,0,100);let row=entry.sets[1]!
  if(mode==='missing')entry.sets.splice(0,1)
  if(mode==='duplicate-anchor')entry.sets.unshift(structuredClone(entry.sets[0]!))
  if(mode==='copied-dependent')entry.sets.push(structuredClone(row))
  if(mode==='future-order')entry.sets.reverse()
  if(mode==='identity')row.nativeRowIdentity!.source.cell='elsewhere'
  if(mode==='wrong-movement')entry.id='0025'
  row.w=80;const before=structuredClone(entry);expect(evaluateNativeRelativeLoad(S,entry,row).status).toBe('pending');expect(()=>prepareNativeCompletion(S,entry,row,true)).toThrow();expect(entry).toEqual(before)
 })
 it('cannot Finish a forged done row without its separate frozen evaluation',()=>{const {S,entry}=relativeFixture();complete(S,entry,0,100);Object.assign(entry.sets[1]!,{w:90,done:true});expect(()=>buildCompletedWorkout(S.active)).toThrow();expect(entry.sets[1]!.nativeLoadEvaluation).toBeUndefined()})
 it('can choose a later explicit earlier ordinal among repeated template IDs',()=>{const d=relativeDefinition(),p=relativeSlot(d).nativePrescription;p.sets[2].relativeLoad.anchor=nativeRowIdentity(p,2);expect(importProgramme(d).definition).toEqual(d)})
 for(const custom of [false,true])it(`rejects authoritative ${custom?'custom':'built-in'} assisted false override while manual native/legacy remain admitted`,()=>{
  const customEx=custom?[{id:'invented-assisted',n:'Invented assisted',eq:'machine',bp:'back',assisted:true}]:[],index=createExerciseIndex(customEx),id=custom?'invented-assisted':Object.keys(EXIDX).find(id=>isAssisted(id))!
  const d=relativeDefinition(),cfg=relativeSlot(d),p=cfg.nativePrescription;cfg.id=id;cfg.label=index[id]!.n;cfg.assisted=false;p.variantKey=`source-variant:${encodeURIComponent(id)}:${encodeURIComponent(cfg.label.toLowerCase())}:`;p.sets.forEach((r:any)=>{if(r.relativeLoad)r.relativeLoad.anchor=nativeRowIdentity(p,1)})
  refuses(d,index,customEx)
  for(const r of p.sets){delete r.relativeLoad;r.effort={scale:'rpe',max:8}}expect(importProgramme(d,{customEx},index).definition).toBeDefined()
  delete cfg.nativePrescription;cfg.reps=5;cfg.weight=20;expect(importProgramme(d,{customEx},index).definition).toBeDefined()
 })
})

it('owned dumbbell grid rounds down without changing the athlete actual',()=>{
 const {S,entry}=relativeFixture(),id=Object.keys(EXIDX).find(id=>EXIDX[id]!.eq==='dumbbell')!,p=entry.target.nativePrescription as any
 entry.id=id;entry.target.id=id;entry.target.label=EXIDX[id]!.n;p.variantKey=`source-variant:${encodeURIComponent(id)}:${encodeURIComponent(String(entry.target.label).toLowerCase())}:`
 p.sets.forEach((r:any)=>{if(r.relativeLoad)r.relativeLoad.anchor=nativeRowIdentity(p,1)})
 entry.sets.forEach((r:any,i:number)=>{r.nativeTarget=structuredClone(p.sets[i]);r.nativeRowIdentity=nativeRowIdentity(p,i+1)})
 S.dumbbells={kg:{weights:[10,15,20,25]}};complete(S,entry,0,21)
 expect(evaluateNativeRelativeLoad(S,entry,entry.sets[1]!)).toMatchObject({evaluation:{plannedLoad:{value:15,unit:'kg'}}});expect(entry.sets[1]!.w).toBeUndefined()
})
it('Finish and Repeat refuse copied completed identities without rewriting the source',()=>{
 const {S,entry}=relativeFixture();complete(S,entry,0,100);complete(S,entry,1,90);entry.sets.push(structuredClone(entry.sets[1]!));const before=structuredClone(S)
 expect(()=>buildCompletedWorkout(S.active)).toThrow(/identity/);expect(()=>repeatSessionEntries(S,S.active)).toThrow(/identity/);expect(S).toEqual(before)
})
it('relation Repeat clears session modifiers and all known actuals while retaining opaque row metadata',()=>{
 const {S,entry}=relativeFixture();complete(S,entry,0,100);complete(S,entry,1,85)
 Object.assign(entry.sets[0]!,{type:'restpause',phase:'warmup',warmup:true,weightOrigin:'manual',clusters:[{r:3,restSec:15}],drops:[{w:70,r:4}],rpe:9,rir:1,failure:true,note:'Invented row note',inventedOpaque:{keep:true},bursts:{opaque:true}})
 const before=structuredClone(entry),r=repeatSessionEntries(S,S.active).entries[0]!.sets![0]!
 for(const key of ['w','r','at','rpe','rir','failure','clusters','drops','type','phase','warmup','weightOrigin','nativeActualLoad','nativeLoadEvaluation'])expect(r[key]).toBeUndefined()
 expect(r).toMatchObject({done:false,note:'Invented row note',inventedOpaque:{keep:true},bursts:{opaque:true},nativeRowIdentity:entry.sets[0]!.nativeRowIdentity})
 expect(entry).toEqual(before)
})
