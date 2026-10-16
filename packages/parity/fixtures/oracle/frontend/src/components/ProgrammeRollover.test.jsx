// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import {it,expect,beforeEach,afterEach} from 'vitest'
import ProgrammeRollover,{rolloverSheet,acceptRolloverWithUndo} from './ProgrammeRollover.jsx'
import {activate,skip} from '../lib/programme.js'
import {DEF,useStore} from '../store/useStore.js'
import {useUI} from '../store/useUI.js'
let roots=[]
const mount=el=>{const host=document.createElement('div'),root=createRoot(host);roots.push(root);act(()=>root.render(<MemoryRouter>{el}</MemoryRouter>));return host}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;const S=structuredClone(DEF);activate(S,{id:'synth',name:'Test',weeks:[1,2].map(index=>({index,days:[{key:'d1',sessions:[{routineSnapshot:{ex:[]}}]}]}))},{cycleId:'c'});useStore.setState({S,user:null});useUI.setState({sheets:[]})})
afterEach(()=>act(()=>roots.splice(0).forEach(r=>r.unmount())))
it('reviews rollover through the real sheet then dismisses the prompt',()=>{useStore.getState().update(s=>skip(s,'c','c:w1d1'));const host=mount(<ProgrammeRollover/>);expect(host.textContent).toContain('Week 1 complete');act(()=>rolloverSheet('c'));const sheet=mount(useUI.getState().sheets.at(-1).render(()=>{}));act(()=>sheet.querySelector('button').click());expect(host.textContent).not.toContain('Week 1 complete')})
it('offers a finished block choice and creates a new lap through Repeat',()=>{useStore.getState().update(s=>{skip(s,'c','c:w1d1');skip(s,'c','c:w2d1')});const host=mount(<ProgrammeRollover/>);expect(host.textContent).toContain('Block complete');act(()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Repeat block').click());expect(useStore.getState().S.programmes.cycles.at(-1).lap).toBe(2);expect(host.textContent).not.toContain('Block complete')})

it('rollover Undo restores snapshot, routines and review marker, and is refused after a new action',async()=>{const {rolloverProposals}=await import('../lib/programme-rollover.js');useStore.getState().update(s=>skip(s,'c','c:w1d1'));const before=structuredClone(useStore.getState().S),p=rolloverProposals(before,'c');act(()=>acceptRolloverWithUndo('c',p,[]));const undo=useUI.getState().toastAction.run;act(()=>undo());expect(useStore.getState().S.programmes.cycles[0].rolloverReviewed).toBe(before.programmes.cycles[0].rolloverReviewed);expect(useStore.getState().S.routines).toMatchObject(before.routines);act(()=>acceptRolloverWithUndo('c',p,[]));const later=useUI.getState().toastAction.run;useStore.getState().update(s=>s.active={id:'new-workout'});act(()=>later());expect(useStore.getState().S.programmes.cycles[0].rolloverReviewed).toBeTruthy()})
