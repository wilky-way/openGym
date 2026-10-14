import {describe,it,expect} from 'vitest'
import {stampPut,highestStamp,applyServerOffloadRule,type SyncRecord,type StampReport} from '../src/server-stamp'
const marker=(at:number,versionId='sha256:synthetic')=>({versionId,at})
const definition=(id='a')=>({id,name:'Synthetic',_ts:1})
const state=(p:SyncRecord):SyncRecord=>({workouts:[],routines:[],programmes:{definitions:[],cycles:[],...p}})
function put(cur:SyncRecord|null,next:SyncRecord,stamped=false,report:StampReport={}) {
 return stampPut(cur,next,{stamped,overRead:true,now:100,report})
}
describe('server library offload rule',()=>{
 it('unstamped stale writer is filtered before its definitions can receive fresh stamps',()=>{
  const cur=state({offloaded:{a:marker(20)}})
  const next=state({definitions:[definition()]});const report:StampReport={}
  put(cur,next,false,report)
  expect(next.programmes.definitions).toEqual([])
  expect(next.programmes.offloaded).toEqual(cur.programmes.offloaded)
  expect(report.changed).toBe(true)
  expect(cur.programmes.definitions).toEqual([])
 })
 it('stamped stale writers cannot resurrect definitions using a newer _ts',()=>{
  const cur=state({definitions:[definition()],offloaded:{a:marker(20)}})
  const next=state({definitions:[{...definition(),_ts:99999}]})
  put(cur,next,true)
  expect(next.programmes.definitions).toEqual([])
  expect(cur.programmes.definitions).toHaveLength(1)
 })
 it('concurrent offloads join by maximum at without losing either id',()=>{
  const cur=state({definitions:[definition('b')],offloaded:{a:marker(20),c:marker(50,'sha256:latest')}})
  const next=state({definitions:[definition('a')],offloaded:{b:marker(30),c:marker(40)}})
  put(cur,next)
  expect(next.programmes.definitions).toEqual([])
  expect(next.programmes.offloaded).toEqual({a:marker(20),c:marker(50,'sha256:latest'),b:marker(30)})
 })
 it('only an explicit later install marker admits the definition across stale replay',()=>{
  const cur=state({offloaded:{a:marker(20)}})
  const next=state({definitions:[definition()],installed:{a:marker(21)}})
  put(cur,next)
  expect(next.programmes.definitions.map((d:SyncRecord)=>d.id)).toEqual(['a'])
  expect(next.programmes.installed.a).toEqual(marker(21))
  const stale=state({definitions:[definition()],offloaded:{a:marker(20)}})
  put(next,stale)
  expect(stale.programmes.definitions.map((d:SyncRecord)=>d.id)).toEqual(['a'])
  expect(stale.programmes.installed.a).toEqual(marker(21))
 })
 it.each([19,20])('install marker at %s cannot override offload at 20',(at)=>{
  const next=state({definitions:[definition()],installed:{a:marker(at)}})
  put(state({offloaded:{a:marker(20)}}),next)
  expect(next.programmes.definitions).toEqual([])
 })
 it.each(['active','paused'])('a %s cycle on either input protects its definition',(status)=>{
  for(const reverse of [false,true]) {
   const used=state({definitions:[definition()],cycles:[{id:'c',programmeId:'a',status,occurrences:[]}]})
   const offloaded=state({offloaded:{a:marker(20)}})
   const [cur,next]=reverse?[used,offloaded]:[offloaded,used]
   put(cur!,next!)
   expect(next!.programmes.definitions.map((d:SyncRecord)=>d.id)).toEqual(['a'])
  }
 })
 it.each(['finished','archived'])('a %s cycle does not protect an offloaded definition',(status)=>{
  const next=state({definitions:[definition()],cycles:[{id:'c',programmeId:'a',status,occurrences:[]}]})
  put(state({offloaded:{a:marker(20)}}),next)
  expect(next.programmes.definitions).toEqual([])
 })
 it('terminal cycles without an offload marker do not trigger automatic offload',()=>{
  const next=state({definitions:[definition()],cycles:[{id:'c',programmeId:'a',status:'finished',occurrences:[]}]})
  put(null,next)
  expect(next.programmes.definitions).toHaveLength(1)
  expect(next.programmes.offloaded).toBeUndefined()
 })
 it('Reset removes old manifests but retains markers made after Reset',()=>{
  const cur=state({offloaded:{a:marker(20)},installed:{a:marker(21)}})
  const next=state({definitions:[{...definition(),_ts:50}],offloaded:{a:marker(20),b:marker(40)},installed:{a:marker(21)}})
  next.resetAt=30;next.resetIds={programmeDefinitions:['a'],programmeCycles:[]}
  put(cur,next)
  expect(next.programmes.offloaded).toEqual({b:marker(40)})
  expect(next.programmes.installed).toEqual({})
  expect(next.programmes.definitions.map((d:SyncRecord)=>d.id)).toEqual(['a'])
  const omitted:SyncRecord={resetAt:30,workouts:[],routines:[]}
  put(cur,omitted)
  expect(omitted.programmes).toBeUndefined()
 })
 it('marker joins do not shrink on same-reset stale pushes',()=>{
  const cur=state({offloaded:{a:marker(20)}});cur.resetAt=10
  const next=state({offloaded:{b:marker(30)}});next.resetAt=10
  put(cur,next)
  expect(next.programmes.offloaded).toEqual({a:marker(20),b:marker(30)})
 })
 it('offload and install clocks lift unstamped edits causally',()=>{
  const cur=state({offloaded:{a:marker(500)},installed:{b:marker(600)}})
  expect(highestStamp(cur)).toBe(600)
  cur.restSec=60
  const next=state({});next.restSec=90
  put(cur,next)
  expect(next.edited.restSec).toBe(601)
 })
 it('pure filter preserves unknown programme keys and does not mutate either input',()=>{
  const previous={definitions:[definition()],cycles:[],offloaded:{a:marker(20)},future:{value:1}}
  const incoming={definitions:[definition()],cycles:[],installed:{a:marker(21)},future:{value:2}}
  const before=structuredClone([previous,incoming])
  const filtered=applyServerOffloadRule(previous,incoming)
  expect([previous,incoming]).toEqual(before)
  expect(filtered.previous?.future).toEqual({value:1})
  expect(filtered.next.future).toEqual({value:2})
  expect(filtered.next.definitions).toHaveLength(1)
 })
 it.each(['constructor','toString','__proto__'])('unrelated offload does not remove prototype-named id %s',(id)=>{
  const next=state({definitions:[definition(id)]})
  put(state({offloaded:{other:marker(20)}}),next)
  expect(next.programmes.definitions.map((d:SyncRecord)=>d.id)).toEqual([id])
 })
 it.each(['constructor','toString','__proto__'])('manifest joins retain own marker for prototype-named id %s',(id)=>{
  const offloaded=Object.fromEntries([[id,marker(20)]])
  const next=state({definitions:[definition(id)]})
  put(state({offloaded}),next)
  expect(next.programmes.definitions).toEqual([])
  expect(Object.hasOwn(next.programmes.offloaded,id)).toBe(true)
  expect(next.programmes.offloaded[id]).toEqual(marker(20))
 })

 it('advancing Reset retains stored-only markers newer than Reset, including when programmes is omitted',()=>{
  for(const omitted of [false,true]) {
   const cur=state({offloaded:{a:marker(200),old:marker(50)},installed:{b:marker(250)},definitions:[definition('a'),definition('b')],cycles:[{id:'old-cycle',status:'finished',occurrences:[]}]})
   const next:SyncRecord=omitted?{workouts:[],routines:[]}:state({})
   next.resetAt=100
   put(cur,next)
   expect(next.programmes.offloaded).toEqual({a:marker(200)})
   expect(next.programmes.installed).toEqual({b:marker(250)})
   expect(next.programmes.definitions).toEqual([])
   expect(next.programmes.cycles).toEqual([])
   const stale=state({definitions:[definition('a')]});stale.resetAt=100
   put(next,stale)
   expect(stale.programmes.definitions).toEqual([])
   expect(stale.programmes.offloaded.a).toEqual(marker(200))
  }
 })

 it('malformed and duplicate cycles do not crash or provide false offload protection',()=>{
  const previous={offloaded:{a:marker(20)},definitions:[],cycles:[null]}
  const incoming={definitions:[definition()],cycles:[null,[],false,'cycle',{status:'active',programmeId:'a'},{id:'c',status:'finished',programmeId:'a'},{id:'c',status:'active',programmeId:'a'}]}
  expect(applyServerOffloadRule(previous,incoming).next.definitions).toEqual([])
  const used={definitions:[definition()],cycles:[null,{id:'c',status:'active',programmeId:'a'}]}
  expect(applyServerOffloadRule(previous,used).next.definitions).toHaveLength(1)
  const next=state(incoming)
  put(state(previous),next)
  expect(next.programmes.definitions).toEqual([])
 })

 it('in-use protection survives activation reconciliation and repeated PUT until explicit re-offload',()=>{
  const cur=state({definitions:[definition('a'),definition('b')],offloaded:{a:marker(20),b:marker(20)},cycles:[
   {id:'ca',programmeId:'a',status:'active',since:10,occurrences:[]},
   {id:'cb',programmeId:'b',status:'active',since:20,occurrences:[]},
  ]})
  const first=structuredClone(cur)
  put(cur,first,true)
  expect(first.programmes.definitions.map((d:SyncRecord)=>d.id)).toEqual(['a','b'])
  for(const id of ['a','b']) {
   expect(first.programmes.installed[id]).toEqual(marker(21))
  }
  const again=structuredClone(first)
  put(first,again,true)
  expect(again).toEqual(first)
  expect(JSON.stringify(again.programmes.installed)).toBe(JSON.stringify(first.programmes.installed))
  expect(JSON.stringify(again.programmes.offloaded)).toBe(JSON.stringify(first.programmes.offloaded))
  const ended=structuredClone(again)
  ended.programmes.cycles.forEach((c:SyncRecord)=>{c.status='finished'})
  const afterTerminal=structuredClone(ended)
  put(ended,afterTerminal,true)
  expect(afterTerminal.programmes.definitions.map((d:SyncRecord)=>d.id)).toEqual(['a','b'])
  const reoffload=structuredClone(afterTerminal)
  reoffload.programmes.offloaded.a=marker(afterTerminal.programmes.installed.a.at+1)
  put(afterTerminal,reoffload,true)
  expect(reoffload.programmes.definitions.map((d:SyncRecord)=>d.id)).toEqual(['b'])
 })

 it('equal-clock manifest ties select the greater version id on either input order',()=>{
  for(const reverse of [false,true]) {
   const a=state({offloaded:{a:marker(20,'sha256:a')},installed:{b:marker(30,'sha256:a')}})
   const b=state({offloaded:{a:marker(20,'sha256:z')},installed:{b:marker(30,'sha256:z')}})
   const [cur,next]=reverse?[b,a]:[a,b]
   put(cur!,next!,true)
   expect(next!.programmes.offloaded.a).toEqual(marker(20,'sha256:z'))
   expect(next!.programmes.installed.b).toEqual(marker(30,'sha256:z'))
  }
 })

})


describe('server rejects unsafe offload clocks from stale peers', () => {
 it.each([1.5, 2 ** 53, 1e100])('ignores clock %s without poisoning active/paused protection', at => {
  for (const status of ['active', 'paused']) for (const stamped of [false, true]) {
   const cur = state({offloaded:{a:marker(at)}})
   const before = structuredClone(cur)
   const next = state({definitions:[definition()],cycles:[{id:'clock-cycle',programmeId:'a',status,occurrences:[]}]})
   expect(highestStamp(cur)).toBe(0)
   put(cur,next,stamped)
   expect(next.programmes.definitions.map((d:SyncRecord)=>d.id)).toEqual(['a'])
   expect(next.programmes.offloaded).toEqual({})
   expect(next.programmes.installed).toBeUndefined()
   expect(next.programmes.cycles.map((c:SyncRecord)=>({id:c.id,programmeId:c.programmeId,status:c.status,occurrences:c.occurrences,_ts:c._ts}))).toEqual([{id:'clock-cycle',programmeId:'a',status,occurrences:[],_ts:stamped ? undefined : 100}])
   expect(next.programmes.definitions[0]._ts).toBe(stamped ? 1 : 100)
   expect(highestStamp(next)).toBe(stamped ? 1 : 100)
   expect(Number.isSafeInteger(highestStamp(next))).toBe(true)
   expect(highestStamp(next)).toBeLessThan(2 ** 53)
   expect(cur).toEqual(before)
  }
 })
})
