import {afterEach,expect,it} from 'vitest'
import {createMaxTools} from '../src/max-tools'
import {activate} from '@opengym/core/programme'
import {buildSessionEntries} from '@opengym/core/session-start'
import {syntheticProgramme,syntheticSlot} from '../../core/test/fixtures/synthetic-programme'
import {target} from './http-helpers'
const servers:Awaited<ReturnType<typeof target>>[]=[]
afterEach(async()=>{for(const s of servers.splice(0))await s.close()})
async function fixture(){
 const definition=syntheticProgramme();definition.maxBasis='1rm'
 Object.assign(syntheticSlot(definition),{pyramid:[5,5],tm:{key:'bench',percentages:[50,50]}})
 definition.tmSeeds={bench:{value:200,unit:'lb'}}
 const state:any={_rev:7,_wid:'epoch',unit:'lb',routines:[],workouts:[],customEx:[],extension:{retained:true}}
 activate(state,definition,{cycleId:'c',today:'2026-10-12',tm:{bench:200}})
 Object.assign(state.programmes.cycles[0],{tmSeed:{bench:200},tmUnit:'lb'})
 const server=await target(state);servers.push(server)
 const read=async()=>(await server.request('GET','/api/data')).body
 const initial=await read(),params={cycle_id:'c',lift:'bench',value:240,unit:'lb',today:'2026-10-15',expected_rev:initial.rev,expected_wid:initial.state._wid}
 let beforePut:(()=>Promise<void>)|undefined,agentPuts=0
 const fetcher:typeof server.fetcher=async(url,init)=>{
  if(init.method==='PUT'){agentPuts++;const hook=beforePut;beforePut=undefined;await hook?.()}
  return server.fetcher(url,init)
 }
 const tools=createMaxTools({env:server.env,fetcher,now:()=>Date.parse('2026-10-15T12:00:00Z')})
 const call=(name:string,p:any)=>tools.find(t=>t.name===name)!.handler(p) as Promise<any>
 const browserWrite=async(change:(s:any)=>void)=>{
  const current=await read(),next=structuredClone(current.state);change(next)
  const result=await server.request('PUT','/api/data',{state:next,baseRev:current.rev,baseWid:next._wid},server.browserToken)
  expect(result.status).toBe(200)
 }
 return {server,read,params,call,browserWrite,setHook:(hook:()=>Promise<void>)=>{beforePut=hook},puts:()=>agentPuts}
}
it('real agent HTTP previews/applies/compensates max history and opens effective rows without changing frozen rows',async()=>{
 const x=await fixture(),before=await x.read(),frozen=buildSessionEntries(before.state,before.state.routines[0])
 expect(frozen[0]!.sets.map((s:{w?:number})=>s.w)).toEqual([100,100])
 const preview=await x.call('set_training_max',x.params)
 expect(preview).toMatchObject({applied:false,training_status:'idle'});expect(x.puts()).toBe(0)
 const applied=await x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})
 expect(applied.applied).toBe(true);expect(x.puts()).toBe(1)
 const saved=await x.read();expect(saved.state.extension).toEqual({retained:true})
 expect(buildSessionEntries(saved.state,saved.state.routines[0])[0]!.sets.map((s:{w?:number})=>s.w)).toEqual([120,120])
 expect(frozen[0]!.sets.map((s:{w?:number})=>s.w)).toEqual([100,100])
 expect(saved.state.programmes.cycles[0].tmSeed).toEqual({bench:200})
 const undo=await x.call('undo_training_max',{undo_token:applied.undo_token,today:'2026-10-15'})
 expect((await x.call('undo_training_max',{undo_token:applied.undo_token,today:'2026-10-15',apply:true,preview_token:undo.preview_token})).applied).toBe(true)
 const restored=await x.read();expect(restored.state.programmes.cycles[0].maxAdjustments).toHaveLength(2)
 expect(buildSessionEntries(restored.state,restored.state.routines[0])[0]!.sets.map((s:{w?:number})=>s.w)).toEqual([100,100])
})
for(const status of ['active','unknown','revision'] as const)it(`real HTTP ${status} race after idle preflight cannot apply or retry a max decision`,async()=>{
 const x=await fixture(),preview=await x.call('set_training_max',x.params)
 x.setHook(async()=>{
  if(status==='revision')await x.browserWrite(s=>{s.extension.peer='retained'})
  else expect((await x.server.request('POST','/api/activity',{active:true,sessionId:'synthetic-running',startedAt:1000},x.server.browserToken)).status).toBe(200)
  if(status==='unknown')await x.server.advanceClock(71000)
 })
 await expect(x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})).rejects.toMatchObject(status==='revision'?{code:'REV_CONFLICT'}:{code:'TRAINING_NOW',guardStatus:status})
 expect(x.puts()).toBe(1)
 const current=await x.read();expect(current.state.programmes.cycles[0].maxAdjustments??[]).toEqual([])
 if(status==='revision')expect(current.state.extension.peer).toBe('retained')
 await expect(x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})).rejects.toBeInstanceOf(Error)
 expect(x.puts()).toBe(1)
})
it('actual agent revocation after preflight cannot mutate or seal a max undo',async()=>{
 const x=await fixture(),before=await x.read(),preview=await x.call('set_training_max',x.params)
 x.setHook(async()=>{expect((await x.server.request('POST','/api/account/devices/revoke',{id:x.server.token.split('.')[1]},x.server.browserToken)).status).toBe(200)})
 const result=await x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})
 expect(result).toMatchObject({applied:null,inspection_required:true,undo_available:false});expect(result.undo_token).toBeUndefined()
 const current=await x.server.request('GET','/api/data',undefined,x.server.browserToken)
 expect(current.body).toEqual(before);expect(x.puts()).toBe(1)
})
