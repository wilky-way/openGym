// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import Home from '../views/Home.jsx'
import ProgrammeToday,{notTodaySheet,programmeAction} from './ProgrammeToday.jsx'
import QueueRow from './QueueRow.jsx'
import {DEF,useStore} from '../store/useStore.js'
import {useUI} from '../store/useUI.js'
import {activate,shiftNotToday,pause} from '../lib/programme.js'
import {projectCycle} from '../lib/programme-calendar.js'
import {bindUI} from './ui.jsx'
import {effectiveRoutineId as apiRoutine} from '../../../api/queue.js'
const def={id:'today',name:'Synthetic strength',weeks:[1,2,3].map(index=>({index,rir:2,days:[1,2,3,4].map(i=>({key:'d'+i,sessions:[{routineSnapshot:{name:'Day '+i,ex:[]}}]}))}))}
let roots=[]
const mount=el=>{const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(<MemoryRouter>{el}</MemoryRouter>));return host}
const click=(host,text)=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text);expect(b,text).toBeTruthy();act(()=>b.click())}
const sheet=()=>{const sh=useUI.getState().sheets.at(-1);return mount(sh.render(()=>useUI.getState().closeSheet(sh.id)))}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-12T12:00:00'));bindUI(useUI);document.body.innerHTML='';useUI.setState({sheets:[],toastAction:null});const S=structuredClone(DEF);activate(S,def,{cycleId:'c',today:'2026-10-12'});useStore.setState({S,user:null})})
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));vi.useRealTimers()})
it('shows Today, shifts with the engine preview, becomes a rest day, and Undo restores the projection',()=>{
 const host=mount(<ProgrammeToday/>);expect(host.textContent).toContain('Week 1 of 3 · 2 RIR');click(host,'Not today?');const sh=sheet();expect(sh.textContent).toContain('12 sessions move');expect(sh.textContent).toContain('Sun 1 Nov');click(sh,'Shift: do it tomorrow');expect(host.textContent).toContain('Program rest day');expect(apiRoutine(useStore.getState().S,'2026-10-12')).toBeNull();act(()=>useUI.getState().toastAction.run());expect(useStore.getState().S.programmes.cycles[0].notBefore).toBeNull();expect(host.textContent).toContain('Next program session')
})
it('does not undo a later edit or a started workout',()=>{programmeAction('c',s=>shiftNotToday(s,'c','2026-10-12'),'shifted');const undo=useUI.getState().toastAction.run;useStore.getState().update(s=>{s.active={id:'new-workout'}});act(()=>undo());expect(useStore.getState().S.programmes.cycles[0].notBefore).toBe('2026-10-13')})
it('moves to a selected date, pauses without a queue-row crash, and resumes',()=>{
 const host=mount(<ProgrammeToday/>);notTodaySheet('c');const sh=sheet();const input=sh.querySelector('input');act(()=>{Object.getOwnPropertyDescriptor(input.constructor.prototype,'value').set.call(input,'2026-10-15');input.dispatchEvent(new Event('input',{bubbles:true}))});click(sh,'Move session');expect(useStore.getState().S.programmes.cycles[0].occurrences[0].pinnedOn).toBe('2026-10-15');click(host,'Not today?');click(sheet(),'Pause for travel');expect(host.textContent).toContain('Program paused');mount(<QueueRow S={useStore.getState().S} today="2026-10-12" onStart={()=>{}}/>);expect(apiRoutine(useStore.getState().S,'2026-10-12')).toBeNull();click(host,'Pick up at week 1');expect(useStore.getState().S.programmes.cycles[0].status).toBe('active')
})
it('skip is explicit, advances the next occurrence and remains undoable',()=>{notTodaySheet('c');click(sheet(),'Skip d1 instead');click(sheet(),'Skip this session');const S=useStore.getState().S;expect(S.programmes.cycles[0].occurrences[0].status).toBe('skipped');expect(projectCycle(S.programmes.cycles[0],S.workouts,'2026-10-12',S.queue).next.dayKey).toBe('d2');act(()=>useUI.getState().toastAction.run());expect(useStore.getState().S.programmes.cycles[0].occurrences[0].status).toBe('pending')})

it.each(['shift','skip','pause','move'])('uses the current date when %s is tapped after midnight', action=>{
 vi.setSystemTime(new Date('2026-10-12T23:59:59'));notTodaySheet('c');const sh=sheet();
 if(action==='move'){const input=sh.querySelector('input');act(()=>{Object.getOwnPropertyDescriptor(input.constructor.prototype,'value').set.call(input,'2026-10-12');input.dispatchEvent(new Event('input',{bubbles:true}))})}
 vi.setSystemTime(new Date('2026-10-13T00:00:01'));
 if(action==='shift'){click(sh,'Shift: do it tomorrow');expect(useStore.getState().S.programmes.cycles[0].notBefore).toBe('2026-10-14')}
 if(action==='skip'){click(sh,'Skip d1 instead');click(sheet(),'Skip this session');expect(useStore.getState().S.programmes.cycles[0].occurrences[0].date).toBe('2026-10-13')}
 if(action==='pause'){click(sh,'Pause for travel');expect(useStore.getState().S.programmes.cycles[0].pausedOn).toBe('2026-10-13')}
 if(action==='move'){click(sh,'Move session');expect(sh.querySelector('[role=alert]').textContent).toContain('current or future date');expect(useStore.getState().S.programmes.cycles[0].occurrences[0].pinnedOn).toBeUndefined()}
})
it('offers pick up and repeat while paused, and identifies an active out-of-order workout independently',()=>{
 useStore.getState().update(s=>{s.active={id:'in-flight',name:'Day 3 out of order'};pause(s,'c','2026-10-12')});const host=mount(<ProgrammeToday/>);expect(host.textContent).toContain('Day 3 out of order');expect(host.textContent).toContain('Resume');expect(host.textContent).toContain('Pick up at week 1');expect(host.textContent).toContain('Repeat week');expect(host.textContent).not.toContain('Invalid Date')
})
it('labels a no-op shift honestly on a pinned rest day',()=>{
 useStore.getState().update(s=>{s.programmes.cycles[0].occurrences[0].pinnedOn='2026-10-15'});notTodaySheet('c');const sh=sheet();expect(sh.textContent).toContain('Your next session is already later');expect(sh.textContent).not.toContain('Shift: do it tomorrow');click(sh,'Check current dates');expect(useUI.getState().toastMsg).toContain('already have these dates')
})

it('keeps the stock today row, different-workout door and ordinary weekday routine alongside the program',()=>{
 useStore.getState().update(s=>{s.routines.push({id:'core',name:'Core',ex:[{id:'0025',sets:1,reps:8}]});s.week[1]=['core']});const host=mount(<Home/>);expect(host.querySelector('.today-row')).toBeTruthy();expect(host.querySelector('.today-row .ttl').textContent).toContain('Core');expect(host.textContent).toContain('Choose a different workout');expect(host.querySelector('.program-today')).toBeTruthy()
})
it('keeps the logged-today tick after a program session is finished',()=>{
 useStore.getState().update(s=>{const o=s.programmes.cycles[0].occurrences[0];s.workouts.push({id:'logged',d:'2026-10-12',name:'D1 completed',start:1,end:2,entries:[{occurrenceId:o.instanceId}],routineIds:[o.routineId]})});const host=mount(<Home/>);expect(host.querySelector('.today-row .ttl').textContent).toContain('D1 completed (done)');expect(host.querySelector('.today-row .tag').textContent).toBe('Done')
})
it('keeps active workout Resume in the stock row even while the program is paused',()=>{
 useStore.getState().update(s=>{s.active={id:'flight',name:'D3 active',start:Date.now(),entries:[]};pause(s,'c','2026-10-12')});const host=mount(<Home/>);expect(host.querySelector('.today-row .ttl').textContent).toContain('D3 active');expect(host.querySelector('.today-row .tag').textContent).toBe('Resume');expect(host.querySelector('.program-today').textContent).toContain('Pick up at week 1')
})

it('the main-lift subtitle shows effective deload work sets',()=>{
 useStore.getState().update(s=>{const r=s.routines[0];r.ex=[{id:'0025',sets:4,reps:8,weight:100,prog:'off'}];r.deload={setsFactor:.5,loadFactor:.7};r.excludeFromProgression=true});const host=mount(<ProgrammeToday/>);expect(host.textContent).toContain('2 × 8');expect(host.textContent).not.toContain('4 × 8')
})
it('a timed main lift uses its duration and never prints undefined reps',()=>{
 useStore.getState().update(s=>{s.routines[0].ex=[{id:'0025',mode:'time',sets:3,sec:45,weight:0,prog:'off'}]});const host=mount(<ProgrammeToday/>);expect(host.textContent).toContain('3 × 0:45');expect(host.textContent).not.toContain('undefined')
})
it('programme heading identifies the next session while a different workout is active',()=>{
 useStore.getState().update(s=>{s.active={id:'flight',name:'D3 active',entries:[]}});const host=mount(<ProgrammeToday/>);expect(host.querySelector('h2').textContent).toBe('Next program session');expect(host.textContent).toContain('D3 active')
})
