// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import Programs, { ProgrammeRoutines } from './Programs.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { activate, advanceProgramme, pause } from '../lib/programme.js'
import { mergeStates } from '../lib/sync-merge.js'
import { bindUI } from '../components/ui.jsx'
import { dayOverrideSheet } from '../sheets.jsx'

export const definition = {id:'synthetic-ui',name:'Synthetic strength',unit:'lb',weeks:[1,2,3].map(index=>({index,rir:index===3?6:2,mode:index===3?'deload':'train',days:['d1','d2'].map(key=>({key,sessions:[{routineSnapshot:{name:key,ex:[{id:'0025',sets:3,reps:8,weight:80}]}}]}))}))}
let roots=[]
const mount = el => { const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(<MemoryRouter>{el}</MemoryRouter>));return host }
const click = (host,text) => { const b=[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text);expect(b,'button '+text).toBeTruthy();act(()=>b.click()) }
const sheet = () => mount(useUI.getState().sheets.at(-1).render(()=>{}))
const setDate = (host, value) => {
 const input=host.querySelector('input[type=date]')
 act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})
}
const addNext = () => useStore.getState().update(s=>s.programmes.definitions.push({...structuredClone(definition),id:'next',name:'Next synthetic program'}))
const openNext = host => act(()=>[...host.querySelectorAll('.program-card')].find(b=>b.textContent.includes('Next synthetic program')).click())
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true; vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-12T12:00:00'));localStorage.clear();bindUI(useUI);document.body.innerHTML='';useUI.setState({sheets:[],toasts:[]});const S=structuredClone(DEF);S.programmes.definitions=[structuredClone(definition)];useStore.setState({S,user:null})})
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));vi.useRealTimers()})
it('loads through the preview and opens the weeks grid and a pending session',()=>{
 const host=mount(<Programs/>);act(()=>host.querySelector('.program-card').click());click(host,'Start this program');expect(host.textContent).toContain('Load 6 routines');click(host,'Confirm load');expect(useStore.getState().S.queue.programmeCycleId).toBeTruthy();
 click(host,'All programs');act(()=>host.querySelector('.program-card').click());expect(host.querySelectorAll('.program-cell')).toHaveLength(6);expect(host.textContent).toContain('Deload');act(()=>host.querySelector('.program-cell').click());expect(useUI.getState().sheets).toHaveLength(1);
})
it('shows a single routine name that differs from the day name before loading',()=>{
 useStore.getState().update(s=>{const d=s.programmes.definitions[0];d.days=[{key:'d1',name:'Upper day'}];d.weeks[0].days[0].sessions[0].routineSnapshot.name='Press & pull'})
 const host=mount(<Programs/>);act(()=>host.querySelector('.program-card').click());const name=host.querySelector('.program-day-name')
 expect(name.querySelector('strong').textContent).toBe('Upper day');expect(name.querySelector('small').textContent).toBe('Press & pull')
})
it('the rendered day sheet saves a program pin through the real store cleanup and can clear it',()=>{
 useStore.getState().update(s=>activate(s,definition,{cycleId:'c'}));const o=useStore.getState().S.programmes.cycles[0].occurrences[0]
 dayOverrideSheet('2026-10-14');let sheet=useUI.getState().sheets.at(-1);let host=mount(sheet.render(()=>{}));const row=[...host.querySelectorAll('.item')].find(r=>r.textContent.includes(o.routineName));expect(row).toBeTruthy();act(()=>row.click())
 expect(useStore.getState().S.programmes.cycles[0].occurrences[0].pinnedOn).toBe('2026-10-14');expect(useStore.getState().S.dayPlan['2026-10-14']).toBeUndefined()
 dayOverrideSheet('2026-10-14');sheet=useUI.getState().sheets.at(-1);host=mount(sheet.render(()=>{}));act(()=>[...host.querySelectorAll('.item')].find(r=>r.textContent==='Back to weekly plan').click())
 expect(useStore.getState().S.programmes.cycles[0].occurrences[0].pinnedOn).toBeUndefined()
})
it('reconciles two offline activations identically in either merge order and projects the survivor',()=>{
 const a=structuredClone(useStore.getState().S),b=structuredClone(a);activate(a,definition,{cycleId:'a',now:100});activate(b,definition,{cycleId:'b',now:200})
 for(const merged of [mergeStates(a,b),mergeStates(b,a)]){advanceProgramme(merged,'2026-10-12');expect(merged.programmes.cycles.filter(c=>c.status==='active').map(c=>c.id)).toEqual(['a']);expect(merged.programmes.cycles.find(c=>c.id==='b').status).toBe('archived');expect(merged.routines).toHaveLength(12);expect(merged.queue.programmeCycleId).toBe('a')}
})

it('adoption preview requires distinct routine picks and preserves their prescriptions and queue progress',()=>{
 useStore.getState().update(s=>{s.routines=['a','b'].map((id,i)=>({id,name:id,ex:[{id:'0025',sets:5,reps:6,weight:100+i}]}));s.queue={ids:['a','b'],since:123,startsOn:'2026-10-12'};});
 const host=mount(<Programs/>);act(()=>host.querySelector('.program-card').click());click(host,'Start this program');act(()=>host.querySelector('[role=switch][aria-label="Adopt existing routines for this week"]').click());
 expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Confirm load').disabled).toBe(true)
 for(const [day,id] of [['d1','a'],['d2','b']]){
  const picker=[...host.querySelectorAll('button.lrow')].find(b=>b.textContent.startsWith(day));act(()=>picker.click());const sheet=useUI.getState().sheets.at(-1);const sh=mount(sheet.render(()=>{}));click(sh,id)
 }
 click(host,'Confirm load');const S=useStore.getState().S;expect(S.routines.find(r=>r.id==='a').ex[0].sets).toBe(5);expect(S.queue.since).toBe(123);expect(S.queue.ids).toEqual(['a','b']);expect(S.routines).toHaveLength(6)
})

it.each(['rest','personal'])('a programme day pin replaces a %s override',value=>{
 useStore.getState().update(s=>{activate(s,definition,{cycleId:'c'});s.dayPlan['2026-10-14']=value});const o=useStore.getState().S.programmes.cycles[0].occurrences[0]
 dayOverrideSheet('2026-10-14');const host=mount(useUI.getState().sheets.at(-1).render(()=>{}));act(()=>[...host.querySelectorAll('.item')].find(r=>r.textContent.includes(o.routineName)).click())
 expect(useStore.getState().S.dayPlan['2026-10-14']).toBeUndefined();expect(useStore.getState().S.programmes.cycles[0].occurrences[0].pinnedOn).toBe('2026-10-14')
})
it('offline adoption repairs shared routine ownership in either merge order and archival survives newer stale edits',()=>{
 const base=structuredClone(useStore.getState().S);base.routines=['a','b'].map(id=>({id,name:id,ex:[{id:'0025',sets:3}]}));base.queue={ids:['b','a'],since:100,startsOn:'2026-10-12'}
 const a=structuredClone(base),b=structuredClone(base);const named=structuredClone(definition);named.weeks.forEach(w=>w.days.forEach(d=>{d.sessions[0].sessionTemplateId=d.key}));activate(a,named,{cycleId:'winner',existingRoutineIds:{d1:'a',d2:'b'}});activate(b,named,{cycleId:'loser',existingRoutineIds:{d1:'a',d2:'b'}})
 // Deterministic tie-break picks loser alphabetically. Use a later since for the second run.
 b.programmes.cycles[0].since=200;b.edited={queue:200};b.routines.forEach(r=>{r._ts=200;r._f={programme:200}})
 for(const merged of [mergeStates(a,b),mergeStates(b,a)]) {
  expect(merged.routines.find(r=>r.id==='a').programme).toMatchObject({cycleId:'winner',instanceId:'winner:w1d1',series:'winner:d1'});expect(merged.queue.programmeCycleId).toBe('winner');expect(merged.queue.ids).toEqual(['b','a']);expect(merged.edited.queue).toBeGreaterThan(0)
  merged.programmes.cycles.find(c=>c.id==='winner').status='finished';const stale=structuredClone(b);stale.programmes.cycles[0]._ts=1000;stale.programmes.cycles[0]._f={status:1000};stale.programmes.cycles[0].activationConflict='winner';expect(mergeStates(merged,stale).programmes.cycles.find(c=>c.id==='loser').status).toBe('archived')
 }
})
it('an active run wins over an older paused run and retargets the queue without waiting for advance',()=>{
 const a=structuredClone(useStore.getState().S),b=structuredClone(a);activate(a,definition,{cycleId:'paused',now:100});a.programmes.cycles[0].status='paused';activate(b,definition,{cycleId:'active',now:200});
 for(const S of [mergeStates(a,b),mergeStates(b,a)]) {expect(S.programmes.cycles.find(c=>c.id==='active').status).toBe('active');expect(S.queue.programmeCycleId).toBe('active')}
})

it('adoption preview resolves the existing queue progress before showing the next session',()=>{
 useStore.getState().update(s=>{s.routines=['d1','d2'].map(id=>({id,name:id,ex:[{id:'0025',sets:3}]}));s.queue={ids:['d1','d2'],since:100,startsOn:'2026-10-10'};s.workouts=[{id:'old',name:'d1',routineId:'d1',start:200,d:'2026-10-10',entries:[]}]})
 const host=mount(<Programs/>);act(()=>host.querySelector('.program-card').click());click(host,'Start this program');act(()=>host.querySelector('[role=switch][aria-label="Adopt existing routines for this week"]').click());expect(host.textContent).toContain('Next session: d2');expect(useStore.getState().S.programmes.cycles).toHaveLength(0)
})
it('terminal statuses have a fixed precedence in either merge order',()=>{
 const a=structuredClone(useStore.getState().S),b=structuredClone(a);a.programmes.cycles=[{id:'c',status:'finished',occurrences:[]}];b.programmes.cycles=[{id:'c',status:'archived',occurrences:[]}]
 for(const S of [mergeStates(a,b),mergeStates(b,a)]) expect(S.programmes.cycles[0].status).toBe('finished')
})
it('places library-source definitions under Library and own definitions under Mine',()=>{
 useStore.getState().update(s=>{s.programmes.definitions.push({...structuredClone(definition),id:'library',name:'Library sample',source:{kind:'library'},rulesSupported:false})});
 const host=mount(<Programs/>),cards=[...host.querySelectorAll('.program-card')];expect(cards).toHaveLength(2);expect(cards[1].textContent).toContain('Library sample');expect(cards[1].textContent).toContain('Ready')
})

it('shows only remaining weeks for the active run, with completed weeks still in program detail',()=>{
 useStore.getState().update(s=>{activate(s,definition,{cycleId:'c'});s.workouts=s.programmes.cycles[0].occurrences.filter(o=>o.weekIndex===1).map((o,i)=>({id:'done'+i,d:'2026-10-12',entries:[{occurrenceId:o.instanceId}]}))});
 const host=mount(<ProgrammeRoutines S={useStore.getState().S} nav={()=>{}}/>);expect(host.querySelectorAll('details')).toHaveLength(2);expect(host.textContent).not.toContain('Week 1');expect(host.textContent).toContain('Week 2')
})
it('removes the offline-conflict continuation message when its surviving run is complete',()=>{
 useStore.getState().update(s=>{activate(s,definition,{cycleId:'c'});s.programmes.cycles.push({id:'loser',status:'archived',activationConflict:'c',occurrences:[],snapshot:definition})});const host=mount(<Programs/>);expect(host.textContent).toContain('Your earlier run continues');act(()=>useStore.getState().update(s=>{s.programmes.cycles.find(c=>c.id==='c').status='finished';s.queue=null}));expect(host.textContent).not.toContain('Your earlier run continues')
})
it('UI continuation adoption marks missing earlier weeks pre-app without inventing prescriptions',()=>{
 useStore.getState().update(s=>{
  s.programmes.definitions[0].weeks=[4,5,6].map(index=>({...structuredClone(definition.weeks[0]),index}))
  s.routines=['d1','d2'].map(id=>({id,name:id,ex:[{id:'0025',sets:3,reps:8,weight:100}]}))
  s.queue={ids:['d2','d1'],since:123,startsOn:'2026-10-12'}
 })
 const host=mount(<Programs/>);act(()=>host.querySelector('.program-card').click());click(host,'Start this program')
 act(()=>host.querySelector('[role=switch][aria-label="Adopt existing routines for this week"]').click())
 click(host,'Confirm load')
 const S=useStore.getState().S,c=S.programmes.cycles[0]
 expect(c.preApp.weeks).toEqual([1,2,3]);expect(c.snapshot.weeks.map(w=>w.index)).toEqual([4,5,6]);expect(S.workouts).toEqual([]);expect(S.queue.ids).toEqual(['d2','d1'])
})

it('starts an inactive definition on the chosen future date, defaulting the input to today',()=>{
 const host=mount(<Programs/>);act(()=>host.querySelector('.program-card').click());click(host,'Start this program')
 expect(host.querySelector('input[type=date]').value).toBe('2026-10-12');setDate(host,'2026-10-20');click(host,'Confirm load')
 const S=useStore.getState().S;expect(S.queue.startsOn).toBe('2026-10-20');expect(S.programmes.cycles[0].notBefore).toBe('2026-10-20')
})
it.each(['list','detail'])('ends from the %s only after confirmation and keeps accessible archived history',surface=>{
 useStore.getState().update(s=>{activate(s,definition,{cycleId:'c'});const o=s.programmes.cycles[0].occurrences[0];s.workouts=[{id:'done',d:'2026-10-12',entries:[{occurrenceId:o.instanceId}]}]})
 const before=structuredClone(useStore.getState().S),host=mount(<Programs/>);if(surface==='detail')act(()=>host.querySelector('.program-card').click())
 click(host,'End program');const dialog=sheet();expect(dialog.textContent).toContain('Logged workouts stay in history');expect(useStore.getState().S.programmes.cycles[0].status).toBe('active');click(dialog,'Cancel')
 expect(useStore.getState().S.queue).toEqual(before.queue);click(host,'End program');click(sheet(),'End program')
 const S=useStore.getState().S;expect(S.programmes.cycles[0].status).toBe('archived');expect(S.queue).toBeNull();expect(S.routines.every(r=>!r.programme)).toBe(true);expect(S.workouts).toEqual(before.workouts)
 if(surface==='detail')click(host,'All programs');expect(host.textContent).toContain('Program history');act(()=>[...host.querySelectorAll('.program-card')].find(b=>b.textContent.includes('Archived')).click());expect(host.querySelectorAll('.program-cell')).toHaveLength(6)
})
it.each(['list','detail'])('a paused %s offers and executes Resume and End',surface=>{
 useStore.getState().update(s=>{activate(s,definition,{cycleId:'c'});pause(s,'c','2026-10-12')})
 const host=mount(<Programs/>);if(surface==='detail')act(()=>host.querySelector('.program-card').click())
 expect([...host.querySelectorAll('button')].some(b=>b.textContent==='End program')).toBe(true);click(host,'Resume program');expect(useStore.getState().S.programmes.cycles[0].status).toBe('active');expect(host.textContent).not.toContain('Resume program')
})
it.each(['active','paused'])('switches a %s program from the inactive definition detail with explicit archival copy and start date',status=>{
 useStore.getState().update(s=>{activate(s,definition,{cycleId:'c'});s.programmes.cycles[0].status=status});addNext()
 const host=mount(<Programs/>);openNext(host);click(host,'Switch to this program');expect(host.textContent).toContain('current cycle will be archived');expect(host.textContent).toContain('routines become plain routines');expect(useStore.getState().S.programmes.cycles[0].status).toBe(status)
 setDate(host,'2026-10-21');expect(host.textContent).toContain('new program starts on 2026-10-21');click(host,'Confirm switch')
 const S=useStore.getState().S;expect(S.programmes.cycles.map(c=>c.status)).toEqual(['archived','active']);expect(S.queue.startsOn).toBe('2026-10-21');expect(S.routines.filter(r=>!r.programme)).toHaveLength(6)
})
it.each(['list','detail'])('switches through the next-program chooser from the active %s',surface=>{
 useStore.getState().update(s=>activate(s,definition,{cycleId:'c'}));addNext();const host=mount(<Programs/>);if(surface==='detail')act(()=>host.querySelector('.program-card').click())
 click(host,'Switch program');act(()=>[...host.querySelectorAll('button.lrow')].find(b=>b.textContent.startsWith('Choose next program')).click());click(sheet(),'Next synthetic program')
 expect(host.textContent).toContain('Switch from Synthetic strength to Next synthetic program?');click(host,'Confirm switch');expect(useStore.getState().S.programmes.cycles.find(c=>c.status==='active').programmeId).toBe('next')
})
it('refuses an End confirmation opened before a workout starts and disables every detail mutation',()=>{
 useStore.getState().update(s=>activate(s,definition,{cycleId:'c'}));const host=mount(<Programs/>);act(()=>host.querySelector('.program-card').click());click(host,'End program');const dialog=sheet()
 act(()=>useStore.setState({S:{...useStore.getState().S,active:{id:'running'}}}));const before=structuredClone(useStore.getState().S);click(dialog,'End program');expect(useStore.getState().S).toEqual(before);expect(useUI.getState().toastMsg).toContain('Finish the current workout')
 for(const label of ['End program','Switch program','Duplicate program'])expect([...host.querySelectorAll('button')].find(b=>b.textContent===label).disabled).toBe(true)
 expect(host.querySelector('[role=switch][aria-label="Repeat program"]').disabled).toBe(true)
})
it('disables a switch preview while a workout is active and when its current cycle was replaced',()=>{
 useStore.getState().update(s=>activate(s,definition,{cycleId:'c'}));addNext();const host=mount(<Programs/>);openNext(host);click(host,'Switch to this program')
 const confirm=()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Confirm switch')
 act(()=>useStore.setState({S:{...useStore.getState().S,active:{id:'running'}}}));expect(confirm().disabled).toBe(true)
 act(()=>{const S=structuredClone(useStore.getState().S);S.active=null;S.programmes.cycles[0].status='archived';activate(S,definition,{cycleId:'replacement'});useStore.setState({S})});expect(confirm().disabled).toBe(true);click(host,'Confirm switch');expect(useStore.getState().S.programmes.cycles.find(c=>c.id==='replacement').status).toBe('active')
})
it('shows importer instructions and needs-review reasons while legacy imports are ready',()=>{
 useStore.getState().update(s=>{s.programmes.definitions[0].source={kind:'library'};s.programmes.definitions[0].needsReview=['Review synthetic prescriptions'];s.programmes.definitions[0].instructions='Synthetic block instructions'})
 const host=mount(<Programs/>);expect(host.textContent).toContain('Needs review');act(()=>host.querySelector('.program-card').click());expect(host.textContent).toContain('Synthetic block instructions');expect(host.textContent).toContain('Review synthetic prescriptions')
})

it('opens the current week, keeps later weeks inspectable, and preserves session actions', () => {
 useStore.getState().update(s=>activate(s,definition,{cycleId:'c'}))
 const host=mount(<Programs/>);act(()=>host.querySelector('.program-card').click())
 const weeks=[...host.querySelectorAll('details.program-week')]
 expect(weeks.map(w=>w.open)).toEqual([true,false,false])
 act(()=>weeks[1].querySelector('summary').click())
 expect(weeks[1].open).toBe(true)
 act(()=>weeks[1].querySelector('.program-cell').click())
 expect(useUI.getState().sheets).toHaveLength(1)
 expect(useStore.getState().S.programmes.cycles[0].status).toBe('active')
})
