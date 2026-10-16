// @vitest-environment happy-dom
import {workoutSheetPlatform} from './workout-sheet-environment'
import {configureProgrammeUi} from '../src/lib/programme-ui-services'
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {it,expect,afterEach,vi} from 'vitest'
import Workout from '../src/views/Workout'
import {useStore} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {nativeFixture} from './w41-fixture'
import {sessionPreviewSheet,programmePreviewContent} from '../src/components/SessionPreview'
vi.mock('../src/lib/sound',()=>({beep:vi.fn(),chime:vi.fn(),vibrate:vi.fn(),alertBuzz:vi.fn(),unlock:vi.fn()}))
vi.mock('../src/lib/api',()=>({api:vi.fn(()=>Promise.resolve({})),appBase:()=>'/'}))
let root:Root|undefined
const mount=(el:React.ReactNode)=>{const host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root!.render(el));return host}
const type=(input:HTMLInputElement,value:string)=>act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})
afterEach(()=>{act(()=>root?.unmount());root=undefined;document.body.innerHTML=''})
it('actual list input and completion handlers keep unknown reps/load empty and reject premature completion',()=>{
 const {S}=nativeFixture();S.active.entries[0].target.reps=99
 act(()=>useStore.setState({S,user:null}));const host=mount(<Workout/>)
 expect(host.textContent).toContain('7–11 reps · RPE 6–8 · 61–69% 1RM guidance')
 const row=host.querySelector('.setrow:not(.side)')!,inputs=[...row.querySelectorAll('input')] as HTMLInputElement[]
 expect(inputs.slice(0,2).map(i=>i.value)).toEqual(['',''])
 const check=row.querySelector('button[aria-label*="done"]') as HTMLButtonElement;expect(check).toBeTruthy()
 act(()=>check.click());expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(false)
 expect(useUI.getState().toastMsg).toContain('Enter actual reps and load')
 type(inputs[0]!,'40');type(inputs[1]!,'12')
 act(()=>check.click());const logged=useStore.getState().S.active.entries[0].sets[0]
 expect(logged).toMatchObject({w:40,r:12,done:true});expect(logged.nativeTarget.reps).toEqual({kind:'range',min:7,max:11})
 expect(host.textContent).toContain('Reps above target');expect(host.textContent).toContain('Effort not logged')
})
it('focus inputs remain nullable and share the real guarded completion path',()=>{
 const {S}=nativeFixture();S.active.workoutView='focus';S.workoutView='focus';act(()=>useStore.setState({S,user:null}));const host=mount(<Workout/>)
 const reps=host.querySelector('input[aria-label="Actual reps"]') as HTMLInputElement,load=host.querySelector('input[aria-label="Actual load"]') as HTMLInputElement
 expect(reps).toBeTruthy();expect(load).toBeTruthy();expect([reps.value,load.value]).toEqual(['',''])
 const complete=host.querySelector('button[aria-label="Complete set"]') as HTMLButtonElement;act(()=>complete.click())
 expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(false)
 type(reps,'8');type(load,'40');type(reps,'');act(()=>complete.click())
 expect(useStore.getState().S.active.entries[0].sets[0].r).toBeUndefined();expect(useStore.getState().S.active.entries[0].sets[0].done).toBe(false)
 type(reps,'8');act(()=>complete.click());expect(useStore.getState().S.active.entries[0].sets[0]).toMatchObject({r:8,w:40,done:true})
})
it('actual preview preserves intervals and guidance, with no numeric actual inputs or mutation',()=>{
 configureProgrammeUi({platform:workoutSheetPlatform,initialProgramId:()=> 'native-mobile',startFlow:vi.fn(),confirmSheet:vi.fn(),workoutDetailSheet:vi.fn(),dayOverrideSheet:vi.fn()})
 const {S,definition,cycle}=nativeFixture();S.active=null;act(()=>useStore.setState({S,user:null}));const before=JSON.stringify(useStore.getState().S)
 act(()=>sessionPreviewSheet(()=>programmePreviewContent(S,definition,cycle,{index:1},'lift:1','lift:1')))
 const sheet=useUI.getState().sheets.at(-1)!,host=mount(sheet.render(()=>{}))
 expect(host.textContent).toContain('7–11 reps · RPE 6–8 · 61–69% 1RM guidance');expect(host.textContent).toContain('enter actual load')
 expect(host.querySelectorAll('input')).toHaveLength(0);expect(JSON.stringify(useStore.getState().S)).toBe(before)
})
