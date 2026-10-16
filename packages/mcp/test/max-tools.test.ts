import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../src/index'
import { createMaxTools } from '../src/max-tools'
import { createTools } from '../src/tools'
import { activate } from '@opengym/core/programme'
import { syntheticProgramme, syntheticSlot } from '../../core/test/fixtures/synthetic-programme'
import { target } from './http-helpers'

const sessions:{close:()=>Promise<void>}[]=[]
afterEach(async()=>{for(const session of sessions.splice(0))await session.close()})
function fixture(seed=true) {
 const d=syntheticProgramme();d.maxBasis='1rm';syntheticSlot(d).pyramid=[5,5];d.tmSeeds={bench:{value:200,unit:'lb'}};syntheticSlot(d).tm={key:'bench',percentages:[50,50]}
 const state:any={unit:'lb',routines:[],workouts:[{id:'old',d:'2026-01-01',entries:[],extension:{keep:true}}],customEx:[],extension:{nested:['retained'],future:{answer:42}}}
 activate(state,d,{cycleId:'c',today:'2026-10-12',tm:seed?{bench:200}:{}})
 state.programmes.cycles[0].tmSeed={bench:200};state.programmes.cycles[0].tmUnit='lb'
 if(!seed){delete state.programmes.cycles[0].snapshot.tmSeeds;state.programmes.cycles[0].tm={};state.programmes.cycles[0].tmSeed={}}
 state._rev=7;state._wid='epoch';state.programmes.cycles[0].extension={keep:true}
 return state
}
function api(seed=true) {
 let state=fixture(seed),rev=7,clock=Date.parse('2026-10-15T12:00:00Z')
 const env:any={OPENGYM_URL:'http://127.0.0.1:1234',OPENGYM_UID:'test-uid',OPENGYM_TOKEN:'synthetic-max-token',OPENGYM_ENABLE_PROGRAMME_WRITES:'1'}
 const calls:any[]=[]
 const behavior:any={status:'idle',user:'test-uid'}
 const response=(status:number,body:any)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(body)})
 const fetcher:any=async(url:string,init:any)=>{
  const path=new URL(url).pathname;calls.push({path,method:init.method,...(init.body?{body:JSON.parse(init.body)}:{})})
  if(path==='/api/me')return response(200,{user:{id:behavior.user},...(behavior.renew?{token:behavior.renew}:{})})
  if(path==='/api/data/activity'){behavior.beforeActivity?.();return response(behavior.unsupported?404:200,{status:behavior.invalid?'not-idle':behavior.status})}
  if(path==='/api/data'&&init.method==='GET') {
   if(behavior.readFail)throw new Error('lost read')
   return response(200,{state,rev})
  }
  if(path==='/api/data'&&init.method==='PUT') {
   const body=JSON.parse(init.body)
   if(behavior.race)return response(423,{code:'TRAINING_NOW',guardStatus:behavior.race})
   if(behavior.conflict)return response(409,{code:'REV_CONFLICT'})
   if(body.baseRev!==rev||body.baseWid!==state._wid)return response(409,{code:'REV_CONFLICT'})
   state={...body.state,_rev:++rev,_wid:`write-${rev}`,_wids:[...(state._wids??[]),state._wid]}
   if(behavior.lost){behavior.readFail=!!behavior.readFailAfterPut;throw new Error('lost acknowledgement')}
   if(behavior.readbackMutation)state.extension.changed=true
   return response(200,{ok:true,rev:behavior.badAck?rev+1:rev,wid:state._wid})
  }
  throw new Error('unexpected route')
 }
 const tools=createMaxTools({env,fetcher,now:()=>clock}),params:any={cycle_id:'c',lift:'bench',value:240,unit:'lb',today:'2026-10-15',reason:'Reviewed',expected_rev:7,expected_wid:'epoch'}
 const call=(name:string,p:any)=>tools.find(t=>t.name===name)!.handler(p)
 const puts=()=>calls.filter(c=>c.method==='PUT')
 return {env,behavior,calls,fetcher,tools,params,call,puts,setRevision:(value:number)=>{rev=value;state._rev=value},get state(){return state},get rev(){return rev},advance:(ms:number)=>clock+=ms}
}
async function transport(tools:ReturnType<typeof createMaxTools>) {
 const server=createMcpServer(tools),client=new Client({name:'synthetic-max-client',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair()
 await server.connect(a);await client.connect(b)
 sessions.push({close:async()=>{await client.close();await server.close()}})
 return async(name:string,args:any)=>{
  const result:any=await client.callTool({name,arguments:args})
  return result.isError?{error:result.content[0].text}:JSON.parse(result.content[0].text)
 }
}
it('real MCP transport previews without PUT and applies the exact reviewed audited event once',async()=>{
 const x=api(),call=await transport(createTools({env:x.env,fetcher:x.fetcher})),before=structuredClone(x.state)
 const preview=await call('set_training_max',x.params)
 expect(preview).toMatchObject({applied:false,training_status:'idle',audit:{current:200,proposed:240,unit:'lb',basis:'1rm',effective_on:'2026-10-15',outcome:'append-max-decision'}})
 expect(x.puts()).toHaveLength(0);expect(x.state).toEqual(before)
 const applied=await call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})
 expect(applied).toMatchObject({applied:true,undo_available:true,audit:{event_id:preview.audit.event_id}})
 expect(x.puts()).toHaveLength(1)
 const body=x.puts()[0].body
 expect(body).toMatchObject({baseRev:7,baseWid:'epoch',stamped:true,requireIdle:true})
 expect(Object.hasOwn(body,'trainingClose')).toBe(false);expect(Object.hasOwn(body.state,'active')).toBe(false)
 expect(x.state.programmes.cycles[0].tmSeed).toEqual(before.programmes.cycles[0].tmSeed)
 expect(x.state.extension).toEqual(before.extension);expect(x.state.workouts).toEqual(before.workouts)
 expect(x.state.programmes.cycles[0].extension).toEqual({keep:true})
 const replay=await call('set_training_max',{...x.params,expected_rev:x.rev,expected_wid:x.state._wid,apply:true,preview_token:preview.preview_token})
 expect(replay.error).toMatch(/^PREVIEW_REQUIRED:/);expect(x.puts()).toHaveLength(1)
})
it('sealed undo previews by default, appends compensation, and retains the exact original history',async()=>{
 const x=api(),call=await transport(x.tools),preview=await call('set_training_max',x.params)
 const applied=await call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})
 const original=structuredClone(x.state.programmes.cycles[0].maxAdjustments[0]),seed=structuredClone(x.state.programmes.cycles[0].tmSeed)
 const undo=await call('undo_training_max',{undo_token:applied.undo_token,today:'2026-10-15'})
 expect(undo).toMatchObject({applied:false,audit:{current:240,proposed:200,outcome:'append-compensating-decision'}})
 expect(x.puts()).toHaveLength(1)
 const result=await call('undo_training_max',{undo_token:applied.undo_token,today:'2026-10-15',apply:true,preview_token:undo.preview_token})
 expect(result.applied).toBe(true)
 const history=x.state.programmes.cycles[0].maxAdjustments
 expect(history).toHaveLength(2);expect(history[0]).toEqual(original)
 expect(history[1]).toMatchObject({previous:240,value:200,unit:'lb',basis:'1rm',reason:`Compensating MCP decision for ${original.id}.`})
 expect(history[1].recordedAt).toBeGreaterThan(original.recordedAt);expect(x.state.programmes.cycles[0].tmSeed).toEqual(seed)
 const again=await call('undo_training_max',{undo_token:applied.undo_token})
 expect(again.error).toMatch(/^UNDO_UNAVAILABLE:/)
})
it.each(['revision','wid','fingerprint','input','profile','credential','server','action','expired'] as const)('refuses a preview with changed %s before PUT',async kind=>{
 const x=api(),preview=await x.call('set_training_max',x.params)
 let p:any={...x.params,apply:true,preview_token:preview.preview_token},name='set_training_max'
 if(kind==='revision'){x.setRevision(8)}
 if(kind==='wid')x.state._wid='restored'
 if(kind==='fingerprint')x.state.extension.nested.push('changed')
 if(kind==='input')p.value=241
 if(kind==='profile')x.behavior.user='other'
 if(kind==='credential')x.env.OPENGYM_TOKEN='replacement-config'
 if(kind==='server')x.env.OPENGYM_URL='http://127.0.0.1:4321'
 if(kind==='action'){name='undo_training_max';p={undo_token:preview.preview_token,apply:true,preview_token:preview.preview_token}}
 if(kind==='expired')x.advance(15*60000)
 await expect(x.call(name,p)).rejects.toBeInstanceOf(Error);expect(x.puts()).toHaveLength(0)
})
it.each(['active','unknown'])('refuses %s training at preflight without PUT',async status=>{
 const x=api(),preview=await x.call('set_training_max',x.params);x.behavior.status=status
 await expect(x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})).rejects.toMatchObject({code:'TRAINING_NOW',guardStatus:status})
 expect(x.puts()).toHaveLength(0)
})
it.each(['active','unknown'])('honors atomic server %s refusal after an idle preflight without retry',async status=>{
 const x=api(),preview=await x.call('set_training_max',x.params);x.behavior.race=status
 await expect(x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})).rejects.toMatchObject({code:'TRAINING_NOW',guardStatus:status})
 expect(x.puts()).toHaveLength(1)
 x.behavior.race=false
 await expect(x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})).rejects.toMatchObject({code:'PREVIEW_REQUIRED'})
 expect(x.puts()).toHaveLength(1)
})
it('does not retry a server revision conflict and consumes the token',async()=>{
 const x=api(),preview=await x.call('set_training_max',x.params);x.behavior.conflict=true
 await expect(x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})).rejects.toMatchObject({code:'REV_CONFLICT'})
 x.behavior.conflict=false
 await expect(x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})).rejects.toMatchObject({code:'PREVIEW_REQUIRED'})
 expect(x.puts()).toHaveLength(1)
})
it.each(['unsupported','invalid'])('fails closed on a %s guard endpoint',async kind=>{
 const x=api();x.behavior[kind]=true
 await expect(x.call('set_training_max',x.params)).rejects.toMatchObject({code:'TRAINING_GUARD_UNAVAILABLE'});expect(x.puts()).toHaveLength(0)
})
it('previews with the write gate off, but apply requires explicit true and opt-in',async()=>{
 const x=api(),call=await transport(x.tools);x.env.OPENGYM_ENABLE_PROGRAMME_WRITES='0'
 const preview=await call('set_training_max',x.params);expect(preview.applied).toBe(false)
 expect((await call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})).error).toMatch(/^WRITES_DISABLED:/)
 expect((await call('set_training_max',{...x.params,apply:'true',preview_token:preview.preview_token})).error).toMatch(/^EINVAL:/)
 expect(x.puts()).toHaveLength(0)
})
it.each([{trainingClose:{}},{requireIdle:false},{active:null},{stamped:false},{apply:true},{value:Infinity},{unit:'stones'},{today:'2026-02-30'},{reason:'x'.repeat(1001)}])('real MCP boundary rejects flags and invalid inputs %j',async extra=>{
 const x=api(),call=await transport(x.tools),result=await call('set_training_max',{...x.params,...extra})
 expect(result.error).toBeTruthy();expect(x.puts()).toHaveLength(0)
})
it('canonical binding tolerates reordered object keys but never content edits',async()=>{
 const x=api(),preview=await x.call('set_training_max',x.params)
 x.state.extension={future:x.state.extension.future,nested:x.state.extension.nested}
 const result=await x.call('set_training_max',{...x.params,preview_token:preview.preview_token,apply:true})
 expect(result.applied).toBe(true)
})
it('undo refuses same-identity extension edits and cannot be used by changed credentials',async()=>{
 const x=api(),preview=await x.call('set_training_max',x.params),applied=await x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})
 x.state.extension.changed=true
 await expect(x.call('undo_training_max',{undo_token:applied.undo_token})).rejects.toMatchObject({code:'UNDO_MODIFIED'})
 delete x.state.extension.changed;x.env.OPENGYM_TOKEN='changed-token'
 await expect(x.call('undo_training_max',{undo_token:applied.undo_token})).rejects.toMatchObject({code:'UNDO_UNAVAILABLE'})
 expect(x.puts()).toHaveLength(1)
})
it('no-prior-max decision explicitly has no undo and preserves the new event',async()=>{
 const x=api(false),preview=await x.call('set_training_max',x.params)
 expect(preview.audit.current).toBeNull();expect(preview.undo_limitation).toContain('No prior max')
 const result=await x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})
 expect(result.undo_available).toBe(false);expect(result.undo_token).toBeUndefined();expect(x.state.programmes.cycles[0].maxAdjustments).toHaveLength(1)
})
it.each([false,true])('lost write acknowledgement triggers readback and inspection-only next call, readback failed=%s',async readFailAfterPut=>{
 const x=api(),preview=await x.call('set_training_max',x.params);x.behavior.lost=true;x.behavior.readFailAfterPut=readFailAfterPut
 const result=await x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})
 expect(result).toMatchObject({applied:null,outcome:'uncertain',inspection_required:true,undo_available:false});expect(result.preview_token).toBeUndefined();expect(result.undo_token).toBeUndefined()
 x.behavior.readFail=false
 const inspection=await x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})
 expect(inspection).toMatchObject({inspection_only:true,event_present:true});expect(inspection.preview_token).toBeUndefined();expect(x.puts()).toHaveLength(1)
 await expect(x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})).rejects.toMatchObject({code:'REV_CONFLICT'})
})
it.each(['badAck','readbackMutation'])('does not seal undo after %s',async kind=>{
 const x=api(),preview=await x.call('set_training_max',x.params);x.behavior[kind]=true
 const result=await x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})
 expect(result).toMatchObject({outcome:'uncertain',undo_available:false});expect(result.undo_token).toBeUndefined();expect(x.puts()).toHaveLength(1)
})
it('redacts initial and same-call renewed credentials in preview audit and input errors',async()=>{
 const x=api(),call=await transport(x.tools);x.behavior.renew='renewed-max-secret-token'
 const preview=await call('set_training_max',{...x.params,reason:`${x.env.OPENGYM_TOKEN} ${x.behavior.renew}`})
 expect(JSON.stringify(preview)).not.toContain(x.env.OPENGYM_TOKEN);expect(JSON.stringify(preview)).not.toContain(x.behavior.renew)
 const invalid=await call('set_training_max',{...x.params,unit:x.behavior.renew})
 expect(JSON.stringify(invalid)).not.toContain(x.behavior.renew)
})
it('bounds preview memory and expires old undo seals',async()=>{
 const x=api(),old=await x.call('set_training_max',x.params)
 for(let i=0;i<32;i++)await x.call('set_training_max',{...x.params,value:241+i})
 await expect(x.call('set_training_max',{...x.params,apply:true,preview_token:old.preview_token})).rejects.toMatchObject({code:'PREVIEW_REQUIRED'});expect(x.puts()).toHaveLength(0)
 const latest=await x.call('set_training_max',x.params),applied=await x.call('set_training_max',{...x.params,apply:true,preview_token:latest.preview_token})
 x.advance(60*60000)
 await expect(x.call('undo_training_max',{undo_token:applied.undo_token})).rejects.toMatchObject({code:'UNDO_UNAVAILABLE'})
})
it('refuses an unavailable activity endpoint even with otherwise real authenticated HTTP state',async()=>{
 const fixtureState=fixture(),server=await target(fixtureState);sessions.push(server)
 const tools=createMaxTools({env:server.env,fetcher:(url,init)=>url.endsWith('/api/data/activity')?Promise.resolve(new Response(null,{status:404})):server.fetcher(url,init)}),call=await transport(tools)
 const read=await server.request('GET','/api/data')
 const result=await call('set_training_max',{cycle_id:'c',lift:'bench',value:240,unit:'lb',expected_rev:read.body.rev,expected_wid:read.body.state._wid})
 expect(result.error).toMatch(/^TRAINING_GUARD_UNAVAILABLE:/)
 expect(server.calls.filter(c=>c.method==='PUT')).toHaveLength(0)
})
it('two concurrent applies of one preview can issue only one PUT',async()=>{
 const x=api(),preview=await x.call('set_training_max',x.params),p={...x.params,apply:true,preview_token:preview.preview_token}
 const results=await Promise.allSettled([x.call('set_training_max',p),x.call('set_training_max',p)])
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(x.puts()).toHaveLength(1)
})
it('a stale undo preview cannot compensate after another document edit',async()=>{
 const x=api(),preview=await x.call('set_training_max',x.params),applied=await x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})
 const undo=await x.call('undo_training_max',{undo_token:applied.undo_token,today:'2026-10-15'})
 x.state.extension.changed='after undo preview'
 await expect(x.call('undo_training_max',{undo_token:applied.undo_token,today:'2026-10-15',apply:true,preview_token:undo.preview_token})).rejects.toMatchObject({code:'UNDO_MODIFIED'})
 expect(x.puts()).toHaveLength(1);expect(x.state.programmes.cycles[0].maxAdjustments).toHaveLength(1)
})
it('does not send any active workout body even if the endpoint reports idle',async()=>{
 const x=api(),preview=await x.call('set_training_max',x.params);x.state.active={id:'running',start:100,entries:[]}
 await expect(x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})).rejects.toMatchObject({code:'TRAINING_NOW'})
 expect(x.puts()).toHaveLength(0)
})
it('generated MCP schemas advertise preview defaults and the compensation tool',async()=>{
 const x=api(),server=createMcpServer(createTools({env:x.env,fetcher:x.fetcher})),client=new Client({name:'schema-reader',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair()
 await server.connect(a);await client.connect(b);sessions.push({close:async()=>{await client.close();await server.close()}})
 const listed=(await client.listTools()).tools,max=listed.find(t=>t.name==='set_training_max')!,undo=listed.find(t=>t.name==='undo_training_max')!
 expect(max.inputSchema.properties?.apply).toMatchObject({type:'boolean',default:false})
 expect(max.inputSchema.properties?.preview_token).toMatchObject({type:'string',format:'uuid'})
 expect(max.inputSchema.required).toEqual(expect.arrayContaining(['cycle_id','lift','value','unit','expected_rev','expected_wid']))
 expect(undo.inputSchema.required).toContain('undo_token');expect(undo.inputSchema.properties?.apply).toMatchObject({default:false})
 expect(x.calls).toHaveLength(0)
})

it('a preview that expires during the fresh network preflight cannot authorize PUT',async()=>{
 const x=api(),preview=await x.call('set_training_max',x.params)
 x.behavior.beforeActivity=()=>x.advance(15*60000)
 await expect(x.call('set_training_max',{...x.params,apply:true,preview_token:preview.preview_token})).rejects.toMatchObject({code:'PREVIEW_REQUIRED'})
 expect(x.puts()).toHaveLength(0)
})
