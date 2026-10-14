import {guardedStoreUpdate} from '../../src/lib/guarded-update'
// @vitest-environment happy-dom
globalThis.IS_REACT_ACT_ENVIRONMENT=true
import React,{act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {initializeStore,useStore,DEF,clone,KEY} from '../../src/store/useStore'
import {initializeSyncEngine} from '../../src/store/sync-engine'
import {createBrowserPlatform,browserServerEndpoint} from '../../src/platform/browser'
import {configureClientIO} from '../../src/lib/client-io'
import {configureUx,createBrowserUx} from '../../src/platform/ux'
import {useUI,configureUI,restoreWork,WORK_KEY} from '../../src/store/useUI'
import {captureSheetTarget} from '../../src/lib/sheet-target'
import {captureContext,createSheetUpdater} from '../../src/sheets/sheet-target'
import {captureViewTarget,updateViewTarget} from '../../src/views/view-write-guard'
import {captureWorkoutTarget,workoutTargetUpdate} from '../../src/views/workout-target'
import {captureProgrammeTarget,updateProgramme} from '../../src/lib/programme-target'
import {capturePlanTarget,updatePlanTarget} from '../../src/views/plan-target'
import {createPublicActions} from '../../src/store/public-actions'
import {settingsTarget,settingsUpdate} from '../../src/lib/settings-target'
import ExerciseViewToggle from '../../src/components/ExerciseViewToggle'
import {createExerciseIndex} from '@opengym/core/exercises'
import ErrorBoundary from '../../src/components/ErrorBoundary'
import SettingsB,{RestSoundSheet} from '../../src/views/SettingsB'
import {workoutSettingsSheet} from '../../src/components/WorkoutSettingsSheet'
import {goalSheet} from '../../src/sheets-a'
let map:Map<string,string>,platform:ReturnType<typeof createBrowserPlatform>,dispose:()=>void
const roots:Root[]=[]
const doc=(name='A')=>({...clone(DEF),sound:false,activeEquipId:'same',profileId:'same',future:{name},workouts:[{id:name+'-private',entries:[]}],active:{id:'collision',start:100,d:'2026-10-13',entries:[{id:'1001',sets:[{sec:45,w:0,done:false}]}]}})
const bytes=()=>JSON.stringify([...map].sort(([a],[b])=>a.localeCompare(b)))
function install(name='A'){useStore.getState().setUser({id:name},{adopt:true});useStore.getState().replaceState(doc(name),false)}
function durableB(){map.set(KEY,JSON.stringify(doc('B')));map.set('gym_owner','B');map.set('gym_user',JSON.stringify({id:'B'}));map.set('gym_state_owner','B');map.set('gym_state_wid','B-new-write')}
function mount(element:React.ReactNode){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(element));return host}
function sheet(){return useUI.getState().sheets.at(-1)!}
function buttons(host:HTMLElement){return [...host.querySelectorAll<HTMLButtonElement>('button')]}
beforeEach(()=>{sessionStorage.clear();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));map=new Map([[KEY,JSON.stringify(doc())],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_state_owner','A']]);const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}};platform={...createBrowserPlatform(),kv,server:browserServerEndpoint(kv)};configureClientIO(platform);configureUx(createBrowserUx());initializeStore(platform);dispose=initializeSyncEngine({platform,api:async()=>({}),prompts:{toast:()=>{},askAddDeviceData:async()=>false},acquireAuthLock:async()=>()=>{},acquireSyncLock:async()=>()=>{}});configureUI({platform,deviceId:()=>undefined,notifyRestOver:async()=>{}});useUI.getState().closeAll();useUI.getState().stopWork();useUI.getState().stopRest()})
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));useUI.getState().stopWork();useUI.getState().stopRest();dispose();vi.useRealTimers();document.body.innerHTML=''})
const helpers={
 shell:()=>{const t=captureSheetTarget();return()=>{try{useStore.getState().update(s=>{if(!t(s))throw t;s.targetW=123})}catch(e){if(e!==t)throw e}}},
 exercise:()=>createSheetUpdater(captureContext()).bind(null,(s:any)=>{s.targetW=123}),
 view:()=>{const t=captureViewTarget();return()=>updateViewTarget(t,()=>true,s=>{s.targetW=123})},
 workout:()=>{const t=captureWorkoutTarget();return()=>workoutTargetUpdate(t,s=>{s.targetW=123})},
 programme:()=>{const t=captureProgrammeTarget(platform);return()=>updateProgramme(s=>{s.targetW=123},t)},
 plan:()=>{const t=capturePlanTarget();return()=>updatePlanTarget(t,s=>{s.targetW=123})},
}
for(const [name,open]of Object.entries(helpers))it(`pending owner event: ${name}`,()=>{const callback=open();durableB();const before=bytes();callback();
 // RM pending-storage-event regression: no durable write is allowed.
 expect(bytes()).toBe(before)
})
for(const name of ['exercise','view','workout'] as const)it(`same-account identical replace: ${name}`,()=>{const callback=helpers[name]();useStore.getState().replaceState(doc('replacement'),false);const before=bytes();callback();expect(bytes()).toBe(before);expect(useStore.getState().S.targetW).toBeNull()})
it('ErrorBoundary stale discard deletes replacement workout',()=>{const boundary=new ErrorBoundary({});boundary.state={failed:true};const rendered:any=boundary.render();const children:any[]=rendered.props.children;const fragment=children.find(x=>x?.type===React.Fragment);const discard=fragment.props.children.find((x:any)=>x?.props?.variant==='danger');install('B');const before=bytes();discard.props.onClick();expect(bytes()).toBe(before);expect(useStore.getState().S.active).not.toBeNull()})
it('WorkoutSettings resnapshots its callback at child mount',()=>{workoutSettingsSheet();const opened=sheet();install('B');const host=mount(opened.render(()=>{}));const switchButton=host.querySelector<HTMLElement>('[role="switch"]');expect(switchButton).toBeTruthy();const before=bytes();act(()=>switchButton!.click());expect(bytes()).toBe(before)})
it('restored timed hold edits a replacement duplicate occurrence',()=>{useUI.getState().startWork(45,'Synthetic hold',null,{idx:0,i:0,id:'1001'});const raw=map.get(WORK_KEY)!;useUI.getState().stopWork();install('B');map.set(WORK_KEY,raw);const before=bytes();expect(restoreWork(Date.now()+50_000)).toBe(false);expect(bytes()).toBe(before);expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({done:false,sec:45})})
it('RestSound child has no durable-owner fence',()=>{const host=mount(<RestSoundSheet close={()=>{}}/>);durableB();const before=bytes();const b=buttons(host).find(b=>b.textContent?.includes('Classic beeps'));expect(b).toBeTruthy();act(()=>b!.click());expect(bytes()).toBe(before)})


it('WorkoutSettings refuses a stale callback after same-account replacement',()=>{workoutSettingsSheet();const opened=sheet();const host=mount(opened.render(()=>{}));act(()=>useStore.getState().replaceState(doc('new-document'),false));const before=bytes();act(()=>host.querySelector<HTMLElement>('[role="switch"]')!.click());expect(bytes()).toBe(before)})

it('mounted GoalSheet refuses a pending owner event',()=>{goalSheet();const opened=sheet();const host=mount(opened.render(()=>{}));const input=host.querySelector('input');expect(input).toBeTruthy();act(()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;setter.call(input,'90');input!.dispatchEvent(new Event('input',{bubbles:true}));input!.dispatchEvent(new Event('change',{bubbles:true}))});durableB();const before=bytes();const save=buttons(host).find(b=>b.textContent?.trim()==='Save goal');expect(save).toBeTruthy();act(()=>save!.click());expect(bytes()).toBe(before)})
it('mounted WorkoutSettings refuses a pending owner event',()=>{workoutSettingsSheet();const host=mount(sheet().render(()=>{}));durableB();const before=bytes();act(()=>host.querySelector<HTMLElement>('[role="switch"]')!.click());expect(bytes()).toBe(before)})
it('mounted SettingsB field chooser refuses a pending owner event',()=>{const host=mount(<SettingsB page="units"/>);const button=buttons(host).find(b=>b.textContent?.trim()==='0.25');expect(button).toBeTruthy();durableB();const before=bytes();act(()=>button!.click());expect(bytes()).toBe(before)})
it('mounted ExerciseViewToggle refuses a pending owner event',()=>{const host=mount(<ExerciseViewToggle/>);durableB();const before=bytes();act(()=>buttons(host)[0]!.click());expect(bytes()).toBe(before)})
for(const field of ['heatmapMetric','balanceTemplate','connLocal'])it(`scalar ${field} refuses a pending owner event`,()=>{const update=useStore.getState().update;durableB();const before=bytes();update(s=>{s[field]='stale'});expect(bytes()).toBe(before)})
it('public programme actions refuse a pending owner event',()=>{const actions=createPublicActions(useStore.getState,{platform,toast:()=>{}});durableB();const before=bytes();expect(()=>actions.pauseProgramme('synthetic')).toThrow(/changed|workout/i);expect(bytes()).toBe(before)})
for(const key of ['gym_owner','gym_user','gym_state_owner','lineage'])it(`independent durable ${key} mismatch refuses even SettingsA's partial fence`,()=>{const target=settingsTarget();if(key==='lineage'){map.set(KEY,JSON.stringify({...doc(),_wid:'foreign-lineage',_rev:12}))}else map.set(key,key==='gym_user'?JSON.stringify({id:'B'}):'B');const before=bytes();settingsUpdate(target,s=>{s.restSec=123});expect(bytes()).toBe(before)})
for(const name of ['replaceState','importBackup','resetEverything','signOut','signOutAll','setUnit'])it(`${name} refuses pending B without changing any durable key`,async()=>{durableB();const before=bytes();const action=useStore.getState()[name];if(name==='replaceState')action(doc('replacement'),true,{durable:true});else if(name==='importBackup')action(doc('backup'),{durable:true});else if(name==='setUnit')action('lb');else await action({force:true,durable:true});expect(bytes()).toBe(before)})
for(const name of ['pushState','pullState'])it(`${name} sends nothing under pending B`,async()=>{dispose();const api=vi.fn(async()=>({rev:2}));dispose=initializeSyncEngine({platform,api,prompts:{toast:()=>{},askAddDeviceData:async()=>false},acquireSyncLock:async()=>()=>{}});useStore.setState({ready:true});durableB();const before=bytes();await useStore.getState()[name]();expect(api).not.toHaveBeenCalled();expect(bytes()).toBe(before)})
it('a change of durable owner inside the producer is checked again before persistence',()=>{let before='';useStore.getState().update(s=>{s.targetW=123;durableB();before=bytes()});expect(bytes()).toBe(before)})
it('ordinary same-account peer writes still merge before the local write',()=>{const peer={...doc(),_wid:'server-peer',_rev:3,_ts:100,workouts:[...doc().workouts,{id:'peer-workout',entries:[]}]};map.set(KEY,JSON.stringify(peer));map.set('gym_state_wid','peer-write');map.set('gym_sync',JSON.stringify({rev:3,wid:'server-peer',ts:100}));useStore.getState().update(s=>{s.targetW=123});const saved=JSON.parse(map.get(KEY)!);expect(saved.workouts.map((w:any)=>w.id).sort()).toEqual(['A-private','peer-workout']);expect(saved.targetW).toBe(123);expect(saved.future).toEqual({name:'A'})})
it('a same-account identical replacement invalidates a restored hold',()=>{useUI.getState().startWork(45,'Synthetic hold',null,{idx:0,i:0,id:'1001'});const raw=map.get(WORK_KEY)!;useUI.getState().stopWork();useStore.getState().replaceState(doc(),false);map.set(WORK_KEY,raw);const before=bytes();expect(restoreWork(Date.now()+50_000)).toBe(false);expect(bytes()).toBe(before)})
it('a hold on a deliberate replacement survives a real store rehydration',()=>{useStore.getState().replaceState(doc(),false);useUI.getState().startWork(45,'Synthetic hold',null,{idx:0,i:0,id:'1001'});const raw=map.get(WORK_KEY)!;useUI.getState().stopWork();initializeStore(platform);map.set(WORK_KEY,raw);expect(restoreWork(Date.now()+50_000)).toBe(true);expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(true)})

for(const path of ['first-pull','adopt-profile','merge-restore'])it(`${path} advances the local editor generation for a deliberate replacement`,async()=>{
  dispose();const remote={...doc(),_ts:200,_wid:'remote',_rev:2};
  if(path==='adopt-profile'){map.set(KEY,JSON.stringify({...doc(),_ts:100}));map.set('gym_sync',JSON.stringify({rev:1,ts:100}))}
  dispose=initializeSyncEngine({platform,api:async()=>({state:remote,rev:2}),prompts:{toast:()=>{},askAddDeviceData:async()=>false}});useStore.setState({ready:true});
  if(path==='adopt-profile')useStore.getState().setUser({id:'A'});
  const before=useStore.getState().documentInstance??0, target=captureProgrammeTarget(platform);
  if(path==='first-pull')await useStore.getState().pullState();else if(path==='adopt-profile')await useStore.getState().adoptProfile(async()=>false);else useStore.getState().importBackup(doc(),{mergeWith:{state:remote,rev:2},durable:true});
  expect(useStore.getState().documentInstance).toBeGreaterThan(before);expect(Number(map.get('gym_state_instance'))).toBe(useStore.getState().documentInstance);
  const saved=bytes();expect(updateProgramme(s=>{s.targetW=123},target)).toBe(false);expect(bytes()).toBe(saved);expect(JSON.parse(map.get(KEY)!)).not.toHaveProperty('documentInstance');expect(JSON.parse(map.get(KEY)!)).not.toHaveProperty('gym_state_instance');
})
it('ordinary descendant remote edits retain the local editor generation',async()=>{
  dispose();const local={...doc(),_ts:100,_wid:'old',_rev:1};map.set(KEY,JSON.stringify(local));map.set('gym_sync',JSON.stringify({rev:1,ts:100,wid:'old'}));
  dispose=initializeSyncEngine({platform,api:async()=>({state:{...local,_ts:200,_wid:'new',_rev:2,restSec:120},rev:2}),prompts:{toast:()=>{},askAddDeviceData:async()=>false}});useStore.setState({ready:true});
  const before=useStore.getState().documentInstance,target=captureProgrammeTarget(platform);await useStore.getState().pullState();expect(useStore.getState().documentInstance).toBe(before);expect(updateProgramme(s=>{s.targetW=123},target)).toBe(true)
})
it('a rejected producer is never entered and asks the shell to reload the durable owner',async()=>{dispose();const reload=vi.fn(),toast=vi.fn();platform={...platform,nav:{...platform.nav,reload}};dispose=initializeSyncEngine({platform,api:async()=>({}),prompts:{toast,askAddDeviceData:async()=>false}});const producer=vi.fn();durableB();const before=bytes();useStore.getState().update(producer);await Promise.resolve();expect(producer).not.toHaveBeenCalled();expect(reload).toHaveBeenCalledOnce();expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed.*not saved/i));expect(bytes()).toBe(before)})

it('SettingsB refuses a stale scalar callback after same-account replacement',()=>{const host=mount(<SettingsB page="units"/>);const button=buttons(host).find(b=>b.textContent?.trim()==='0.25')!;expect(button).toBeTruthy();useStore.getState().replaceState(doc(),false);const before=bytes();act(()=>button.click());expect(bytes()).toBe(before)})

it('a stale hold completion preserves every B durable timer byte',()=>{useUI.getState().startWork(45,'A hold',null,{idx:0,i:0,id:'1001'});durableB();map.set(WORK_KEY,JSON.stringify({endsAt:Date.now()+30_000,total:45,label:'B hold',owner:{idx:0,i:0,id:'1001'}}));const before=JSON.stringify([...map].sort());useUI.getState().finishWorkEarly();expect(JSON.stringify([...map].sort())).toBe(before)})
it('a stale rest cleanup preserves every B durable timer byte',()=>{useUI.getState().startRest(45);durableB();map.set('gym_rest',JSON.stringify({endsAt:Date.now()+30_000,total:45}));const before=JSON.stringify([...map].sort());useUI.getState().stopRest();expect(JSON.stringify([...map].sort())).toBe(before)})

it('shared guard reports refusal when durable ownership changes inside an authorized producer',()=>{let before='';const accepted=guardedStoreUpdate(()=>true,s=>{s.targetW=123;durableB();before=bytes()});expect(accepted).toBe(false);expect(bytes()).toBe(before)})
