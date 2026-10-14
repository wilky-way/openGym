// @vitest-environment happy-dom
import {act, type ReactNode} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {configureShell} from '../src/shell'
import {createBrowserPlatform,browserServerEndpoint} from '../src/platform/browser'
import {clientPlatform,clientCapabilities,configureClientIO} from '../src/lib/client-io'
import {IS_ANDROID,IS_APPLE,BIO,VAULT} from '../src/lib/api'
import {useStore,DEF,KEY,clone} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {captureSheetTarget} from '../src/lib/sheet-target'
import {createSheetUpdater} from '../src/sheets/sheet-target'
import * as sheets from '../src/sheets'
import {configureAuthUiServices,authUiServices} from '../src/lib/auth-ui-services'
import {activate,pause} from '@opengym/core/programme'
import {startProgramme} from '@opengym/core/programme-lifecycle'
import {editCompletedSession} from '@opengym/core/session-edit'
import {programmeSessionSheet} from '../src/components/ProgrammeSession'
import ProgrammeToday from '../src/components/ProgrammeToday'
import Admin from '../src/views/Admin'
import {deleteRoutineWithUndo} from '../src/views/Plan'
import Home from '../src/views/Home'
import CheckIn,{openEditCard} from '../src/views/CheckIn'
import {Shell} from '../src/App'
import {nav,setNav} from '../src/lib/nav'
import {printWholePlan} from '../src/sheets-plan-history'
import {initializeStore} from '../src/store/useStore'

const definition:any={id:'today',name:'Synthetic strength',unit:'kg',weeks:[1,2,3].map(index=>({index,rir:2,days:[1,2,3,4].map(i=>({key:'d'+i,sessions:[{routineSnapshot:{name:'Day '+i,ex:[]}}]}))}))}
let map:Map<string,string>,dispose:()=>void,roots:Root[],hosts:HTMLElement[]
let locks:any[],requests:{path:string;method:string}[],holdUser:boolean,answerUser:(value:any)=>void
const routine=()=>({id:'r',name:'Strength',ex:[{id:'0043',sets:1,reps:5,weight:50,prog:'off'}]})
const saved=()=>({id:'w',d:'2026-10-12',name:'Saved',start:1,end:2,entries:[{id:'0043',target:{id:'0043',sets:1,reps:5},sets:[{w:50,r:5,done:true}]}]})
const active=()=>({...saved(),id:'a',start:123,end:undefined,entries:[{id:'0043',target:{id:'0043',sets:2,reps:5},sets:[{w:50,r:5,done:true},{w:50,r:5,done:false}]}]})
function mount(node:ReactNode,path='/home') {const host=document.createElement('div');document.body.append(host);const root=createRoot(host);hosts.push(host);roots.push(root);act(()=>root.render(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>));return host}
const button=(host:HTMLElement,text:string)=>[...host.querySelectorAll<HTMLElement>('button,[role="button"]')].find(b=>b.textContent?.trim()===text)!
function click(host:HTMLElement,text:string){expect(button(host,text),text).toBeTruthy();act(()=>button(host,text).click())}
function top(){const sh=useUI.getState().sheets.at(-1)!;expect(sh).toBeTruthy();return mount(sh.render(()=>useUI.getState().closeSheet(sh.id)))}
function snapshot(){return {map:new Map(map),S:clone(useStore.getState().S),index:useStore.getState().index,instance:useStore.getState().documentInstance,user:useStore.getState().user}}
function unchanged(before:ReturnType<typeof snapshot>){expect(map).toEqual(before.map);expect(useStore.getState().S).toEqual(before.S);expect(useStore.getState().index).toBe(before.index);expect(useStore.getState().documentInstance).toBe(before.instance);expect(useStore.getState().user).toBe(before.user);expect(useUI.getState().toastMsg).toMatch(/changed|again/i)}
function switchB(){useStore.getState().setUser({id:'B',name:'B'},{adopt:{alwaysAsk:true}});useStore.getState().update(s=>{s.workouts=[saved()];s.active=null;s.activeEquipId='profile';s.private='B'},false)}
function replace(){useStore.getState().replaceState(clone(useStore.getState().S),false)}
function interceptSwitch(transition=switchB){const update=useStore.getState().update;let before!:ReturnType<typeof snapshot>;useStore.setState({update(mut,push){useStore.setState({update});transition();before=snapshot();update(mut,push)}});return ()=>before}
beforeEach(()=>{
 Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-12T12:00:00-05:00'))
 roots=[];hosts=[];locks=[];requests=[];holdUser=false;document.body.innerHTML='';setNav(()=>{})
 const initial={...clone(DEF),weighIn:false,sound:false,routines:[routine()],workouts:[saved()],activeEquipId:'profile',gymCards:[{id:'card',label:'Gym',value:'synthetic',fmt:'qrcode'}]}
 map=new Map([[KEY,JSON.stringify(initial)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A',name:'the operator',admin:true})]])
 const kv={get:(key:string)=>map.get(key)??null,set:(key:string,value:string)=>{map.set(key,value)},remove:(key:string)=>{map.delete(key)},subscribe:()=>()=>{}}
 const browser=createBrowserPlatform({buildSha:'synthetic-W23-sha'})
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(name:string,options:any,callback:any)=>{locks.push([name,options]);return callback({name})}}})
 const platform={...browser,kv,server:browserServerEndpoint(kv),transport:{fetch:async(path:string,init:RequestInit={})=>{requests.push({path,method:init.method??'GET'});const data:any=path.startsWith('/api/admin/user?')?(holdUser?await new Promise(resolve=>{answerUser=resolve}):{user:{id:'inspected',name:'Synthetic private admin detail'},workouts:[],routines:[],bodyweight:[],unit:'kg'}):{users:[{id:'inspected',name:'Synthetic inspected',workouts:0}],activity:[],passkeys:[],online:[],config:{},state:clone(DEF),rev:1,events:[],enabled:false,invites:[]};return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}})}}}
 dispose=configureShell(platform);useStore.setState({ready:true,boot:async()=>{}});useUI.setState({sheets:[],toastMsg:'',toastAction:null,timer:null,work:null})
})
afterEach(()=>{act(()=>roots.forEach(r=>r.unmount()));hosts.forEach(h=>h.remove());dispose();useUI.getState().stopRest();useUI.getState().stopWork();vi.useRealTimers();delete (navigator as any).locks})

for (const admin of [false, true]) it(`Admin stops stale polling across an account switch (next admin=${admin})`, async () => {
 const now=Date.now();vi.useFakeTimers({toFake:['Date','setInterval','clearInterval']});vi.setSystemTime(now)
 const original=useUI.getState().toast, toast=vi.fn(original);useUI.setState({toast})
 try {
  mount(<Admin/>, '/admin');await act(async()=>{await vi.dynamicImportSettled()})
  const count=()=>requests.filter(r=>r.path.startsWith('/api/admin/')).length
  const initial=count();expect(initial).toBeGreaterThan(0)
  await act(async()=>{switchB();useStore.setState({user:{...useStore.getState().user!,admin}});await vi.dynamicImportSettled()})
  const before=snapshot()
  await act(async()=>{await vi.advanceTimersByTimeAsync(15000)})
  const first=toast.mock.calls.length;expect(first).toBeLessThanOrEqual(1)
  await act(async()=>{await vi.advanceTimersByTimeAsync(45000)})
  expect(toast).toHaveBeenCalledTimes(first);expect(count()).toBe(initial)
  expect(map).toEqual(before.map);expect(useStore.getState().S).toEqual(before.S)
  expect(useStore.getState().index).toBe(before.index);expect(useStore.getState().documentInstance).toBe(before.instance)
 } finally {useUI.setState({toast:original})}
})
it('Admin retains its live poll across ordinary edits in the same account and stops it on unmount', async () => {
 const now=Date.now();vi.useFakeTimers({toFake:['Date','setInterval','clearInterval']});vi.setSystemTime(now)
 const host=mount(<Admin/>, '/admin');await act(async()=>{await vi.dynamicImportSettled()})
 const count=()=>requests.filter(r=>r.path==='/api/admin/users').length
 expect(count()).toBe(1)
 act(()=>useStore.getState().update(s=>{s.restSec=105},false))
 await act(async()=>{await vi.advanceTimersByTimeAsync(30000)})
 expect(count()).toBe(3);expect(useStore.getState().S.restSec).toBe(105)
 const root=roots.pop()!;act(()=>root.unmount());hosts.splice(hosts.indexOf(host),1);host.remove()
 await act(async()=>{await vi.advanceTimersByTimeAsync(30000)})
 expect(count()).toBe(3)
})

it('keeps the stock today row, different-workout door and ordinary weekday routine alongside the program',()=>{
 useStore.getState().update(s=>{activate(s,definition,{cycleId:'c',today:'2026-10-12'});s.routines.push({id:'core',name:'Core',ex:[{id:'0025',sets:1,reps:8}]});s.week[1]=['core']});const host=mount(<Home/>);expect(host.querySelector('.today-row')).toBeTruthy();expect(host.querySelector('.today-row .ttl')!.textContent).toContain('Core');expect(host.textContent).toContain('Choose a different workout');expect(host.querySelector('.program-today')).toBeTruthy()
})
it('keeps the logged-today tick after a program session is finished',()=>{
 useStore.getState().update(s=>{activate(s,definition,{cycleId:'c',today:'2026-10-12'});s.workouts=[];const o=s.programmes.cycles[0].occurrences[0];s.workouts.push({id:'logged',d:'2026-10-12',name:'D1 completed',start:1,end:2,entries:[{occurrenceId:o.instanceId}],routineIds:[o.routineId]})});const host=mount(<Home/>);expect(host.querySelector('.today-row .ttl')!.textContent).toContain('D1 completed (done)');expect(host.querySelector('.today-row .tag')!.textContent).toBe('Done')
})
it('keeps active workout Resume in the stock row even while the program is paused',()=>{
 useStore.getState().update(s=>{activate(s,definition,{cycleId:'c',today:'2026-10-12'});s.active={id:'flight',name:'D3 active',start:Date.now(),entries:[]};pause(s,'c','2026-10-12')});const host=mount(<Home/>);expect(host.querySelector('.today-row .ttl')!.textContent).toContain('D3 active');expect(host.querySelector('.today-row .tag')!.textContent).toBe('Resume');expect(host.querySelector('.program-today')!.textContent).toContain('Pick up at week 1')
})
it('pending session button cannot start before the program bound',()=>{
 useStore.getState().update(s=>{startProgramme(s,definition,{cycleId:'future',today:'2026-10-12',startsOn:'2026-10-19'})});programmeSessionSheet(useStore.getState().S.programmes.cycles[0].occurrences[0]);click(top(),'Start');expect(useStore.getState().S.active).toBeNull();expect(useUI.getState().toastMsg).toContain('2026-10-19')
})

for(const transition of ['account','late account','late replace','replace','unit','profile','server','away and back']) for(const action of ['delete','finish','skip','card'])it(`${action}: ${transition} leaves real sync store bytes and index unchanged`,()=>{
 if(action==='delete')useStore.getState().update(s=>{editCompletedSession(s,s.workouts[0]);s.active.entries[0].sets[0].done=false})
 if(action==='finish')useStore.getState().update(s=>{s.active=active()})
 if(action==='skip')useStore.getState().update(s=>{s.weighIn=true;s.active=null})
 if(action==='delete')sheets.saveWorkoutEdits(()=>{})
 if(action==='finish')sheets.finishWorkoutSheet()
 if(action==='skip')sheets.startFlow(['r'])
 if(action==='card')openEditCard(useStore.getState().S.gymCards[0])
 const host=top(),text=action==='delete'?'Delete workout':action==='finish'?'Finish and save':action==='skip'?'Start without weighing in':'Save card'
 let before:ReturnType<typeof snapshot>,late:(()=>ReturnType<typeof snapshot>)|undefined
 if(transition==='late account')late=interceptSwitch()
 else if(transition==='late replace')late=interceptSwitch(replace)
 else {if(transition==='account')switchB();if(transition==='replace')replace();if(transition==='unit')useStore.getState().update(s=>{s.unit='lb'},false);if(transition==='profile')useStore.getState().update(s=>{s.activeEquipId='other'},false);if(transition==='server')map.set('gym_server_url','https://synthetic.example');if(transition==='away and back'){const S=clone(useStore.getState().S);switchB();useStore.getState().setUser({id:'A',name:'the operator'},{adopt:{alwaysAsk:true}});useStore.getState().replaceState(S,false)}}
 before=snapshot();click(host,text);unchanged(late?late():before)
})
for(const action of ['delete','finish','skip','card'])it(`${action}: a same-account ordinary settings edit permits the real action`,()=>{
 if(action==='delete')useStore.getState().update(s=>{editCompletedSession(s,s.workouts[0]);s.active.entries[0].sets[0].done=false})
 if(action==='finish')useStore.getState().update(s=>{s.active=active()})
 if(action==='skip')useStore.getState().update(s=>{s.weighIn=true;s.active=null})
 if(action==='delete')sheets.saveWorkoutEdits(()=>{});if(action==='finish')sheets.finishWorkoutSheet();if(action==='skip')sheets.startFlow(['r']);if(action==='card')openEditCard(useStore.getState().S.gymCards[0])
 const host=top();useStore.getState().update(s=>{s.restSec=105},false);click(host,action==='delete'?'Delete workout':action==='finish'?'Finish and save':action==='skip'?'Start without weighing in':'Save card')
 const S=useStore.getState().S;expect(S.restSec).toBe(105);expect(map.get(KEY)).toBe(JSON.stringify(S));if(action==='delete')expect(S.workouts).toEqual([]);if(action==='finish')expect(S.active).toBeNull();if(action==='skip')expect(S.active.routineIds).toEqual(['r']);if(action==='card')expect(useUI.getState().toastMsg).toBe('Card updated')
})
for(const kind of ['confirm','menu'])it(`${kind} receives its original captured target at the final producer`,()=>{
 let callbackTarget:any;sheets[kind==='confirm'?'confirmSheet':'menuSheet'](kind==='confirm'?{onConfirm:valid=>{callbackTarget=valid;createSheetUpdater(valid!)(s=>{s.unknown='written'})}}:{items:[{label:'Write',onClick:valid=>{callbackTarget=valid;createSheetUpdater(valid!)(s=>{s.unknown='written'})}}]});const host=top(),late=interceptSwitch();click(host,kind==='confirm'?'Confirm':'Write');expect(typeof callbackTarget).toBe('function');unchanged(late())
})
it('editor target refuses a reopened history editor of the same saved workout',()=>{
 sheets.workoutDetailSheet(useStore.getState().S.workouts[0]);click(top(),'Edit workout');const first=useStore.getState().S.active.editBase.sheetInstanceId,target=captureSheetTarget()
 useStore.getState().update(s=>{s.active=null},false);sheets.workoutDetailSheet(useStore.getState().S.workouts[0]);click(top(),'Edit workout');expect(useStore.getState().S.active.editBase.sheetInstanceId).not.toBe(first);const before=snapshot();expect(createSheetUpdater(target)(s=>{s.active=null})).toBe(false);unchanged(before)
})
it('retained Today direct Start cannot dispatch A’s routine after switching to B',()=>{
 useStore.getState().update(s=>{activate(s,definition,{cycleId:'c',today:'2026-10-12'});s.active=null;s.weighIn=false});const host=mount(<ProgrammeToday/>),el=button(host,'Start'),props=(el as any)[Object.keys(el).find(k=>k.startsWith('__reactProps'))!],start=props.onClick
 switchB();const before=snapshot();act(()=>start());unchanged(before);expect(useUI.getState().sheets).toEqual([])
})
it('documentInstance survives hydration, changes on replacement, and stays on updates or refused durable save',()=>{
 const instance=useStore.getState().documentInstance!;useStore.getState().update(s=>{s.restSec=105},false);expect(useStore.getState().documentInstance).toBe(instance);replace();expect(useStore.getState().documentInstance).toBe(instance+1)
 const before=snapshot(),kv=clientPlatform().kv,old=kv.set;kv.set=(key,value)=>{if(key===KEY)throw new Error('quota');old(key,value)}
 expect(()=>useStore.getState().replaceState(clone(DEF),false,{durable:true})).toThrow();expect(useStore.getState().documentInstance).toBe(before.instance);expect(useStore.getState().S).toEqual(before.S);expect(map).toEqual(before.map);kv.set=old
 initializeStore(clientPlatform());expect(useStore.getState().documentInstance).toBe(before.instance)
})
it('boot binds exclusive auth and shared sync leases to the same browser carrier',async()=>{
 const transaction=await useStore.getState().beginAuthTransaction!();transaction.cancel();await useStore.getState().pullState();expect(locks.map(x=>x[1].mode)).toContain('exclusive');expect(locks.map(x=>x[1].mode)).toContain('shared');expect(new Set(locks.map(x=>x[0])).size).toBe(1)
})
it('boot binds real authentication dialogs',()=>{expect(()=>authUiServices().menuSheet({title:'Account',items:[{icon:'info',label:'Inspect',onClick(){}}]})).not.toThrow();expect(top().textContent).toContain('Account')})
it('shell print uses the plan sharing script-disabled sandbox',()=>{printWholePlan();const iframe=document.querySelector('iframe')!;expect(iframe).toBeTruthy();expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin allow-modals');expect(iframe.getAttribute('sandbox')).not.toContain('allow-scripts')})
for(const path of ['/home','/checkin','/plan','/plan/r/r','/workout','/stats','/history','/library','/muscles','/structural-balance','/measurements','/settings',...['workout','advanced','alerts','units','equipment','look','plan','data','about','account','reminders'].map(p=>'/settings/'+p),'/admin'])it(`the real shell reaches ${path} without an unbound service`,async()=>{
 if(path==='/workout')useStore.getState().update(s=>{s.active=active()});const host=mount(<Shell/>,path);await act(async()=>{for(let i=0;i<8;i++)await Promise.resolve()});expect(host.textContent).not.toMatch(/Something went wrong|services.*configured|Try again/);expect(host.textContent!.length).toBeGreaterThan(5);if(path==='/settings/about')expect(host.textContent).toContain('synthetic-W23-sha')
})

const settle=()=>act(async()=>{for(let n=0;n<20;n++)await Promise.resolve()})
async function openAdmin(){const host=mount(<Admin/>);await settle();act(()=>[...host.querySelectorAll<HTMLElement>('.item')].find(el=>el.textContent!.includes('Synthetic inspected'))!.click());return host}
it('an A-owned queued Admin drill-down cannot fetch private details under B',async()=>{
 await openAdmin();switchB();const before=snapshot();const host=top();await settle();unchanged(before);expect(requests.some(r=>r.path.startsWith('/api/admin/user?'))).toBe(false);expect(host.textContent).not.toContain('Synthetic private admin detail')
})
it('a delayed Admin reply from A cannot populate its sheet after switching to B',async()=>{
 holdUser=true;await openAdmin();const host=top();await settle();expect(answerUser).toBeTypeOf('function');switchB();const before=snapshot();await act(async()=>{answerUser({user:{id:'inspected',name:'Synthetic private admin detail'},workouts:[],routines:[],bodyweight:[]})});unchanged(before);expect(host.textContent).not.toContain('Synthetic private admin detail')
})
it('a retained Admin enable button aborts inside its real updater probe before requesting under B',async()=>{
 await openAdmin();const host=top();await settle();click(host,'Disable account');const confirm=top(),late=interceptSwitch(),count=requests.length;click(confirm,'Disable');unchanged(late());expect(requests).toHaveLength(count)
})
for(const transition of ['account','replace','ordinary'])it(`Plan Undo after ${transition} follows the real replacement identity`,()=>{
 deleteRoutineWithUndo('r');const undo=useUI.getState().toastAction!.run
 if(transition==='account')switchB();if(transition==='replace')replace();if(transition==='ordinary')useStore.getState().update(s=>{s.restSec=105},false)
 const before=snapshot();act(()=>undo());if(transition==='ordinary'){expect(useStore.getState().S.routines.some((r:any)=>r.id==='r')).toBe(true);expect(useStore.getState().S.restSec).toBe(105)}else unchanged(before)
})

for(const action of ['edit','delete','repeat'])for(const transition of ['account','replace','late replace','late unit','late equip','late server','ordinary'])it(`real History ${action}: ${transition} guards the selected saved id`,()=>{
 useStore.getState().update(s=>{s.workouts=[saved(),{...saved(),id:'second',name:'Other',d:'2026-10-11',entries:[{id:'0043',target:{id:'0043'},sets:[{w:90,r:5,done:true}]}]}];s.active=null;s.weighIn=false})
 const history=mount(<Shell/>,'/history');act(()=>[...history.querySelectorAll<HTMLElement>('.item')].find(el=>el.textContent!.includes('Saved'))!.click());const detail=top()
 if(action==='delete')click(detail,'Delete workout')
 let late:(()=>ReturnType<typeof snapshot>)|undefined
 if(transition==='account')switchB();if(transition==='replace')replace();if(transition==='late replace')late=interceptSwitch(replace);if(transition==='late unit')late=interceptSwitch(()=>useStore.getState().update(s=>{s.unit='lb'},false));if(transition==='late equip')late=interceptSwitch(()=>useStore.getState().update(s=>{s.activeEquipId='other'},false));if(transition==='late server')late=interceptSwitch(()=>map.set('gym_server_url','https://synthetic.example'));if(transition==='ordinary')useStore.getState().update(s=>{s.restSec=105},false)
 const before=snapshot();click(action==='delete'?top():detail,action==='edit'?'Edit workout':action==='delete'?'Delete':'Repeat today')
 if(transition!=='ordinary')unchanged(late?late():before)
 else {expect(useStore.getState().S.restSec).toBe(105);if(action==='edit')expect(useStore.getState().S.active.editingWorkoutId).toBe('w');if(action==='delete')expect(useStore.getState().S.workouts.map((w:any)=>w.id)).toEqual(['second']);if(action==='repeat')expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(50)}
})

for(const action of ['superset save','workout discard'])for(const transition of ['account','late account','late replace','ordinary'])it(`${action}: ${transition} validates in the composed producer`,()=>{
 useStore.getState().update(s=>{s.routines[0].ex=[{...routine().ex[0],sg:'pair'},{...routine().ex[0],id:'0025',sg:'pair'}];s.active=action==='workout discard'?active():null})
 const host=mount(<Shell/>,action==='superset save'?'/plan/r/r':'/workout')
 if(action==='superset save')act(()=>host.querySelector<HTMLButtonElement>('.ss-label-btn')!.click())
 else {act(()=>host.querySelector<HTMLButtonElement>('[aria-label="Workout options"]')!.click());click(top(),'Discard workout')}
 const sheet=top();let late:(()=>ReturnType<typeof snapshot>)|undefined
 if(transition==='account')switchB();if(transition==='late account')late=interceptSwitch();if(transition==='late replace')late=interceptSwitch(replace);if(transition==='ordinary')useStore.getState().update(s=>{s.restSec=105},false)
 const before=snapshot();click(sheet,action==='superset save'?'Save':'Discard')
 if(transition!=='ordinary')unchanged(late?late():before)
 else {expect(useStore.getState().S.restSec).toBe(105);expect(map.get(KEY)).toBe(JSON.stringify(useStore.getState().S));if(action==='workout discard')expect(useStore.getState().S.active).toBeNull();else expect(map.get(KEY)).not.toBe(before.map.get(KEY))}
})

it('About retains source and catalogue-license attribution alongside the build SHA',()=>{
 const host=mount(<Shell/>,'/settings/about')
 expect(host.textContent).toContain('synthetic-W23-sha');expect(host.textContent).toContain('free & open source (AGPL v3)')
 expect(host.textContent).toContain('Exercise media © Aliaksandr Makatserchyk');expect(host.textContent).toContain('Media licensed for use in openGym only')
 expect(host.querySelector('a[href="https://gymvisual.com/"]')).toBeTruthy();expect(host.querySelector('a[href$="NOTICE.md"]')).toBeTruthy();expect(host.querySelector('a[href="https://github.com/wilky-way/openGym"]')).toBeTruthy()
})

it('boot refreshes platform-specific passkey labels and Android install instructions',()=>{
 const own=Object.getOwnPropertyDescriptor(navigator,'userAgent')
 try {
  Object.defineProperty(navigator,'userAgent',{configurable:true,value:'Mozilla/5.0 (Linux; Android 15)'})
  const platform=clientPlatform();dispose();dispose=configureShell(platform);useStore.setState({ready:true})
  expect(IS_ANDROID).toBe(true);expect(IS_APPLE).toBe(false);expect(BIO).toBe('fingerprint or face unlock');expect(VAULT).toBe('Google Password Manager')
  const host=mount(<Shell/>,'/settings/about');expect(host.textContent).toContain('In Chrome: ⋮ menu → Add to Home screen');expect(host.textContent).not.toContain('In Safari')
 } finally {if(own)Object.defineProperty(navigator,'userAgent',own);else delete (navigator as any).userAgent}
})
for(const transition of ['account','replace','unmount','ordinary'])it(`boot push sync: delayed worker after ${transition} retains its opening authority`,async()=>{
 let resolveWorker!:(r:any)=>void,readyCalls=0
 const waiting=new Promise<any>(resolve=>{resolveWorker=resolve}),caps=clientCapabilities(),platform=clientPlatform()
 platform.info.canWebPush=true
 const registration={pushManager:{getSubscription:async()=>({endpoint:'https://push.synthetic/A',options:{},toJSON:()=>({endpoint:'https://push.synthetic/A'})})}}
 configureClientIO(platform,{...caps,push:{...caps.push,supported:()=>true,permission:()=> 'granted',ready:()=>++readyCalls===1?waiting:Promise.resolve({pushManager:{getSubscription:async()=>null}}),shareDeviceId:async()=>{}}})
 mount(<Shell/>);await settle()
 if(transition==='account')act(()=>switchB());if(transition==='replace')act(()=>replace());if(transition==='unmount')act(()=>roots.at(-1)!.unmount());if(transition==='ordinary')act(()=>useStore.getState().update(s=>{s.restSec=105},false))
 const before=snapshot();await act(async()=>{resolveWorker(registration);for(let i=0;i<30;i++)await Promise.resolve()})
 const push=requests.filter(r=>r.path.startsWith('/api/push/'))
 if(transition==='ordinary'){expect(push.map(r=>r.method)).toEqual(['GET','GET','POST']);expect(push.at(-1)?.path).toBe('/api/push/subscribe')}
 else {expect(push).toEqual([]);expect(map).toEqual(before.map);expect(useStore.getState().index).toBe(before.index)}
})

it('installed iOS PWAs omit the Add to Home Screen tip through navigator.standalone',()=>{
 const own=Object.getOwnPropertyDescriptor(navigator,'standalone')
 try {
  Object.defineProperty(navigator,'standalone',{configurable:true,value:true})
  const host=mount(<Shell/>,'/settings/about');expect(host.textContent).not.toContain('Add to Home');expect(host.textContent).toContain('synthetic-W23-sha')
 } finally {if(own)Object.defineProperty(navigator,'standalone',own);else delete (navigator as any).standalone}
})
