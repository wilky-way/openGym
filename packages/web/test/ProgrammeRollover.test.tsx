import './programme-ui-harness'
// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect,beforeEach,afterEach} from 'vitest'
import ProgrammeRollover,{rolloverSheet,acceptRolloverWithUndo} from '../src/components/ProgrammeRollover'
import {activate,skip} from '@opengym/core/programme'
import {DEF,useStore} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
let roots: any[]=[]
const mount=(el: any) =>{const host:any=document.createElement('div'),root=createRoot(host);roots.push(root);act(()=>root.render(<>{el}</>));return host}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;const S=structuredClone(DEF);activate(S,{id:'synth',name:'Test',weeks:[1,2].map((index: any) =>({index,days:[{key:'d1',sessions:[{routineSnapshot:{ex:[]}}]}]}))},{cycleId:'c'});useStore.setState({S,user:null});useUI.setState({sheets:[]})})
afterEach(()=>act(()=>roots.splice(0).forEach((r: any) =>r.unmount())))
it('reviews rollover through the real sheet then dismisses the prompt',()=>{useStore.getState().update((s: any) =>skip(s,'c','c:w1d1'));const host=mount(<ProgrammeRollover/>);expect(host.textContent).toContain('Week 1 complete');act(()=>rolloverSheet('c'));const sheet=mount(useUI.getState().sheets.at(-1)!.render(()=>{}));act(()=>sheet.querySelector('button').click());expect(host.textContent).not.toContain('Week 1 complete')})
it('offers a finished block choice and creates a new lap through Repeat',()=>{useStore.getState().update((s: any) =>{skip(s,'c','c:w1d1');skip(s,'c','c:w2d1')});const host=mount(<ProgrammeRollover/>);expect(host.textContent).toContain('Block complete');act(()=>[...host.querySelectorAll('button')].find((b: any) =>b.textContent==='Repeat block').click());expect(useStore.getState().S.programmes.cycles.at(-1)!.lap).toBe(2);expect(host.textContent).not.toContain('Block complete')})

it('rollover Undo restores snapshot, routines and review marker, and is refused after a new action',async()=>{const {rolloverProposals}=await import('@opengym/core/programme-rollover');useStore.getState().update((s: any) =>skip(s,'c','c:w1d1'));const before=structuredClone(useStore.getState().S),p=rolloverProposals(before,'c');act(()=>acceptRolloverWithUndo('c',p,[]));const undo=useUI.getState().toastAction!.run;act(()=>undo());expect(useStore.getState().S.programmes.cycles[0].rolloverReviewed).toBe(before.programmes.cycles[0].rolloverReviewed);expect(useStore.getState().S.routines).toMatchObject(before.routines);act(()=>acceptRolloverWithUndo('c',p,[]));const later=useUI.getState().toastAction!.run;useStore.getState().update((s: any) =>s.active={id:'new-workout'});act(()=>later());expect(useStore.getState().S.programmes.cycles[0].rolloverReviewed).toBeTruthy()})
