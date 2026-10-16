#!/usr/bin/env bun
// Requires the granted I02 slot and an already authenticated persistent profile.
// Deliberately never discovers or operates any live container/data location.
import fs from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { containedFile } from '../../server/src/migration/safety.ts'
assert(process.argv.includes('--lease-granted'), 'explicit Stack Manager grant required')
process.umask(0o077)
const root='/private/tmp/opengym-i02-slot', data=join(root,'data'), records=[]
const authLeg=process.argv.includes('--auth-leg'), script=join(import.meta.dir,'I02.mjs'), origin=authLeg?'http://localhost:8198':'http://127.0.0.1:8198'
process.env.I02_ORIGIN=origin
assert(fs.realpathSync(root)===root && (fs.statSync(root).mode&0o777)===0o700)
function run(argv) { return execFileSync(argv[0],argv.slice(1),{encoding:'utf8',timeout:60000,maxBuffer:8e6}) }
async function step(name, fn) {
  const start=performance.now(), result=await fn()
  const item={name,seconds:+((performance.now()-start)/1000).toFixed(3),result:result??true}
  records.push(item);console.log(JSON.stringify(item));fs.writeFileSync(containedFile(root,'timed-cycle.json'),JSON.stringify(records,null,2),{mode:0o600})
}
const docker=(...args)=>run(['docker',...args])
const helper=phase=>JSON.parse(run(['bun',script,phase]).trim())
function migrate(command, flags=[]) {
  const raw=run(['bun','packages/server/src/cli/migrate.ts',command,'--data',data,'--scratch',root,...flags])
  fs.writeFileSync(containedFile(root,`cycle-${command.replaceAll(':','-')}-${records.length}.json`),raw,{mode:0o600})
  return JSON.parse(raw)
}
async function ready() {
  for(let i=0;i<100;i++){try{const r=await fetch(origin+'/api/health');if(r.ok && (await r.json()).ok)return}catch{}await Bun.sleep(200)}
  throw new Error('leased frontend API readiness timeout')
}
function startApi(kind) {
  return docker('run','-d','--name','opengym-rw-i02-api','--network','opengym-rw-i02','--network-alias','api','-p','127.0.0.1:8197:3000','-v',data+':/data','-e','ORIGIN='+origin,'-e','RP_ID='+new URL(origin).hostname,'-e','DEVICE_TOKENS=1','-e','OFFLOAD_RULE=0',kind==='legacy'?'opengym-api:wilky-a2f2daca':'opengym-rw-api:i02')
}
function startWeb(kind) {docker('run','-d','--name','opengym-rw-i02-web','--network','opengym-rw-i02','-p','127.0.0.1:8198:80','-e','BACKEND=api',kind==='legacy'?'opengym-web:wilky-a2f2daca':'opengym-rw-web:i02')}
const agent=(...args)=>run(['agent-browser','--session','i02',...args])
const agentJson=(...args)=>JSON.parse(agent('--json',...args)).data
const evaluate=source=>agentJson('eval',source).result
const click=text=>{
  const refs=agentJson('snapshot','-i','-c').refs
  const buttons=Object.entries(refs).filter(([,r])=>r.role==='button')
  const exact=buttons.filter(([,r])=>r.name===text)
  const matches=exact.length?exact:buttons.filter(([,r])=>r.name.startsWith(text+' '))
  matches.sort(([a],[b])=>+a.slice(1)-+b.slice(1))
  assert(matches.length,'button '+text);agent('click','@'+matches.at(-1)[0]);agent('wait','250')
}
async function until(fn,label){for(let i=0;i<100;i++){if(fn())return;await Bun.sleep(150)}throw new Error('timeout: '+label)}
const localSnapshot=()=>evaluate('JSON.parse(localStorage.getItem("gym_state_v1")).workouts.map(w=>({id:w.id,entries:w.entries}))')
async function updateBrowser(kind,before) {
  assert(Array.isArray(before),'snapshot must precede the image swap')
  agent('open',origin+'/')
  const sw=docker('exec','opengym-rw-i02-web','cat','/usr/share/nginx/html/sw.js')
  const expected=sw.match(/const CACHE = '([^']+)'/)[1]
  const html=docker('exec','opengym-rw-i02-web','cat','/usr/share/nginx/html/index.html')
  const main=html.match(/<script[^>]+src="([^"]+)"/)[1]
  agent('eval','(async()=>{const r=await navigator.serviceWorker.register("/sw.js");await r.update();return true})()')
  await until(()=>evaluate(`(async()=>{const r=await navigator.serviceWorker.getRegistration();return !r.installing&&!r.waiting&&(await caches.keys()).includes(${JSON.stringify(expected)})&&!!await(await caches.open(${JSON.stringify(expected)})).match('index.html')})()`),'complete worker installation')
  agent('reload')
  const scripts=evaluate('[...document.scripts].filter(s=>s.src).map(s=>new URL(s.src).pathname)')
  assert(scripts.includes(new URL(main,origin+'/').pathname),'page loaded expected production bundle')
  const after=evaluate('JSON.parse(localStorage.getItem("gym_state_v1"))')
  for(const old of before)assert(after.workouts.some(w=>w.id===old.id&&JSON.stringify(w.entries)===JSON.stringify(old.entries)),'local logged sets survive the transition')
  assert(after.futureTop.preserved,'unknown local field survives')
  return {workerComplete:true,kind,loggedWorkoutsPreserved:before.length}
}
async function reauth(v2) {
  agent('open',origin+'/#/settings/account')
  if(evaluate('document.body.textContent').includes('Sign out')){click('Sign out');click('Sign out')}
  await until(()=>evaluate('document.body.textContent').includes('Sign in with passkey'),'sign-in screen')
  click('Sign in with passkey')
  await until(()=>evaluate('document.body.textContent').includes('Hi I02 Recovery'),'passkey recovery')
  const cookie=agentJson('cookies','get').cookies.find(c=>c.name==='gymsid')
  assert(cookie && cookie.value.startsWith('v2.')===v2,'expected phone carrier version')
  return {passkeyLogin:true,v2}
}
// CDP supplies only the software authenticator. All app actions use agent-browser.
let ws
if(authLeg){
const pages=await(await fetch('http://127.0.0.1:8196/json/list')).json()
ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);const pending=new Map();let sequence=0
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject})
ws.onmessage=e=>{const v=JSON.parse(e.data);if(v.id){const p=pending.get(v.id);pending.delete(v.id);clearTimeout(p?.timer);v.error?p.reject(new Error('CDP failed')):p.resolve(v.result)}}
const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout'))},5000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}))})
await cdp('WebAuthn.enable')
await cdp('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})
await step('register-recovery-passkey',async()=>{
  helper('browser-login');agent('open',origin+'/#/settings/account');click('Sign out');click('Sign out')
  click('Create new profile');agent('find','placeholder','Your name','fill','I02 Recovery');click('Create passkey')
  await until(()=>evaluate('document.body.textContent').includes('Hi I02 Recovery'),'passkey registered')
  return {registered:true}
})
}
else helper('browser-login')
async function rollbackA() {
  const before=authLeg?null:localSnapshot()
  docker('stop','opengym-rw-i02-api')
  const report=migrate('rollback:prepare',['--apply']);assert(report.verified && report.writeOwner==='legacy')
  docker('rm','-f','opengym-rw-i02-api','opengym-rw-i02-web');startApi('legacy');startWeb('legacy');await ready()
  agent('tab','0');agent('set','offline','off')
  const login=authLeg?await reauth(false):await updateBrowser('legacy',before)
  return {verified:true,legacyBooted:true,...login}
}
async function refused() {
  docker('rm','-f','opengym-rw-i02-api');startApi('new')
  let state
  for(let i=0;i<100;i++){state=JSON.parse(docker('inspect','opengym-rw-i02-api'))[0].State;if(!state.Running)break;await Bun.sleep(100)}
  assert(state.ExitCode!==0&&!state.Running,'new API refuses legacy ownership')
  const logs=spawnSync('docker',['logs','opengym-rw-i02-api'],{encoding:'utf8'})
  assert((logs.stdout+logs.stderr).includes('LEGACY_WRITES_DETECTED'))
  docker('rm','opengym-rw-i02-api');return {refused:true}
}
async function forwardA() {
  const before=authLeg?null:localSnapshot()
  const report=migrate('import',['--apply','--reconcile']);assert(report.reconciled && report.accountsEqual && report.profiles.every(p=>p.equal))
  startApi('new');docker('rm','-f','opengym-rw-i02-web');startWeb('new');await ready();if(!authLeg)await updateBrowser('new',before)
  return {reconciled:true,legacyWorkoutCount:JSON.parse(run(['agent-browser','--session','i02','--json','eval','JSON.parse(localStorage.getItem("gym_state_v1")).workouts.length'])).data.result,integrity:helper('mirror').integrity}
}
if(authLeg){
 await step('auth-cutover-A',async()=>{docker('rm','-f','opengym-rw-i02-api');startApi('new');await ready();return reauth(true)})
 await step('v2-agent-renewal',()=>helper('v2-renew'))
 await step('auth-rollback-A',rollbackA)
 await step('v2-carrier-refused-by-legacy',()=>helper('v2-refused'))
 await step('legacy-agent-repair',()=>helper('re-pair'))
 await step('auth-boot-before-reconcile-refused',refused)
 await step('auth-re-upgrade',forwardA)
 await step('auth-phone-re-login',()=>reauth(true))
 ws.close();console.log('I02 supplemental auth leg: PASS');process.exit(0)
}
await step('rollback-A',rollbackA)
await step('legacy-workout-after-rollback',()=>{helper('persist-browser-cookie');return helper('workout')})
await step('boot-before-reconcile-refused',refused)
await step('cutover-A-again',forwardA)
if(authLeg)await step('new-phone-passkey-login',()=>reauth(true))
await step('v2-agent-renewal',()=>helper('v2-renew'))
await step('cutover-B',()=>{
  helper('B-before');docker('stop','opengym-rw-i02-api')
  const uid=JSON.parse(fs.readFileSync(containedFile(data,'db.json'),'utf8')).users.find(u=>u.id!=='I02Synthetic').id
  const preview=migrate('library:offload',['--profile',uid,'--dry-run']), report=migrate('library:offload',['--profile',uid,'--apply'])
  assert(preview.moved.length===report.moved.length && !report.mirrorWarning);docker('start','opengym-rw-i02-api')
  return {moved:report.moved.length,protected:report.protectedIds.length,bytes:report.bytes}
})
await ready();await step('workout-after-B',()=>helper('post-B'))
await step('rollback-B',async()=>{
  docker('stop','opengym-rw-i02-api')
  const uid=JSON.parse(fs.readFileSync(containedFile(data,'db.json'),'utf8')).users.find(u=>u.id!=='I02Synthetic').id
  const preview=migrate('library:reinstall',['--profile',uid,'--preflight']), report=migrate('library:reinstall',['--profile',uid,'--apply'])
  assert(!report.mirrorWarning);docker('start','opengym-rw-i02-api');await ready()
  const proof=helper('B-after');return {preflightBytes:preview.bytes,requestBytes:preview.requestBytes,...proof}
})
await step('code-rollback-after-B',rollbackA)
await step('v2-carrier-refused-by-legacy',()=>helper('v2-refused'))
await step('legacy-agent-repair',()=>helper('re-pair'))
await step('second-legacy-workout',()=>{helper('persist-browser-cookie');return helper('workout')})
await step('second-boot-before-reconcile-refused',refused)
await step('cutover-A-third-time',forwardA)
await step('new-agent-repair',()=>helper('re-pair'))
ws?.close()
console.log('I02 timed persistent-profile cutover cycle: PASS')
