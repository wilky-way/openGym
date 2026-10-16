import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { dataServer } from './data-helpers'
import { user } from './helpers'
import { TRAINING_HEARTBEAT_MS, trainingStatus } from '../src/training-guard'

test('durable device activity gates agents atomically, expiry stays unknown, scoped finish closes only its owner', async () => {
  const h = dataServer(['u1']), u = user('u1')
  const browser = h.auth.mint(u,'browser'), paired = h.auth.mint(u,'paired'), agent = h.auth.mint(u,'agent')
  const call = async (token: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(h.api + path, {method, headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)})})
    return {status:r.status,body:await r.json() as any}
  }
  const put = async (token: string, extra: any = {}, conditional = true) => {
    const got = h.data.get('u1'), state = {...got.state, routines:[], workouts:[], ...extra}
    return call(token,'PUT','/api/data',{state,...(conditional ? {baseRev:got.rev,baseWid:got.state?._wid ?? null} : {})})
  }
  assert.equal((await put(agent)).body.guardStatus,'unknown')
  assert.equal((await put(browser,{active:null})).status,200)
  assert.equal((await put(agent)).status,200)
  assert.equal((await put(browser,{active:{id:'a',start:100,secret:'never stored',entries:[{private:true}]}})).status,200)
  assert.equal('active' in h.data.get('u1').state!,false)
  assert.ok(!JSON.stringify(h.db.query('SELECT * FROM meta').all()).includes('never stored'))
  assert.equal((await put(agent,{active:null})).body.code,'TRAINING_NOW')
  // Peers and omission cannot clear an active owner.
  await put(paired,{active:null}); await put(browser)
  assert.equal((await put(agent)).status,423)
  const old = await call(browser,'GET','/api/data/activity')
  await put(browser,{active:{id:'b',start:200}})
  await put(browser,{active:null,workouts:[{id:'a',start:100}]})
  assert.equal((await put(agent)).status,423)
  // Lease from A cannot clear B, even at the current document revision.
  let got = h.data.get('u1')
  assert.equal((await call(browser,'PUT','/api/data',{state:{...got.state,active:null},baseRev:got.rev,baseWid:got.state!._wid,trainingClose:old.body.own})).status,200)
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'active')
  h.clock.t += TRAINING_HEARTBEAT_MS + 1
  assert.equal((await put(agent)).body.guardStatus,'unknown')
  await call(browser,'POST','/api/activity',{active:false,reason:'closed'})
  assert.equal((await put(agent)).body.guardStatus,'unknown')
  await call(browser,'POST','/api/activity',{active:true,startedAt:200})
  assert.equal((await put(agent)).body.code,'TRAINING_NOW')
  const stale = h.data.get('u1')
  await put(browser,{active:{id:'c',start:300}})
  assert.equal((await call(browser,'PUT','/api/data',{state:{...stale.state,active:null},baseRev:stale.rev,baseWid:stale.state!._wid})).status,409)
  await call(browser,'POST','/api/activity',{active:true,startedAt:200})
  await put(browser,{active:null,workouts:[{id:'a',start:100},{id:'b',start:200},{id:'c',start:300}]})
  assert.equal((await put(agent)).status,200)
  // A heartbeat alone also blocks before the first document push.
  await call(paired,'POST','/api/activity',{active:true,startedAt:400})
  assert.equal((await put(agent)).status,423)
  // Cookie carrier of a device credential has exactly the same ownership.
  const r = await fetch(h.api+'/api/data/activity',{headers:{Cookie:'gymsid='+paired}})
  assert.equal(r.status,200)
  assert.equal((await r.json() as any).status,'active')
  assert.equal((await call('', 'PUT','/api/data',{state:{routines:[]}})).status,401)
})

test('explicit close needs exact lease, session, rev and wid; failed writes roll activity back', async () => {
  const h = dataServer(['u1']), token = h.auth.mint(user('u1'),'browser')
  const headers = {Authorization:'Bearer '+token,'Content-Type':'application/json'}
  const request = async (body: any) => fetch(h.api+'/api/data',{method:'PUT',headers,body:JSON.stringify(body)})
  await request({state:{routines:[],active:{id:'a',start:100}}})
  const got = h.data.get('u1'), own = await fetch(h.api+'/api/data/activity',{headers}).then(r=>r.json()) as any
  assert.equal((await request({state:{...got.state,active:null},baseRev:got.rev,baseWid:'wrong',trainingClose:own.own})).status,409)
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'active')
  assert.equal((await request({state:{...got.state,active:null},baseRev:got.rev,baseWid:got.state!._wid,trainingClose:own.own})).status,200)
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'idle')
})

test('markers survive fresh DB connections, revoked devices, and rollback of failed documents', async () => {
  const h = dataServer(['u1']), token = h.auth.mint(user('u1'),'browser')
  const headers = {Authorization:'Bearer '+token,'Content-Type':'application/json'}
  const put = async (body: unknown) => fetch(h.api+'/api/data',{method:'PUT',headers,body:JSON.stringify(body)})
  await put({state:{routines:[],workouts:[],active:{id:'a',start:100}}})
  const {openDb} = await import('../src/storage/db'), {join} = await import('node:path')
  const db = openDb(join(h.dataDir,'opengym.db'))
  try {assert.equal(trainingStatus(db,'u1',h.clock.t),'active')} finally {db.close()}
  const s = h.auth.sessionOf(new Request('http://synthetic/',{headers}))!
  h.auth.revokeDevice(s.device.id,'u1')
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'active')
  assert.equal((await put({state:{routines:[],active:null},baseRev:h.data.rev('u1').rev,baseWid:h.data.rev('u1').wid})).status,401)
  const other = h.auth.mint(user('u1'),'paired'), session = h.auth.sessionOf(new Request('http://synthetic/',{headers:{Authorization:'Bearer '+other}}))!
  const before = h.data.get('u1')
  const tooLarge = 'x'.repeat(6*1024*1024)
  assert.throws(()=>h.data.compareAndWrite('u1',{state:{...before.state,active:{id:'b',start:200},tooLarge},baseRev:before.rev,baseWid:before.state!._wid},session))
  // Failed write must not leave another device's marker behind.
  const entries = JSON.parse(h.db.query<{value:string},[string]>('SELECT value FROM meta WHERE key=?').get('training_guard:u1')!.value)
  assert.equal(entries.filter((m: any)=>m.status==='active').length,1);assert.equal(entries.find((m: any)=>m.status==='active').device,s.device.id)
  assert.deepEqual(h.data.get('u1'),before)
})

test('a non-agent carrier can opt into the same atomic guard, and agents cannot use unconditional PUT', async () => {
  const h=dataServer(['u1']), browser=h.auth.mint(user('u1'),'browser'), agent=h.auth.mint(user('u1'),'agent')
  const put=async(token: string,body: unknown)=>fetch(h.api+'/api/data',{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)})
  await put(browser,{state:{routines:[],workouts:[],active:null},baseRev:0,baseWid:null})
  const got=h.data.get('u1')
  assert.equal((await put(agent,{state:got.state})).status,409)
  await fetch(h.api+'/api/activity',{method:'POST',headers:{Authorization:'Bearer '+browser,'Content-Type':'application/json'},body:JSON.stringify({active:true,startedAt:100})})
  assert.equal((await put(browser,{state:got.state,baseRev:got.rev,baseWid:got.state!._wid,requireIdle:true})).status,423)
  const status=await fetch(h.api+'/api/data/activity',{headers:{Authorization:'Bearer '+agent}}).then(r=>r.json()) as any
  assert.equal(status.status,'active');assert.equal('own' in status,false)
})

test('corrupt marker metadata remains unknown and readable, and agent bodies cannot spoof close or idle', async()=>{
  const h=dataServer(['u1']),agent=h.auth.mint(user('u1'),'agent')
  h.db.query('INSERT INTO meta(key,value) VALUES(?,?)').run('training_guard:u1','{"corrupt":true}')
  const headers={Authorization:'Bearer '+agent,'Content-Type':'application/json'}
  const read=await fetch(h.api+'/api/data/activity',{headers})
  assert.equal(read.status,200);assert.equal((await read.json() as any).status,'unknown')
  const r=await fetch(h.api+'/api/data',{method:'PUT',headers,body:JSON.stringify({state:{routines:[],active:null},baseRev:0,baseWid:null,trainingClose:{lease:'spoof',session:null},requireIdle:false})})
  assert.equal(r.status,423);assert.equal((await r.json() as any).guardStatus,'unknown')
  const browser=h.auth.mint(user('u1'),'browser')
  const synced=await fetch(h.api+'/api/data',{method:'PUT',headers:{...headers,Authorization:'Bearer '+browser},body:JSON.stringify({state:{routines:[],workouts:[],active:null},baseRev:0,baseWid:null})})
  assert.equal(synced.status,200);assert.equal(trainingStatus(h.db,'u1',h.clock.t),'unknown')
})

test('normal discard confirms only its own exact session, including expired leases; late heartbeats cannot reopen it', async()=>{
  const h=dataServer(['u1','u2']),browser=h.auth.mint(user('u1'),'browser'),peer=h.auth.mint(user('u1'),'paired'),agent=h.auth.mint(user('u1'),'agent')
  const activity=async(token: string,body: unknown)=>fetch(h.api+'/api/activity',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)})
  await activity(browser,{active:true,sessionId:'s100',startedAt:100})
  await activity(peer,{active:false,reason:'discarded',profileId:'u1',sessionId:'s100',startedAt:100})
  await activity(agent,{active:false,reason:'discarded',profileId:'u1',sessionId:'s100',startedAt:100})
  await activity(browser,{active:false,reason:'discarded',profileId:'u2',sessionId:'s100',startedAt:100})
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'active')
  await activity(browser,{active:true,sessionId:'s200',startedAt:200})
  await activity(browser,{active:false,reason:'discarded',profileId:'u1',sessionId:'s100',startedAt:100})
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'active')
  h.clock.t+=TRAINING_HEARTBEAT_MS+1
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'unknown')
  await activity(browser,{active:false,reason:'discarded',profileId:'u1',sessionId:'s200',startedAt:200})
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'idle')
  await activity(browser,{active:true,sessionId:'s200',startedAt:200})
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'idle')
  await activity(peer,{active:true,sessionId:'s300',startedAt:300})
  await activity(browser,{active:false,reason:'discarded',profileId:'u1',sessionId:'s300',startedAt:300})
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'active')
})

test('same-start sessions and clock rollback keep separate device/session guards, so stale close cannot authorize writes',async()=>{
  const h=dataServer(['u1']),browser=h.auth.mint(user('u1'),'browser')
  const activity=async(sessionId: string,startedAt: number,active=true)=>fetch(h.api+'/api/activity',{method:'POST',headers:{Authorization:'Bearer '+browser,'Content-Type':'application/json'},body:JSON.stringify({active,reason:active ? undefined:'discarded',profileId:'u1',sessionId,startedAt})})
  await activity('a',100);await activity('b',100)
  await activity('a',100,false)
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'active')
  await activity('a',100);await activity('b',100,false)
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'idle')
  await activity('clock-rollback',50)
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'active')
  await activity('b',100,false)
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'active')
  await activity('clock-rollback',50,false)
  assert.equal(trainingStatus(h.db,'u1',h.clock.t),'idle')
})

test('ambiguous legacy activity stays fenced until a trusted own lease close, never a guessed timestamp finish',async()=>{
  const h=dataServer(['u1']),browser=h.auth.mint(user('u1'),'browser'),headers={Authorization:'Bearer '+browser,'Content-Type':'application/json'}
  await fetch(h.api+'/api/activity',{method:'POST',headers,body:JSON.stringify({active:true,startedAt:100})})
  const put=async(proof?: unknown)=>{
    const got=h.data.get('u1')
    return fetch(h.api+'/api/data',{method:'PUT',headers,body:JSON.stringify({state:{...got.state,routines:[],workouts:[{id:'not-proven',start:100}],active:null},baseRev:got.rev,baseWid:got.state?._wid ?? null,trainingClose:proof})})
  }
  await put();assert.equal(trainingStatus(h.db,'u1',h.clock.t),'active')
  h.clock.t+=TRAINING_HEARTBEAT_MS+1
  const read=await fetch(h.api+'/api/data/activity',{headers}).then(r=>r.json()) as any
  assert.equal(read.status,'unknown')
  await put(read.own);assert.equal(trainingStatus(h.db,'u1',h.clock.t),'idle')
})
