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
it('real Start/edit/done/Finish/log/Repeat controls preserve manual actuals and frozen targets',()=>{
 start();const host=mount(<Workout/>);expect(rows(host)).toHaveLength(3)
 weight(host,1,'77');tick(host,1);expect(useStore.getState().S.active.entries[0].sets[1].done).toBe(false);expect(host.textContent).toContain('Pending: complete anchor set 1')
 weight(host,0,'100');tick(host,0);expect(host.textContent).toContain('Planned 90 kg');expect(useStore.getState().S.active.entries[0].sets[1].w).toBe(77)
 tick(host,1);const frozen=structuredClone(useStore.getState().S.active.entries[0].sets[1].nativeLoadEvaluation)
 weight(host,0,'200');expect(host.textContent).toContain('Planned 90 kg (at completion)');expect(host.textContent).toContain('Planned 180 kg')
 weight(host,2,'180');tick(host,2);act(()=>finishWorkout())
 const S=useStore.getState().S,log=S.workouts.at(-1);expect(S.active).toBeNull();expect(log.entries[0].sets[1]).toMatchObject({w:77,nativeLoadEvaluation:frozen})
 act(()=>root!.render(<NativeTarget row={log.entries[0].sets[1]}/>));expect(host.textContent).toContain('Planned 90 kg (at completion)')
 act(()=>repeatWorkout(log));expect(useStore.getState().S.active.entries[0].sets.every((r:any)=>r.r===undefined && r.w===undefined && !r.done && !r.nativeLoadEvaluation)).toBe(true)
 act(()=>root!.render(<Workout/>));expect(host.textContent).toContain('Pending: complete anchor set 1');expect(log.entries[0].sets[1].nativeLoadEvaluation).toEqual(frozen)
})
it('real undo and recompletion retain manual actuals and require the new anchor',()=>{
 start();const host=mount(<Workout/>);weight(host,0,'100');tick(host,0);weight(host,1,'81');tick(host,1);tick(host,1)
 expect(useStore.getState().S.active.entries[0].sets[1].nativeLoadEvaluation).toBeUndefined();tick(host,0);tick(host,1)
 expect(useStore.getState().S.active.entries[0].sets[1]).toMatchObject({done:false,w:81})
 weight(host,0,'200');tick(host,0);tick(host,1);expect(useStore.getState().S.active.entries[0].sets[1].nativeLoadEvaluation.plannedLoad.value).toBe(180)
})
it('focus shows pending/derived goal separately and completes through the same guarded producer',()=>{
 start('focus');const host=mount(<Workout/>);const load=()=>host.querySelector('input[aria-label="Actual load"]') as HTMLInputElement
 type(load(),'100');act(()=>(host.querySelector('button[aria-label="Complete set"]') as HTMLButtonElement).click())
 expect(host.textContent).toContain('10% below set 1 actual load');expect(host.textContent).toContain('Planned 90 kg');expect(load().value).toBe('')
 type(load(),'85');act(()=>(host.querySelector('button[aria-label="Complete set"]') as HTMLButtonElement).click());expect(useStore.getState().S.active.entries[0].sets[1]).toMatchObject({w:85,done:true,nativeLoadEvaluation:{plannedLoad:{value:90,unit:'kg'}}})
})
it('real read-only preview exposes the authored relation and pending reason without mutating state',()=>{
 const {S,definition,cycle}=start();act(()=>useStore.getState().update(s=>{s.active=null}));configureProgrammeUi({platform:workoutSheetPlatform,initialProgramId:()=>definition.id,startFlow:vi.fn(),confirmSheet:vi.fn(),workoutDetailSheet:vi.fn(),dayOverrideSheet:vi.fn()})
 const before=JSON.stringify(useStore.getState().S);act(()=>sessionPreviewSheet(()=>programmePreviewContent(S,definition,cycle,{index:1},'lift:1','lift:1')))
 const sheet=useUI.getState().sheets.at(-1)!,host=mount(sheet.render(()=>{}));expect(host.textContent).toContain('10% below set 1 actual load');expect(host.textContent).toContain('Pending: complete anchor set 1');expect(host.querySelectorAll('input')).toHaveLength(0);expect(JSON.stringify(useStore.getState().S)).toBe(before)
})
for(const change of ['owner','profile','editor','entry','row','source'])it(`stale completion producer refuses ${change} with full state preimage`,()=>{
 start();const host=mount(<Workout/>);weight(host,0,'100');tick(host,0);weight(host,1,'80')
 const original=useStore.getState().update,toast=vi.fn();useUI.setState({toast});
 // Change the actual draft only when the completion producer runs, after its preflight.
 act(()=>useStore.setState({update:(fn:any,push:any)=>original((s:any)=>{
  {if(change==='owner')useStore.setState({user:{id:'other'}});if(change==='profile')s.profileId='other';if(change==='editor')s.active.editingWorkoutId='other';if(change==='entry')s.active.entries[0].id='0025';if(change==='row')s.active.entries[0].sets.reverse();if(change==='source')s.active.entries[0].target.nativePrescription.source.cell='B99'}
  fn(s)
 },push)}))
 const before=JSON.stringify(useStore.getState().S);tick(host,1);expect(JSON.stringify(useStore.getState().S)).toBe(before);expect(useStore.getState().S.active.entries[0].sets[1].nativeLoadEvaluation).toBeUndefined()
 act(()=>useStore.setState({update:original}))
})

it('real row-menu rest-pause clusters survive historical Finish but clear on relation Repeat',()=>{
 start();const host=mount(<Workout/>);weight(host,0,'100');weight(host,1,'85');weight(host,2,'90')
 act(()=>(rows(host)[0]!.querySelector('button[aria-label="Set 1"]') as HTMLButtonElement).click())
 const sheet=useUI.getState().sheets.at(-1)!,menu=document.createElement('div');document.body.append(menu);const menuRoot=createRoot(menu)
 try{act(()=>menuRoot.render(sheet.render(()=>{})));const add=[...menu.querySelectorAll<HTMLElement>('.menu-item')].find(el=>el.textContent?.includes('Rest-pause burst'))!;expect(add).toBeTruthy();act(()=>add.click())}
 finally{act(()=>menuRoot.unmount());menu.remove()}
 const clusters=structuredClone(useStore.getState().S.active.entries[0].sets[0].clusters);expect(clusters).toHaveLength(1)
 tick(host,0);tick(host,1);tick(host,2);act(()=>finishWorkout());const log=useStore.getState().S.workouts.at(-1)
 expect(log.entries[0].sets[0].clusters).toEqual(clusters);const before=structuredClone(log);act(()=>repeatWorkout(log))
 expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({done:false});for(const key of ['w','r','clusters','nativeLoadEvaluation','nativeActualLoad'])expect(useStore.getState().S.active.entries[0].sets[0][key]).toBeUndefined()
 expect(useStore.getState().S.workouts.at(-1)).toEqual(before)
})
