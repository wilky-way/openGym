// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import ProgrammeCalendar from './ProgrammeCalendar.jsx'
import {DEF,useStore} from '../store/useStore.js'
import {useUI} from '../store/useUI.js'
import {activate,shiftNotToday,pause,skip} from '../lib/programme.js'
import {shiftPreview} from '../lib/programme-today.js'
import {programmeAction} from './ProgrammeToday.jsx'
import {workoutDetailSheet} from '../sheets.jsx'
vi.mock('../sheets.jsx',()=>({workoutDetailSheet:vi.fn(),dayOverrideSheet:vi.fn(),startFlow:vi.fn(),confirmSheet:vi.fn()}))
const def={id:'calendar',name:'Synthetic strength',weeks:[1,2,3].map(index=>({index,mode:index===3?'deload':'train',days:[1,2,3,4].map(i=>({key:'d'+i,sessions:[{routineSnapshot:{name:'Day '+i,ex:[]}}]}))}))}
let roots=[]
const mount=el=>{const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(el));return host}
const click=(host,sel)=>act(()=>host.querySelector(sel).click())
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-12T12:00:00'));vi.clearAllMocks();localStorage.clear();document.body.innerHTML='';const S=structuredClone(DEF);activate(S,def,{cycleId:'c',today:'2026-10-12'});S.workouts=[{id:'historical',d:'2026-09-20',name:'Historical lift',entries:[]}];useStore.setState({S,user:null});useUI.setState({sheets:[],programmeShift:null})})
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));vi.useRealTimers()})
it('renders the worked-example month, end and deload, and opens projected sessions',()=>{const host=mount(<ProgrammeCalendar/>);expect(host.querySelectorAll('[data-date]')).toHaveLength(31);expect(host.querySelector('[data-date="2026-10-31"]').textContent).toContain('🏁');expect(host.querySelectorAll('.pending')).toHaveLength(12);expect(host.querySelectorAll('.deload')).toHaveLength(4);click(host,'[data-date="2026-10-12"] .pending');const sh=useUI.getState().sheets.at(-1);expect(mount(sh.render(()=>{})).textContent).toContain('Projected session')})
it('shows history outside program months and opens a saved workout',()=>{const host=mount(<ProgrammeCalendar/>);click(host,'[aria-label="Previous month"]');expect(host.textContent).toContain('September');click(host,'.logged');expect(workoutDetailSheet).toHaveBeenCalledWith(expect.objectContaining({id:'historical'}));click(host,'[aria-label="Next month"]');expect(host.textContent).toContain('October')})
it('avoids duplicate done chips, shows skipped sessions and opens the day chooser',()=>{useStore.getState().update(s=>{const o=s.programmes.cycles[0].occurrences[0];s.workouts.push({id:'done',d:'2026-10-12',name:'Completed workout',entries:[{occurrenceId:o.instanceId}]});skip(s,'c',s.programmes.cycles[0].occurrences[1].instanceId,{today:'2026-10-12'})});const host=mount(<ProgrammeCalendar/>);expect(host.querySelectorAll('.logged')).toHaveLength(1);expect(host.querySelectorAll('.skipped')).toHaveLength(1);expect(host.querySelectorAll('.program-calendar-chip.done')).toHaveLength(0);click(host,'[data-date="2026-10-12"] .program-calendar-date');const sh=useUI.getState().sheets.at(-1);expect(mount(sh.render(()=>{})).textContent).toContain('Completed workout')})
it('retains history when paused and without a program',()=>{useStore.getState().update(s=>pause(s,'c','2026-10-12'));const host=mount(<ProgrammeCalendar/>);expect(host.textContent).toContain('Logged workouts remain visible');expect(host.querySelectorAll('.pending')).toHaveLength(0);click(host,'[aria-label="Previous month"]');expect(host.querySelectorAll('.logged')).toHaveLength(1);act(()=>useStore.getState().update(s=>{s.programmes.cycles=[];s.queue=null}));expect(host.querySelectorAll('.logged')).toHaveLength(1)})
it('shows ghosts and moved rings after Shift without storing projected dates',()=>{const host=mount(<ProgrammeCalendar/>),preview=shiftPreview(useStore.getState().S,'c','2026-10-12');act(()=>programmeAction('c',s=>shiftNotToday(s,'c','2026-10-12'),'shifted',preview));expect(host.textContent).toContain('12 sessions moved');expect(host.querySelector('[data-date="2026-10-12"] .program-calendar-ghost')).toBeTruthy();expect(host.querySelectorAll('.moved').length).toBeGreaterThan(0);expect(useStore.getState().S.programmes.cycles[0].occurrences.every(o=>!o.date)).toBe(true);act(()=>useUI.getState().toastAction.run());expect(host.querySelectorAll('.program-calendar-ghost')).toHaveLength(0)})

it.each(['finished','archived'])('retains skipped history and end flags of a %s run without projecting its pending sessions',status=>{
 useStore.getState().update(s=>{const c=s.programmes.cycles[0];skip(s,'c',c.occurrences[0].instanceId,{today:'2026-10-12'});c.status=status;c.completedOn='2026-10-12';s.queue=null})
 const host=mount(<ProgrammeCalendar/>);expect(host.querySelectorAll('.pending')).toHaveLength(0);expect(host.querySelectorAll('.skipped')).toHaveLength(1);expect(host.querySelector('[data-date="2026-10-12"]').textContent).toContain('🏁');click(host,'.skipped');expect(useUI.getState().sheets).toHaveLength(1)
})
it('keeps resolved history from an old run alongside the new run',()=>{
 useStore.getState().update(s=>{skip(s,'c',s.programmes.cycles[0].occurrences[0].instanceId,{today:'2026-10-12'});s.programmes.cycles[0].status='archived';activate(s,def,{cycleId:'new',today:'2026-10-12'})})
 const host=mount(<ProgrammeCalendar/>);expect(host.querySelectorAll('.skipped')).toHaveLength(1);expect(host.querySelectorAll('.pending')).toHaveLength(12)
})
it('labels dates with sessions and labels chips with date, next, deload and moved status; includes visible symbols and legend',()=>{
 const host=mount(<ProgrammeCalendar/>);expect(host.querySelector('[data-date="2026-10-12"] .program-calendar-date').getAttribute('aria-label')).toContain('2026');expect(host.querySelector('[data-date="2026-10-12"] .program-calendar-date').getAttribute('aria-label')).toContain('Next session');expect(host.querySelector('.next').textContent).toContain('→');expect(host.querySelector('.deload').textContent).toContain('◇');expect(host.querySelector('.deload').getAttribute('aria-label')).toContain('Deload');expect(host.querySelector('.deload').getAttribute('aria-label')).toContain('2026');expect(host.textContent).toContain('Calendar legend')
 act(()=>programmeAction('c',s=>shiftNotToday(s,'c','2026-10-12'),'shifted',shiftPreview(useStore.getState().S,'c','2026-10-12')));expect(host.querySelector('.moved').getAttribute('aria-label')).toContain('Moved');expect(host.querySelector('.moved').textContent).toContain('↗')
})
it('a missed day shows ghosts, moved rings and notice, including after reload, without storing pending dates in state',()=>{
 const host=mount(<ProgrammeCalendar/>);vi.setSystemTime(new Date('2026-10-13T12:00:00'));act(()=>useStore.setState({S:structuredClone(useStore.getState().S)}));expect(host.textContent).toContain('Your projected sessions moved');expect(host.querySelector('[data-date="2026-10-12"] .program-calendar-ghost')).toBeTruthy();expect(host.querySelector('.moved')).toBeTruthy();expect(useStore.getState().S.programmes.cycles[0].occurrences.every(o=>!o.date)).toBe(true)
 act(()=>roots.splice(0).forEach(r=>r.unmount()));const reloaded=mount(<ProgrammeCalendar/>);expect(reloaded.textContent).toContain('Your projected sessions moved');expect(reloaded.querySelector('.program-calendar-ghost')).toBeTruthy()
})
it('a trained day does not display a missed-day notice',()=>{
 const host=mount(<ProgrammeCalendar/>);vi.setSystemTime(new Date('2026-10-13T12:00:00'));act(()=>useStore.getState().update(s=>s.workouts.push({id:'done',d:'2026-10-12',entries:[{occurrenceId:s.programmes.cycles[0].occurrences[0].instanceId}]})));expect(host.textContent).not.toContain('Your projected sessions moved');expect(host.querySelectorAll('.program-calendar-ghost')).toHaveLength(0)
})
it('places the finished flag on the last resolved date, retaining logged deload cues',()=>{
 useStore.getState().update(s=>{const c=s.programmes.cycles[0];s.workouts.push(...c.occurrences.map((o,i)=>({id:'old'+i,d:'2026-10-11',name:'Workout',entries:[{occurrenceId:o.instanceId}]})))});
 const host=mount(<ProgrammeCalendar/>);expect(host.querySelector('[data-date="2026-10-11"]').textContent).toContain('🏁');expect(host.querySelector('[data-date="2026-10-12"]').textContent).not.toContain('🏁');expect(host.querySelectorAll('.logged.deload')).toHaveLength(4);expect(host.querySelector('.logged.deload').getAttribute('aria-label')).toContain('Deload');expect(host.querySelector('.logged.deload').textContent).toContain('◇')
})
