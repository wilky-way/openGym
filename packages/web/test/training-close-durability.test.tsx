// @vitest-environment happy-dom
import {workoutSheetPlatform} from './workout-sheet-environment'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {useStore,KEY} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {editCompletedSession} from '@opengym/core/session-edit'
import {saveWorkoutEdits,exitWorkoutEdit} from '../src/sheets-d'
import Workout from '../src/views/Workout'
import {api} from '../src/lib/api'
import {setNav} from '../src/lib/nav'
vi.mock('../src/lib/api',()=>({api:vi.fn().mockResolvedValue({}),beacon:vi.fn(),appBase:()=>'/'}))
const roots:ReturnType<typeof createRoot>[]=[]
const leave=vi.fn()
function mount(node:React.ReactNode){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(node));return host}
function prompt(){const sheet=useUI.getState().sheets.at(-1)!;return mount(sheet.render(()=>useUI.getState().closeSheet(sheet.id)))}
function click(host:HTMLElement,text:string){const b=[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)!;expect(b).toBeTruthy();act(()=>b.click())}
const closes=()=>vi.mocked(api).mock.calls.filter(([path,opts])=>path==='/api/activity'&&JSON.parse(String(opts?.body)).active===false)
function discardConfirmation(){
 const host=mount(<Workout/>);act(()=>host.querySelector<HTMLButtonElement>('[aria-label="Workout options"]')!.click())
 const menu=prompt();const item=[...menu.querySelectorAll<HTMLElement>('.menu-item')].find(n=>n.textContent?.includes('Discard workout'))!
 expect(item).toBeTruthy();act(()=>item.click());return prompt()
}
beforeEach(()=>{
 setNav(leave);leave.mockClear()
 useStore.getState().setUser({id:'A'},{adopt:true})
 useStore.getState().update(s=>{s.active=null;s.workouts=[{id:'saved',d:'2026-10-10',start:1000,end:2000,name:'Synthetic',entries:[{id:'0025',sets:[{w:40,r:5,done:true}]}],prs:[]}]},false)
 useStore.getState().update(s=>{editCompletedSession(s as any,'saved');s.active.entries[0].sets[0].w=55},false)
 vi.mocked(api).mockClear()
})
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.innerHTML='';vi.restoreAllMocks()})
for(const kind of ['save','cancel','delete','discard'] as const)it(`actual ${kind} primary quota failure keeps the session and never releases the guard`,()=>{
 if(kind==='delete')useStore.getState().update(s=>{s.active.entries[0].sets[0].done=false},false)
 if(kind==='discard')useStore.getState().update(s=>{delete s.active.editingWorkoutId;delete s.active.editBase},false)
 let invoke:()=>void
 if(kind==='save')invoke=()=>act(()=>saveWorkoutEdits(leave))
 else if(kind==='delete'){act(()=>saveWorkoutEdits(leave));const host=prompt();invoke=()=>click(host,'Delete workout')}
 else if(kind==='cancel'){act(()=>exitWorkoutEdit(leave));const host=prompt();invoke=()=>click(host,"Don't save")}
 else{
  const confirm=discardConfirmation();invoke=()=>click(confirm,'Discard')
 }
 const saved=localStorage.getItem(KEY),before=structuredClone(useStore.getState().S),write=workoutSheetPlatform.kv.set
 let attempts=0
 vi.spyOn(workoutSheetPlatform.kv,'set').mockImplementation((key,value)=>{if(key===KEY){attempts++;throw new Error('synthetic quota')}return write(key,value)})
 vi.mocked(api).mockClear();leave.mockClear()
 invoke()
 expect(attempts).toBeGreaterThan(0)
 expect(localStorage.getItem(KEY)).toBe(saved)
 expect(useStore.getState().S).toEqual(before)
 expect(closes()).toEqual([]);expect(leave).not.toHaveBeenCalled()
 expect(useUI.getState().toastMsg).not.toMatch(/Workout (updated|deleted)/)
})
it('actual successful Discard persists closure before its owning-device packet and navigation',()=>{
 useStore.getState().update(s=>{delete s.active.editingWorkoutId;delete s.active.editBase},false)
 const confirm=discardConfirmation();vi.mocked(api).mockClear();leave.mockClear()
 let durableAtClose=false
 vi.mocked(api).mockImplementation(async(path,opts)=>{
  if(path==='/api/activity'&&JSON.parse(String(opts?.body)).active===false)durableAtClose=JSON.parse(localStorage.getItem(KEY)!).active===null
  return {}
 })
 click(confirm,'Discard')
 expect(durableAtClose).toBe(true);expect(closes()).toHaveLength(1);expect(useStore.getState().S.active).toBeNull()
 expect(leave).toHaveBeenCalledWith('/home')
})
it('a subscriber reopening the same historical workout cannot receive the older close or success',()=>{
 const opened=useStore.getState().S.active.editBase.sheetInstanceId
 const unsubscribe=useStore.subscribe((next,previous)=>{
  if(previous.S.active && next.S.active===null){
   unsubscribe()
   useStore.getState().update(s=>{editCompletedSession(s as any,'saved')},false)
  }
 })
 act(()=>saveWorkoutEdits(leave));unsubscribe()
 expect(useStore.getState().S.active.editBase.sheetInstanceId).not.toBe(opened)
 expect(closes()).toEqual([]);expect(leave).not.toHaveBeenCalled()
 expect(useUI.getState().toastMsg).not.toBe('Workout updated')
})
it('an owner switch away and back during publication cannot authorize the old close',()=>{
 const owner=useStore.getState().user
 const unsubscribe=useStore.subscribe((next,previous)=>{
  if(previous.S.active && next.S.active===null){
   unsubscribe();useStore.setState({user:{id:'B'}});useStore.setState({user:owner})
  }
 })
 act(()=>saveWorkoutEdits(leave));unsubscribe()
 expect(closes()).toEqual([]);expect(leave).not.toHaveBeenCalled()
 expect(useUI.getState().toastMsg).not.toBe('Workout updated')
})
