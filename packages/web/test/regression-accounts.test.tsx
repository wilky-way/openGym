// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEF, KEY, useStore, initializeStore } from '../src/store/useStore'
import { configureClientIO } from '../src/lib/client-io'
import { initializeSyncEngine } from '../src/store/sync-engine'
import { editCompletedSession, saveWorkoutEdit } from '@opengym/core/session-edit'
import { useUI } from '../src/store/useUI'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { workoutDetailSheet, workoutDateSheet, workoutDurationSheet, dayOverrideSheet, dayNoteSheet, dayAssignSheet, planImportSheet, planToolsSheet, configurePlanHistorySheets } from '../src/sheets-plan-history'
const io = vi.hoisted(()=>({printHTML:vi.fn(),shareBlob:vi.fn(async()=>true),saveBlob:vi.fn(),imageURL:vi.fn(()=>'blob:synthetic'),revokeImageURL:vi.fn(),readPlanFile:vi.fn()}))
vi.mock('../src/platform/plan-history',()=>io)
const ex={id:'review-custom',n:'Synthetic lift',eq:'body weight',bp:'chest',tg:'pectorals',custom:true}
const workout=(owner:string)=>({id:'shared-workout',name:owner+' history',d:'2026-09-14',start:new Date('2026-09-14T09:00:00').getTime(),end:new Date('2026-09-14T10:00:00').getTime(),vol:80,prs:[],entries:[{id:ex.id,target:{sets:1,reps:8},sets:[{w:owner==='A'?10:20,r:8,done:true}]}]})
const doc=(owner:string)=>({...structuredClone(DEF),_ts:owner==='A'?100:200,customEx:[ex],routines:[{id:'r-'+owner,name:owner+' routine',ex:[{id:ex.id,sets:1,reps:8,weight:10}]}],week:{1:['r-'+owner]},workouts:[workout(owner)],active:{id:'session-'+owner,name:owner+' logged session',start:1,entries:[{id:ex.id,sets:[{w:10,r:8,done:true}]}]},shareMap:false,dayNotes:{'2026-09-07':{text:owner+' day note'}}})
let roots:Root[]=[],dispose:()=>void,map:Map<string,string>,api:ReturnType<typeof vi.fn<() => Promise<never>>>
const repeat=vi.fn(),logPast=vi.fn()
const btn=(h:HTMLElement,s:string)=>[...h.querySelectorAll('button')].find(b=>b.textContent?.trim()===s)!
const type=(el:HTMLInputElement|HTMLTextAreaElement,value:string)=>{Object.getOwnPropertyDescriptor(el.constructor.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}))}
function mount(){const sheet=useUI.getState().sheets.at(-1)!;const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(sheet.render(()=>useUI.getState().closeSheet(sheet.id))));return host}
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-16T12:00:00'))
 configureUx(createBrowserUx());document.body.innerHTML='';repeat.mockReset();logPast.mockReset();io.shareBlob.mockClear();io.saveBlob.mockClear();io.printHTML.mockClear()
 useUI.setState({sheets:[],toast:vi.fn()})
 map=new Map([[KEY,JSON.stringify(doc('A'))],['gym_owner','A'],['gym_user',JSON.stringify({id:'A',name:'Account A'})],['gym_state_owner','A']])
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 const platform:any={kv,server:{baseUrl:()=>''},nav:{href:()=> 'https://synthetic.invalid/'}}
 api=vi.fn(async()=>{throw new Error('Network disabled in review probe')})
 configureClientIO(platform)
 initializeStore(platform)
 dispose=initializeSyncEngine({platform,api,prompts:{toast:useUI.getState().toast,askAddDeviceData:async()=>false}})
 useStore.setState({ready:true})
 configurePlanHistorySheets({version:'1',repeatWorkout:repeat,logPastWorkoutSheet:logPast,exerciseHistorySheet:vi.fn()})
})
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));dispose();vi.restoreAllMocks();vi.useRealTimers()})
function switchToB(){act(()=>{useStore.getState().setUser({id:'B',name:'Account B'},{adopt:true});useStore.getState().replaceState(doc('B'),false)});expect(useStore.getState().user!.id).toBe('B');expect(map.get('gym_owner')).toBe('B');expect(useStore.getState().S.workouts[0]!.name).toBe('B history');expect(api).not.toHaveBeenCalled()}
function unchanged(before:string){expect(map.get(KEY)).toBe(before);expect(useUI.getState().toast).toHaveBeenCalled();expect(api).not.toHaveBeenCalled()}
it('real sync store account switch: delete confirmation cannot delete B matching-id history',()=>{
 workoutDetailSheet(workout('A'));const h=mount();act(()=>btn(h,'Delete workout').click());const c=mount();switchToB();const before=map.get(KEY)!
 act(()=>btn(c,'Delete').click());unchanged(before)
})
it('real sync store account switch: routine confirmation cannot import A history into B plan',()=>{
 workoutDetailSheet(workout('A'));const h=mount();act(()=>btn(h,'Save as routine').click());const c=mount();switchToB();const before=map.get(KEY)!
 act(()=>btn(c,'Save').click());unchanged(before)
})
it('real sync store account switch: detail note cleanup cannot overwrite B matching-id note',()=>{
 workoutDetailSheet(workout('A'));const h=mount();act(()=>type(h.querySelector('textarea')!,'A private note'));switchToB();const before=map.get(KEY)!
 act(()=>roots.pop()!.unmount());unchanged(before)
})
it('real sync store account switch: date save cannot move B matching-id history',()=>{
 workoutDateSheet(workout('A'));const h=mount();act(()=>type(h.querySelector('input[type=date]')!,'2026-09-13'));switchToB();const before=map.get(KEY)!
 act(()=>btn(h,'Save').click());unchanged(before)
})
it('real sync store account switch: duration save cannot retime B matching-id history',()=>{
 workoutDurationSheet(workout('A'));const h=mount();act(()=>type(h.querySelector('input')!,'45'));switchToB();const before=map.get(KEY)!
 act(()=>btn(h,'Save').click());unchanged(before)
})
it('real sync store account switch: day override cannot change B date assignments',()=>{
 dayOverrideSheet('2026-09-07');const h=mount();switchToB();const before=map.get(KEY)!
 act(()=>[...h.querySelectorAll<HTMLElement>('.item')].find(el=>el.textContent?.includes('B routine'))!.click());unchanged(before)
})
it('real sync store account switch: backfill cannot delegate under B from an A sheet',()=>{
 dayOverrideSheet('2026-09-07');const h=mount();switchToB();act(()=>btn(h,'Log this workout').click())
 expect(logPast).not.toHaveBeenCalled();expect(useUI.getState().toast).toHaveBeenCalled();expect(api).not.toHaveBeenCalled()
})
it('real sync store account switch: day-note save cannot write A draft into B',()=>{
 dayNoteSheet('2026-09-07');const h=mount();act(()=>type(h.querySelector('textarea')!,'A private day note'));switchToB();const before=map.get(KEY)!
 act(()=>btn(h,'Save').click());unchanged(before)
})
it('real sync store account switch: weekday assignment cannot alter B weekly plan',()=>{
 dayAssignSheet(1);const h=mount();switchToB();const before=map.get(KEY)!
 act(()=>[...h.querySelectorAll<HTMLElement>('.item')].find(el=>el.textContent?.includes('B routine'))!.click());unchanged(before)
})
it('real sync store account switch: import confirmation refuses and preserves B',()=>{
 planImportSheet({name:'A import',unit:'kg',routines:[{id:'incoming',name:'Incoming',ex:[{id:ex.id}]}],customEx:[],week:{},routineCount:1,exerciseCount:1,scheduledDays:0,dropped:0});const h=mount();switchToB();const before=map.get(KEY)!
 act(()=>btn(h,'Add to my plan').click());unchanged(before);expect(useUI.getState().toast).toHaveBeenCalledWith('This sheet is out of date. Open it again.')
})
async function shareSheet(){const ctx=new Proxy({measureText:(text:string)=>({width:text.length*10})},{get:(o:any,key)=>o[key]??(()=>{})}) as CanvasRenderingContext2D;configureUx({...createBrowserUx(),path2D:()=>({} as Path2D)});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx);vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(cb=>cb(new Blob(['synthetic-png'])));workoutDetailSheet(workout('A'));const h=mount();act(()=>btn(h,'Share as image').click());let sh!:HTMLElement;await act(async()=>{sh=mount();await Promise.resolve()});return sh}
it('real sync store account switch: image map callback cannot write B preference',async()=>{
 const h=await shareSheet();switchToB();const before=map.get(KEY)!
 await act(async()=>{h.querySelector<HTMLButtonElement>('[role=switch]')!.click();await Promise.resolve()});unchanged(before)
})
it('real sync store account switch: image sharing cannot share A history after switching to B',async()=>{
 const h=await shareSheet();switchToB();await act(async()=>{btn(h,'Share').click();await Promise.resolve()})
 expect(io.shareBlob).not.toHaveBeenCalled();expect(useUI.getState().toast).toHaveBeenCalled();expect(api).not.toHaveBeenCalled()
})
it('real sync store account switch: plan-tools export refuses stale account context',async()=>{
 planToolsSheet();const h=mount();switchToB();await act(async()=>{btn(h,'Export plan file').click();await Promise.resolve()})
 expect(io.saveBlob.mock.calls.length).toBe(0);expect(useUI.getState().toast).toHaveBeenCalled();expect(api).not.toHaveBeenCalled()
})

it('real sync store account switch: repeat callback refuses B before disabled-button rerender',()=>{
 useStore.getState().replaceState({...doc('A'),active:null},false)
 workoutDetailSheet(workout('A'));const h=mount()
 act(()=>{useStore.getState().setUser({id:'B',name:'Account B'},{adopt:true});useStore.getState().replaceState(doc('B'),false);btn(h,'Repeat today').click()})
 expect(useStore.getState().user!.id).toBe('B');expect(repeat).not.toHaveBeenCalled();expect(useUI.getState().toast).toHaveBeenCalled();expect(api).not.toHaveBeenCalled()
})
it('real sync store account switch: plan-tools print refuses stale account context',()=>{
 planToolsSheet();const h=mount();switchToB()
 const before=map.get(KEY)!
 act(()=>btn(h,'Print / Save as PDF').click())
 expect(io.printHTML).not.toHaveBeenCalled();unchanged(before)
})

it('real sync store account switch: day note Remove preserves B bytes',()=>{
 useStore.getState().update((s:any)=>{s.dayNotes['2026-09-07']={text:'A original'}})
 dayNoteSheet('2026-09-07');const h=mount();switchToB();const before=map.get(KEY)!
 act(()=>btn(h,'Remove note').click());unchanged(before)
})
it('real sync store account switch: weekly Rest preserves B bytes',()=>{
 dayAssignSheet(1);const h=mount();switchToB();const before=map.get(KEY)!
 act(()=>[...h.querySelectorAll<HTMLElement>('.item')].find(el=>el.textContent?.includes('Rest day'))!.click());unchanged(before)
})
it('real sync store account switch: detail note blur preserves B bytes',()=>{
 workoutDetailSheet(workout('A'));const h=mount();act(()=>type(h.querySelector('textarea')!,'A blur draft'))
 switchToB();const before=map.get(KEY)!
 act(()=>h.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));unchanged(before)
})
it('real sync store account switch: edit callback refuses B before rerender',()=>{
 useStore.getState().replaceState({...doc('A'),active:null},false)
 workoutDetailSheet(workout('A'));const h=mount();let before=''
 act(()=>{useStore.getState().setUser({id:'B',name:'Account B'},{adopt:true});useStore.getState().replaceState({...doc('B'),active:null},false);before=map.get(KEY)!;btn(h,'Edit workout').click()})
 unchanged(before)
})
it('real sync store abort inside producer prevents a persistence race from stamping B',()=>{
 workoutDetailSheet(workout('A'));const h=mount();act(()=>btn(h,'Delete workout').click());const c=mount()
 const originalUpdate=useStore.getState().update
 let before=''
 useStore.setState({update(mut,push){
  useStore.getState().setUser({id:'B',name:'Account B'},{adopt:true})
  useStore.getState().replaceState(doc('B'),false)
  before=map.get(KEY)!
  originalUpdate(mut,push)
 }})
 try {act(()=>btn(c,'Delete').click());unchanged(before)}
 finally {useStore.setState({update:originalUpdate})}
})
it('repeat revalidates after the note updater joins another tab active session',()=>{
 useStore.getState().replaceState({...doc('A'),active:null},false)
 workoutDetailSheet(workout('A'));const h=mount()
 const replacement={...doc('A'),active:{...doc('A').active,id:'other-tab-session'}}
 map.set(KEY,JSON.stringify(replacement));map.set('gym_state_wid','other-tab-write')
 act(()=>btn(h,'Repeat today').click())
 expect(useStore.getState().S.active).toBeNull()
 expect(map.get(KEY)).toBe(JSON.stringify(replacement))
 expect(repeat).not.toHaveBeenCalled();expect(useUI.getState().toast).toHaveBeenCalled()
})
it.each(['Copy as text','Export as .fit file'])('real sync store account switch: detail %s refuses stale output',async action=>{
 workoutDetailSheet(workout('A'));const h=mount();switchToB();const before=map.get(KEY)!
 await act(async()=>{btn(h,action).click();await Promise.resolve()})
 unchanged(before);expect(io.saveBlob).not.toHaveBeenCalled()
})
it('real sync store account switch: exercise history delegation refuses stale context',()=>{
 const history=vi.fn();configurePlanHistorySheets({version:'1',repeatWorkout:repeat,logPastWorkoutSheet:logPast,exerciseHistorySheet:history})
 workoutDetailSheet(workout('A'));const h=mount();switchToB();const before=map.get(KEY)!
 act(()=>h.querySelector<HTMLElement>('.wd-ex')!.click());unchanged(before);expect(history).not.toHaveBeenCalled()
})

it.each(['before confirm','inside producer'])('queued storage event %s: stale Delete preserves the saved real history editor and backing record',phase=>{
 useStore.getState().replaceState({...doc('A'),active:null},false)
 workoutDetailSheet(workout('A'));const h=mount();act(()=>btn(h,'Delete workout').click());const c=mount()
 const savedEditor={...doc('A'),active:null}
 editCompletedSession(savedEditor as any,workout('A'))
 const before=JSON.stringify(savedEditor)
 const publish=()=>{map.set(KEY,before);map.set('gym_state_wid','queued-editor-write')}
 const originalUpdate=useStore.getState().update
 if (phase==='before confirm') publish()
 else useStore.setState({update(mut,push){publish();originalUpdate(mut,push)}})
 try {act(()=>btn(c,'Delete').click());unchanged(before)}
 finally {useStore.setState({update:originalUpdate})}
 expect(()=>saveWorkoutEdit(JSON.parse(map.get(KEY)!) as any)).not.toThrow()
 expect(useStore.getState().S.workouts).toHaveLength(1)
})
it('queued account event: stale day-note Save cannot write before the owner event arrives',()=>{
 dayNoteSheet('2026-09-07');const h=mount();act(()=>type(h.querySelector('textarea')!,'A private pending note'))
 map.set('gym_owner','B');map.set('gym_user',JSON.stringify({id:'B'}));map.set('gym_state_owner','B');map.set(KEY,JSON.stringify(doc('B')))
 const before=map.get(KEY)!
 act(()=>btn(h,'Save').click());unchanged(before)
})
it('current owned copy remains editable after an expired login continues without account',()=>{
 useStore.getState().setUser(null);useStore.getState().setGuest(true)
 expect(map.get('gym_owner')).toBe('A');expect(map.get('gym_user')).toBeUndefined()
 dayNoteSheet('2026-09-07');const h=mount();act(()=>type(h.querySelector('textarea')!,'Local offline note'))
 act(()=>btn(h,'Save').click())
 expect(JSON.parse(map.get(KEY)!).dayNotes['2026-09-07'].text).toBe('Local offline note')
 expect(useUI.getState().toast).toHaveBeenCalledWith('Noted. See you next session!');expect(api).not.toHaveBeenCalled()
})
