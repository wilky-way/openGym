// @vitest-environment happy-dom
import {workoutSheetPlatform} from './workout-sheet-environment'
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {it,expect,afterEach,beforeEach,vi} from 'vitest'
import Workout from '../src/views/Workout'
import {clone,DEF,useStore} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {relativeDefinition} from '../../core/test/native-relative-fixture'
import {importProgramme,saveImportedProgramme} from '@opengym/core/programme-import'
import {activate} from '@opengym/core/programme'
import {beginWorkout,finishWorkout,repeatWorkout} from '../src/sheets-d'
import {configureProgrammeUi} from '../src/lib/programme-ui-services'
import {sessionPreviewSheet,programmePreviewContent} from '../src/components/SessionPreview'
import {NativeTarget} from '../src/components/NativeTarget'
import {editCompletedSession} from '@opengym/core/session-edit'
vi.mock('../src/components/Media',()=>({default:()=>null,Thumb:()=>null,WorkoutThumb:()=>null}))
vi.mock('../src/lib/sound',()=>({beep:vi.fn(),chime:vi.fn(),vibrate:vi.fn(),alertBuzz:vi.fn(),unlock:vi.fn()}))
vi.mock('../src/lib/api',()=>({api:vi.fn(()=>Promise.resolve({})),appBase:()=>'/'}))
beforeEach(()=>{vi.spyOn(workoutSheetPlatform.transport,'fetch').mockImplementation(async()=>new Response('{}',{status:200,headers:{'content-type':'application/json'}}))})
let root:Root|undefined
const mount=(el:React.ReactNode)=>{const host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root!.render(el));return host}
const type=(input:HTMLInputElement,value:string)=>act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})
const rows=(host:HTMLElement)=>[...host.querySelectorAll('.setrow:not(.side)')]
const weight=(host:HTMLElement,i:number,value:string)=>type(rows(host)[i]!.querySelector('input')!,value)
const tick=(host:HTMLElement,i:number)=>act(()=>(rows(host)[i]!.querySelector('button[aria-label*="done"]') as HTMLButtonElement).click())
function start(view='list') {
 const S=clone(DEF);S.gifSize='off';S.sound=false;S.weighIn=false;S.workoutView=view;S.effort='off'
 const definition=relativeDefinition();saveImportedProgramme(S,importProgramme(definition));const cycle=activate(S,definition,{today:'2026-10-13',cycleId:'w50-ui'})
 act(()=>useStore.setState({S,user:null}));act(()=>beginWorkout([S.routines[0].id],null))
 return {definition,cycle,S:useStore.getState().S}
}
afterEach(()=>{act(()=>root?.unmount());root=undefined;document.body.innerHTML='';vi.restoreAllMocks()})
function button(host:HTMLElement,label:string) {
 const b=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===label)
 expect(b,`button ${label}`).toBeTruthy();act(()=>b!.click())
}
function menu(host:HTMLElement,i:number,label:string) {
 act(()=>(rows(host)[i]!.querySelector('button.n') as HTMLButtonElement).click())
 const sheet=useUI.getState().sheets.at(-1)!,node=document.createElement('div');document.body.append(node);const r=createRoot(node)
 try{act(()=>r.render(sheet.render(()=>{})));const item=[...node.querySelectorAll<HTMLElement>('.menu-item')].find(el=>el.textContent?.includes(label));expect(item).toBeTruthy();act(()=>item!.click())}finally{act(()=>r.unmount());node.remove()}
}
for(const operation of ['Add set','Copy this set'])it(`normal DOM ${operation} → Finish saves every ordinary extra and authored row`,()=>{
 start();const host=mount(<Workout/>);weight(host,0,'100');tick(host,0);weight(host,1,'85');tick(host,1);weight(host,2,'90');tick(host,2)
 if(operation==='Add set')button(host,'Add set');else menu(host,1,'Copy this set')
 expect(rows(host)).toHaveLength(4)
 const extra=operation==='Add set'?3:2;weight(host,extra,'71');tick(host,extra)
 act(()=>finishWorkout())
 if(useStore.getState().S.active){const sheet=useUI.getState().sheets.at(-1)!,node=document.createElement('div');document.body.append(node);const r=createRoot(node);try{act(()=>r.render(sheet.render(()=>{})));button(node,'Finish workout')}finally{act(()=>r.unmount());node.remove()}}
 const state=useStore.getState().S
 expect(state.active).toBeNull();expect(state.workouts.at(-1).entries[0].sets).toHaveLength(4)
 expect(state.workouts.at(-1).entries[0].sets[extra]).toMatchObject({done:true,w:71})
})
const activeEntry=()=>useStore.getState().S.active.entries[0]
function finishConfirmed(){
 act(()=>finishWorkout())
 if(!useStore.getState().S.active)return
 const sheet=useUI.getState().sheets.at(-1)!,node=document.createElement('div');document.body.append(node);const r=createRoot(node)
 try{act(()=>r.render(sheet.render(()=>{})));button(node,'Finish workout')}finally{act(()=>r.unmount());node.remove()}
}
function completeAuthored(host:HTMLElement){weight(host,0,'100');tick(host,0);weight(host,1,'85');tick(host,1);weight(host,2,'90');tick(host,2)}
it('actual Copy-extra/undo/completion/Finish/Repeat keeps fresh disjoint identities and exact history',()=>{
 start();const host=mount(<Workout/>);completeAuthored(host);menu(host,1,'Copy this set')
 const first=structuredClone(activeEntry().sets[2]);expect(first.nativeExtraIdentity.kind).toBe('athlete-extra')
 for(const key of ['nativeRowIdentity','nativeTarget','nativeLoadEvaluation','nativeActualLoad','max'])expect(first[key]).toBeUndefined()
 menu(host,2,'Copy this set');const second=structuredClone(activeEntry().sets[3]);expect(second.nativeExtraIdentity.id).not.toBe(first.nativeExtraIdentity.id)
 weight(host,2,'71');tick(host,2);tick(host,2);expect(activeEntry().sets[2]).toMatchObject({done:false,w:71});tick(host,2)
 weight(host,3,'72');tick(host,3);finishConfirmed();const log=useStore.getState().S.workouts.at(-1),before=structuredClone(log)
 expect(log.entries[0].sets.map((r:any)=>r.w)).toEqual([100,85,71,72,90]);act(()=>repeatWorkout(log))
 const repeated=activeEntry();expect(repeated.sets).toHaveLength(5);expect(repeated.sets[2]).toMatchObject({done:false,w:71,r:5});expect(repeated.sets[3]).toMatchObject({done:false,w:72,r:5})
 expect(new Set(repeated.sets.filter((r:any)=>r.nativeExtraIdentity).map((r:any)=>r.nativeExtraIdentity.id)).size).toBe(2)
 expect(repeated.sets[2].nativeExtraIdentity.id).not.toBe(first.nativeExtraIdentity.id)
 for(const i of [0,1,4])expect(repeated.sets[i].w).toBeUndefined()
 expect(useStore.getState().S.workouts.at(-1)).toEqual(before);tick(host,1);expect(repeated.sets[1].done).toBe(false)
})
for(const operation of ['add','copy'])it(`actual remove ${operation} then Finish preserves authored rows and current position`,()=>{
 start();const host=mount(<Workout/>);completeAuthored(host)
 if(operation==='add')button(host,'Add set');else menu(host,1,'Copy this set')
 const at=operation==='add'?3:2,cur=useStore.getState().S.active.cur
 menu(host,at,'Remove this set');expect(activeEntry().sets).toHaveLength(3);expect(useStore.getState().S.active.cur).toBe(cur)
 finishConfirmed();expect(useStore.getState().S.active).toBeNull();expect(useStore.getState().S.workouts.at(-1).entries[0].sets.map((r:any)=>r.w)).toEqual([100,85,90])
})
it('actual remove authored anchor with an extra leaves dependency pending and can Finish retained completed extra work',()=>{
 start();const host=mount(<Workout/>);button(host,'Add set');weight(host,3,'71');tick(host,3)
 menu(host,0,'Remove this set');weight(host,0,'77');tick(host,0)
 expect(activeEntry().sets[0]).toMatchObject({done:false,w:77});expect(host.textContent).toContain('anchor missing or ambiguous')
 finishConfirmed();const log=useStore.getState().S.workouts.at(-1);expect(useStore.getState().S.active).toBeNull();expect(log.entries[0].sets).toHaveLength(3);expect(log.entries[0].sets[2]).toMatchObject({done:true,w:71})
 const before=structuredClone(log);act(()=>repeatWorkout(log));expect(activeEntry().sets).toHaveLength(4);expect(activeEntry().sets[0].nativeRowIdentity.rowOrdinal).toBe(1);expect(useStore.getState().S.workouts.at(-1)).toEqual(before)
})
it('actual remove and toast Undo restores exact extra identity and typed data',()=>{
 start();const host=mount(<Workout/>);button(host,'Add set');weight(host,3,'71')
 const before=structuredClone(activeEntry().sets),toast=vi.fn();useUI.setState({toast})
 menu(host,3,'Remove this set');expect(activeEntry().sets).toHaveLength(3)
 const opts=toast.mock.calls.at(-1)![1];expect(opts.action).toBe('Undo');act(()=>opts.onAction());expect(activeEntry().sets).toEqual(before)
 completeAuthored(host);tick(host,3);finishConfirmed();expect(useStore.getState().S.workouts.at(-1).entries[0].sets).toHaveLength(4)
})
for(const fault of ['reorder','duplicate'])it(`actual guarded producer ${fault} refusal retains extras, saved state and current callbacks`,()=>{
 start();const host=mount(<Workout/>);weight(host,0,'100');tick(host,0);weight(host,1,'85');weight(host,2,'90');button(host,'Add set');weight(host,3,'71')
 const original=useStore.getState().update
 act(()=>useStore.setState({update:(fn:any,push:any)=>original((s:any)=>{
  const e=s.active.entries[0];if(fault==='reorder')[e.sets[1],e.sets[2]]=[e.sets[2],e.sets[1]];else e.sets.push(structuredClone(e.sets[0]));fn(s)
 },push)}))
 const before=JSON.stringify(useStore.getState().S);tick(host,1);expect(JSON.stringify(useStore.getState().S)).toBe(before)
 act(()=>useStore.setState({update:original}));tick(host,1);tick(host,2);tick(host,3);finishConfirmed();expect(useStore.getState().S.active).toBeNull()
})
it('actual convert authored anchor to warm-up keeps exact authority and frozen actuals; dependents retain their own anchor',()=>{
 start();const host=mount(<Workout/>);completeAuthored(host);const before=structuredClone(activeEntry().sets)
 menu(host,0,'Make it a warm-up set');expect(activeEntry().sets[0]).toMatchObject({...before[0],phase:'warmup',warmup:true})
 finishConfirmed();expect(useStore.getState().S.active).toBeNull();expect(useStore.getState().S.workouts.at(-1).entries[0].sets[1].nativeLoadEvaluation).toEqual(before[1].nativeLoadEvaluation)
})
it('actual Add warm-up before authored rows supports ordinary completion and Finish',()=>{
 start();const host=mount(<Workout/>);completeAuthored(host)
 const more=host.querySelector<HTMLButtonElement>('button[aria-label="More"]');expect(more).toBeTruthy();act(()=>more!.click())
 const sheet=useUI.getState().sheets.at(-1)!,node=document.createElement('div');document.body.append(node);const r=createRoot(node)
 try{act(()=>r.render(sheet.render(()=>{})));const item=[...node.querySelectorAll<HTMLElement>('.menu-item')].find(x=>x.textContent?.includes('Add warm-up set'));expect(item).toBeTruthy();act(()=>item!.click())}finally{act(()=>r.unmount());node.remove()}
 expect(activeEntry().sets).toHaveLength(4);weight(host,0,'40');tick(host,0);finishConfirmed();expect(useStore.getState().S.active).toBeNull()
})

it('actual authored-anchor phase conversion back retains exact identity and cannot reset frozen dependents',()=>{
 start();const host=mount(<Workout/>);completeAuthored(host);const before=structuredClone(activeEntry().sets)
 menu(host,0,'Make it a warm-up set');menu(host,0,'Count it as a working set')
 expect(activeEntry().sets).toEqual(before);finishConfirmed();expect(useStore.getState().S.active).toBeNull()
})
it('actual dependent phase move before its anchor stays pending on fresh completion and preserves its typed load',()=>{
 start();const host=mount(<Workout/>);weight(host,0,'100');tick(host,0);weight(host,1,'77')
 menu(host,1,'Make it a warm-up set');expect(activeEntry().sets[0].nativeRowIdentity.rowOrdinal).toBe(2);tick(host,0)
 expect(activeEntry().sets[0]).toMatchObject({done:false,w:77});expect(activeEntry().sets[0].nativeLoadEvaluation).toBeUndefined()
 expect(host.textContent).toContain('anchor missing or ambiguous')
 menu(host,0,'Count it as a working set');menu(host,1,'Make it a warm-up set')
 // Moving the actual authored anchor ahead again permits a fresh current completion.
 expect(activeEntry().sets[0].nativeRowIdentity.rowOrdinal).toBe(1);tick(host,1);expect(activeEntry().sets[1]).toMatchObject({done:true,w:77,nativeLoadEvaluation:{plannedLoad:{value:90,unit:'kg'}}})
})
it('actual historical Save retains added/copied/warm-up work, source times, notes, metadata and frozen evaluations',()=>{
 start();const host=mount(<Workout/>);completeAuthored(host);finishConfirmed();const saved=structuredClone(useStore.getState().S.workouts.at(-1)),receipt=saved.entries[0].sets[1].nativeLoadEvaluation
 act(()=>useStore.getState().update((s:any)=>{editCompletedSession(s,saved.id);s.active.entries[0].sets[1].opaque={keep:true};s.active.entries[0].sets[1].note='typed note'}))
 button(host,'Add set');weight(host,3,'71');tick(host,3);menu(host,1,'Copy this set');weight(host,2,'72');tick(host,2)
 menu(host,0,'Make it a warm-up set');finishConfirmed();const log=useStore.getState().S.workouts.at(-1)
 expect(useStore.getState().S.active).toBeNull();expect(log).toMatchObject({id:saved.id,start:saved.start,end:saved.end})
 expect(log.entries[0].sets).toHaveLength(5);expect(log.entries[0].sets[1]).toMatchObject({nativeLoadEvaluation:receipt,note:'typed note',opaque:{keep:true}})
 expect(log.entries[0].sets[2]).toMatchObject({w:72,done:true,note:'typed note',opaque:{keep:true}})
 expect(saved.entries[0].sets).toHaveLength(3)
})
it('phase conversion of an empty authored anchor preserves unknown actual rather than inventing zero',()=>{
 start();const host=mount(<Workout/>);menu(host,0,'Make it a warm-up set');expect(activeEntry().sets[0].w).toBeUndefined();tick(host,0);expect(activeEntry().sets[0].done).toBe(false)
})

it('actual unticked warm-up Finish keeps the row and Repeat excludes extra warm-ups without changing the log',()=>{
 start();const host=mount(<Workout/>);completeAuthored(host)
 act(()=>host.querySelector<HTMLButtonElement>('button[aria-label="More"]')!.click())
 const sheet=useUI.getState().sheets.at(-1)!,node=document.createElement('div');document.body.append(node);const r=createRoot(node)
 try{act(()=>r.render(sheet.render(()=>{})));act(()=>[...node.querySelectorAll<HTMLElement>('.menu-item')].find(x=>x.textContent?.includes('Add warm-up set'))!.click())}finally{act(()=>r.unmount());node.remove()}
 finishConfirmed();const log=useStore.getState().S.workouts.at(-1),before=structuredClone(log)
 expect(log.entries[0].sets[0]).toMatchObject({done:false,phase:'warmup',nativeExtraIdentity:{kind:'athlete-extra'}})
 act(()=>repeatWorkout(log));expect(activeEntry().sets).toHaveLength(3);expect(useStore.getState().S.workouts.at(-1)).toEqual(before)
})
