import {it,expect,beforeEach} from 'vitest'
import {z} from 'zod'
import {PROGRAMME_TOOLS,mutateProgramme} from '../src/programme-tools'
import {_seedStateForTests} from '../src/state'
import {activate,skip} from '@opengym/core/programme'
import {programmePosition} from '@opengym/core/programme-agent'
const definition: any={id:'synthetic',name:'Synthetic',unit:'lb',weeks:[1,2].map((index: any)=>({index,days:['d1','d2'].map((key: any)=>({key,sessions:[{routineSnapshot:{ex:[{id:'0025',sets:3,reps:8,weight:100}]}}]}))}))}
let S: any
const env: any={OPENGYM_ENABLE_PROGRAMME_WRITES:'1',OPENGYM_URL:'http://127.0.0.1:1234',OPENGYM_TOKEN:'test-token'}
beforeEach(()=>{S={_rev:7,_wid:'epoch',unit:'lb',routines:[],workouts:[],programmes:{definitions:[structuredClone(definition)],cycles:[]}};_seedStateForTests(S)})
function fakeApi({rev=7,status=200,user='test-uid',conflict=false}: any={}) {
 const calls: any=[];let saved: any=null
 const fetcher: any=async(url: any,init: any)=>{calls.push({url,init});if(url.endsWith('/api/me'))return{ok:true,status:200,json:async()=>({user:{id:user}})};if(init.method==='GET')return{ok:status===200,status,json:async()=>({state:saved || structuredClone(S),rev:saved?8:rev})};if(!conflict)saved={...JSON.parse(init.body).state,_wid:'new-epoch',_rev:8};return{ok:!conflict,status:conflict?409:200,json:async()=>({ok:true,rev:8,wid:'new-epoch'})}}
 return{fetcher,calls}
}
it('reads the active definition, next projected date and per-week adherence without changing state',()=>{activate(S,definition,{cycleId:'c',today:'2026-10-12'});skip(S,'c','c:w1d1',{today:'2026-10-12'});const before: any=JSON.stringify(S);const read: any=PROGRAMME_TOOLS.find((t: any)=>t.name==='get_programme')!.handler({});expect(read.cycle.id).toBe('c');const position: any=PROGRAMME_TOOLS.find((t: any)=>t.name==='programme_position')!.handler({today:'2026-10-12'});expect(position.next.date).toBe('2026-10-12');expect(position.adherence).toMatchObject({done:0,skipped:1,planned:4});expect(position).toEqual(programmePosition(S,'2026-10-12',undefined));expect(JSON.stringify(S)).toBe(before)})
it('reports no active cycle and paused position without a next session',()=>{expect(programmePosition(S,'2026-10-12',undefined).active).toBeNull();activate(S,definition,{cycleId:'c',today:'2026-10-12'});S.programmes.cycles[0].status='paused';expect(programmePosition(S,'2026-10-12',undefined).next).toBeNull()})
it('opts out by default and never writes directly to the data directory',async()=>{const api: any=fakeApi();await expect(mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:'epoch'},{env:{},fetcher:api.fetcher})).rejects.toMatchObject({code:'WRITES_DISABLED'});expect(api.calls).toHaveLength(0)})
it('activates via conditional authenticated API, preserving baseWid and not mutating the read cache',async()=>{const api: any=fakeApi(),before: any=structuredClone(S);await mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher});const put: any=api.calls.find((c: any)=>c.init.method==='PUT');expect(put.init.method).toBe('PUT');const body: any=JSON.parse(put.init.body);expect(body).toMatchObject({baseRev:7,baseWid:'epoch'});expect(body.state.queue.programmeCycleId).toBeTruthy();expect(put.init.headers.Authorization).toBe('Bearer test-token');expect(S).toEqual(before)})
it.each(['wrong-profile','stale-revision','api-conflict'])('refuses %s',async (kind: any)=>{const api: any=fakeApi({user:kind==='wrong-profile'?'another':'test-uid',rev:kind==='stale-revision'?8:7,conflict:kind==='api-conflict'});await expect(mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher})).rejects.toMatchObject({code:kind==='wrong-profile'?'PROFILE_MISMATCH':'REV_CONFLICT'});expect(api.calls.filter((c: any)=>c.init.method==='PUT')).toHaveLength(kind==='api-conflict'?1:0)})
it('uses UI activation and skip guards before PUT',async()=>{activate(S,definition,{cycleId:'c',today:'2026-10-12'});let api: any=fakeApi();await expect(mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher})).rejects.toThrow('already running');expect(api.calls.filter((c: any)=>c.init.method==='PUT')).toHaveLength(0);skip(S,'c','c:w1d1',{today:'2026-10-12'});api=fakeApi();await expect(mutateProgramme('skip',{cycleId:'c',instanceId:'c:w1d1',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher})).rejects.toThrow('pending');expect(api.calls.filter((c: any)=>c.init.method==='PUT')).toHaveLength(0)})
it('shift and skip derive the same projections as UI actions',async()=>{activate(S,definition,{cycleId:'c',today:'2026-10-12'});let api: any=fakeApi();const shifted: any=await mutateProgramme('shift',{cycleId:'c',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher});expect(shifted.position.next.date).toBe('2026-10-13');api=fakeApi();const skipped: any=await mutateProgramme('skip',{cycleId:'c',instanceId:'c:w1d1',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher});expect(skipped.position.adherence.skipped).toBe(1);expect(skipped.position.next.instanceId).toBe('c:w1d2')})
it('schemas reject invalid dates and mutations without a revision',()=>{for(const t of PROGRAMME_TOOLS){const schema: any=z.object(t.schema);if(t.name==='programme_position')expect(schema.safeParse({today:'2026-02-30'}).success).toBe(false);if(t.name==='shift_programme')expect(schema.safeParse({cycle_id:'c'}).success).toBe(false)}})

it('refuses a restored state whose revision matches but write identity changed',async()=>{const api: any=fakeApi();await expect(mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:'old-epoch',today:'2026-10-12'},{env,fetcher:api.fetcher})).rejects.toMatchObject({code:'REV_CONFLICT'});expect(api.calls.filter((c: any)=>c.init.method==='PUT')).toHaveLength(0)})
it('refuses an identity-less profile before PUT so a same-revision restore cannot lose history',async()=>{
 delete S._wid;const api: any=fakeApi()
 await expect(mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:null,today:'2026-10-12'},{env,fetcher:api.fetcher})).rejects.toMatchObject({code:'WRITE_ID_REQUIRED'})
 expect(api.calls.some((c: any)=>c.init.method==='PUT')).toBe(false)
})
it('retains a renewed token across actions and resets it when configured credentials change',async()=>{
 const config: any={...env,OPENGYM_TOKEN:'renewal-original'},seen: any=[]
 const api: any=fakeApi(),fetcher: any=async(url: any,init: any)=>{
  if(url.endsWith('/api/me')){
   seen.push(init.headers.Authorization)
   return{ok:true,status:200,json:async()=>({user:{id:'test-uid'},token:'renewal-current'})}
  }
  return api.fetcher(url,init)
 }
 const p: any={programmeId:'synthetic',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'}
 await mutateProgramme('activate',p,{env:config,fetcher})
 await expect(mutateProgramme('activate',p,{env:config,fetcher})).rejects.toMatchObject({code:'REV_CONFLICT'})
 expect(seen).toEqual(['Bearer renewal-original','Bearer renewal-current'])
 config.OPENGYM_TOKEN='replacement-config'
 await expect(mutateProgramme('activate',p,{env:config,fetcher})).rejects.toMatchObject({code:'REV_CONFLICT'})
 expect(seen.at(-1)).toBe('Bearer replacement-config')
 expect(process.env.OPENGYM_TOKEN).not.toBe('renewal-current')
})

it('set_training_max validates finite positive values and explicit units at the MCP boundary',()=>{
 const tool=PROGRAMME_TOOLS.find(t=>t.name==='set_training_max')!,schema=z.object(tool.schema)
 const p={cycle_id:'c',lift:'bench',value:100,unit:'kg',expected_rev:7,expected_wid:'epoch'}
 expect(schema.safeParse(p).success).toBe(true)
 for(const value of [0,-1,Infinity,NaN,'100'])expect(schema.safeParse({...p,value}).success).toBe(false)
 expect(schema.safeParse({...p,unit:undefined}).success).toBe(false)
})
it('the legacy mutation helper cannot bypass the new max preview contract',async()=>{
 const api=fakeApi()
 await expect(mutateProgramme('set_training_max',{cycleId:'c',lift:'bench',value:220,unit:'lb',expectedRev:7,expectedWid:'epoch'},{env,fetcher:api.fetcher})).rejects.toMatchObject({code:'PREVIEW_REQUIRED'})
 expect(api.calls).toHaveLength(0)
})
