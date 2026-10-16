import {expect,test} from 'bun:test'
import {dataServer} from './data-helpers'
import {getUser} from '../src/storage'
import {getDevice,listDevices} from '../src/storage/devices'
import {createApp} from '../src/app'
import {RequestBody} from '../src/http'
import {DAY} from './auth-helpers'

for(const carrier of ['bearer','cookie'] as const)test(`real HTTP ${carrier} agent cannot pair around active training, including admin ownership and renewal`,async()=>{
 const h=dataServer(['u1']);h.db.query('UPDATE users SET admin=1 WHERE id=?').run('u1')
 const u=getUser(h.db,'u1')!,browser=h.auth.mint(u,'browser'),agent=h.auth.mint(u,'agent')
 const headers=(token:string)=>({...carrier==='cookie'?{Cookie:'gymsid='+token}:{Authorization:'Bearer '+token},'Content-Type':'application/json'})
 const call=async(token:string|undefined,path:string,method='GET',body?:unknown)=>{
  const r=await fetch(h.api+path,{method,headers:token?headers(token):{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
  return {status:r.status,body:await r.json() as any,cookies:r.headers.getSetCookie()}
 }
 const put=(token:string,extra:Record<string,unknown>)=>{const got=h.data.get('u1');return call(token,'/api/data','PUT',{state:{unit:'kg',routines:[],workouts:[],...got.state,...extra},baseRev:got.rev,baseWid:got.state?._wid??null})}
 expect(h.auth.sessionOf(new Request('http://synthetic/',{headers:headers(agent)}))?.device.kind).toBe('agent')
 expect((await put(browser,{active:null})).status).toBe(200)
 expect((await put(agent,{note:'idle agent allowed'})).status).toBe(200)
 expect((await put(browser,{active:{id:'training',start:1000,entries:[]}})).status).toBe(200)
 const before=h.data.get('u1'),devices=listDevices(h.db,'u1').length
 expect((await put(agent,{note:'forbidden direct write'})).status).toBe(423)
 for(const [path,method] of [['/api/pair/create','POST'],['/api/admin/users','GET'],['/api/admin/invites/new','POST']] as const){
  const denied=await call(agent,path,method,method==='POST'?{}:undefined)
  expect(denied.status).toBe(403);expect(denied.body).toEqual({error:'forbidden'});expect(denied.cookies).toEqual([]);expect(denied.body.token).toBeUndefined()
 }
 const created=await call(browser,'/api/pair/create','POST',{});expect(created.status).toBe(200)
 const refused=await call(agent,'/api/pair/redeem','POST',{code:created.body.code})
 expect(refused.status).toBe(403);expect(refused.body.token).toBeUndefined();expect(refused.cookies).toEqual([])
 expect(listDevices(h.db,'u1')).toHaveLength(devices);expect(h.data.get('u1')).toEqual(before)
 const guarded=await call(agent,'/api/data/activity');expect(guarded.body).toEqual({status:'active'})
 expect((await call(undefined,'/api/data/activity')).status).toBe(401)
 const owner=await call(browser,'/api/data/activity');expect(owner.body.own.lease).toBeString();expect(owner.body.own.session).toMatch(/^[a-f0-9]{64}$/)
 expect(Object.keys(owner.body).sort()).toEqual(['own','status']);expect(JSON.stringify(owner.body)).not.toContain(browser);expect(JSON.stringify(owner.body)).not.toContain(agent)
 // The refused redemption did not consume the trusted browser's code. Independent
 // ordinary pairing remains supported; its carrier is not issued to the agent.
 const paired=await call(undefined,'/api/pair/redeem','POST',{code:created.body.code});expect(paired.status).toBe(200)
 expect(h.auth.sessionOf(new Request('http://synthetic/',{headers:headers(paired.body.token)}))?.device.kind).toBe('paired')
 expect((await put(paired.body.token,{note:'ordinary paired sync'})).status).toBe(200)
 expect((await put(browser,{note:'own browser sync'})).status).toBe(200)
 expect((await put(agent,{note:'forbidden after trusted pairing'})).status).toBe(423)
 expect(h.data.get('u1').state?.note).toBe('own browser sync')
 const agentId=agent.split('.')[1]!,deviceCount=listDevices(h.db,'u1').length
 h.clock.t+=46*DAY
 // Renewal is intentionally the bearer /me seam; cookie transport does not
 // echo renewed credentials. Both transports above exercised the same agent.
 const renewal=await fetch(h.api+'/api/me',{headers:{Authorization:'Bearer '+agent}})
 const renewed={status:renewal.status,body:await renewal.json() as any};expect(renewed.status).toBe(200);expect(renewed.body.token).toBeString()
 expect(renewed.body.token.split('.')[1]).toBe(agentId);expect(getDevice(h.db,agentId)?.kind).toBe('agent');expect(listDevices(h.db,'u1')).toHaveLength(deviceCount)
 // Renewed agents are fenced even while leases are unknown, and then active again.
 expect((await put(renewed.body.token,{note:'forbidden expired guard'})).status).toBe(423)
 expect((await call(browser,'/api/activity','POST',{active:true,sessionId:'training',startedAt:1000})).status).toBe(200)
 expect((await put(renewed.body.token,{note:'forbidden renewed write'})).status).toBe(423)
 expect((await call(renewed.body.token,'/api/pair/create','POST',{})).status).toBe(403)
 expect((await call(renewed.body.token,'/api/data/activity')).body.status).toBe('active');expect(h.data.get('u1').state?.note).toBe('own browser sync')
})

test('body-receipt revocation or browser-to-agent capability change cannot dispatch a composed guarded PUT',async()=>{
 for(const change of ['revoked','agent'] as const){
  const h=dataServer(['u1']),u=getUser(h.db,'u1')!,browser=h.auth.mint(u,'browser'),actor=h.auth.mint(u,'browser')
  const headers=(token:string)=>({Authorization:'Bearer '+token,'Content-Type':'application/json'})
  const seed=await fetch(h.api+'/api/data',{method:'PUT',headers:headers(browser),body:JSON.stringify({state:{unit:'kg',routines:[],workouts:[],active:{id:'training',start:1000}},baseRev:0,baseWid:null})});expect(seed.status).toBe(200)
  const before=h.data.get('u1'),request=new Request('http://synthetic/api/data',{method:'PUT',headers:headers(actor)})
  let started!:()=>void,release!:()=>void
  const reading=new Promise<void>(r=>{started=r}),ready=new Promise<void>(r=>{release=r})
  class DelayedBody extends RequestBody{
   override async receipt(){started();await ready}
   override async readJson(){return {state:{...before.state,note:'never committed'},baseRev:before.rev,baseWid:before.state!._wid}}
  }
  const app=createApp(h.auth.config,{auth:h.auth,data:h.data}),pending=app.fetch(request,{body:new DelayedBody(request,1000)})
  await reading
  if(change==='revoked')h.auth.revokeDevice(actor.split('.')[1]!,'u1')
  else h.db.query("UPDATE devices SET kind='agent' WHERE id=?").run(actor.split('.')[1]!)
  release();expect((await pending).status).toBe(change==='revoked'?401:423)
  expect(h.data.get('u1')).toEqual(before)
  const status=await fetch(h.api+'/api/data/activity',{headers:headers(browser)});expect((await status.json() as any).status).toBe('active')
 }
})
