import { startFlow } from './programme-ui-harness'
// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import ProgrammeToday,{notTodaySheet,programmeAction} from '../src/components/ProgrammeToday'
import QueueRow from '../src/components/QueueRow'
import {DEF,useStore} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {activate,shiftNotToday,pause} from '@opengym/core/programme'
import {projectCycle} from '@opengym/core/programme-calendar'
import {bindUI} from '../src/components/ui'
import { effectiveRoutineId as apiRoutine } from '@opengym/core/history'
const def={id:'today',name:'Synthetic strength',weeks:[1,2,3].map((index: any) =>({index,rir:2,days:[1,2,3,4].map((i: any) =>({key:'d'+i,sessions:[{routineSnapshot:{name:'Day '+i,ex:[]}}]}))}))}
let roots: any[]=[]
const mount=(el: any) =>{const host:any=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(<>{el}</>));return host}
const click=(host: any, text: any) =>{const b=[...host.querySelectorAll('button')].find((b: any) =>b.textContent.trim()===text);expect(b,text).toBeTruthy();act(()=>b.click())}
const sheet=()=>{const sh=useUI.getState().sheets.at(-1)!;return mount(sh.render(()=>useUI.getState().closeSheet(sh.id)))}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-12T12:00:00'));bindUI(useUI);document.body.innerHTML='';useUI.setState({sheets:[],toastAction:null});const S=structuredClone(DEF);activate(S,def,{cycleId:'c',today:'2026-10-12'});useStore.setState({S,user:null})})
afterEach(()=>{act(()=>roots.splice(0).forEach((r: any) =>r.unmount()));vi.useRealTimers()})
it('shows Today, shifts with the engine preview, becomes a rest day, and Undo restores the projection',()=>{
 const host=mount(<ProgrammeToday/>);expect(host.textContent).toContain('Week 1 of 3 · 2 RIR');click(host,'Not today?');const sh=sheet();expect(sh.textContent).toContain('12 sessions move');expect(sh.textContent).toContain('Sun, Nov 1');click(sh,'Shift: do it tomorrow');expect(host.textContent).toContain('Program rest day');expect(apiRoutine(useStore.getState().S,'2026-10-12')).toBeNull();act(()=>useUI.getState().toastAction!.run());expect(useStore.getState().S.programmes.cycles[0].notBefore).toBeNull();expect(host.textContent).toContain('Next program session')
})
it('does not undo a later edit or a started workout',()=>{programmeAction('c',(s: any) =>shiftNotToday(s,'c','2026-10-12'),'shifted');const undo=useUI.getState().toastAction!.run;useStore.getState().update((s: any) =>{s.active={id:'new-workout'}});act(()=>undo());expect(useStore.getState().S.programmes.cycles[0].notBefore).toBe('2026-10-13')})
it('moves to a selected date, pauses without a queue-row crash, and resumes',()=>{
 const host=mount(<ProgrammeToday/>);notTodaySheet('c');const sh=sheet();const input:any=sh.querySelector('input');act(()=>{Object.getOwnPropertyDescriptor(input.constructor.prototype,'value')!.set!.call(input,'2026-10-15');input.dispatchEvent(new Event('input',{bubbles:true}))});click(sh,'Move session');expect(useStore.getState().S.programmes.cycles[0].occurrences[0].pinnedOn).toBe('2026-10-15');click(host,'Not today?');click(sheet(),'Pause for travel');expect(host.textContent).toContain('Program paused');mount(<QueueRow S={useStore.getState().S} today="2026-10-12" onStart={()=>{}}/>);expect(apiRoutine(useStore.getState().S,'2026-10-12')).toBeNull();click(host,'Pick up at week 1');expect(useStore.getState().S.programmes.cycles[0].status).toBe('active')
})
it('skip is explicit, advances the next occurrence and remains undoable',()=>{notTodaySheet('c');click(sheet(),'Skip d1 instead');click(sheet(),'Skip this session');const S=useStore.getState().S;expect(S.programmes.cycles[0].occurrences[0].status).toBe('skipped');expect(projectCycle(S.programmes.cycles[0],S.workouts,'2026-10-12',S.queue).next.dayKey).toBe('d2');act(()=>useUI.getState().toastAction!.run());expect(useStore.getState().S.programmes.cycles[0].occurrences[0].status).toBe('pending')})

it.each(['shift','skip','pause','move'])('uses the current date when %s is tapped after midnight', (action: any) =>{
 vi.setSystemTime(new Date('2026-10-12T23:59:59'));notTodaySheet('c');const sh=sheet();
 if(action==='move'){const input:any=sh.querySelector('input');act(()=>{Object.getOwnPropertyDescriptor(input.constructor.prototype,'value')!.set!.call(input,'2026-10-12');input.dispatchEvent(new Event('input',{bubbles:true}))})}
 vi.setSystemTime(new Date('2026-10-13T00:00:01'));
 if(action==='shift'){click(sh,'Shift: do it tomorrow');expect(useStore.getState().S.programmes.cycles[0].notBefore).toBe('2026-10-14')}
 if(action==='skip'){click(sh,'Skip d1 instead');click(sheet(),'Skip this session');expect(useStore.getState().S.programmes.cycles[0].occurrences[0].date).toBe('2026-10-13')}
 if(action==='pause'){click(sh,'Pause for travel');expect(useStore.getState().S.programmes.cycles[0].pausedOn).toBe('2026-10-13')}
 if(action==='move'){click(sh,'Move session');expect(sh.querySelector('[role=alert]').textContent).toContain('current or future date');expect(useStore.getState().S.programmes.cycles[0].occurrences[0].pinnedOn).toBeUndefined()}
})
it('offers pick up and repeat while paused, and identifies an active out-of-order workout independently',()=>{
 useStore.getState().update((s: any) =>{s.active={id:'in-flight',name:'Day 3 out of order'};pause(s,'c','2026-10-12')});const host=mount(<ProgrammeToday/>);expect(host.textContent).toContain('Day 3 out of order');expect(host.textContent).toContain('Resume');expect(host.textContent).toContain('Pick up at week 1');expect(host.textContent).toContain('Repeat week');expect(host.textContent).not.toContain('Invalid Date')
})
it('labels a no-op shift honestly on a pinned rest day',()=>{
 useStore.getState().update((s: any) =>{s.programmes.cycles[0].occurrences[0].pinnedOn='2026-10-15'});notTodaySheet('c');const sh=sheet();expect(sh.textContent).toContain('Your next session is already later');expect(sh.textContent).not.toContain('Shift: do it tomorrow');click(sh,'Check current dates');expect(useUI.getState().toastMsg).toContain('already have these dates')
})


it('the main-lift subtitle shows effective deload work sets',()=>{
 useStore.getState().update((s: any) =>{const r=s.routines[0];r.ex=[{id:'0025',sets:4,reps:8,weight:100,prog:'off'}];r.deload={setsFactor:.5,loadFactor:.7};r.excludeFromProgression=true});const host=mount(<ProgrammeToday/>);expect(host.textContent).toContain('2 × 8');expect(host.textContent).not.toContain('4 × 8')
})
it('a timed main lift uses its duration and never prints undefined reps',()=>{
 useStore.getState().update((s: any) =>{s.routines[0].ex=[{id:'0025',mode:'time',sets:3,sec:45,weight:0,prog:'off'}]});const host=mount(<ProgrammeToday/>);expect(host.textContent).toContain('3 × 0:45');expect(host.textContent).not.toContain('undefined')
})
it('programme heading identifies the next session while a different workout is active',()=>{
 useStore.getState().update((s: any) =>{s.active={id:'flight',name:'D3 active',entries:[]}});const host=mount(<ProgrammeToday/>);expect(host.querySelector('h2').textContent).toBe('Next program session');expect(host.textContent).toContain('D3 active')
})

it('refuses a stale direct Start after the opening account changes', () => {
  useStore.setState({ user: { id: 'synthetic-a' } })
  const host = mount(<ProgrammeToday />)
  act(() => useStore.setState({ user: { id: 'synthetic-b' } }))
  const before = JSON.stringify(useStore.getState().S)
  click(host, 'Start')
  expect(startFlow).not.toHaveBeenCalled()
  expect(JSON.stringify(useStore.getState().S)).toBe(before)
  expect(useUI.getState().toastMsg).toContain('changed')
})
it('permits direct Start for the opening account', () => {
  useStore.setState({ user: { id: 'synthetic-a' } })
  const host = mount(<ProgrammeToday />)
  click(host, 'Start')
  expect(startFlow).toHaveBeenCalledOnce()
  expect(startFlow).toHaveBeenCalledWith([projectCycle(useStore.getState().S.programmes.cycles[0], [], '2026-10-12').next!.routineId])
})
