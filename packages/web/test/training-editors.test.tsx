// @vitest-environment happy-dom
import './workout-sheet-environment'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {useStore} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {editCompletedSession} from '@opengym/core/session-edit'
import {saveWorkoutEdits,exitWorkoutEdit} from '../src/sheets-d'
import Workout from '../src/views/Workout'
import {api} from '../src/lib/api'
vi.mock('../src/lib/api',()=>({api:vi.fn().mockResolvedValue({}),beacon:vi.fn(),appBase:()=>'/'}))
const roots:ReturnType<typeof createRoot>[]=[]
const saved=()=>({id:'saved',d:'2026-10-10',start:1000,end:2000,name:'Synthetic history',entries:[{id:'0025',sets:[{w:40,r:5,done:true}]}],prs:[]})
const active=()=>useStore.getState().S.active
function editor(){
 useStore.getState().discardHistoryEdit()
 useStore.getState().update(s=>{editCompletedSession(s as any,'saved');s.active.entries[0].sets[0].w=55},false)
 return structuredClone(active())
}
function mount(node:React.ReactNode){const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(node));return host}
function prompt(){const sheet=useUI.getState().sheets.at(-1)!;return mount(sheet.render(()=>useUI.getState().closeSheet(sheet.id)))}
function click(host:HTMLElement,text:string){const button=[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===text)!;expect(button).toBeTruthy();act(()=>button.click())}
const packets=()=>vi.mocked(api).mock.calls.filter(([path])=>path==='/api/activity').map(([,opts])=>JSON.parse(String(opts!.body)))
beforeEach(()=>{useStore.getState().setUser({id:'A'},{adopt:true});useStore.getState().update(s=>{s.active=null;s.workouts=[saved()]},false);editor();vi.mocked(api).mockClear()})
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.innerHTML='';vi.clearAllMocks()})
it('history editors heartbeat with the W28 incarnation while keeping saved id/start unchanged',()=>{
 const a=structuredClone(active());mount(<Workout/>);
 expect(a.id).toBe('saved');expect(a.start).toBe(1000);expect(a.editBase.sheetInstanceId).toBeTruthy()
 expect(packets()).toContainEqual(expect.objectContaining({active:true,sessionId:'saved',startedAt:1000,editingWorkoutId:'saved',editorInstanceId:a.editBase.sheetInstanceId}))
})
it.each(['save','cancel','delete'] as const)('successful guarded editor %s closes only the captured incarnation',kind=>{
 const a=structuredClone(active())
 if(kind==='save')act(()=>saveWorkoutEdits(()=>{}))
 else if(kind==='delete'){act(()=>useStore.getState().update(s=>{s.active.entries[0].sets[0].done=false},false));act(()=>saveWorkoutEdits(()=>{}));click(prompt(),'Delete workout')}
 else{act(()=>exitWorkoutEdit(()=>{}));click(prompt(),"Don't save")}
 expect(active()).toBe(null)
 expect(packets().filter(p=>p.reason==='editor-closed')).toEqual([{active:false,reason:'editor-closed',profileId:'A',sessionId:'saved',startedAt:1000,editingWorkoutId:'saved',editorInstanceId:a.editBase.sheetInstanceId}])
 if(kind!=='delete')expect(useStore.getState().S.workouts[0]).toMatchObject({id:'saved',start:1000,end:2000})
})
it.each(['save','cancel','delete'] as const)('stale editor %s callback cannot close a reopened editor of the same saved workout',kind=>{
 if(kind==='delete')act(()=>useStore.getState().update(s=>{s.active.entries[0].sets[0].done=false},false))
 act(()=>kind==='delete'?saveWorkoutEdits(()=>{}):exitWorkoutEdit(()=>{}));const old=prompt(),a=structuredClone(active())
 act(()=>editor());const b=structuredClone(active());expect(b.editBase.sheetInstanceId).not.toBe(a.editBase.sheetInstanceId);vi.mocked(api).mockClear()
 click(old,kind==='delete'?'Delete workout':kind==='save'?'Save changes':"Don't save")
 expect(active()).toEqual(b);expect(packets().filter(p=>p.reason==='editor-closed')).toEqual([])
})
