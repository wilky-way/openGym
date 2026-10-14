// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { createExerciseIndex } from '@opengym/core/exercises'
import { editCompletedSession, saveWorkoutEdit } from '@opengym/core/session-edit'
import { workoutDetailSheet, workoutDateSheet, workoutDurationSheet, dayOverrideSheet, dayNoteSheet, dayAssignSheet, planImportSheet, planToolsSheet, configurePlanHistorySheets } from '../src/sheets-plan-history'
const io = vi.hoisted(() => ({printHTML:vi.fn(),shareBlob:vi.fn(async()=>true),saveBlob:vi.fn(),imageURL:vi.fn(()=>'blob:synthetic'),revokeImageURL:vi.fn(),readPlanFile:vi.fn()}))
vi.mock('../src/platform/plan-history',()=>io)
let roots: Root[] = []
const ex = { id:'review-bw', n:'Synthetic lift', eq:'body weight', bp:'chest', tg:'pectorals', custom:true }
const saved = { id:'workout-A', name:'Synthetic saved A', d:'2026-09-14', start:new Date('2026-09-14T09:00:00').getTime(), end:new Date('2026-09-14T10:00:00').getTime(), vol:0, prs:[], entries:[{id:ex.id,target:{sets:1,reps:8},sets:[{w:10,r:8,done:true}]}] }
const session = (id: string) => ({ id, d:'2026-09-15', name:id, start:1, entries:[{ id:ex.id, sets:[{w:10,r:8,done:true}] }] })
const repeat = vi.fn(), logPast = vi.fn()
function mount() {
 const sheet = useUI.getState().sheets.at(-1)!
 const host = document.createElement('div');document.body.append(host)
 const root=createRoot(host);roots.push(root)
 act(()=>root.render(sheet.render(()=>useUI.getState().closeSheet(sheet.id))))
 return host
}
const btn = (host: HTMLElement, label: string) => [...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===label)!
const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => { Object.getOwnPropertyDescriptor(el.constructor.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true})) }
function replaceSession() { act(()=>useStore.setState(s=>({S:{...s.S,active:session('session-B')}}))) }
function untouched(before: string) {
 expect(JSON.stringify(useStore.getState().S)).toBe(before)
 expect(useUI.getState().toast).toHaveBeenCalled()
}
beforeEach(()=> {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
 configureUx(createBrowserUx());repeat.mockReset();logPast.mockReset();io.shareBlob.mockReset().mockResolvedValue(true);io.saveBlob.mockClear();io.printHTML.mockClear()
 configurePlanHistorySheets({version:'1',repeatWorkout:repeat,logPastWorkoutSheet:logPast,exerciseHistorySheet:vi.fn()})
 useUI.setState({sheets:[],toast:vi.fn()})
 const S={...structuredClone(DEF),customEx:[ex],workouts:[structuredClone(saved)],routines:[{id:'r',name:'Synthetic routine',ex:[{id:ex.id}]}],week:{1:['r']},active:session('session-A')}
 useStore.setState({S,index:createExerciseIndex(S.customEx),user:null})
 document.body.innerHTML=''
})
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));vi.restoreAllMocks()})
it('stale delete cannot remove the source of a newly opened real history editor',()=>{
 useStore.setState(s=>({S:{...s.S,active:null}}))
 workoutDetailSheet(saved);const detail=mount();act(()=>btn(detail,'Delete workout').click());const confirm=mount()
 act(()=>useStore.getState().update(s=>editCompletedSession(s as any,saved)))
 const before=JSON.stringify(useStore.getState().S)
 act(()=>btn(confirm,'Delete').click())
 // Save now throws "Workout deleted" on the unguarded implementation.
 expect(()=>saveWorkoutEdit(structuredClone(useStore.getState().S) as any)).not.toThrow()
 untouched(before)
})
it('stale routine-save cannot copy a target deleted while confirmation is open',()=>{
 workoutDetailSheet(saved);const detail=mount();act(()=>btn(detail,'Save as routine').click());const confirm=mount()
 replaceSession();act(()=>useStore.setState(s=>({S:{...s.S,workouts:[]}})))
 const before=JSON.stringify(useStore.getState().S)
 act(()=>btn(confirm,'Save').click());untouched(before)
})
it('date sheet aborts after active instance A becomes B',()=>{
 workoutDateSheet(saved);const host=mount();act(()=>type(host.querySelector('input[type=date]')!,'2026-09-13'))
 replaceSession();const before=JSON.stringify(useStore.getState().S)
 act(()=>btn(host,'Save').click());untouched(before)
})
it('duration sheet aborts after active instance A becomes B',()=>{
 workoutDurationSheet(saved);const host=mount();act(()=>type(host.querySelector('input')!,'45'))
 replaceSession();const before=JSON.stringify(useStore.getState().S)
 act(()=>btn(host,'Save').click());untouched(before)
})
it('detail note unmount aborts after active instance A becomes B',()=>{
 workoutDetailSheet(saved);const host=mount();act(()=>type(host.querySelector('textarea')!,'Old sheet note'))
 replaceSession();const before=JSON.stringify(useStore.getState().S)
 act(()=>roots.pop()!.unmount());untouched(before)
})
it('day override does not start a backfill after a logged replacement session appears',()=>{
 dayOverrideSheet('2026-09-07');const host=mount();replaceSession()
 act(()=>btn(host,'Log this workout').click())
 expect(logPast).not.toHaveBeenCalled();expect(useUI.getState().toast).toHaveBeenCalled()
})
it('day override routine assignment aborts after active instance A becomes B',()=>{
 dayOverrideSheet('2026-09-07');const host=mount();replaceSession();const before=JSON.stringify(useStore.getState().S)
 act(()=>[...host.querySelectorAll<HTMLElement>('.item')].find(el=>el.textContent?.includes('Synthetic routine'))!.click());untouched(before)
})
it('day note save aborts after active instance A becomes B',()=>{
 dayNoteSheet('2026-09-07');const host=mount();act(()=>type(host.querySelector('textarea')!,'Old day note'))
 replaceSession();const before=JSON.stringify(useStore.getState().S);act(()=>btn(host,'Save').click());untouched(before)
})
it('weekday assignment aborts after active instance A becomes B',()=>{
 dayAssignSheet(1);const host=mount();replaceSession();const before=JSON.stringify(useStore.getState().S)
 act(()=>[...host.querySelectorAll<HTMLElement>('.item')].find(el=>el.textContent?.includes('Synthetic routine'))!.click());untouched(before)
})
it('import confirmation aborts after active instance A becomes B',()=>{
 planImportSheet({name:'Synthetic import',unit:'kg',routines:[{id:'incoming',name:'Incoming',ex:[{id:ex.id,sets:1}]}],week:{},customEx:[],routineCount:1,exerciseCount:1,scheduledDays:0,dropped:0})
 const host=mount();replaceSession();const before=JSON.stringify(useStore.getState().S)
 act(()=>btn(host,'Add to my plan').click());untouched(before)
})
it('a detail edit callback refuses a replacement session in the real history editor helper',()=>{
 useStore.setState(s=>({S:{...s.S,active:null}}));workoutDetailSheet(saved);const host=mount()
 // Simulate another updater winning before React commits the disabled-button render.
 let before=''
 act(()=>{useStore.setState(s=>({S:{...s.S,active:session('session-B')}}));before=JSON.stringify(useStore.getState().S);btn(host,'Edit workout').click()})
 untouched(before)
})
it('repeat callback does not delegate if another updater starts a session before rerender',()=>{
 useStore.setState(s=>({S:{...s.S,active:null}}));workoutDetailSheet(saved);const host=mount()
 act(()=>{useStore.setState(s=>({S:{...s.S,active:session('session-B')}}));btn(host,'Repeat today').click()})
 expect(repeat).not.toHaveBeenCalled();expect(useUI.getState().toast).toHaveBeenCalled()
})

async function shareSheet() {
 const ctx=new Proxy({measureText:(text:string)=>({width:text.length*10})},{get:(o:any,key)=>o[key]??(()=>{})}) as CanvasRenderingContext2D
 configureUx({...createBrowserUx(),path2D:()=>({} as Path2D)})
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx)
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(cb=>cb(new Blob(['synthetic-png'])))
 useStore.setState(s=>({S:{...s.S,shareMap:false}}))
 workoutDetailSheet(saved);const detail=mount();act(()=>btn(detail,'Share as image').click())
 let host!:HTMLElement
 await act(async()=>{host=mount();await Promise.resolve()})
 return host
}
it('image share confirmation aborts after active instance A becomes B',async()=>{
 const host=await shareSheet();replaceSession()
 await act(async()=>{btn(host,'Share').click();await Promise.resolve()})
 expect(io.shareBlob).not.toHaveBeenCalled();expect(useUI.getState().toast).toHaveBeenCalled()
})
it('image share-map setting aborts after active instance A becomes B',async()=>{
 const host=await shareSheet();expect(host.querySelector('[role=switch]')).not.toBeNull();replaceSession()
 const before=JSON.stringify(useStore.getState().S)
 await act(async()=>{host.querySelector<HTMLButtonElement>('[role=switch]')!.click();await Promise.resolve()})
 untouched(before)
})

// Binding design safety exception: these callbacks deliberately refuse stale legacy actions.
it.each(['Delete workout','Save as routine','Change date & time','Change duration','Share as image','Repeat today','Edit workout','Copy as text','Export as .fit file'])('%s refuses a deleted workout target',async action=>{
 useStore.setState(s=>({S:{...s.S,active:null}}))
 workoutDetailSheet(saved);const host=mount()
 act(()=>useStore.setState(s=>({S:{...s.S,workouts:[]}})))
 const before=JSON.stringify(useStore.getState().S)
 await act(async()=>{btn(host,action).click();await Promise.resolve()})
 if (action==='Delete workout' || action==='Save as routine') {
  const confirm=mount();act(()=>btn(confirm,action==='Delete workout'?'Delete':'Save').click())
 }
 untouched(before);expect(repeat).not.toHaveBeenCalled();expect(io.saveBlob).not.toHaveBeenCalled();expect(io.shareBlob).not.toHaveBeenCalled()
})
it.each([workoutDateSheet,workoutDurationSheet])('history editor refuses a deleted target before even a no-op save',open=>{
 open(saved);const host=mount();act(()=>useStore.setState(s=>({S:{...s.S,workouts:[]}})))
 const before=JSON.stringify(useStore.getState().S);act(()=>btn(host,'Save').click());untouched(before)
})
it('note blur refuses a stale session',()=>{
 workoutDetailSheet(saved);const host=mount();act(()=>type(host.querySelector('textarea')!,'Private draft'))
 replaceSession();const before=JSON.stringify(useStore.getState().S)
 act(()=>host.querySelector('textarea')!.dispatchEvent(new FocusEvent('focusout',{bubbles:true})));untouched(before)
})
it('day note removal refuses a stale session',()=>{
 useStore.getState().update(s=>{s.dayNotes['2026-09-07']={text:'Original',future:{keep:true}}})
 dayNoteSheet('2026-09-07');const host=mount();replaceSession();const before=JSON.stringify(useStore.getState().S)
 act(()=>btn(host,'Remove note').click());untouched(before)
})
it('weekday rest refuses a stale session',()=>{
 dayAssignSheet(1);const host=mount();replaceSession();const before=JSON.stringify(useStore.getState().S)
 act(()=>[...host.querySelectorAll<HTMLElement>('.item')].find(el=>el.textContent?.includes('Rest day'))!.click());untouched(before)
})
it('captures the instance at open before React mounts',()=>{
 dayAssignSheet(1);replaceSession();const host=mount();const before=JSON.stringify(useStore.getState().S)
 act(()=>[...host.querySelectorAll<HTMLElement>('.item')].find(el=>el.textContent?.includes('Synthetic routine'))!.click());untouched(before)
})
it('rejects a transition away and back to the same instance identity',()=>{
 dayAssignSheet(1);const host=mount();replaceSession()
 act(()=>useStore.setState(s=>({S:{...s.S,active:session('session-A')}})))
 const before=JSON.stringify(useStore.getState().S)
 act(()=>[...host.querySelectorAll<HTMLElement>('.item')].find(el=>el.textContent?.includes('Synthetic routine'))!.click());untouched(before)
})
it('validates inside the updater against a different active draft',()=>{
 dayAssignSheet(1);const host=mount();const previousUpdate=useStore.getState().update
 const persisted=vi.fn()
 useStore.setState({update(mut){const draft={...structuredClone(useStore.getState().S),active:session('session-B')};mut(draft);persisted(draft)}})
 try {
  const before=JSON.stringify(useStore.getState().S)
  act(()=>[...host.querySelectorAll<HTMLElement>('.item')].find(el=>el.textContent?.includes('Synthetic routine'))!.click())
  untouched(before);expect(persisted).not.toHaveBeenCalled()
 } finally {useStore.setState({update:previousUpdate})}
})
it('normal note save preserves future keys and canonical clearing',()=>{
 useStore.getState().update(s=>{s.dayNotes['2026-09-07']={text:'Original',tag:'sick',future:{keep:true}}})
 dayNoteSheet('2026-09-07');const host=mount();act(()=>type(host.querySelector('textarea')!,'Updated'))
 act(()=>btn(host,'Save').click());expect(useStore.getState().S.dayNotes['2026-09-07']).toMatchObject({text:'Updated',tag:'sick',future:{keep:true}})
 dayNoteSheet('2026-09-07');const again=mount();act(()=>btn(again,'Remove note').click())
 expect(useStore.getState().S.dayNotes['2026-09-07']).toEqual({_ts:expect.any(Number),future:{keep:true}})
})
it('share fallback after an instance switch neither downloads nor closes another sheet',async()=>{
 const host=await shareSheet();let finish!:(value:boolean)=>void
 io.shareBlob.mockReturnValueOnce(new Promise(resolve=>{finish=resolve}))
 act(()=>btn(host,'Share').click());replaceSession()
 const before=JSON.stringify(useStore.getState().S)
 await act(async()=>{finish(false);await Promise.resolve()})
 untouched(before);expect(io.saveBlob).not.toHaveBeenCalled()
})

it.each(['Export plan file','Print / Save as PDF'])('plan tools %s refuses a stale instance',async action=>{
 planToolsSheet();const host=mount();replaceSession();const before=JSON.stringify(useStore.getState().S)
 await act(async()=>{btn(host,action).click();await Promise.resolve()})
 untouched(before);expect(io.saveBlob).not.toHaveBeenCalled();expect(io.printHTML).not.toHaveBeenCalled()
})
