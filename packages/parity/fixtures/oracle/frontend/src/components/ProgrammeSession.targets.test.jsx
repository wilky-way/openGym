// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {DEF,useStore} from '../store/useStore.js'
import {useUI} from '../store/useUI.js'
import {programmeSessionSheet} from './ProgrammeSession.jsx'
import {activate} from '../lib/programme.js'
import {bindUI} from './ui.jsx'
vi.mock('../sheets.jsx',()=>({startFlow:vi.fn(),confirmSheet:vi.fn(),workoutDetailSheet:vi.fn()}))
let root,host,occurrence
beforeEach(()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;bindUI(useUI);useUI.setState({sheets:[]});const S=structuredClone(DEF)
 const cfg={id:'0025',sets:2,reps:5,pyramid:[1,5],setTargets:[{rpe:8},{rir:2}],tm:{key:'bench',percentages:[75,65]},instructions:'Synthetic backoffs: drop 10%'}
 const d={id:'synthetic-preview',name:'Synthetic preview',unit:'lb',weeks:[{index:1,days:[{key:'d1',sessions:[{routineSnapshot:{name:'Upper',prog:'off',ex:[cfg,{open:true,label:'Your accessory',slotId:'back',sets:3,repsMin:10,reps:15,weight:0,prog:'off'}]}}]}]}]}
 const c=activate(S,d,{cycleId:'c',today:'2026-10-12'});occurrence=c.occurrences[0];useStore.setState({S,user:null});host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove()})
const mount=()=>{programmeSessionSheet(occurrence);const sh=useUI.getState().sheets.at(-1);act(()=>root.render(sh.render(()=>{})))}
it('shows each authored set target, rule and open slot before Start, without requiring a TM',()=>{
 mount();expect(host.textContent).toContain('Set 1 · 1 · @8 · 75%');expect(host.textContent).toContain('Set 2 · 5 · 2 RIR · 65%');expect(host.textContent).toContain('Synthetic backoffs: drop 10%');expect(host.textContent).toContain('Your accessory');expect(host.textContent).toContain('3 × 10–15');expect(host.textContent).not.toContain(' lb')
 expect([...host.querySelectorAll('button')].find(b=>b.textContent==='Start').disabled).toBe(false)
})
it('shows a TM-derived load only when the cycle actually has a TM',()=>{
 useStore.getState().update(s=>{s.unit='lb';s.programmes.cycles[0].tm={bench:200}});mount();expect(host.textContent).toContain('75% · 150 lb');expect(host.textContent).toContain('65% · 130 lb')
})

it('updates all projected targets immediately when the profile changes, keeping authored state intact',()=>{
 mount();const before=JSON.stringify(useStore.getState().S.routines)
 act(()=>useStore.getState().update(s=>{s.effort='rpe'}))
 expect(host.textContent).toContain('Set 1 · 1 · RPE 8 · 75%');expect(host.textContent).toContain('Set 2 · 5 · RPE 8 · 65%')
 act(()=>useStore.getState().update(s=>{s.effort='rir'}))
 expect(host.textContent).toContain('Set 1 · 1 · 2 RIR · 75%');expect(JSON.stringify(useStore.getState().S.routines)).toBe(before)
})
