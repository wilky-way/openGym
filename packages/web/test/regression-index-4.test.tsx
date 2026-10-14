// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { createExerciseIndex } from '@opengym/core/exercises'
import { drawWorkoutCard } from '../src/lib/workout-card'
import { workoutFit } from '@opengym/core/fit-export'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { configureClientIO } from '../src/lib/client-io'
import { createBrowserPlatform } from '../src/platform/browser'
import { exportPlanFile, importPlanFile, planImportSheet, printWholePlan, workoutDetailSheet, workoutDateSheet, planToolsSheet, PLAN_FILE_MAX, DayNoteRow, WorkoutRow, configurePlanHistorySheets, dayOverrideSheet } from '../src/sheets-plan-history'
const io = vi.hoisted(() => ({ printHTML: vi.fn(), saveBlob: vi.fn(), readPlanFile: vi.fn(), shareBlob: vi.fn(), imageURL: vi.fn(() => 'blob:preview'), revokeImageURL: vi.fn() }))
vi.mock('../src/platform/plan-history', () => io)
let roots: Root[] = []
function mountTop(): HTMLElement {
 const sheet = useUI.getState().sheets.at(-1)!
 const host = document.createElement('div'); document.body.append(host)
 const root = createRoot(host); roots.push(root)
 act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
 return host
}
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!
const type = (el: HTMLInputElement, value: string) => { Object.getOwnPropertyDescriptor(el.constructor.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true})) }
const bw = { id:'custom-bw', n:'Custom body lift', eq:'body weight', bp:'upper arms', tg:'biceps', custom:true }
const cardio = { id:'custom-cardio', n:'Custom cardio', eq:'elliptical machine', bp:'cardio', tg:'cardiovascular system', custom:true }
const bells = { id:'custom-bells', n:'Custom single arm bells', eq:'dumbbell', bp:'upper arms', tg:'biceps', custom:true }
const assist = { id:'custom-assist', n:'Custom assisted', assisted:true, eq:'assisted', bp:'back', tg:'lats', custom:true }
function install(extra: any = {}) {
 const S = { ...structuredClone(DEF), customEx:[bw,cardio,assist,bells], ...extra }
 useStore.setState({ S, index:createExerciseIndex(S.customEx) })
}
const entry = (id='custom-bw') => ({id,target:{},sets:[{w:10,r:8,done:true}]})
const workout = (extra: any = {}) => ({id:'w1',name:'Synthetic workout',d:'2026-09-14',start:new Date('2026-09-14T09:00:00').getTime(),end:new Date('2026-09-14T10:00:00').getTime(),entries:[entry()],prs:[], ...extra})
beforeEach(() => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-16T12:00:00'))
 configureUx(createBrowserUx());configureClientIO(createBrowserPlatform())
 io.saveBlob.mockReset();io.readPlanFile.mockReset();io.shareBlob.mockReset();io.revokeImageURL.mockReset();io.imageURL.mockReset().mockReturnValue('blob:preview')
 useUI.setState({sheets:[],toast:vi.fn()});useStore.setState({user:null});install()
 document.body.innerHTML=''
 configurePlanHistorySheets({version:'1.0.0',exerciseHistorySheet:vi.fn(),logPastWorkoutSheet:vi.fn(),repeatWorkout:vi.fn()})
})
afterEach(() => {act(() => roots.splice(0).forEach(r=>r.unmount()));vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()})
describe('custom-index outputs', () => {
 it('exports custom cardio targets through buildPlanBundle', async () => {
  install({routines:[{id:'r',name:'Cardio',ex:[{id:cardio.id,min:12,speed:7}]}]})
  await exportPlanFile()
  const data=JSON.parse(await io.saveBlob.mock.calls[0]![0].text())
  expect(data.routines[0].ex[0]).toMatchObject({min:12,speed:7})
 })
 it('accepts an already-installed custom exercise during parsePlan', async () => {
  io.readPlanFile.mockResolvedValue(JSON.stringify({opengym_plan:1,unit:'kg',week:{},routines:[{id:'r',name:'Local custom',ex:[{id:bw.id,reps:8,sets:1,weight:10}]}],customEx:[]}))
  await importPlanFile(new Blob(['{}']))
  expect(mountTop().textContent).toContain('1 exercise')
  expect(mountTop().textContent).not.toContain('left out')
 })
 it('retains an installed custom reference through mergePlan', () => {
  planImportSheet({name:'Import',unit:'kg',routines:[{id:'r',name:'Incoming',ex:[{id:bw.id,reps:8,sets:1,weight:10}]}],week:{},customEx:[],routineCount:1,exerciseCount:1,scheduledDays:0,dropped:0})
  const host=mountTop();act(()=>button(host,'Add to my plan').click())
  expect(useStore.getState().S.routines[0].ex[0].id).toBe(bw.id)
 })
 it('prints a custom bodyweight target with its name and added-load notation', () => {
  install({routines:[{id:'r',name:'Routine',ex:[{id:bw.id,reps:8,sets:1,weight:10}]}]})
  printWholePlan()
  const html = io.printHTML.mock.calls.at(-1)![0]
  expect(html).toContain('Custom body lift')
  expect(html).toContain('+10')
 })
 it('shows and copies the custom bodyweight set label', async () => {
  const writeText=vi.fn(async (_text:string)=>{})
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}})
  const w=workout();install({workouts:[w]});workoutDetailSheet(w)
  const host=mountTop()
  expect(host.querySelector('.wd-ex .ss')!.textContent).toBe('+10 × 8')
  await act(async()=>button(host,'Copy as text').click())
  expect(writeText.mock.calls[0]![0]).toContain('+10 × 8')
 })
 it('computes custom dumbbell volume in combined routine sections', () => {
  const w=workout({entries:[{...entry(bells.id),target:{dbLoad:'each'},rid:'a'},{...entry(bells.id),target:{dbLoad:'each'},rid:'b'}],routineIds:['a','b']})
  install({workouts:[w]});workoutDetailSheet(w)
  expect(mountTop().textContent).toContain('1 sets · 80 kg')
 })
 it('exports custom cardio FIT bytes using its real index', async () => {
  const w=workout({entries:[{id:cardio.id,target:{},sets:[{min:12,speed:7,done:true}]}]})
  install({workouts:[w]});workoutDetailSheet(w)
  const host=mountTop();await act(async()=>button(host,'Export as .fit file').click())
  const bytes=new Uint8Array(await io.saveBlob.mock.calls[0]![0].arrayBuffer())
  expect(bytes).toEqual(workoutFit(w,{unit:'kg',version:'1.0.0'},useStore.getState().index))
  expect(bytes).not.toEqual(workoutFit(w,{unit:'kg',version:'1.0.0'}))
 })
 it('rebuilds assisted-lift PRs in the lower-assistance direction when moving', () => {
  const a=workout({id:'a',prs:[assist.id],entries:[{id:assist.id,sets:[{w:30,r:8,done:true}]}]})
  const b=workout({id:'b',d:'2026-09-15',start:new Date('2026-09-15T09:00:00').getTime(),end:new Date('2026-09-15T10:00:00').getTime(),prs:[],entries:[{id:assist.id,sets:[{w:40,r:8,done:true}]}]})
  install({workouts:[a,b]});workoutDateSheet(b);const host=mountTop()
  act(()=>type(host.querySelector('input[type=date]')!,'2026-09-13'))
  act(()=>button(host,'Save').click())
  expect(useStore.getState().S.workouts.map((w:any)=>w.prs)).toEqual([[assist.id],[assist.id]])
 })
 it('saves custom cardio as a cardio routine through the real session helper', () => {
  const w=workout({entries:[{id:cardio.id,sets:[{min:12,speed:7,done:true}]}]})
  install({workouts:[w]});workoutDetailSheet(w)
  const host=mountTop();act(()=>button(host,'Save as routine').click())
  const confirm=mountTop();act(()=>button(confirm,'Save').click())
  expect(useStore.getState().S.routines[0].ex[0]).toMatchObject({id:cardio.id,min:12,speed:7})
 })
 it('uses the custom index to compute share-image volume and names', async () => {
  const texts:string[]=[]
  const ctx=new Proxy({fillText:(text:string)=>texts.push(text),measureText:(text:string)=>({width:text.length*10})},{get:(o:any,key)=>o[key]??(()=>{})}) as CanvasRenderingContext2D
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx)
  vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(cb=>cb(new Blob(['png'],{type:'image/png'})))
  const w=workout({entries:[{...entry(bells.id),target:{dbLoad:'each'}}]});install({workouts:[w],shareMap:false});workoutDetailSheet(w)
  const host=mountTop();act(()=>button(host,'Share as image').click())
  await act(async()=>{mountTop();await Promise.resolve()})
  expect(texts).toContain('80 kg')
  expect(texts).not.toContain('160 kg')
 })
})
describe('file safety and integration seams', () => {
 it('rejects over 1 MiB before the file reader runs', async () => {
  const onRead=vi.fn();await importPlanFile(new Blob([new Uint8Array(PLAN_FILE_MAX+1)]),onRead)
  expect(io.readPlanFile).not.toHaveBeenCalled();expect(onRead).not.toHaveBeenCalled();expect(useUI.getState().sheets).toHaveLength(0)
  expect(useUI.getState().toast).toHaveBeenCalledWith('Couldn’t read that file.')
 })
 it('reads the inclusive 1 MiB limit and reports read failure without closing', async () => {
  io.readPlanFile.mockRejectedValue(new Error('synthetic failure'));const close=vi.fn()
  await importPlanFile(new Blob([new Uint8Array(PLAN_FILE_MAX)]),close)
  expect(io.readPlanFile).toHaveBeenCalledTimes(1);expect(close).not.toHaveBeenCalled();expect(useUI.getState().toast).toHaveBeenCalledWith('Couldn’t read that file.')
 })
 it('closes only after valid parsing and leaves bad input unchanged', async () => {
  const before=useStore.getState().S;io.readPlanFile.mockResolvedValue('{}');const close=vi.fn()
  await importPlanFile(new Blob(['{}']),close)
  expect(close).not.toHaveBeenCalled();expect(useStore.getState().S).toBe(before);expect(useUI.getState().sheets).toHaveLength(0)
 })
 it('keeps empty plan export and print disabled but offers import', () => {
  planToolsSheet();const host=mountTop()
  expect(button(host,'Export plan file').disabled).toBe(true);expect(button(host,'Print / Save as PDF').disabled).toBe(true);expect(button(host,'Import a plan file').disabled).toBe(false)
 })
 it('passes the saved record and close callback to the repeat seam', () => {
  const repeatWorkout=vi.fn();configurePlanHistorySheets({version:'1',repeatWorkout,exerciseHistorySheet:vi.fn(),logPastWorkoutSheet:vi.fn()})
  const w=workout();install({workouts:[w]});workoutDetailSheet(w);const host=mountTop();act(()=>button(host,'Repeat today').click())
  expect(repeatWorkout).toHaveBeenCalledWith(w,expect.any(Function))
 })
 it('renders day-note rows without media and opens the note', () => {
  const host=document.createElement('div'),root=createRoot(host);roots.push(root)
  act(()=>root.render(<DayNoteRow iso="2026-09-14" note={{tag:'sick',text:'Synthetic note'}}/>))
  expect(host.textContent).toContain('Sick');expect(host.textContent).toContain('Synthetic note')
  act(()=>host.querySelector<HTMLElement>('.item')!.click());expect(useUI.getState().sheets).toHaveLength(1)
 })
 it('renders a workout row with PRs and no deleted-media badges', () => {
  const host=document.createElement('div'),root=createRoot(host);roots.push(root)
  act(()=>root.render(<WorkoutRow w={workout({prs:[bw.id],media:[{}]})} onClick={()=>{}}/>))
  expect(host.textContent).toContain('1 PR');expect(host.querySelector('.wrow-media')).toBeNull()
 })
})

function stubCanvas(callbacks?: BlobCallback[], texts: string[] = []) {
 const ctx=new Proxy({fillText:(text:string)=>texts.push(text),measureText:(text:string)=>({width:text.length*10})},{get:(o:any,key)=>o[key]??(()=>{})}) as CanvasRenderingContext2D
 configureUx({...createBrowserUx(),path2D:()=>({} as Path2D)})
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(ctx)
 vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(cb=>callbacks?callbacks.push(cb):cb(new Blob(['png'])))
 return ctx
}
async function openShare(w: any) {
 install({workouts:[w],shareMap:false});workoutDetailSheet(w)
 const detail=mountTop();act(()=>button(detail,'Share as image').click())
 let host!: HTMLElement;await act(async()=>{host=mountTop();await Promise.resolve()})
 return host
}
describe('review regressions',()=>{
 it('recomputes share PR names after a custom-index replacement and unit change',async()=>{
  const texts:string[]=[];stubCanvas(undefined,texts)
  await openShare(workout({prs:[bw.id]}))
  expect(texts.join(' ')).toContain('Custom Body Lift')
  act(()=>install({workouts:[workout()],shareMap:false,unit:'lb',customEx:[{...bw,n:'Renamed custom'},cardio,assist,bells]}))
  await act(async()=>{await Promise.resolve()})
  expect(texts.join(' ')).toContain('Renamed Custom')
 })
 it('draws trophy and map paths through the injected adapter without global Path2D',()=>{
  vi.stubGlobal('Path2D',undefined)
  const paths:string[]=[];const ctx=stubCanvas()
  configureUx({...createBrowserUx(),path2D:path=>{paths.push(path);return {path} as unknown as Path2D}})
  drawWorkoutCard(ctx,{width:100,height:100,rtl:false,items:[{kind:'trophy',x:0,y:0,size:24},{kind:'map',view:'front',x:0,y:0,w:10,h:10}]},{bg:'#000',surface:'#222',label:'#fff',label2:'#999',acc:'#0f0'},{body:{front:{vb:'0 0 10 10',p:{chest:['muscle-path'],hair:['inert-path']}}},levels:{chest:1}})
  expect(paths).toHaveLength(4);expect(paths).toContain('muscle-path');expect(paths).toContain('inert-path')
 })
 it('drops a read that finishes after the profile changes',async()=>{
  let resolve!: (value:string)=>void;io.readPlanFile.mockReturnValue(new Promise(r=>{resolve=r}))
  const close=vi.fn();const pending=importPlanFile(new Blob(['plan']),close)
  useStore.setState({user:{id:'other-profile'}})
  resolve(JSON.stringify({opengym_plan:1,unit:'kg',week:{},routines:[],customEx:[]}));await pending
  expect(close).not.toHaveBeenCalled();expect(useUI.getState().sheets).toHaveLength(0);expect(useStore.getState().S.routines).toHaveLength(0)
 })
 it('drops the file read when its PlanTools sheet was unmounted',async()=>{
  let resolve!: (value:string)=>void;io.readPlanFile.mockReturnValue(new Promise(r=>{resolve=r}))
  planToolsSheet();const host=mountTop();const field=host.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(field,'files',{value:[new Blob(['plan'])]})
  act(()=>field.dispatchEvent(new Event('change',{bubbles:true})))
  act(()=>{useUI.setState({sheets:[]});roots.pop()!.unmount()})
  await act(async()=>{resolve(JSON.stringify({opengym_plan:1,unit:'kg',week:{},routines:[],customEx:[]}));await Promise.resolve()})
  expect(useUI.getState().sheets).toHaveLength(0);expect(useStore.getState().S.routines).toHaveLength(0)
 })
 it('refuses a confirmation opened for a previous profile',()=>{
  planImportSheet({unit:'kg',routines:[{id:'r',ex:[{id:bw.id}]}],week:{},customEx:[],routineCount:1,exerciseCount:1,scheduledDays:0,dropped:0})
  const host=mountTop();useStore.setState({user:{id:'new-profile'}})
  act(()=>button(host,'Add to my plan').click())
  expect(useStore.getState().S.routines).toHaveLength(0);expect(useUI.getState().toast).toHaveBeenCalledWith('This sheet is out of date. Open it again.')
 })
 it('disables edit and repeat while a session is active',()=>{
  const w=workout();install({workouts:[w],active:{id:'live'}});workoutDetailSheet(w);const host=mountTop()
  expect(button(host,'Repeat today').disabled).toBe(true);expect(button(host,'Edit workout').disabled).toBe(true)
 })
 it('flushes the typed note before repeat delegation',()=>{
  const repeatWorkout=vi.fn(()=>expect(useStore.getState().S.workouts[0].note).toBe('Updated note'))
  configurePlanHistorySheets({version:'1',repeatWorkout,exerciseHistorySheet:vi.fn(),logPastWorkoutSheet:vi.fn()})
  const w=workout();install({workouts:[w]});workoutDetailSheet(w);const host=mountTop()
  act(()=>type(host.querySelector('textarea') as any,'Updated note'))
  act(()=>button(host,'Repeat today').click());expect(repeatWorkout).toHaveBeenCalledOnce()
 })
 it('closes the day sheet before delegating its missed-day date and combined routines',()=>{
  const logPastWorkoutSheet=vi.fn(()=>expect(useUI.getState().sheets).toHaveLength(0))
  configurePlanHistorySheets({version:'1',repeatWorkout:vi.fn(),exerciseHistorySheet:vi.fn(),logPastWorkoutSheet})
  install({routines:[{id:'a',name:'A',ex:[]},{id:'b',name:'B',ex:[]}],week:{1:['a','b']}})
  dayOverrideSheet('2026-09-14');const host=mountTop();act(()=>button(host,'Log this workout').click())
  expect(logPastWorkoutSheet).toHaveBeenCalledWith({iso:'2026-09-14',routineIds:['a','b']})
 })
 it('keeps a cancelled native share handled and downloads only for unavailable sharing',async()=>{
  stubCanvas();const host=await openShare(workout());io.shareBlob.mockResolvedValueOnce(true)
  await act(async()=>button(host,'Share').click())
  expect(io.saveBlob).not.toHaveBeenCalled();expect(useUI.getState().sheets).toHaveLength(1)
  const next=await openShare(workout());io.shareBlob.mockResolvedValueOnce(false)
  await act(async()=>button(next,'Share').click())
  expect(io.saveBlob).toHaveBeenCalledOnce();expect(io.saveBlob.mock.calls[0]![1]).toBe('opengym-workout-2026-09-14.png')
 })
 it('replaces and releases preview URLs, retaining the old preview until the new draw completes',async()=>{
  const callbacks: BlobCallback[]=[];stubCanvas(callbacks)
  io.imageURL.mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
  const host=await openShare(workout());await act(async()=>{callbacks.shift()!(new Blob(['first']));await Promise.resolve()})
  expect(host.querySelector('img')!.getAttribute('src')).toBe('blob:first')
  act(()=>useStore.setState(s=>({S:{...s.S,body:'female'}})))
  expect(host.querySelector('img')!.getAttribute('src')).toBe('blob:first')
  await act(async()=>{callbacks.shift()!(new Blob(['second']));await Promise.resolve()})
  expect(io.revokeImageURL).toHaveBeenCalledWith('blob:first');expect(host.querySelector('img')!.getAttribute('src')).toBe('blob:second')
  act(()=>roots.pop()!.unmount());expect(io.revokeImageURL).toHaveBeenCalledWith('blob:second')
 })
 it('ignores image generation completing after the share sheet unmounts',async()=>{
  const callbacks: BlobCallback[]=[];stubCanvas(callbacks)
  await openShare(workout());act(()=>roots.pop()!.unmount())
  await act(async()=>{callbacks.shift()!(new Blob(['late']));await Promise.resolve()})
  expect(io.imageURL).not.toHaveBeenCalled()
 })
})
