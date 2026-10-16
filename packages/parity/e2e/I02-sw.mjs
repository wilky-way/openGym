#!/usr/bin/env bun
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { containedFile } from '../../server/src/migration/safety.ts'
assert(process.argv.includes('--lease-granted'),'Stack Manager grant required')
process.umask(0o077)
const root='/private/tmp/opengym-i02-slot',dist=join(root,'context/dist'),origin='http://127.0.0.1:8198'
assert(fs.realpathSync(root)===root&&(fs.statSync(root).mode&0o777)===0o700)
function directory(path){assert(path.startsWith(root+'/')&&fs.realpathSync(path)===path,'private directory alias refused');containedFile(root,path.slice(root.length+1));for(const file of fs.readdirSync(path)){const p=containedFile(path,file);if(fs.statSync(p).isDirectory())directory(p)}}
directory(dist)
directory(join(root,'legacy-dist'))
containedFile(root,'sw-rehearsal.json')
const records=[]
const run=argv=>execFileSync(argv[0],argv.slice(1),{encoding:'utf8',timeout:60000,maxBuffer:8e6})
const agent=(...args)=>{const r=JSON.parse(run(['agent-browser','--session','i02','--json',...args]));assert(r.success,r.error);return r.data}
const ev=s=>agent('eval',s).result
const pause=ms=>Bun.sleep(ms)
async function wait(fn,label){for(let i=0;i<120;i++){if(await fn())return;await pause(150)}throw new Error('timeout: '+label)}
async function step(name,fn){const t=performance.now();const result=await fn();const record={name,seconds:+((performance.now()-t)/1000).toFixed(3),result};records.push(record);fs.writeFileSync(containedFile(root,'sw-rehearsal.json'),JSON.stringify(records,null,2),{mode:0o600});console.log(JSON.stringify(record))}
const docker=(...args)=>run(['docker',...args])
async function swap(kind,mount){
  if(mount)directory(mount)
  docker('rm','-f','opengym-rw-i02-web')
  docker('run','-d','--name','opengym-rw-i02-web','--network','opengym-rw-i02','-p','127.0.0.1:8198:80','-e','BACKEND=api',...(mount?['-v',mount+':/usr/share/nginx/html:ro']:[]),kind==='legacy'?'opengym-web:wilky-a2f2daca':'opengym-rw-web:i02')
  await wait(async()=>{try{return(await fetch(origin+'/api/health')).ok}catch{return false}},'slot readiness')
}
const cacheName=s=>s.match(/const CACHE = '([^']+)'/)[1]
const lazy=s=>JSON.parse(JSON.parse(s.match(/const LAZY = (.*)/)[1]))
async function install(expected){
  ev('(async()=>{const r=await navigator.serviceWorker.register("/sw.js");await r.update();return true})()')
  await wait(()=>ev(`(async()=>{const r=await navigator.serviceWorker.getRegistration();return !r.installing&&!r.waiting&&(await caches.keys()).includes(${JSON.stringify(expected)})&&!!await(await caches.open(${JSON.stringify(expected)})).match('index.html')})()`),'complete install '+expected)
  await pause(700)
}
await step('legacy-worker-installed',async()=>{
  await swap('legacy');agent('tab','0');agent('open',origin+'/')
  const source=docker('exec','opengym-rw-i02-web','cat','/usr/share/nginx/html/sw.js')
  await install(cacheName(source));agent('reload')
  assert(ev('!!navigator.serviceWorker.controller'))
  assert(ev('JSON.parse(localStorage.getItem("gym_state_v1")).futureTop.preserved'))
  return {controlled:true,cache:cacheName(source)}
})
directory(join(root,'legacy-dist'))
const legacySource=fs.readFileSync(containedFile(root,'legacy-dist/sw.js'),'utf8'), oldCache=cacheName(legacySource)
const oldQr=lazy(legacySource).find(p=>p.includes('/jsQR-')),oldMedia=lazy(legacySource).find(p=>p.includes('/media-ingest-'))
const newSource=fs.readFileSync(containedFile(dist,'sw.js'),'utf8'),newCache=cacheName(newSource)
const main=fs.readFileSync(containedFile(dist,'index.html'),'utf8').match(/<script[^>]+src="([^"]+)"/)[1]
await step('partial-install',async()=>{
  const file=containedFile(dist,main), held=containedFile(dist,main+'.held');fs.renameSync(file,held)
  try{
    await swap('new',dist)
    ev('(async()=>{await(await navigator.serviceWorker.getRegistration()).update();return true})()')
    await pause(1200)
    await wait(()=>ev('(async()=>!(await navigator.serviceWorker.getRegistration()).installing)()'),'failed install settled')
    assert(ev(`(async()=>!!await(await caches.open(${JSON.stringify(oldCache)})).match('index.html'))()`))
    assert(!ev(`(async()=>!!await(await caches.open(${JSON.stringify(newCache)})).match('index.html'))()`))
    agent('set','offline','on')
    const oldShell=ev('(async()=>{const r=await fetch("/index.html");return (await r.text()).includes("index-otjWb91H")})()')
    assert(oldShell);agent('set','offline','off')
    return {failedNewInstall:true,legacyShellPreserved:true}
  }finally{fs.renameSync(held,file)}
})
await step('upgrade-old-tab-lazy-chunks',async()=>{
  ev('(async()=>{await(await caches.open("other-app-offline")).put("/unrelated",new Response("preserved"));return true})()')
  if (agent('tab','list').tabs.length<2) ev('window.open("about:blank");true')
  await install(newCache)
  // First use after upgrade: the original document still runs the old main bundle.
  assert(ev(`(async()=>{await import(${JSON.stringify(oldQr)});return true})()`))
  agent('set','offline','on')
  assert(ev(`(async()=>{await import(${JSON.stringify(oldMedia)});return true})()`))
  agent('set','offline','off')
  const generations=ev('(async()=>(await caches.keys()).filter(k=>k.startsWith("opengym-rt-")))()')
  assert.equal(generations.length,2)
  return {onlineQrFirstUse:true,offlineMediaFirstUse:true,generations}
})
await step('reload-handshake-prunes-previous',async()=>{
  agent('tab','1');agent('open',origin+'/');agent('tab','0');agent('reload')
  await wait(()=>ev('(async()=>(await caches.keys()).filter(k=>k.startsWith("opengym-rt-")).length===1)()'),'old generation pruned')
  assert.equal(ev('(async()=>await(await(await caches.open("other-app-offline")).match("/unrelated")).text())()'),'preserved')
  return {previousPruned:true,unrelatedCachePreserved:true}
})
await step('second-upgrade-two-generations',async()=>{
  const next=containedFile(root,'next-dist')
  if(fs.existsSync(next))directory(next)
  run(['bun',join(process.cwd(),'node_modules/vite/bin/vite.js'),'build',join(process.cwd(),'packages/web'),'--config',join(process.cwd(),'packages/web/vite.config.ts'),'--outDir',next])
  // The second artifact is a real Vite build with a distinct exposed build tag.
  // Set APP_BUILD before launching this script to differ from the shipped image.
  directory(next)
  const source=fs.readFileSync(containedFile(next,'sw.js'),'utf8'),cache=cacheName(source)
  assert.notEqual(cache,newCache,'second build must be a distinct artifact')
  await swap('new',next);await install(cache)
  const qr=lazy(newSource).find(p=>p.includes('/jsQR-'))
  agent('set','offline','on');assert(ev(`(async()=>{await import(${JSON.stringify(qr)});return true})()`));agent('set','offline','off')
  const generations=ev('(async()=>(await caches.keys()).filter(k=>k.startsWith("opengym-rt-")))()')
  assert.equal(generations.length,2)
  return {priorRewriteLazyOffline:true,generations}
})
await step('second-reload-prunes-previous',async()=>{
  agent('tab','1');agent('reload');agent('tab','0');agent('reload')
  await wait(()=>ev('(async()=>(await caches.keys()).filter(k=>k.startsWith("opengym-rt-")).length===1)()'),'second generation pruned')
  return {previousPruned:true}
})
await step('return-to-shipped-image',async()=>{await swap('new');await install(newCache);agent('tab','1');agent('reload');agent('tab','0');agent('reload');return {shippedBuildRestored:true}})
console.log('I02 persistent-profile service-worker rehearsal: PASS')
