// @vitest-environment happy-dom
import './workout-sheet-environment'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { workoutSheetPlatform } from './workout-sheet-environment'
import { createSyncEngine } from '../src/store/sync-engine'
import { captureWorkoutRow, captureWorkoutTarget, workoutTargetUpdate } from '../src/views/workout-target'
import { deleteActiveSet, copyActiveSet, removeActiveExercise } from '../src/views/Workout'
import { WorkoutSettings, workoutSettingsSheet } from '../src/components/WorkoutSettingsSheet'
import Workout from './W17-harness'
import * as sheets from '../src/sheets'
import {configureUx,createBrowserUx} from '../src/platform/ux'
const roots: Root[] = [], disposals: (() => void)[] = []
const originalUpdate = useStore.getState().update
const st = () => useStore.getState().S
const entry = (w = 40) => ({id:'0043',target:{mode:'reps',sets:2,reps:5},sets:[{w,r:5,done:false},{w:60,r:5,done:false}]})
function install(extra: any = {}) { const ux=createBrowserUx();configureUx({...ux,audio:{...ux.audio,vibrateSupported:()=>true},wakeLock:{...ux.wakeLock,supported:()=>true}}); useStore.getState().update(s => { s.active={id:'same-id',start:100,d:'2026-10-13',cur:0,entries:[entry()],...extra}; s.wc={...s.wc,unknownControl:{keep:true}} }) }
function mount(node: React.ReactNode) {const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(node));return host}
function top() {const sheet=useUI.getState().sheets.at(-1)!;return mount(sheet.render(()=>useUI.getState().closeSheet(sheet.id)))}
function click(host: HTMLElement, text: string) {const el=[...host.querySelectorAll<HTMLElement>('button,.menu-item')].find(e=>(e.querySelector('.tt')?.textContent ?? e.textContent)?.trim()===text);expect(el,text).toBeTruthy();act(()=>el!.click())}
function settingsAction(host: HTMLElement, kind: string) {
 const label: Record<string,string>={sound:'Play a sound',vibrate:'Vibrate',flash:'Flash the screen',wake:'Keep screen awake',swipe:'Swipe actions',layout:'Layout',effort:'Effort scale',gif:'Exercise animations',rest:'Rest timer'}
 const row=[...host.querySelectorAll<HTMLElement>('.lrow')].find(e=>e.querySelector('.lrow-t')?.textContent===label[kind])!
 if(kind==='layout')click(row,'Compact');else if(kind==='effort')click(row,'RIR');else if(kind==='gif')click(row,'Small');else act(()=>row.querySelector<HTMLButtonElement>('[role=switch]')!.click())
}
const refused=(bytes: string | null, published: string)=>{expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBe(bytes);expect(JSON.stringify(st())).toBe(published);expect(useUI.getState().toastMsg).toContain('workout changed')}
function swap(kind: string) {
 if(kind==='account')useStore.setState({user:{id:'B'}})
 useStore.getState().update(s=>{if(kind==='profile')s.activeEquipId='B';if(kind==='session')s.active.start=200;if(kind==='editor')s.active.editBase={sheetInstanceId:'reopened'};s.savedBy='B';s.active.entries[0].sets[0].w=99})
}
// Change the producer's actual draft after earlier dialog checks/probes passed.
function atProducer(kind: string, boundary = 1) {
 const B=structuredClone(st());B.savedBy='B';if(kind==='draft-profile')B.activeEquipId='B';if(kind==='session')B.active.start=200;if(kind==='row'){if(B.active.entries[0].sets[0])B.active.entries[0].sets[0].w=99;else B.active.entries[0].target.label='replaced'}
 const bytes=JSON.stringify(B);workoutSheetPlatform.kv.set('gym_state_v1',bytes)
 const engine=createSyncEngine(useStore.setState,useStore.getState,{platform:workoutSheetPlatform,api:vi.fn().mockResolvedValue({}),prompts:{askAddDeviceData:()=>false,toast:m=>useUI.getState().toast(m)}})
 disposals.push(engine.dispose);let calls=0;const after=vi.fn();const published=JSON.stringify(st())
 useStore.setState({update(mutate,push){calls++;if(calls===boundary){if(kind==='account')useStore.setState({S:B,user:{id:'B'}});engine.actions.update(draft=>{Object.assign(draft,B);mutate(draft)},push);after()}else engine.actions.update(mutate,push)}})
 return {bytes,published,after,B}
}
afterEach(()=>{disposals.splice(0).forEach(fn=>fn());useStore.setState({update:originalUpdate});act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.innerHTML='';vi.restoreAllMocks()})
it.each(['sound','vibrate','flash','wake','swipe','layout','effort'].flatMap(kind=>['account','draft-profile','session'].map(owner=>[kind,owner])))('%s settings aborts a %s replacement inside W07 producer', (kind,owner)=>{
 install();const host=mount(<WorkoutSettings close={()=>{}}/>);const {bytes,published,after}=atProducer(owner)
 settingsAction(host,kind)
 expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBe(bytes);expect(JSON.stringify(st())).toBe(owner==='account'?bytes:published);expect(after).not.toHaveBeenCalled();expect(useUI.getState().toastMsg).toContain('workout changed')
})
it.each(['account','profile','session','editor'])('settings duration preserves %s replacement bytes at delayed Done',owner=>{
 install();const host=mount(<WorkoutSettings close={()=>{}}/>);act(()=>[...host.querySelectorAll<HTMLElement>('.lrow')].find(e=>e.querySelector('.lrow-t')?.textContent==='Rest timer')!.click());const wheel=top()
 act(()=>swap(owner));const bytes=workoutSheetPlatform.kv.get('gym_state_v1'),published=JSON.stringify(st());click(wheel,'Done');refused(bytes,published)
})
it('duration updates its original account and wc edits retain unknown keys',()=>{
 install();const host=mount(<WorkoutSettings close={()=>{}}/>);act(()=>[...host.querySelectorAll<HTMLElement>('.lrow')].find(e=>e.querySelector('.lrow-t')?.textContent==='Rest timer')!.click());click(top(),'Done');expect(st().restSec).toBe(90);settingsAction(host,'swipe');expect(st().wc.unknownControl).toEqual({keep:true});expect(st().wc.swipeSets).toBe(false)
})
it('closing the settings editor refuses its delayed duration callback',()=>{
 install();workoutSettingsSheet();const host=top();act(()=>[...host.querySelectorAll<HTMLElement>('.lrow')].find(e=>e.querySelector('.lrow-t')?.textContent==='Rest timer')!.click());const wheel=top();const parent=useUI.getState().sheets[0]!;act(()=>useUI.getState().closeSheet(parent.id));const bytes=workoutSheetPlatform.kv.get('gym_state_v1'),published=JSON.stringify(st());click(wheel,'Done');refused(bytes,published)
})
it.each(['Drop set','Rest-pause burst','Taken to failure','Make it a warm-up set'].flatMap(action=>['account','draft-profile','session','row'].map(owner=>[action,owner])))('%s set menu rejects %s at its own producer after the callback probe', (action,owner)=>{
 install();const host=mount(<Workout/>);act(()=>host.querySelector<HTMLButtonElement>('button.n')!.click());const menu=top();const {bytes,published,after}=atProducer(owner,2);click(menu,action)
 expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBe(bytes);expect(JSON.stringify(st())).toBe(owner==='account'?bytes:published);expect(after).not.toHaveBeenCalled();expect(useUI.getState().toastMsg).toContain('workout changed')
})
it.each(['Drop set','Rest-pause burst','Taken to failure','Make it a warm-up set'])('%s menu succeeds on the same account',action=>{
 install();const host=mount(<Workout/>);act(()=>host.querySelector<HTMLButtonElement>('button.n')!.click());click(top(),action);expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBeTruthy();expect(st().active.entries[0].sets).toHaveLength(2)
 if(action==='Drop set')expect(st().active.entries[0].sets[0].drops).toHaveLength(1)
 if(action==='Rest-pause burst')expect(st().active.entries[0].sets[0].clusters).toHaveLength(1)
 if(action==='Taken to failure')expect(st().active.entries[0].sets[0].failure).toBe(true)
 if(action==='Make it a warm-up set')expect(st().active.entries[0].sets[0].phase).toBe('warmup')
})
it.each(['copy','delete','remove'])('%s set helper aborts replacement draft before UI timers or persistence',kind=>{
 install();const target=captureWorkoutRow(0,kind==='remove'?undefined:0);const {bytes,published,after}=atProducer('draft-profile');const stop=vi.spyOn(useUI.getState(),'stopWork');stop.mockClear()
 if(kind==='copy')expect(copyActiveSet(0,0,target)).toBe(false);else if(kind==='delete')expect(deleteActiveSet(0,0,{target})).toBe(false);else expect(removeActiveExercise(0,target)).toBe(false)
 refused(bytes,published);expect(after).not.toHaveBeenCalled();expect(stop).not.toHaveBeenCalled()
})
it.each(['account','profile','session','editor'])('Undo cannot restore A rows into a colliding %s target',owner=>{
 install();deleteActiveSet(0,0);const undo=useUI.getState().toastAction!.run;act(()=>swap(owner));const bytes=workoutSheetPlatform.kv.get('gym_state_v1'),published=JSON.stringify(st());act(()=>undo());refused(bytes,published)
})
it('Undo follows its duplicate exercise occurrence after reordering and cannot run twice',()=>{
 install();useStore.getState().update(s=>{s.active.entries.push(entry(90));s.active.entries[0].workoutRowIdentity={unknown:'retain'}});deleteActiveSet(0,0);const undo=useUI.getState().toastAction!.run;useStore.getState().update(s=>{s.active.entries.reverse()});act(()=>undo());expect(st().active.entries[0].sets[0].w).toBe(90);expect(st().active.entries[1].sets[0].w).toBe(40);expect(st().active.entries[1].workoutRowIdentity).toEqual({unknown:'retain'});const bytes=workoutSheetPlatform.kv.get('gym_state_v1'),published=JSON.stringify(st());act(()=>undo());refused(bytes,published)
})
it('account A to B to A invalidates an old context even with identical document bytes',()=>{
 install();const target=captureWorkoutTarget();useStore.setState({user:{id:'B'}});useStore.setState({user:null});const bytes=workoutSheetPlatform.kv.get('gym_state_v1'),published=JSON.stringify(st());expect(workoutTargetUpdate(target,s=>{s.sound=true})).toBe(false);refused(bytes,published)
})
it('unrelated producer errors propagate without being mislabeled as stale targets',()=>{install();expect(()=>workoutTargetUpdate(captureWorkoutTarget(),()=>{throw new Error('Synthetic failure')})).toThrow('Synthetic failure')})

// Callbacks supplied by W12/W14 are delivered after their editors have opened. The caller
// owns the producer; a row validator must survive every intermediate menu/parent wrapper.
it.each(['account','draft-profile','session','row'].flatMap(owner=>['list','focus'].map(view=>[owner,view])))('effort picker in %s/%s rejects the final replacement producer', (owner,view)=>{
 install({workoutView:view});useStore.getState().update(s=>{s.effort='rir'});const host=mount(<Workout/>);let callback:((v:number)=>unknown)|undefined;vi.spyOn(sheets,'effortPickerSheet').mockImplementation((_kind,_value,done)=>{callback=done as any;return {id:'fixture',close(){},lock(){}}});act(()=>host.querySelector<HTMLButtonElement>('.effcell')!.click());const {bytes,published,after}=atProducer(owner,3);act(()=>callback!(2));expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBe(bytes);expect(JSON.stringify(st())).toBe(owner==='account'?bytes:published);expect(after).not.toHaveBeenCalled();expect(useUI.getState().toastMsg).toContain('workout changed')
})
it.each(['list','focus'])('effort picker in %s succeeds for its original row',view=>{
 install({workoutView:view});useStore.getState().update(s=>{s.effort='rir'});const host=mount(<Workout/>);let callback:((v:number)=>unknown)|undefined;vi.spyOn(sheets,'effortPickerSheet').mockImplementation((_kind,_value,done)=>{callback=done as any;return {id:'fixture',close(){},lock(){}}});act(()=>host.querySelector<HTMLButtonElement>('.effcell')!.click());act(()=>callback!(2));expect(st().active.entries[0].sets[0].rir).toBe(2);if(view==='list')expect(st().active.entries[0].sets[0].done).toBe(true)
})
it.each(['account','draft-profile','session','row'])('focus set menu carries the row target through the parent producer for %s',owner=>{
 install({workoutView:'focus'});const host=mount(<Workout/>);act(()=>host.querySelector<HTMLButtonElement>('[aria-label="Set menu"]')!.click());const menu=top();const {bytes,published,after}=atProducer(owner,3);click(menu,'Add drop set');expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBe(bytes);expect(JSON.stringify(st())).toBe(owner==='account'?bytes:published);expect(after).not.toHaveBeenCalled();expect(useUI.getState().toastMsg).toContain('workout changed')
})
it.each(['account','draft-profile','session'])('per-side weight and cascade abort %s inside their owned producer',owner=>{
 install();useStore.getState().update(s=>{s.active.entries[0].target.side=true;s.active.entries[0].sets.forEach((row:any)=>{row.sides={L:{w:row.w,r:4,done:false},R:{w:row.w,r:4,done:false}}})});const host=mount(<Workout/>);const {bytes,published,after}=atProducer(owner);act(()=>host.querySelector<HTMLButtonElement>('.side-rows .stp.w [aria-label="Increase"]')!.click());expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBe(bytes);expect(JSON.stringify(st())).toBe(owner==='account'?bytes:published);expect(after).not.toHaveBeenCalled();expect(useUI.getState().toastMsg).toContain('workout changed')
})

it.each(['list','focus'])('unmounting the originating %s editor refuses its queued effort callback',view=>{
 install({workoutView:view});useStore.getState().update(s=>{s.effort='rir'});const host=mount(<Workout/>);let callback:((v:number)=>unknown)|undefined;vi.spyOn(sheets,'effortPickerSheet').mockImplementation((_kind,_value,done)=>{callback=done as any;return {id:'fixture',close(){},lock(){}}});act(()=>host.querySelector<HTMLButtonElement>('.effcell')!.click());act(()=>roots.splice(0).forEach(r=>r.unmount()));const bytes=workoutSheetPlatform.kv.get('gym_state_v1'),published=JSON.stringify(st());act(()=>callback!(2));refused(bytes,published)
})

it('Undo refuses a different exercise that inherited its occurrence token',()=>{
 install();deleteActiveSet(0,0);const undo=useUI.getState().toastAction!.run;useStore.getState().update(s=>{s.active.entries[0].id='2138';s.active.entries[0].target={mode:'cardio'};s.active.entries[0].sets=[{min:10,speed:5,done:false}]});const bytes=workoutSheetPlatform.kv.get('gym_state_v1'),published=JSON.stringify(st());act(()=>undo());refused(bytes,published)
})
it('a menu target distinguishes identical duplicate rows by their unknown entry fields',()=>{
 install();useStore.getState().update(s=>{s.active.entries.push(entry());s.active.entries[0].note='first';s.active.entries[1].note='second'});const target=captureWorkoutRow(0,0);useStore.getState().update(s=>s.active.entries.reverse());const bytes=workoutSheetPlatform.kv.get('gym_state_v1'),published=JSON.stringify(st());expect(copyActiveSet(0,0,target)).toBe(false);refused(bytes,published)
})
it('workout settings request normal sync and do not expose removed media writes',()=>{
 install();const host=mount(<WorkoutSettings close={()=>{}}/>);const update=vi.spyOn(useStore.getState(),'update');settingsAction(host,'swipe');expect(update.mock.calls.at(-1)?.[1]).toBe(true);expect(host.textContent).not.toContain('Exercise animations');expect(st().gifSize).toBe('full')
})

it.each(['account','draft-profile','session','row'])('open-slot picker guards %s at the actual chooser updater',owner=>{
 install({entries:[{id:'',rid:null,target:{open:true,slotId:'one',sets:1,reps:5,weight:40},sets:[]}]});const host=mount(<Workout/>);let callback:((ex:any)=>unknown)|undefined;vi.spyOn(sheets,'exercisePicker').mockImplementation(done=>{callback=done as any;return {id:'fixture',close(){},lock(){}}});click(host,'Choose exercise');const {bytes,published,after}=atProducer(owner);act(()=>callback!({id:'0043'}));expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBe(bytes);expect(JSON.stringify(st())).toBe(owner==='account'?bytes:published);expect(after).not.toHaveBeenCalled();expect(useUI.getState().toastMsg).toContain('workout changed')
})
it('open-slot picker resolves its original slot and retains unknown entry/config keys',()=>{
 install({entries:[{id:'',rid:null,unknownEntry:{keep:true},target:{open:true,slotId:'one',sets:1,reps:5,weight:40,unknownConfig:{keep:true}},sets:[]}]});const host=mount(<Workout/>);let callback:((ex:any)=>unknown)|undefined;vi.spyOn(sheets,'exercisePicker').mockImplementation(done=>{callback=done as any;return {id:'fixture',close(){},lock(){}}});click(host,'Choose exercise');act(()=>callback!({id:'0043'}));expect(st().active.entries[0].id).toBe('0043');expect(st().active.entries[0].sets).toHaveLength(1);expect(st().active.entries[0].unknownEntry).toEqual({keep:true});expect(st().active.entries[0].target.unknownConfig).toEqual({keep:true})
})

it('warm-up conversion and return to work retain unknown row metadata and legacy known-field clearing', () => {
 install();useStore.getState().update(s => {
  Object.assign(s.active.entries[0].sets[0], {opaqueRow:{keep:true}, engineFuture:{v:7}, rir:2, rpe:8, failure:true, weightOrigin:'manual', planSec:45, note:'work-only', incline:3})
  s.active.entries[0].opaqueEntry={keep:true};s.active.entries[0].target.opaqueConfig={keep:true}
 })
 const host=mount(<Workout/>);act(()=>host.querySelector<HTMLButtonElement>('button.n')!.click());click(top(),'Make it a warm-up set')
 let row=st().active.entries[0].sets[0]
 expect(row).toMatchObject({w:40,r:5,done:false,phase:'warmup',warmup:true,opaqueRow:{keep:true},engineFuture:{v:7}})
 for(const key of ['rir','rpe','failure','weightOrigin','planSec','note','incline'])expect(row).not.toHaveProperty(key)
 expect(st().active.entries[0].opaqueEntry).toEqual({keep:true});expect(st().active.entries[0].target.opaqueConfig).toEqual({keep:true})
 act(()=>host.querySelector<HTMLButtonElement>('button.n')!.click());click(top(),'Count it as a working set')
 row=st().active.entries[0].sets[0]
 expect(row.opaqueRow).toEqual({keep:true});expect(row.engineFuture).toEqual({v:7});expect(row.phase).toBeUndefined();expect(row.warmup).toBeUndefined()
 expect(workoutSheetPlatform.kv.get('gym_state_v1')).toContain('"opaqueRow":{"keep":true}')
})

it('a held focus step checks the final updater row and stops after producer refusal', () => {
 install({workoutView:'focus'});const host=mount(<Workout/>);vi.useFakeTimers()
 const button=host.querySelector<HTMLButtonElement>('[aria-label="Increase load"]')!
 const down=new Event('pointerdown',{bubbles:true});Object.assign(down,{pointerId:7,button:0,pointerType:'touch',clientX:100,clientY:300});act(()=>button.dispatchEvent(down))
 const {bytes,published,after}=atProducer('row',3)
 act(()=>vi.advanceTimersByTime(480))
 expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBe(bytes);expect(JSON.stringify(st())).toBe(published);expect(after).not.toHaveBeenCalled();expect(useUI.getState().toastMsg).toContain('workout changed')
 act(()=>vi.advanceTimersByTime(2400))
 expect(workoutSheetPlatform.kv.get('gym_state_v1')).toBe(bytes);expect(JSON.stringify(st())).toBe(published);expect(after).not.toHaveBeenCalled()
})
