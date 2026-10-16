import {afterEach,expect,test} from 'vitest'
import {relativeDefinition} from '../../core/test/native-relative-fixture'
import {createTemplateTools} from '../src/template-tools'
import {target} from './http-helpers'
import {buildPlannedEntry} from '@opengym/core/session-start'
import {pyramidRestFor} from '@opengym/core/pyramid'
import {restSecFor,warmupRestSecFor} from '@opengym/core/supersetFlow'
import {isWarmupRow} from '@opengym/core/workout-model'
import {createExerciseIndex} from '@opengym/core/exercises'
let api:Awaited<ReturnType<typeof target>>|undefined
afterEach(async()=>{await api?.close();api=undefined})
const state=():any=>({_rev:7,_wid:'epoch',unit:'kg',routines:[{id:'old',name:'Synthetic',prog:'off',ex:[{id:'0001',sets:2,reps:5,weight:60,restSec:90,extension:{keep:true}}]}],workouts:[],customEx:[],week:{},dayPlan:{},exWeights:{},programmes:{cycles:[]}})
async function setup(s:any){
 api=await target(s)
 const tools=createTemplateTools({env:{...api.env,OPENGYM_ENABLE_ROUTINE_WRITES:'1'},fetcher:api.fetcher})
 const call=(name:string,p:any)=>tools.find(t=>t.name===name)!.handler(p) as Promise<any>
 const read=async()=>(await api!.request('GET','/api/data')).body.state
 const apply=async(name:string,p:any)=>{const preview=await call(name,p);const result=await call(name,{...p,apply:true,preview_token:preview.preview_token});return {preview,result,saved:await read()}}
 return {call,read,apply}
}
function opened(s:any){const r=s.routines[0],index=createExerciseIndex(s.customEx);return r.ex.map((cfg:any)=>buildPlannedEntry(s,cfg,r,{noProg:r.excludeFromProgression===true},index))}
function rests(s:any,unit=[0]){const entries=opened(s);return entries[0]!.sets.filter((row:any)=>!isWarmupRow(row)).map((_row:any,i:number)=>restSecFor(entries,unit,60,{idx:0,sec:pyramidRestFor(entries[0]!.target,entries[0]!.sets,i)}))}
test('per-set rest ownership refuses an ineffective scalar timer edit and preserves actual opened rests',async()=>{
 const s=state();Object.assign(s.routines[0].ex[0],{pyramid:[5,5],pyramidWeight:[60,65],pyramidRest:[90,120]})
 const {call,read}=await setup(s),before=await read();expect(rests(before)).toEqual([90,120])
 await expect(call('edit_routine',{routine_id:'old',exercises:[{exercise_id:'0001',sets:2,reps:5,rest_sec:300}]})).rejects.toMatchObject({code:'UNSUPPORTED_CONFIG'})
 expect(await read()).toEqual(before);expect(rests(await read())).toEqual([90,120]);expect(api!.calls.filter(c=>c.method==='PUT')).toEqual([])
})
test('native prescription ownership refuses scalar shape changes while retaining metadata',async()=>{
 const s=state(), native=relativeDefinition().weeks[0].days[0].sessions[0].routineSnapshot.ex[0];s.routines[0].ex=[native]
 const {call,read,apply}=await setup(s),before=await read()
 await expect(call('edit_routine',{routine_id:'old',exercises:[{exercise_id:native.id,sets:native.sets,reps:9}]})).rejects.toHaveProperty('code','UNSUPPORTED_CONFIG')
 expect(await read()).toEqual(before);expect(api!.calls.filter(c=>c.method==='PUT')).toEqual([])
 // Native rows have no legacy scalar reps; routine metadata does not resubmit a flat shape.
 const out=await apply('edit_routine',{routine_id:'old',name:'Metadata only'})
 expect(out.saved.routines[0].name).toBe('Metadata only')
 expect(out.saved.routines[0].ex).toEqual(before.routines[0].ex)
 expect(api!.calls.filter(c=>c.method==='PUT')).toHaveLength(1)
 expect(out.saved.routines[0].ex[0].nativePrescription).toEqual(before.routines[0].ex[0].nativePrescription)
})
test.each(['authored-group','longer-partner'])('superset %s timer ownership refuses ineffective per-slot rest and preserves harmless metadata',async policy=>{
 const s=state();s.routines[0].ex=[{...s.routines[0].ex[0],sg:'pair',...(policy==='authored-group'?{sgRest:450}:{})},{id:'0025',sets:2,reps:5,weight:60,restSec:450,sg:'pair'}]
 const {call,read,apply}=await setup(s),before=await read();expect(rests(before,[0,1])).toEqual([450,450])
 const slots=[{exercise_id:'0001',sets:2,reps:5,rest_sec:300},{exercise_id:'0025',sets:2,reps:5}]
 await expect(call('edit_routine',{routine_id:'old',exercises:slots})).rejects.toHaveProperty('code','UNSUPPORTED_CONFIG')
 expect(await read()).toEqual(before)
 const out=await apply('edit_routine',{routine_id:'old',name:'Renamed',exercises:[{exercise_id:'0001',sets:2,reps:5,notes:'Retained note'},{exercise_id:'0025',sets:2,reps:5}]})
 expect(out.preview.target.ex[0]).toMatchObject({...before.routines[0].ex[0],note:'Retained note'})
 expect(out.saved.routines[0].ex[0]).toMatchObject(out.preview.target.ex[0]);expect(rests(out.saved,[0,1])).toEqual([450,450])
})
test('a peer per-set rest can own the superset timer even when its scalar rest is shorter',async()=>{
 const s=state();s.routines[0].ex=[{...s.routines[0].ex[0],sg:'pair'},{id:'0025',sets:2,reps:5,weight:60,restSec:90,pyramid:[5,5],pyramidRest:[450,450],sg:'pair'}]
 const {call,read}=await setup(s),before=await read(),entries=opened(before)
 expect(restSecFor(entries,[0,1],60,{idx:1,sec:pyramidRestFor(entries[1]!.target,entries[1]!.sets,0)})).toBe(450)
 await expect(call('edit_routine',{routine_id:'old',exercises:[{exercise_id:'0001',sets:2,reps:5,rest_sec:300},{exercise_id:'0025',sets:2,reps:5}]})).rejects.toHaveProperty('code','UNSUPPORTED_CONFIG')
 expect(await read()).toEqual(before)
})
test('compatible authored per-set rests remain intact when a scalar rest edit is effective',async()=>{
 const s=state();Object.assign(s.routines[0].ex[0],{pyramid:[5,5],pyramidRest:[300,300]})
 const {apply}=await setup(s),out=await apply('edit_routine',{routine_id:'old',exercises:[{exercise_id:'0001',sets:2,reps:5,rest_sec:300}]})
 expect(out.preview.target.ex[0]).toMatchObject({restSec:300,pyramidRest:[300,300]});expect(out.saved.routines[0].ex[0]).toMatchObject(out.preview.target.ex[0]);expect(rests(out.saved)).toEqual([300,300])
})
const history=()=>({id:'finished',d:'2026-07-26',start:1700000000000,end:1700000300000,routineId:'old',entries:[{id:'0001',sets:[{w:60,r:5,done:true},{w:60,r:5,done:true}]}]})
test('plain default progression refuses an ineffective flat load without turning progression off',async()=>{
 const s=state();delete s.routines[0].prog;s.workouts=[history()]
 const {call,read,apply}=await setup(s),before=await read();expect(opened(before)[0]!.sets.map((r:any)=>r.w)).toEqual([62.5,62.5])
 await expect(call('edit_routine',{routine_id:'old',exercises:[{exercise_id:'0001',sets:2,reps:5,weight:40}]})).rejects.toHaveProperty('code','UNSUPPORTED_CONFIG')
 expect(await read()).toEqual(before);expect(api!.calls.filter(c=>c.method==='PUT')).toEqual([])
 const out=await apply('edit_routine',{routine_id:'old',name:'Renamed',exercises:[{exercise_id:'0001',sets:2,reps:5,notes:'Metadata only'}]})
 expect(out.preview.target.ex[0]).toMatchObject({weight:60,extension:{keep:true},note:'Metadata only'})
 expect(out.saved.routines[0].prog).toBeUndefined();expect(opened(out.saved)[0]!.sets.map((r:any)=>r.w)).toEqual([62.5,62.5]);expect(out.saved.workouts).toEqual(before.workouts)
})
test.each(['load','rest'])('echoed stored %s scalars cannot claim an ineffective Start target',async field=>{
 const s=state()
 if(field==='load'){delete s.routines[0].prog;s.workouts=[history()]}
 else Object.assign(s.routines[0].ex[0],{pyramid:[5,5],pyramidRest:[90,120]})
 const {call,read}=await setup(s),before=await read()
 await expect(call('edit_routine',{routine_id:'old',exercises:[{exercise_id:'0001',sets:2,reps:5,...(field==='load'?{weight:60}:{rest_sec:90})}]})).rejects.toHaveProperty('code','UNSUPPORTED_CONFIG')
 expect(await read()).toEqual(before)
})
test('explicit progression-off load and effective work rest agree in preview, save and actual Start',async()=>{
 const s=state();s.workouts=[history()];Object.assign(s.routines[0].ex[0],{warmupSets:2,warmupRestSec:30})
 const {apply}=await setup(s),out=await apply('edit_routine',{routine_id:'old',exercises:[{exercise_id:'0001',sets:2,reps:5,weight:40,rest_sec:300}]})
 expect(out.preview.target.ex[0]).toMatchObject({weight:40,restSec:300,warmupRestSec:30})
 expect(out.saved.routines[0].ex[0]).toMatchObject(out.preview.target.ex[0])
 const entry=opened(out.saved)[0]!;expect(entry.sets.filter((r:any)=>!isWarmupRow(r)).map((r:any)=>r.w)).toEqual([40,40])
 expect(restSecFor([entry],[0],60)).toBe(300);expect(warmupRestSecFor(entry,0,300)).toBe(30)
})
test.each(['4918','custom-cardio'])('reps-only create rejects %s using the actual catalogue/custom index',async eid=>{
 const s=state();s.routines=[];s.customEx=[{id:'custom-cardio',custom:true,n:'Synthetic cardio',bp:'cardio',eq:'machine'}]
 const {call,read}=await setup(s),before=await read()
 await expect(call('create_routine',{name:'Unsupported',placement:{kind:'none'},exercises:[{exercise_id:eid,sets:2,reps:10,weight:50}]})).rejects.toMatchObject({code:'UNSUPPORTED_CONFIG'})
 expect(await read()).toEqual(before);expect(api!.calls.filter(c=>c.method==='PUT')).toEqual([])
})
test.each(['time','cardio'])('retained explicit %s mode refuses strength inputs but preserves metadata and its original opened targets',async mode=>{
 const s=state();Object.assign(s.routines[0].ex[0],{mode,sec:45,min:12,speed:7})
 const {call,read,apply}=await setup(s),before=await read(),rows=opened(before)[0]!.sets
 await expect(call('edit_routine',{routine_id:'old',exercises:[{exercise_id:'0001',sets:2,reps:5,weight:40}]})).rejects.toHaveProperty('code','UNSUPPORTED_CONFIG')
 expect(await read()).toEqual(before)
 const out=await apply('edit_routine',{routine_id:'old',name:'Renamed',exercises:[{exercise_id:'0001',sets:2,reps:5,notes:'Keep mode'}]})
 expect(out.preview.target.ex[0]).toMatchObject({...before.routines[0].ex[0],note:'Keep mode'})
 expect(opened(out.saved)[0]!.sets).toEqual(rows)
})
test('supported custom reps authoring preserves its own index and effective opened load/reps',async()=>{
 const s=state();s.routines=[];s.customEx=[{id:'custom-reps',custom:true,n:'Synthetic lift',bp:'back',eq:'dumbbell'}]
 const {apply}=await setup(s),out=await apply('create_routine',{name:'Supported',placement:{kind:'none'},exercises:[{exercise_id:'custom-reps',sets:2,reps:10,weight:20,rest_sec:90}]})
 expect(out.preview.target.ex[0]).toMatchObject({weight:20,reps:10});expect(out.saved.routines[0].ex[0]).toMatchObject(out.preview.target.ex[0]);expect(opened(out.saved)[0]!.sets).toEqual([{w:20,r:10,done:false},{w:20,r:10,done:false}])
})
