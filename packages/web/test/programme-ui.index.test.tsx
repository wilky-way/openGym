// @vitest-environment happy-dom
import './programme-ui-harness'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from '@babel/parser'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { bindUI } from '../src/components/ui'
import { activate, skip } from '@opengym/core/programme'
import { createExerciseIndex, canonicalExId, EXIDX } from '@opengym/core/exercises'
import { EXALIAS } from '@opengym/core/exercises-data'
import ProgrammeToday from '../src/components/ProgrammeToday'
import { programmeSessionSheet } from '../src/components/ProgrammeSession'
import { rolloverSheet, acceptRolloverWithUndo } from '../src/components/ProgrammeRollover'
import ProgrammeImport from '../src/components/ProgrammeImport'
import Programs from '../src/views/Programs'
const custom = { id:'synthetic-custom-lift', n:'Synthetic Custom Lift', eq:'dumbbell', bp:'chest', custom:true }
const definition = (cfg: any = {}) => ({id:'synthetic',name:'Synthetic',unit:'kg',weeks:[1,2].map(index=>({index,days:[{key:'d1',sessions:[{routineSnapshot:{name:'Day',ex:[{id:custom.id,slotId:'lift',sets:index+1,reps:5,weight:20,prog:'off',...cfg}]}}]}]}))})
let roots: Root[] = []
const mount = (element: React.ReactNode): HTMLDivElement => { const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(element));return host }
const sheet = () => mount(useUI.getState().sheets.at(-1)!.render(()=>{}))
const click = (host: HTMLElement, text: string) => {const button=[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;expect(button).toBeTruthy();act(()=>button.click())}
const install = (cfg: any = {}, exercise: any = custom) => {
 const S:any=structuredClone(DEF);S.unit='kg';S.customEx=[exercise]
 activate(S,definition({...cfg,id:exercise.id}),{cycleId:'c',today:'2026-10-12'},createExerciseIndex(S.customEx));useStore.setState({S,user:null});return S
}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-12T12:00:00'));bindUI(useUI);useUI.setState({sheets:[]});document.body.innerHTML='';install()})
afterEach(()=>{act(()=>roots.splice(0).forEach(root=>root.unmount()));vi.useRealTimers()})
it('session preview resolves the custom name and rounds TM to owned custom dumbbells',()=>{
 install({sets:1,pyramid:[5],tm:{key:'lift',percentages:[75]}})
 useStore.getState().update(s=>{s.programmes.cycles[0].tm={lift:23};s.dumbbells={kg:{weights:[10,15,20]}}})
 programmeSessionSheet(useStore.getState().S.programmes.cycles[0].occurrences[0]);const host=sheet()
 expect(host.textContent).toContain('Synthetic Custom Lift');expect(host.textContent).toContain('75% · 15 kg')
})
it('Today resolves the real custom exercise name',()=>{expect(mount(<ProgrammeToday/>).textContent).toContain('Synthetic Custom Lift')})
it('Today derives the subtitle mode from a real custom cardio exercise',()=>{
 install({min:7},{...custom,bp:'cardio',eq:'body weight'});expect(mount(<ProgrammeToday/>).textContent).toContain('2 × 7 min')
})
it('Today derives a bodyweight set increase from real custom history',()=>{
 install({sets:3,reps:10,repsMax:15,weight:0,prog:'linear'},{...custom,id:'0025',eq:'body weight'})
 useStore.getState().update(s=>{const r=s.routines[0];s.workouts=[{id:'history',d:'2026-10-11',routineIds:[r.id],entries:[{id:r.ex[0].id,target:{sets:3,reps:15},sets:[1,2,3].map(()=>({w:0,r:15,done:true}))}]}]})
 expect(mount(<ProgrammeToday/>).textContent).toContain('4 × 10')
})
it('rollover resolves a real custom proposal name',()=>{
 useStore.getState().update(s=>skip(s,'c','c:w1d1',{today:'2026-10-12'}));rolloverSheet('c');expect(sheet().textContent).toContain('Synthetic Custom Lift')
})
it('rollover excludes real custom cardio slots from set proposals',()=>{
 install({}, {...custom,bp:'cardio'});useStore.getState().update(s=>skip(s,'c','c:w1d1',{today:'2026-10-12'}));rolloverSheet('c');expect(sheet().textContent).toContain('No set changes to propose')
})
it('rollover acceptance validates real custom cardio proposals with the profile index',()=>{
 install({}, {...custom,bp:'cardio'});useStore.getState().update(s=>skip(s,'c','c:w1d1',{today:'2026-10-12'}));act(()=>acceptRolloverWithUndo('c',[],[]));expect(useStore.getState().S.programmes.cycles[0].rolloverReviewed).toBeTruthy()
})
it('imports and saves a native custom programme with no routine activation',async()=>{
 const host=mount(<ProgrammeImport/>),input=host.querySelector<HTMLInputElement>('input[type=file]')!
 Object.defineProperty(input,'files',{value:[{name:'synthetic.json',size:300,text:async()=>JSON.stringify(definition())}]})
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(host.textContent).toContain('Import preview');click(host,'Save program')
 expect(useStore.getState().S.programmes.definitions[0].weeks[0].days[0].sessions[0].routineSnapshot.ex[0].id).toBe(custom.id)
})
it('previews both custom start and switch through the actual UI',()=>{
 useStore.getState().update(s=>{s.programmes.definitions=[definition()];s.programmes.cycles=[];s.routines=[];s.queue=null})
 const host=mount(<Programs/>);act(()=>host.querySelector<HTMLButtonElement>('.program-card')!.click());click(host,'Start this program');expect(host.textContent).toContain('Next session: Synthetic D1')
 click(host,'Confirm load');click(host,'All programs');const own=[...host.querySelectorAll<HTMLButtonElement>('.program-card')].find(b=>b.textContent?.includes('Mine'))!;act(()=>own.click());click(host,'Switch to this program');expect(host.textContent).toContain('Confirm switch')
})
// Inert edges: a real created index retains every alias target; programme lifecycle conversion
// passes only {unit,routines}, whose conversion never consults exercise metadata.
it('proves canonical lookup inert for all real-index aliases and custom ids',()=>{
 const index=createExerciseIndex([custom]);for(const id of [...Object.keys(EXALIAS),custom.id])expect(canonicalExId(id,index)).toBe(canonicalExId(id))
 for(const target of Object.values(EXALIAS))expect(EXIDX[target]).toBeTruthy()
})
const inert = [
 ['components/ProgrammeImport','importProgramme',2],['components/ProgrammeImport','saveImportedProgramme',3],
 ['views/Programs','startProgramme',3],['views/Programs','switchProgramme',4],
 ['store/public-actions','repeatWeek',4],['store/public-actions','finishBlock',4],
] as const
function calls(source: string): any[] {const found:any[]=[];const visit=(node:any)=>{if(!node || typeof node!=='object')return;if(node.type==='CallExpression')found.push(node);for(const [key,value] of Object.entries(node))if(!['loc','comments','tokens'].includes(key))Array.isArray(value)?value.forEach(visit):visit(value)};visit(parse(source,{sourceType:'module',plugins:['typescript','jsx']}));return found}
for(const [module,callee,position] of inert)it(`inert index forwarding: ${module} → ${callee}`,()=>{
 const call=calls(readFileSync(resolve(import.meta.dirname,'../src/'+module+(module==='store/public-actions'?'.ts':'.tsx')),'utf8')).find(n=>n.callee?.name===callee)
 expect(call.arguments[position]).toMatchObject(module==='store/public-actions'?{type:'Identifier',name:'index'}:{type:'CallExpression',callee:{type:'Identifier',name:'createExerciseIndex'}})
})
