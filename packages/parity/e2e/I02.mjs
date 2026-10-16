#!/usr/bin/env bun
// Operator phases for the leased :8198 rehearsal. Raw real-data evidence stays
// in a private scratch directory; only aggregate results may enter the repo.
import fs from 'node:fs'
import { join } from 'node:path'
import { createHmac, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { fixture } from './fixture.mjs'
import { containedFile } from '../../server/src/migration/safety.ts'

process.umask(0o077)
const root = process.env.I02_ROOT || '/private/tmp/opengym-i02-slot'
assert(root.startsWith('/private/tmp/opengym-'), 'dedicated private scratch required')
const data = join(root, process.env.I02_DATA || 'data'), phase = process.argv[2]
const origin=process.env.I02_ORIGIN || 'http://127.0.0.1:8198'
assert(['http://127.0.0.1:8198','http://localhost:8198'].includes(origin),'leased origins only')
assert(fs.realpathSync(root) === root && fs.realpathSync(data).startsWith(root + '/'), 'scratch must not escape via aliases')
assert((fs.statSync(root).mode & 0o777) === 0o700, 'scratch root must be private')
const accounts = () => JSON.parse(fs.readFileSync(containedFile(data, 'db.json'), 'utf8'))
const user = () => accounts().users.find(u => u.id !== 'I02Synthetic')
const sign = u => {
  const payload = `${u.id}:${Date.now() + 86400000}:${u.sv || 0}`
  return payload + '.' + createHmac('sha256', fs.readFileSync(containedFile(data, 'secret'), 'utf8').trim()).update(payload).digest('base64url')
}
const hash = b => createHash('sha256').update(b).digest('hex')
const privateWrite = (name, v) => fs.writeFileSync(containedFile(root, name), typeof v === 'string' ? v : JSON.stringify(v, null, 2), { mode: 0o600 })
async function api(path = '/api/data', method = 'GET', body, synthetic = false) {
  const u = synthetic ? accounts().users.find(u => u.id === 'I02Synthetic') : user()
  const res = await fetch(origin + path, { method, headers: { Authorization: 'Bearer ' + sign(u), Origin: origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const raw = await res.text()
  assert.equal(res.status, 200, `${method} ${path}: ${res.status}`)
  return { raw, value: JSON.parse(raw) }
}
function agent(...args) {
  const out = execFileSync('agent-browser', ['--session', 'i02', '--json', ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 8e6 })
  const result = JSON.parse(out.trim().split('\n').findLast(l => l.startsWith('{')))
  assert(result.success, result.error)
  return result.data
}
const ev = s => agent('eval', s).result
const wait = async (f, label) => { for (let i = 0; i < 100; i++) { if (await f()) return; await Bun.sleep(200) }; throw new Error('timeout: ' + label) }
const click = text => {
  const refs = agent('snapshot', '-i', '-c').refs
  const buttons = Object.entries(refs).filter(([,r]) => r.role === 'button')
  const exact = buttons.filter(([,r]) => r.name === text)
  const matches = exact.length ? exact : buttons.filter(([,r]) => r.name.startsWith(text + ' '))
  matches.sort(([a],[b]) => +a.slice(1)-+b.slice(1))
  assert(matches.length, 'button ' + text)
  agent('click', '@' + matches.at(-1)[0])
}
const start = performance.now()
let result
if (phase === 'seed') {
  assert(!fs.existsSync(containedFile(data,'opengym.db')), 'never seed SQLite-owned data')
  const a = accounts()
  assert(!a.subs?.length && !fs.existsSync(join(data, 'vapid.json')), 'push must be removed before first start')
  if (!a.users.some(u => u.id === 'I02Synthetic')) {
    a.users.push({ id: 'I02Synthetic', name: 'I02 Synthetic', created: new Date().toISOString(), admin: false, sv: 0 })
    for (const name of ['db.json', 'db.json.bak']) fs.writeFileSync(containedFile(data,name),JSON.stringify(a,null,2),{mode:0o600})
    fs.writeFileSync(containedFile(data,'state-I02Synthetic.json'),JSON.stringify({...fixture, week:Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,'i01-routine'])), _rev:0}),{mode:0o600})
  }
  result = { syntheticAdded: true }
} else if (phase === 'baseline' || phase === 'compare') {
  const got = await api()
  if (phase === 'baseline') privateWrite('legacy-get.json', got.raw)
  else assert(got.raw === fs.readFileSync(containedFile(root,'legacy-get.json'),'utf8'), 'legacy/new GET must be byte-identical')
  result = { byteEqual: phase === 'compare', bytes: Buffer.byteLength(got.raw), sha256: hash(got.raw), rev:got.value.rev }
} else if (phase === 'synthetic-schedule') {
  const got=(await api('/api/data','GET',undefined,true)).value
  got.state.week=Object.fromEntries([0,1,2,3,4,5,6].map(d=>[d,'i01-routine']))
  await api('/api/data','PUT',{state:got.state,baseRev:got.rev},true)
  result={allDaysScheduled:true}
} else if (phase === 'browser-login') {
  const u = accounts().users.find(u => u.id === 'I02Synthetic'), token = sign(u)
  agent('cookies','set','gymsid',token,'--url',origin,'--expires',String(Math.floor(Date.now()/1000)+86400))
  const doc=(await api('/api/data','GET',undefined,true)).value.state
  ev(`localStorage.setItem('gym_owner','I02Synthetic');localStorage.setItem('gym_state_owner','I02Synthetic');localStorage.setItem('gym_state_v1',${JSON.stringify(JSON.stringify(doc))});localStorage.removeItem('gym_dirty');localStorage.removeItem('gym_auth_transaction');true`)
  agent('reload')
  agent('open',origin+'/#/home')
  await wait(()=>ev('document.body.textContent').includes('I01 offline workout'),'synthetic fixture loaded')
  result = { syntheticAuthenticated: true }
} else if (phase === 'persist-browser-cookie') {
  const u=accounts().users.find(u=>u.id==='I02Synthetic')
  agent('cookies','set','gymsid',sign(u),'--url',origin,'--expires',String(Math.floor(Date.now()/1000)+86400))
  assert(ev('(async()=>(await fetch("/api/me")).status)()')===200,'persistent fixture cookie accepted')
  result={persistentCarrier:true,readStatus:200}
} else if (phase === 'workout') {
  const before = (await api('/api/data','GET',undefined,true)).value.state.workouts.length
  agent('open',origin+'/')
  agent('set','offline','on')
  agent('click','.today-row')
  await wait(()=>ev('!!JSON.parse(localStorage.getItem("gym_state_v1")).active'),'workout start')
  agent('fill','.setrow .stp.w input','42.5');agent('fill','.setrow .stp.r input','6')
  agent('click','[aria-label="Set 1 done"]');await Bun.sleep(350);click('Finish workout')
  const offline = ev('JSON.parse(localStorage.getItem("gym_state_v1"))')
  assert.equal(offline.workouts.length,before+1)
  assert.equal((await api('/api/data','GET',undefined,true)).value.state.workouts.length,before)
  agent('set','offline','off');agent('reload')
  await wait(async()=> (await api('/api/data','GET',undefined,true)).value.state.workouts.length===before+1,'workout sync')
  const saved=(await api('/api/data','GET',undefined,true)).value.state.workouts.at(-1)
  assert(saved.entries[0].sets[0].done && saved.entries[0].sets[0].w===42.5 && saved.entries[0].sets[0].r===6)
  result={ offlineCompleted:true, synced:true, workouts:before+1 }
} else if (phase === 'v2-renew') {
  const u=accounts().users.find(u=>u.id==='I02Synthetic')
  const response=await fetch(origin+'/api/me',{headers:{Authorization:'Bearer '+sign(u)}})
  assert(response.status===200,'legacy bearer accepted for renewal')
  const body=await response.json();assert(body.token?.startsWith('v2.'),'v2 renewal issued')
  const read=await fetch(origin+'/api/data',{headers:{Authorization:'Bearer '+body.token}})
  assert(read.status===200,'renewed v2 carrier reads state')
  privateWrite('v2-token.txt',body.token)
  result={legacyBearerAccepted:true,v2Issued:true,renewedReadStatus:200}
} else if (phase === 'v2-refused') {
  const token=fs.readFileSync(containedFile(root,'v2-token.txt'),'utf8')
  const response=await fetch(origin+'/api/me',{headers:{Authorization:'Bearer '+token}})
  assert(response.status===401,'legacy must refuse v2 carrier')
  result={legacyRefusesV2:true,status:401}
} else if (phase === 're-pair') {
  const code=(await api('/api/pair/create','POST',{},true)).value.code
  const response=await fetch(origin+'/api/pair/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})})
  assert(response.status===200,'pair redemption succeeds')
  const body=await response.json();assert(typeof body.token==='string','paired carrier issued')
  const read=await fetch(origin+'/api/data',{headers:{Authorization:'Bearer '+body.token}})
  assert(read.status===200,'paired carrier reads state')
  result={paired:true,readStatus:200,v2:body.token.startsWith('v2.')}
} else if (phase === 'no-op') {
  const got=(await api()).value
  const response=(await api('/api/data','PUT',{state:got.state,baseRev:got.rev,stamped:true})).value
  result={putStatus:200,revisionAdvanced:response.rev===got.rev+1}
} else if (phase === 'B-before') {
  privateWrite('B-definitions.json',(await api()).value.state.programmes.definitions)
  result={snapshotSaved:true}
} else if (phase === 'post-B') {
  const got=(await api()).value,doc=got.state,at=Date.now()
  const id='i02-after-B-'+at;privateWrite('post-B-id.txt',id)
  doc.workouts.push({id,name:'I02 after offload',d:'2026-10-13',start:at,end:at+1000,entries:[{id:'0025',sets:[{w:47.5,r:7,done:true}]}],_ts:at})
  await api('/api/data','PUT',{state:doc,baseRev:got.rev,stamped:true})
  result={postOffloadWorkoutWritten:true}
} else if (phase === 'B-after') {
  const doc=(await api()).value.state,old=JSON.parse(fs.readFileSync(containedFile(root,'B-definitions.json'),'utf8'))
  assert(JSON.stringify(doc.programmes.definitions)===JSON.stringify(old),'reinstall restores authored definitions and ordering')
  const id=fs.readFileSync(containedFile(root,'post-B-id.txt'),'utf8')
  assert(doc.workouts.some(w=>w.id===id && w.entries[0].sets[0].w===47.5),'post-B workout preserved')
  result={definitionsEqual:true,newWorkoutPreserved:true,definitions:old.length,manifestRetainedForConvergence:!!doc.programmes.offloaded}
} else if (phase === 'week') {
  const outputs=[]
  for (let day=0;day<7;day++) {
    const got=(await api()).value, doc=structuredClone(got.state), at=Date.parse('2026-10-14T17:00:00Z')+day*86400000
    doc.workouts.push({id:`i02-week-${day}`,name:'I02 synthetic week',d:new Date(at).toISOString().slice(0,10),start:at,end:at+1800000,entries:[{id:'0025',sets:[{w:40+day,r:5,done:true}]}],_ts:at})
    const response=(await api('/api/data','PUT',{state:doc,baseRev:got.rev,stamped:true})).value
    outputs.push({status:200,rev:response.rev})
  }
  const doc=(await api()).value.state
  const raw=JSON.stringify(doc);privateWrite(`week-${process.env.I02_KIND}.json`,raw)
  if(process.env.I02_KIND==='new'){
    const old=JSON.parse(fs.readFileSync(containedFile(root,'week-legacy.json'),'utf8'))
    // Normalize values, preserving ancestry cardinality, order, duplicates and
    // relationships to the initial writer history and latest writer.
    const baseline=JSON.parse(fs.readFileSync(containedFile(root,'legacy-get.json'),'utf8')).state
    const originals=new Set([baseline._wid,...(baseline._wids||[])])
    for(const v of [old,doc]){
      const generated=new Map();const normalize=id=>originals.has(id)?id:generated.has(id)?generated.get(id):(generated.set(id,'generated-'+generated.size),generated.get(id))
      v._wids=v._wids.map(normalize);v._wid=normalize(v._wid)
    }
    assert(JSON.stringify(doc)===JSON.stringify(old),'synthetic week equality including clocks, order and unknown fields')
  }
  result={ days:7,workoutsAdded:7,responses:outputs,byteEqualAfterWriterIdNormalization:process.env.I02_KIND==='new' }
} else if (phase === 'sw') {
  result=ev('(async()=>({controller:!!navigator.serviceWorker.controller,caches:await caches.keys(),scripts:[...document.scripts].filter(s=>s.src).map(s=>new URL(s.src).pathname),state:!!localStorage.getItem("gym_state_v1")}))()')
} else if (phase === 'mirror') {
  const db=new Database(containedFile(data,'opengym.db'),{readonly:true})
  for(const row of db.query('SELECT profile_id,json FROM state_docs').all())assert(row.json===fs.readFileSync(containedFile(data,`state-${row.profile_id}.json`),'utf8'),'SQLite mirror bytes equal')
  assert.equal(db.query('PRAGMA integrity_check').get().integrity_check,'ok');db.close()
  result={ mirrorsEqual:true,integrity:'ok' }
} else throw new Error('unknown I02 phase')
const report={phase,seconds:+((performance.now()-start)/1000).toFixed(3),...result}
privateWrite(`${phase}-${process.env.I02_KIND || 'current'}-result.json`,report)
console.log(JSON.stringify(report))
