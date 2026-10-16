// @vitest-environment happy-dom
import './workout-sheet-environment'
import React, {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {DEF, KEY, useStore, type StoreDocument} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import Workout, { copyActiveSet, deleteActiveSet } from '../src/views/Workout'
import * as sheets from '../src/sheets'
import * as duration from '../src/components/DurationWheel'
import {workoutSheetPlatform} from './workout-sheet-environment'

vi.mock('../src/lib/api',()=>({api:vi.fn().mockResolvedValue({}),beacon:vi.fn(),appBase:()=> '/'}))
const roots: Root[] = []
const row = (w=40) => ({w,r:8,done:false})
const entry = (id='0025', extra: any={}) => ({id,rid:'r',target:{sets:2,reps:8,weight:40,restSec:45,...extra},plan:{policy:'linear',kind:'first'},sets:[row(),row()]})
const document = (name='A'): StoreDocument => ({...structuredClone(DEF),sound:false,hints:{swipeSets:true},profileId:'profile-'+name,routines:[{id:'r',name:'Synthetic routine',ex:[{id:'0025',sets:2,reps:8,weight:40}]}],active:{id:'collision',d:'2026-10-13',start:100,name,cur:0,entries:[entry(),entry('0027')]},unknown:{keep:name}})
let host: HTMLDivElement
function install(name='A',patch: any={}) {const S={...document(name),...patch};useStore.getState().setUser({id:name}, {adopt:true});useStore.setState({S});useStore.getState().update(()=>{},false)}
function mount() {host=globalThis.document.createElement('div');globalThis.document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(<Workout/>));return host}
function tap(label:string, within=host) {const button=within.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)??[...within.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label);expect(button,label).toBeTruthy();act(()=>button!.click())}
const items=(opts:any)=>(opts.sections?opts.sections.flatMap((s:any)=>s.items):opts.items).filter(Boolean)
function more(label:string) {tap('More');const menu=vi.mocked(sheets.menuSheet).mock.calls.at(-1)![0];const action=items(menu).find((i:any)=>i.label===label);expect(action,label).toBeTruthy();act(()=>action.onClick())}
function options(label:string) {tap('Workout options');const menu=vi.mocked(sheets.menuSheet).mock.calls.at(-1)![0];const action=items(menu).find((i:any)=>i.label===label);expect(action,label).toBeTruthy();act(()=>action.onClick())}
const saved = () => workoutSheetPlatform.kv.get(KEY)
function replace(kind:string) {act(()=>{
  if(kind==='account')install('B')
  else if(kind==='away-back'){install('B');install('A')}
  else if(kind==='profile')install('A',{profileId:'other-profile'})
  else if(kind==='session')install('A',{active:{...document('A').active,start:200}})
  else if(kind==='editor')install('A',{active:{...document('A').active,editingWorkoutId:'saved',editBase:{sheetInstanceId:'new-editor'}}})
  else if(kind==='duplicate-reorder')useStore.getState().update(S=>{S.active.entries.reverse()},false)
})}
function noWrite(run:()=>void) {const before=saved();act(run);expect(saved()).toBe(before);expect(useUI.getState().toastMsg).toContain('changed')}
beforeEach(()=>{vi.spyOn(workoutSheetPlatform.transport,'fetch').mockResolvedValue(new Response('{}',{status:200}));install();vi.spyOn(sheets,'menuSheet').mockImplementation(()=>({id:'menu',close(){},lock(){}}));vi.spyOn(sheets,'confirmSheet').mockImplementation(()=>({id:'confirm',close(){},lock(){}}));vi.spyOn(sheets,'exConfigSheet').mockImplementation(()=>({id:'config',close(){},lock(){}}));vi.spyOn(sheets,'exercisePicker').mockImplementation(()=>({id:'pick',close(){},lock(){}}));vi.spyOn(duration,'durationSheet').mockImplementation(()=>({id:'duration',close(){},lock(){}}))})
afterEach(()=>{act(()=>roots.splice(0).forEach(root=>root.unmount()));globalThis.document.body.innerHTML='';useUI.getState().stopWork();useUI.getState().stopRest();vi.restoreAllMocks()})

const actions = {
  discard: () => {options('Discard workout');return vi.mocked(sheets.confirmSheet).mock.calls.at(-1)![0].onConfirm!},
  remove: () => {more('Remove exercise');return vi.mocked(sheets.confirmSheet).mock.calls.at(-1)![0].onConfirm!},
  rest: () => {more('Rest timer');return ()=>vi.mocked(duration.durationSheet).mock.calls.at(-1)![0].onDone!(60)},
  progression: () => {more('Exercise settings');const save=vi.mocked(sheets.exConfigSheet).mock.calls.at(-1)![2];return ()=>save({sets:3,reps:10,weight:50})},
  add: () => {tap('Add exercise');const pick=vi.mocked(sheets.exercisePicker).mock.calls.at(-1)![0];act(()=>pick({id:'0043',n:'Synthetic lift'} as any,false));const save=vi.mocked(sheets.exConfigSheet).mock.calls.at(-1)![2];return ()=>save({sets:1,reps:5,weight:20})},
  routine: () => {act(()=>useStore.getState().update(S=>{S.active.entries[0].target.restSec=120},false));more('Update routine');return vi.mocked(sheets.confirmSheet).mock.calls.at(-1)![0].onConfirm!},
}
describe('W18 real W07 updater and saved-byte safety',()=>{
  for(const [name,open] of Object.entries(actions)) {
    it.each(['account','away-back','profile','session','editor'])(`${name} refuses stale %s even when ids collide`,kind=>{mount();const callback=open();replace(kind);noWrite(callback)})
    it(`${name} succeeds for its original owner`,()=>{mount();const callback=open();const before=saved();act(callback);expect(saved(),useUI.getState().toastMsg).not.toBe(before)})
  }
  it.each(['remove','rest','progression','routine'] as const)('%s refuses a same-count duplicate occurrence reorder',name=>{
    act(()=>useStore.getState().update(S=>{S.active.entries[1]=entry('0025',{restSec:75})},false));mount();const callback=actions[name]();replace('duplicate-reorder');noWrite(callback)
  })
  it('revalidates inside the actual updater draft after a pre-call owner check',()=>{
    mount();const callback=actions.remove();const original=useStore.getState().update
    let bytes:string|null=null
    useStore.setState({update:(mutate,push)=>{useStore.setState({update:original});install('B');bytes=saved();original(draft=>mutate(draft),push)}})
    act(callback);expect(saved()).toBe(bytes);expect(useUI.getState().toastMsg).toContain('changed');useStore.setState({update:original})
  })
  it('progression Save round-trips unknown target keys and logged rows',()=>{
    act(()=>useStore.getState().update(S=>{S.active.entries[0].target.future={nested:42};S.active.entries[0].sets[0]={...row(),done:true,at:12,future:'logged'}},false));mount();actions.progression()();
    expect(useStore.getState().S.active.entries[0].target.future).toEqual({nested:42});expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({done:true,at:12,future:'logged'})
  })
  it.each(['account','away-back','profile','session','editor'])('a captured hold completion refuses %s',kind=>{
    act(()=>useStore.getState().update(S=>{S.active.entries[0]=entry('1001',{mode:'time',sec:45});S.active.entries[0].sets=[{sec:45,w:0,done:false},{sec:45,w:0,done:false}]},false))
    const start=vi.spyOn(useUI.getState(),'startWork');mount();tap('Start set');const callback=start.mock.calls.at(-1)![2]!;replace(kind);noWrite(()=>callback(10))
  })
  it('a same-owner hold logs seconds and ticks exactly its own row',()=>{
    act(()=>useStore.getState().update(S=>{S.active.entries[0]=entry('1001',{mode:'time',sec:45});S.active.entries[0].sets=[{sec:45,w:0,done:false},{sec:45,w:0,done:false}]},false));const start=vi.spyOn(useUI.getState(),'startWork');mount();tap('Start set');act(()=>start.mock.calls.at(-1)![2]!(10));expect(useStore.getState().S.active.entries[0].sets.map((s:any)=>[s.sec,s.done])).toEqual([[10,true],[45,false]])
  })
  it('W16 integration: identical-id same-account replaceState invalidates a captured discard',()=>{
    mount();const callback=actions.discard();const S=structuredClone(useStore.getState().S);S.unknown={replacement:'B'};act(()=>useStore.getState().replaceState(S,false));noWrite(callback)
  })
})

it.each(['entry','row'])('a hold bound to an occurrence refuses a same-count %s reorder',kind=>{act(()=>useStore.getState().update(S=>{S.active.entries=[{...entry('1001',{mode:'time',sec:45}),sets:[{sec:45,w:10,done:false},{sec:30,w:20,done:false}]},{...entry('1001',{mode:'time',sec:45}),sets:[{sec:45,w:10,done:false},{sec:30,w:30,done:false}]}]},false));const start=vi.spyOn(useUI.getState(),'startWork');mount();tap('Start set');const cb=start.mock.calls.at(-1)![2]!;act(()=>useStore.getState().update(S=>{if(kind==='entry')S.active.entries.reverse();else S.active.entries[0].sets.reverse()},false));noWrite(()=>cb(10))})

it('a manual tick of the held row keeps its actual seconds and its completed tick',()=>{act(()=>useStore.getState().update(S=>{S.active.entries[0]={...entry('1001',{mode:'time',sec:45}),sets:[{sec:45,w:0,done:false},{sec:45,w:0,done:false}]}},false));mount();tap('Start set');act(()=>useUI.setState({work:{...useUI.getState().work!,left:35}}));act(()=>host.querySelector<HTMLElement>('[role="checkbox"]')!.click());expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({sec:10,done:true});expect(useStore.getState().S.active.entries[0].sets[0]).not.toHaveProperty('planSec')})
it.each(['intensifier','pyramid'] as const)('Exercise settings clears %s while retaining opaque target data and logged rows',field=>{act(()=>useStore.getState().update(S=>{const e=S.active.entries[0];e.target.future={nested:42};e.target[field]=field==='intensifier'?{type:'dropset',count:1,pct:25}:[8,5];if(field==='pyramid'){e.target.pyramidWeight=[40,50];e.target.pyramidRest=[30,90]}e.sets[0]={...row(),done:true,at:12,future:'logged'}},false));mount();act(actions.progression());const e=useStore.getState().S.active.entries[0];expect(e.target.future).toEqual({nested:42});expect(e.target).not.toHaveProperty(field);expect(e.sets[0]).toMatchObject({done:true,at:12,future:'logged'});expect(e.sets.slice(1).some((r:any)=>r.drops||r.max)).toBe(false);if(field==='pyramid'){expect(e.target).not.toHaveProperty('pyramidWeight');expect(e.target).not.toHaveProperty('pyramidRest')}})
it('ticking another row in the same entry hands back the held row seconds without ticking it',()=>{act(()=>useStore.getState().update(S=>{S.active.entries[0]={...entry('1001',{mode:'time',sec:45}),sets:[{sec:45,w:0,done:false},{sec:45,w:0,done:false}]}},false));mount();tap('Start set');act(()=>useUI.setState({work:{...useUI.getState().work!,left:35}}));act(()=>host.querySelectorAll<HTMLElement>('[role="checkbox"]')[1]!.click());expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({sec:10,done:false,planSec:45});expect(useStore.getState().S.active.entries[0].sets[1].done).toBe(true)})

function timedEntries() {
  return [10, 30].map(w => ({...entry('1001', {mode:'time',sec:45}), sets:[
    {sec:45,w,done:false}, {sec:30,w:w+10,done:false}, {sec:60,w:w+20,done:false},
  ]}))
}
function mountTimed(i=0) {
  act(()=>useStore.getState().update(S=>{S.active.entries=timedEntries()},false))
  const start=vi.spyOn(useUI.getState(),'startWork');mount()
  act(()=>host.querySelectorAll<HTMLButtonElement>('button[aria-label="Start set"]')[i]!.click())
  return start.mock.calls.at(-1)![2]!
}
function stateAndBytes() {return {published:JSON.stringify(useStore.getState().S),saved:saved(),wid:workoutSheetPlatform.kv.get('gym_state_wid')}}
it.each(['entry','row'].flatMap(kind=>['field','tick','copy'].map(action=>[kind,action])))('a %s reorder followed by %s cannot refresh a timed hold into the new occupant', (kind,action)=>{
  const callback=mountTimed()
  act(()=>useStore.getState().update(S=>{if(kind==='entry')S.active.entries.reverse();else S.active.entries[0].sets.reverse()},false))
  act(()=>{
    if(action==='field')host.querySelector<HTMLButtonElement>('.setrow .stp.w button[aria-label="Increase"]')!.click()
    else if(action==='tick')host.querySelector<HTMLElement>('[role="checkbox"]')!.click()
    else copyActiveSet(0,0)
  })
  const before=stateAndBytes()
  act(()=>callback(12))
  expect(stateAndBytes()).toEqual(before)
  expect(useUI.getState().toastMsg).toContain('changed')
  expect(useStore.getState().S.active.entries.flatMap((e:any)=>e.sets).some((r:any)=>r.sec===12)).toBe(false)
})
it('editing the same held occurrence retains its ownership and actual seconds',()=>{
  const callback=mountTimed()
  act(()=>host.querySelector<HTMLButtonElement>('.setrow .stp.w button[aria-label="Increase"]')!.click())
  act(()=>callback(12))
  expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({sec:12,done:true,w:10})
  expect(useStore.getState().S.active.entries[1].sets[0]).toMatchObject({sec:45,done:false,w:30})
})
it.each(['copy','delete','undo'])('a same-owner hold follows its row through %s above it',action=>{
  const callback=mountTimed(1)
  let token:any
  if(action==='undo') {act(()=>deleteActiveSet(0,0));token=useUI.getState().toastAction?.run}
  act(()=>{
    if(action==='copy')copyActiveSet(0,0)
    else if(action==='delete')deleteActiveSet(0,0)
    else {expect(token).toBeTypeOf('function');token()}
  })
  act(()=>callback(12))
  const rows=useStore.getState().S.active.entries[0].sets
  expect(rows.filter((r:any)=>r.done)).toEqual([expect.objectContaining({sec:12,w:20})])
  expect(rows[action==='copy'?2:action==='delete'?0:1]).toMatchObject({sec:12,w:20,done:true})
})
it.each(['new-session','reused-identity','late-row-edit','profile'])('discard refuses a pending same-account durable %s without stamping or publishing',kind=>{
  mount();const callback=actions.discard(), old=JSON.stringify(useStore.getState().S)
  const newer=structuredClone(useStore.getState().S)
  if(kind==='new-session')newer.active={...newer.active,id:'new-session',start:200}
  else if(kind==='reused-identity')newer.active.name='new session with reused identity'
  else if(kind==='late-row-edit')newer.active.entries[0].sets[0].done=true
  else newer.profileId='new-profile'
  // Other-tab bytes are saved before its storage event has reached this mounted tab.
  workoutSheetPlatform.kv.set(KEY,JSON.stringify(newer));workoutSheetPlatform.kv.set('gym_state_wid','other-tab-new-write')
  expect(JSON.stringify(useStore.getState().S)).toBe(old)
  const before=stateAndBytes();act(callback)
  expect(stateAndBytes()).toEqual(before);expect(useUI.getState().toastMsg).toContain('changed')
})
it('discard permits an unrelated same-account durable write while preserving it',()=>{
  mount();const callback=actions.discard(), newer=structuredClone(useStore.getState().S)
  newer.restSec=120;newer._ts=Date.now()+100;newer.edited={...newer.edited,restSec:Date.now()+100}
  workoutSheetPlatform.kv.set(KEY,JSON.stringify(newer));workoutSheetPlatform.kv.set('gym_state_wid','other-tab-unrelated')
  act(callback)
  expect(useStore.getState().S.active).toBeNull()
  expect(JSON.parse(saved()!).restSec).toBe(120)
})

it.each(['account','saved-owner'])('discard refuses a different account durable %s while its storage event is pending',kind=>{
  mount();const callback=actions.discard(), old=JSON.stringify(useStore.getState().S)
  const B=document('B')
  workoutSheetPlatform.kv.set(KEY,JSON.stringify(B));workoutSheetPlatform.kv.set('gym_state_wid','B-new-write')
  workoutSheetPlatform.kv.set('gym_state_owner','B')
  if(kind==='account') {workoutSheetPlatform.kv.set('gym_owner','B');workoutSheetPlatform.kv.set('gym_user',JSON.stringify({id:'B'}))}
  const before=stateAndBytes();act(callback)
  expect(stateAndBytes()).toEqual(before);expect(JSON.stringify(useStore.getState().S)).toBe(old)
  expect(saved()).toBe(JSON.stringify(B));expect(useUI.getState().toastMsg).toContain('changed')
})

it.each([2,3,1])('Exercise settings preserves surviving unfinished occurrence metadata with %s requested sets',sets=>{
  act(()=>useStore.getState().update(S=>{
    const e=S.active.entries[0]
    e.sets=[{...row(),futureRow:{first:42}},{...row(),done:true,futureRow:{logged:43}},{...row(),futureRow:{second:44}}]
  },false))
  mount();more('Exercise settings');const save=vi.mocked(sheets.exConfigSheet).mock.calls.at(-1)![2]
  act(()=>save({sets,reps:10,weight:50}))
  const rows=useStore.getState().S.active.entries[0].sets
  expect(rows[0]).toMatchObject({done:true,futureRow:{logged:43},w:40,r:8})
  if(sets>1)expect(rows[1]).toMatchObject({done:false,futureRow:{first:42},w:50,r:10})
  if(sets>2)expect(rows[2]).toMatchObject({done:false,futureRow:{second:44},w:50,r:10})
  expect(JSON.parse(saved()!).active.entries[0].sets).toEqual(rows)
})
it('newly added rows do not inherit metadata from an existing unfinished row',()=>{
  act(()=>useStore.getState().update(S=>{S.active.entries[0].sets=[{...row(),futureRow:{first:42}}]},false))
  mount();more('Exercise settings');const save=vi.mocked(sheets.exConfigSheet).mock.calls.at(-1)![2]
  act(()=>save({sets:3,reps:8,weight:40}))
  const rows=useStore.getState().S.active.entries[0].sets
  expect(rows[0].futureRow).toEqual({first:42});expect(rows[1]).not.toHaveProperty('futureRow');expect(rows[2]).not.toHaveProperty('futureRow')
})
it.each(['remove','rest','progression','routine','add'] as const)('%s refuses a pending durable account switch inside its producer',name=>{
  mount();const callback=actions[name](), B=document('B')
  workoutSheetPlatform.kv.set(KEY,JSON.stringify(B));workoutSheetPlatform.kv.set('gym_state_wid','B-new-write');workoutSheetPlatform.kv.set('gym_owner','B');workoutSheetPlatform.kv.set('gym_state_owner','B');workoutSheetPlatform.kv.set('gym_user',JSON.stringify({id:'B'}))
  const before=stateAndBytes();act(callback);expect(stateAndBytes()).toEqual(before);expect(saved()).toBe(JSON.stringify(B));expect(useUI.getState().toastMsg).toContain('changed')
})
it.each(['complete','abandon'])('hold %s refuses a pending durable replacement session',mode=>{
  const callback=mountTimed(), newer=structuredClone(useStore.getState().S)
  newer.active.start=200;newer.active.entries[0].sets[0].done=true
  workoutSheetPlatform.kv.set(KEY,JSON.stringify(newer));workoutSheetPlatform.kv.set('gym_state_wid','other-session')
  const before=stateAndBytes();act(()=>callback(12,{abandoned:mode==='abandon'}));expect(stateAndBytes()).toEqual(before);expect(useUI.getState().toastMsg).toContain('changed')
})

it('unchanged Exercise settings retains the opaque keys of the surviving unfinished row',()=>{
  act(()=>useStore.getState().update(S=>{S.active.entries[0].sets=[{...row(),futureRow:{nested:42}},{...row(),done:true,futureRow:{logged:43}}]},false))
  mount();more('Exercise settings');const save=vi.mocked(sheets.exConfigSheet).mock.calls.at(-1)![2]
  act(()=>save({sets:2,reps:8,weight:40}))
  expect(useStore.getState().S.active.entries[0].sets).toEqual([
    expect.objectContaining({futureRow:{logged:43},done:true,w:40,r:8}),
    expect.objectContaining({futureRow:{nested:42},done:false,w:40,r:8}),
  ])
  expect(JSON.parse(saved()!).active.entries[0].sets[1].futureRow).toEqual({nested:42})
})

it.each(['account','session','row-edit'])('set-delete Undo refuses a pending durable %s without stamping or publishing',kind=>{
  mountTimed(2);act(()=>deleteActiveSet(0,0));const undo=useUI.getState().toastAction!.run
  const newer=structuredClone(useStore.getState().S)
  if(kind==='session')newer.active.start=200
  else if(kind==='row-edit')newer.active.entries[0].sets[0].w=99
  if(kind==='account') {
    workoutSheetPlatform.kv.set('gym_owner','B');workoutSheetPlatform.kv.set('gym_state_owner','B');workoutSheetPlatform.kv.set('gym_user',JSON.stringify({id:'B'}))
  }
  workoutSheetPlatform.kv.set(KEY,JSON.stringify(newer));workoutSheetPlatform.kv.set('gym_state_wid','undo-other-tab')
  const before=stateAndBytes();act(undo);expect(stateAndBytes()).toEqual(before);expect(useUI.getState().toastMsg).toContain('changed')
})

it('successful normal discard confirms only the captured profile and session start to the server guard',async()=>{
  const {api}=await import('../src/lib/api')
  mount();const confirm=actions.discard();vi.mocked(api).mockClear()
  act(confirm)
  const signals=vi.mocked(api).mock.calls.filter(([path,opts])=>path==='/api/activity' && JSON.parse(String(opts?.body)).reason==='discarded')
  expect(signals).toHaveLength(1)
  expect(JSON.parse(String(signals[0]![1]!.body))).toEqual({active:false,reason:'discarded',profileId:'A',sessionId:'collision',startedAt:100})
  expect(useStore.getState().S.active).toBe(null)
})
it.each(['account','session','profile'])('stale %s discard never emits an idle confirmation',async kind=>{
  const {api}=await import('../src/lib/api')
  mount();const confirm=actions.discard();replace(kind);vi.mocked(api).mockClear()
  noWrite(confirm)
  expect(vi.mocked(api).mock.calls.filter(([path,opts])=>path==='/api/activity' && JSON.parse(String(opts?.body)).reason==='discarded')).toEqual([])
})
