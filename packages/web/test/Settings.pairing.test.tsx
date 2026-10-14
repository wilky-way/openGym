// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import { request } from 'node:http'
import { api, pairRedeem, configureApiConnection } from '../src/lib/api'
import { apiConnection } from '../src/lib/api-connection'
import { authenticate } from '../src/lib/auth-actions'
import { configureClientIO } from '../src/lib/client-io'
import { createBrowserPlatform } from '../src/platform/browser'
import { createSyncEngine } from '../src/store/sync-engine'
import { useStore, initialStoreState, clone, DEF } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { searchSettings } from '../src/views/settings-pages'
import SettingsA from '../src/views/SettingsA'
vi.mock('react-router-dom',()=>({useNavigate:()=>vi.fn()}))
vi.mock('../src/lib/push',()=>({pushSupported:()=>false}))
let child:ChildProcess,dir:string,base:string,cookie:string,nonce:string,dispose:()=>void
let authenticated:boolean,sheet:HTMLElement
const mounted:{root:Root;host:HTMLDivElement}[]=[],calls:{url:string;headers:Record<string,string>}[]=[]
const user={id:'pair_ui_user',name:'Synthetic pairing user'}
function mount(node:ReactNode){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);mounted.push({root,host});act(()=>root.render(node));return host}
const title='Pair an agent or device'
const row=(host:HTMLElement)=>[...host.querySelectorAll<HTMLButtonElement>('.lrow')].find(el=>el.querySelector('.lrow-t')?.textContent===title)
const button=(host:HTMLElement,label:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent===label)!
beforeAll(async()=>{
 const now=1791892800000;vi.spyOn(Date,'now').mockReturnValue(now)
 nonce=randomBytes(16).toString('hex');const secret=randomBytes(32).toString('hex');dir=mkdtempSync(join(tmpdir(),'opengym-W21-pair-'))
 writeFileSync(join(dir,'secret'),secret,{mode:0o600})
 const payload=`${user.id}:${Date.now()+86400000}:0`;cookie=`gymsid=${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`
 // Real native authentication pairing/auth server on synthetic SQLite data, loopback and an OS-assigned port.
 const loader=join(dir,'native.mjs')
 const modules={storage:pathToFileURL(resolve('../server/src/storage/index.ts')).href,config:pathToFileURL(resolve('../server/src/config.ts')).href,auth:pathToFileURL(resolve('../server/src/auth.ts')).href,server:pathToFileURL(resolve('../server/src/index.ts')).href}
 writeFileSync(loader,`Date.now=()=>1791892800000;const serve=Bun.serve;Bun.serve=options=>{const fetch=options.fetch;return serve({...options,fetch:async(...args)=>{const response=await fetch(...args);response.headers.set('x-opengym-native-test',${JSON.stringify(nonce)});return response}})};const{openStore,putUser}=await import(${JSON.stringify(modules.storage)});const store=openStore(process.env.DATA_DIR);putUser(store.db,{...${JSON.stringify(user)},created:'2026-10-13T00:00:00.000Z',admin:0,disabled:0,sv:0,invited_by:null,last_pull:null,last_reminder:null,last_nudge:null,ord:0,x:'{}'});const{loadConfig}=await import(${JSON.stringify(modules.config)});const config=loadConfig({PORT:'0',HOST:'127.0.0.1',DATA_DIR:process.env.DATA_DIR,ORIGIN:'http://localhost:8080',RP_ID:'localhost'});const{createAuth}=await import(${JSON.stringify(modules.auth)});const auth=createAuth(store.db,config,{address:()=> '127.0.0.1'});const{startServer}=await import(${JSON.stringify(modules.server)});startServer(config,{auth});`)
 child=spawn(process.execPath,[loader],{cwd:resolve('../server'),stdio:['ignore','pipe','pipe'],env:{...process.env,DATA_DIR:dir}})
 let error='';child.stderr!.on('data',data=>{error+=data})
 const port=await new Promise<number>((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error('Native pairing test server startup timed out')),20000);child.stdout!.on('data',data=>{log+=data;const match=/gym-api on :(\d+)/.exec(log);if(match){clearTimeout(timer);resolve(Number(match[1]))}});child.once('exit',()=>{clearTimeout(timer);reject(new Error('Native pairing test server exited: '+error))})})
 base=`http://127.0.0.1:${port}`
},25000)
afterAll(async()=>{if(child && child.exitCode===null && child.signalCode===null)await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill('SIGKILL')});if(dir)rmSync(dir,{recursive:true,force:true});vi.restoreAllMocks()})
beforeEach(()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});authenticated=true;calls.length=0
 const platform0=createBrowserPlatform();platform0.kv.remove('gym_server_url');platform0.kv.remove('gym_device_token');platform0.kv.set('gym_user',JSON.stringify(user));platform0.kv.set('gym_owner',user.id)
 const platform={...platform0,transport:{fetch:async(path:string,init:RequestInit={})=>{
  const url=path.startsWith('http')?path:base+path,headers=Object.fromEntries(new Headers(init.headers));const bearer=platform0.kv.get('gym_device_token')
  if(bearer&&!url.endsWith('/api/pair/redeem'))headers.Authorization='Bearer '+bearer
  if(authenticated&&url.endsWith('/api/pair/create'))headers.Cookie=cookie
  calls.push({url,headers});return new Promise<Response>((resolve,reject)=>{
   const req=request(url,{method:init.method||'GET',headers,agent:false},res=>{if(Object.keys(res.headers).some(k=>k.startsWith('tailscale-'))||res.headers['x-opengym-native-test']!==nonce){res.resume();reject(new Error('Wrong native pairing test server'));return}let body='';res.on('data',d=>{body+=d});res.on('end',()=>resolve(new Response(body,{status:res.statusCode,headers:res.headers as Record<string,string>})))})
   req.on('error',reject);if(init.body)req.write(init.body);req.end()
  })
 }}}
 configureClientIO(platform);useStore.setState(initialStoreState(platform.kv))
 const engine=createSyncEngine(p=>useStore.setState(p),useStore.getState,{platform,api:async()=>({state:clone(DEF),rev:1}),prompts:{toast:vi.fn(),askAddDeviceData:async()=>false},acquireAuthLock:async()=>()=>{},acquireSyncLock:async()=>()=>{}});useStore.setState(engine.actions);dispose=engine.dispose
 useUI.setState({toast:vi.fn(),openSheet:((render:any)=>{sheet=mount(render(()=>{}));return{close(){}}}) as any})
})
afterEach(()=>{act(()=>mounted.splice(0).forEach(({root,host})=>{root.unmount();host.remove()}));dispose();vi.useRealTimers()})
describe('Settings pairing through the real API',()=>{
 it('clicks the account row, displays a real code, redeems it, and authenticates /api/me',async()=>{
  const account=mount(<SettingsA page="account"/>);const close=vi.fn();useUI.setState({openSheet:((render:any)=>{sheet=mount(render(close));return{close(){}}}) as any})
  expect(searchSettings('pair agent',{user}).some(h=>h.title===title)).toBe(true);act(()=>row(account)!.click());await act(async()=>button(sheet,'Create pairing code').click())
  await vi.waitFor(()=>expect(sheet.querySelector('.card')?.textContent).toMatch(/^[A-Z2-9]{8}$/))
  expect(sheet.querySelector('h3')!.textContent).toBe('Pair another device');expect(sheet.textContent).toContain('works once and lasts 5 minutes')
  const code=sheet.querySelector('.card')!.textContent!,openedUser=useStore.getState().user
  const connected=await act(async()=>authenticate(async()=>{const response=await pairRedeem(base,` ${code} `);await configureApiConnection({baseUrl:'https://synthetic-pair.example',token:response.token});return response.user},()=>useStore.getState().user===openedUser))
  expect(connected?.id).toBe(user.id);const token=apiConnection().token;expect(token).toBeTruthy()
  expect((await api('/api/me')).user.id).toBe(user.id)
  expect(calls.find(c=>c.url.endsWith('/api/pair/redeem'))!.headers).not.toHaveProperty('Cookie')
  expect(calls.find(c=>c.url.endsWith('/api/me'))!.headers).toMatchObject({Authorization:`Bearer ${token}`})
  await expect(pairRedeem(base,code)).rejects.toMatchObject({status:400,code:'pair-invalid'})
  await configureApiConnection({baseUrl:'https://synthetic-pair.example',token});expect((await api('/api/me')).user.id).toBe(user.id)
  act(()=>button(sheet,'Done').click());expect(close).toHaveBeenCalledOnce();await configureApiConnection({baseUrl:'',token:null});expect(apiConnection().token).toBeNull()
 })
 it('shows a server refusal in the sheet instead of a pairing code',async()=>{
  authenticated=false;const account=mount(<SettingsA page="account"/>);act(()=>row(account)!.click());await act(async()=>button(sheet,'Create pairing code').click())
  await vi.waitFor(()=>expect(sheet.querySelector('[role="alert"]')?.textContent).toBeTruthy());expect(sheet.querySelector('.card')).toBeNull()
 })
 it('offers no code creation or pairing search result to a guest',()=>{
  useStore.setState({user:null});const account=mount(<SettingsA page="account"/>);expect(row(account)).toBeUndefined();expect(searchSettings('pair agent',{user:null}).some(h=>h.title===title)).toBe(false);expect(calls.some(c=>c.url.endsWith('/api/pair/create'))).toBe(false)
 })
})
