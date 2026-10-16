import {it,expect,beforeEach} from 'vitest'
import {z} from 'zod'
import {PROGRAMME_TOOLS,mutateProgramme} from '../src/programme-tools.js'
import {_seedStateForTests} from '../src/state.js'
import {activate,skip} from '../../frontend/src/lib/programme.js'
import {programmePosition} from '../../frontend/src/lib/programme-agent.js'
const definition={id:'synthetic',name:'Synthetic',unit:'lb',weeks:[1,2].map(index=>({index,days:['d1','d2'].map(key=>({key,sessions:[{routineSnapshot:{ex:[{id:'0025',sets:3,reps:8,weight:100}]}}]}))}))}
let S
const env={OPENGYM_ENABLE_PROGRAMME_WRITES:'1',OPENGYM_URL:'http://127.0.0.1:1234',OPENGYM_TOKEN:'test-token'}
beforeEach(()=>{S={_rev:7,_wid:'epoch',unit:'lb',routines:[],workouts:[],programmes:{definitions:[structuredClone(definition)],cycles:[]}};_seedStateForTests(S)})
function fakeApi({rev=7,status=200,user='test-uid',conflict=false}={}) {
 const calls=[];let saved=null
 const fetcher=async(url,init)=>{calls.push({url,init});if(url.endsWith('/api/me'))return{ok:true,status:200,json:async()=>({user:{id:user}})};if(init.method==='GET')return{ok:status===200,status,json:async()=>({state:saved || structuredClone(S),rev:saved?8:rev})};if(!conflict)saved={...JSON.parse(init.body).state,_wid:'new-epoch',_rev:8};return{ok:!conflict,status:conflict?409:200,json:async()=>({ok:true,rev:8,wid:'new-epoch'})}}
 return{fetcher,calls}
}
it('reads the active definition, next projected date and per-week adherence without changing state',()=>{activate(S,definition,{cycleId:'c',today:'2026-10-12'});skip(S,'c','c:w1d1',{today:'2026-10-12'});const before=JSON.stringify(S);const read=PROGRAMME_TOOLS.find(t=>t.name==='get_programme').handler({});expect(read.cycle.id).toBe('c');const position=PROGRAMME_TOOLS.find(t=>t.name==='programme_position').handler({today:'2026-10-12'});expect(position.next.date).toBe('2026-10-12');expect(position.adherence).toMatchObject({done:0,skipped:1,planned:4});expect(position).toEqual(programmePosition(S,'2026-10-12'));expect(JSON.stringify(S)).toBe(before)})
it('reports no active cycle and paused position without a next session',()=>{expect(programmePosition(S,'2026-10-12').active).toBeNull();activate(S,definition,{cycleId:'c',today:'2026-10-12'});S.programmes.cycles[0].status='paused';expect(programmePosition(S,'2026-10-12').next).toBeNull()})
it('opts out by default and never writes directly to the data directory',async()=>{const api=fakeApi();await expect(mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:'epoch'},{env:{},fetcher:api.fetcher})).rejects.toMatchObject({code:'WRITES_DISABLED'});expect(api.calls).toHaveLength(0)})
it('activates via conditional authenticated API, preserving baseWid and not mutating the read cache',async()=>{const api=fakeApi(),before=structuredClone(S);await mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher});const put=api.calls.find(c=>c.init.method==='PUT');expect(put.init.method).toBe('PUT');const body=JSON.parse(put.init.body);expect(body).toMatchObject({baseRev:7,baseWid:'epoch'});expect(body.state.queue.programmeCycleId).toBeTruthy();expect(put.init.headers.Authorization).toBe('Bearer test-token');expect(S).toEqual(before)})
it.each(['wrong-profile','stale-revision','api-conflict'])('refuses %s',async kind=>{const api=fakeApi({user:kind==='wrong-profile'?'another':'test-uid',rev:kind==='stale-revision'?8:7,conflict:kind==='api-conflict'});await expect(mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher})).rejects.toMatchObject({code:kind==='wrong-profile'?'PROFILE_MISMATCH':'REV_CONFLICT'});expect(api.calls.filter(c=>c.init.method==='PUT')).toHaveLength(kind==='api-conflict'?1:0)})
it('uses UI activation and skip guards before PUT',async()=>{activate(S,definition,{cycleId:'c',today:'2026-10-12'});let api=fakeApi();await expect(mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher})).rejects.toThrow('already running');expect(api.calls.filter(c=>c.init.method==='PUT')).toHaveLength(0);skip(S,'c','c:w1d1',{today:'2026-10-12'});api=fakeApi();await expect(mutateProgramme('skip',{cycleId:'c',instanceId:'c:w1d1',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher})).rejects.toThrow('pending');expect(api.calls.filter(c=>c.init.method==='PUT')).toHaveLength(0)})
it('shift and skip derive the same projections as UI actions',async()=>{activate(S,definition,{cycleId:'c',today:'2026-10-12'});let api=fakeApi();const shifted=await mutateProgramme('shift',{cycleId:'c',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher});expect(shifted.position.next.date).toBe('2026-10-13');api=fakeApi();const skipped=await mutateProgramme('skip',{cycleId:'c',instanceId:'c:w1d1',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'},{env,fetcher:api.fetcher});expect(skipped.position.adherence.skipped).toBe(1);expect(skipped.position.next.instanceId).toBe('c:w1d2')})
it('schemas reject invalid dates and mutations without a revision',()=>{for(const t of PROGRAMME_TOOLS){const schema=z.object(t.schema);if(t.name==='programme_position')expect(schema.safeParse({today:'2026-02-30'}).success).toBe(false);if(t.name==='shift_programme')expect(schema.safeParse({cycle_id:'c'}).success).toBe(false)}})

it('refuses a restored state whose revision matches but write identity changed',async()=>{const api=fakeApi();await expect(mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:'old-epoch',today:'2026-10-12'},{env,fetcher:api.fetcher})).rejects.toMatchObject({code:'REV_CONFLICT'});expect(api.calls.filter(c=>c.init.method==='PUT')).toHaveLength(0)})
it('refuses an identity-less profile before PUT so a same-revision restore cannot lose history',async()=>{
 delete S._wid;const api=fakeApi()
 await expect(mutateProgramme('activate',{programmeId:'synthetic',expectedRev:7,expectedWid:null,today:'2026-10-12'},{env,fetcher:api.fetcher})).rejects.toMatchObject({code:'WRITE_ID_REQUIRED'})
 expect(api.calls.some(c=>c.init.method==='PUT')).toBe(false)
})
it('retains a renewed token across actions and resets it when configured credentials change',async()=>{
 const config={...env,OPENGYM_TOKEN:'renewal-original'},seen=[]
 const api=fakeApi(),fetcher=async(url,init)=>{
  if(url.endsWith('/api/me')){
   seen.push(init.headers.Authorization)
   return{ok:true,status:200,json:async()=>({user:{id:'test-uid'},token:'renewal-current'})}
  }
  return api.fetcher(url,init)
 }
 const p={programmeId:'synthetic',expectedRev:7,expectedWid:'epoch',today:'2026-10-12'}
 await mutateProgramme('activate',p,{env:config,fetcher})
 await expect(mutateProgramme('activate',p,{env:config,fetcher})).rejects.toMatchObject({code:'REV_CONFLICT'})
 expect(seen).toEqual(['Bearer renewal-original','Bearer renewal-current'])
 config.OPENGYM_TOKEN='replacement-config'
 await expect(mutateProgramme('activate',p,{env:config,fetcher})).rejects.toMatchObject({code:'REV_CONFLICT'})
 expect(seen.at(-1)).toBe('Bearer replacement-config')
 expect(process.env.OPENGYM_TOKEN).not.toBe('renewal-current')
})
