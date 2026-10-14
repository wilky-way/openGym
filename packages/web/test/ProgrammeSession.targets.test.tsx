import './programme-ui-harness'
import {programmeUi, configureProgrammeUi} from '../src/lib/programme-ui-services'
import {startFlow as realStartFlow} from '../src/sheets-d'
import {startProgramme} from '@opengym/core/programme-lifecycle'
// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {DEF,useStore,type StoreDocument} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {programmeSessionSheet} from '../src/components/ProgrammeSession'
import {activate} from '@opengym/core/programme'
import {bindUI} from '../src/components/ui'
let root: any,host: any,occurrence: any
beforeEach(()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;bindUI(useUI);useUI.setState({sheets:[]});const S=structuredClone(DEF)
 const cfg={id:'0025',sets:2,reps:5,pyramid:[1,5],setTargets:[{rpe:8},{rir:2}],tm:{key:'bench',percentages:[75,65]},instructions:'Synthetic backoffs: drop 10%'}
 const d={id:'synthetic-preview',name:'Synthetic preview',unit:'lb',weeks:[{index:1,days:[{key:'d1',sessions:[{routineSnapshot:{name:'Upper',prog:'off',ex:[cfg,{open:true,label:'Your accessory',slotId:'back',sets:3,repsMin:10,reps:15,weight:0,prog:'off'}]}}]}]}]}
 const c=activate(S,d,{cycleId:'c',today:'2026-10-12'});occurrence=c.occurrences[0];useStore.setState({S,user:null});host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove()})
const mount=()=>{programmeSessionSheet(occurrence);const sh=useUI.getState().sheets.at(-1)!;act(()=>root.render(sh.render(()=>{})))}
it('shows each authored set target, rule and open slot before Start, without requiring a TM',()=>{
 mount();expect(host.textContent).toContain('Set 1 · 1 · @8 · 75%');expect(host.textContent).toContain('Set 2 · 5 · 2 RIR · 65%');expect(host.textContent).toContain('Synthetic backoffs: drop 10%');expect(host.textContent).toContain('Your accessory');expect(host.textContent).toContain('3 × 10–15');expect(host.textContent).not.toContain(' lb')
 expect([...host.querySelectorAll('button')].find((b: any) =>b.textContent==='Start').disabled).toBe(false)
})
it('shows a TM-derived load only when the cycle actually has a TM',()=>{
 useStore.getState().update((s: any) =>{s.unit='lb';s.programmes.cycles[0].tm={bench:200}});mount();expect(host.textContent).toContain('75% · 150 lb');expect(host.textContent).toContain('65% · 130 lb')
})

it('updates all projected targets immediately when the profile changes, keeping authored state intact',()=>{
 mount();const before=JSON.stringify(useStore.getState().S.routines)
 act(()=>useStore.getState().update((s: any) =>{s.effort='rpe'}))
 expect(host.textContent).toContain('Set 1 · 1 · RPE 8 · 75%');expect(host.textContent).toContain('Set 2 · 5 · RPE 8 · 65%')
 act(()=>useStore.getState().update((s: any) =>{s.effort='rir'}))
 expect(host.textContent).toContain('Set 1 · 1 · 2 RIR · 75%');expect(JSON.stringify(useStore.getState().S.routines)).toBe(before)
})

// The composed shell exercises the rendered programme/workout-row Start path.
it('pending session button cannot start before the program bound', () => {
  const S: StoreDocument = {...structuredClone(DEF), unit:'lb', routines:[], workouts:[], sound:false, weighIn:false}
  const definition = {id:'synthetic',name:'synthetic',unit:'lb',weeks:[1,2].map(index=>({index,days:[{key:'d1',sessions:[{routineSnapshot:{name:'Day 1',ex:[{id:'0025',sets:3,reps:10,weight:100,prog:'off',open:true,label:'Synthetic pick',pyramid:[5,10,10]}]}}]}]}))}
  startProgramme(S, definition, {cycleId:'future',today:'2026-10-12',startsOn:'2026-10-19'})
  useStore.setState({S}); useUI.setState({toastMsg:''})
  configureProgrammeUi({...programmeUi(),startFlow:realStartFlow})
  programmeSessionSheet(S.programmes.cycles[0].occurrences[0])
  const sheet = useUI.getState().sheets.at(-1)!
  act(()=>root.render(sheet.render(()=>useUI.getState().closeSheet(sheet.id))))
  act(()=>[...(host as HTMLElement).querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.trim()==='Start')!.click())
  expect(useStore.getState().S.active).toBe(null)
  expect(useUI.getState().toastMsg).toContain('2026-10-19')
})
