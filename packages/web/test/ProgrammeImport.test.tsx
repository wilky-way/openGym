import './programme-ui-harness'
// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {beforeEach,afterEach,it,expect} from 'vitest'
import ProgrammeImport from '../src/components/ProgrammeImport'
import {DEF,useStore} from '../src/store/useStore'
const raw={id:'synthetic',name:'Synthetic',unit:'lb',weeks:[{n:1,days:[{n:1,exercises:[{id:'0025',name:'Bench',sets:[{count:3,reps:8,weight:100}]}]}]}]}
let root: any,host: any
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;useStore.setState({S:structuredClone(DEF),user:null});host=document.createElement('div');root=createRoot(host);act(()=>root.render(<ProgrammeImport/>))})
afterEach(()=>act(()=>root.unmount()))
it('shows a file preview then saves only the definition on confirmation',async()=>{const input=host.querySelector('input[type=file]');Object.defineProperty(input,'files',{value:[{name:'sample.json',size:100,text:async()=>JSON.stringify(raw)}],configurable:true});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(host.textContent).toContain('Import preview');expect(useStore.getState().S.programmes.definitions).toEqual([]);act(()=>[...host.querySelectorAll('button')].find((b: any) =>b.textContent==='Save program').click());expect(useStore.getState().S.programmes.definitions[0].name).toBe('Synthetic');expect(useStore.getState().S.routines).toEqual([]);expect(useStore.getState().S.queue).toBeNull()})
