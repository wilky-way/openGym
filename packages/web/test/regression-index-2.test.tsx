// @vitest-environment happy-dom
import './workout-sheet-environment'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import Workout from './regression-harness'
import FocusView from '../src/views/FocusView'
import * as sheets from '../src/sheets'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'

const roots: Root[] = []
const custom = (id: string, fields: any = {}) => ({ id, n: 'Local lift', bp: 'upper legs', eq: 'barbell', ...fields })
const entry = (id: string, target: any = {}, rows: any[] = [{ w: 40, r: 8, done: false }]) => ({ id, target: { sets: rows.length, reps: 8, ...target }, sets: rows })
function mount(ex: any, target: any = {}, patch: any = {}, focus = false, rows?: any[]) {
  useStore.getState().update(S => {
    S.unit = 'kg'; Object.assign(S, patch)
    S.customEx = [ex]
    S.active = { id: 'index-proof', d: '2026-10-13', start: 100, cur: 0, entries: [entry(ex.id, target, rows)], workoutView: focus ? 'focus' : 'list' }
  })
  useStore.setState({S:{...useStore.getState().S,customEx:[ex]}}) // Exercise imports may lack the historic custom flag.
  return render(<Workout />)
}
function render(node: React.ReactNode) { const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(node));return host }
function top() { const s=useUI.getState().sheets.at(-1)!;return render(s.render(()=>useUI.getState().closeSheet(s.id))) }
function tap(host: HTMLElement, label: string) { const b=host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? [...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===label)!;expect(b,label).toBeTruthy();act(()=>b.click()) }
function menuClick(host: HTMLElement, label: string) { const b=[...host.querySelectorAll<HTMLElement>('.menu-item')].find(e=>e.querySelector('.tt')?.textContent===label)!;expect(b,label).toBeTruthy();act(()=>b.click()) }
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.innerHTML='';vi.restoreAllMocks()})

it.each([false,true])('custom bar names, default base and loading survive in focus=%s',focus=>{
  const host=mount(custom('c-bar'),{}, {},focus)
  expect(host.textContent).toContain('Local lift')
  expect(host.querySelector(focus?'.focus-badge.plate':'.plateline')?.textContent).toContain('10 per side')
})
it.each([false,true])('custom cardio mode and unflagged custom incline survive in focus=%s',focus=>{
  const host=mount(custom('c-cardio',{n:'Local machine',bp:'cardio',eq:'other'}),{}, {loadKind:{'c-cardio':{kind:'pairs'}}},focus,[{min:10,speed:5,w:40,done:false}])
  expect(host.textContent).toContain('Duration (min)')
  expect(host.textContent).toContain('Incline (%)')
  expect(host.querySelector(focus?'.focus-badge.plate':'.plateline')).toBeNull()
})
it.each([false,true])('custom leg increment is five rather than the unresolved fallback in focus=%s',focus=>{
  const host=mount(custom('c-leg'),{}, {},focus)
  tap(host,focus?'Increase load':'Increase')
  expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(45)
})
it.each([false,true])('custom one-arm bells walk one owned bell rather than a grid in focus=%s',focus=>{
  const host=mount(custom('c-bell',{n:'One arm local press',eq:'dumbbell'}),{dbLoad:'total'}, {dumbbells:{kg:{weights:[9,11,13]}}},focus,[{w:9,r:8,done:false}])
  if(!focus)expect(host.querySelector('.sethead')?.textContent).toContain('Weight (kg)')
  tap(host,focus?'Increase load':'Increase')
  expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(11)
})
it('custom bodyweight remains editable and history/set-menu summaries say added weight',()=>{
  const ex=custom('c-bw',{eq:'body weight'})
  const host=mount(ex,{}, {workouts:[{id:'prior',d:'2026-10-12',start:1,entries:[entry(ex.id,{},[{w:10,r:8,done:true}])]}]})
  expect(host.querySelector('.sethead')?.textContent).toContain('Added (kg)')
  expect(host.querySelector('.refline')?.textContent).toContain('+10 × 8')
  act(()=>host.querySelector<HTMLButtonElement>('button.n')!.click())
  expect(top().textContent).toContain('+40 × 8')
})
it('custom assisted history chooses less assistance and compares the kept record the same way',()=>{
  const ex=custom('c-help',{assisted:true,eq:'leverage machine'})
  const host=mount(ex,{}, {exWeights:{[ex.id]:{w:30}},workouts:[{id:'prior',d:'2026-10-12',start:1,entries:[entry(ex.id,{},[{w:40,r:8,done:true},{w:20,r:8,done:true}])]}],logRef:'best'})
  expect(host.textContent).toContain('Best: 20 kg')
  expect(host.querySelector('.refline')?.textContent).toContain('20×8')
})
it.each([false,true])('drop grids use custom owned dumbbells for perSide=%s',side=>{
  const row:any={w:21,r:8,done:false}
  if(side)row.sides={L:{w:21,r:4,done:false},R:{w:21,r:4,done:false}}
  const host=mount(custom('c-drop',{eq:'dumbbell'}),{side}, {dumbbells:{kg:{weights:[9,15,21]}}},false,[row])
  act(()=>host.querySelector<HTMLButtonElement>('button.n')!.click());menuClick(top(),'Drop set')
  const stored=useStore.getState().S.active.entries[0].sets[0]
  expect(side?stored.sides.L.drops[0].w:stored.drops[0].w).toBe(15)
})
it('focus menu, detail dispatch and superset title each resolve custom names',()=>{
  const ex=custom('c-focus',{n:'Local focus lift'})
  const host=mount(ex,{}, {},true)
  const detail=vi.spyOn(sheets,'exerciseDetailSheet').mockImplementation(()=>({id:'fixture',close(){},lock(){}}))
  tap(host,'More');const menu=top();expect(menu.querySelector('h3')?.textContent).toBe(ex.n)
  menuClick(menu,'Details');expect(detail.mock.calls[0]?.[0].n).toBe(ex.n)
  useStore.getState().update(S=>S.active.entries.push(entry(ex.id)))
  const superset=render(<FocusView entryIdx={0} unit={[0,1]} pointerEpoch="index-proof" />)
  expect(superset.querySelector('.focus-superset-inline strong')?.textContent).toBe('Superset: Local focus lift + Local focus lift')
})
// These callers already supply a resolved mode/object. Index forwarding is required by the
// boundary contract, but removing it cannot change their current rendered output.
it('explicit-mode plan formatting and resolved-object bar checks still forward an index',()=>{
  let plans=0,bars=0
  for(const name of ['Workout','FocusView']) {
    const ast=parse(readFileSync(`src/views/${name}.tsx`,'utf8'),{sourceType:'module',plugins:['typescript','jsx']})
    const walk=(node:any)=>{if(!node||typeof node!=='object')return;if(node.type==='CallExpression'&&node.callee?.type==='Identifier'&&['setsRepsOf','usesBar'].includes(node.callee.name)) {
      expect(node.arguments.at(-1)?.callee?.name).toBe('currentIndex')
      if(node.callee.name==='setsRepsOf'){plans++;expect(node.arguments[0].properties.some((p:any)=>p.key?.name==='mode')).toBe(true)}else{bars++;expect(node.arguments[0].name).toBe('ex')}
    }for(const v of Object.values(node))if(Array.isArray(v))v.forEach(walk);else walk(v)}
    walk(ast)
  }
  expect(plans).toBe(3);expect(bars).toBe(1)
})

it.each(['cardio','assisted'])('open-slot chooser builds custom %s rows from the native caller index',kind=>{
 const id='chosen-'+kind,ex=custom(id,kind==='cardio'?{bp:'cardio',eq:'body weight'}:{bp:'back',eq:'leverage machine',assisted:true});let choose:((ex:any)=>unknown)|undefined;vi.spyOn(sheets,'exercisePicker').mockImplementation(done=>{choose=done as any;return {id:'fixture',close(){},lock(){}}})
 useStore.getState().update(S=>{S.customEx=[ex];S.routines=[{id:'routine',name:'Local plan',ex:[{id:null,open:true,slotId:'slot',sets:1,reps:5,weight:40}]}];S.workouts=kind==='assisted'?[{id:'prior',d:'2026-10-12',routineIds:['routine'],entries:[{id,rid:'routine',target:{sets:1,reps:5,weight:40},sets:[{w:40,r:5,done:true}]}]}]:[];S.active={id:'chooser',d:'2026-10-13',start:100,cur:0,entries:[{id:'',rid:'routine',opaqueEntry:{keep:true},target:{open:true,slotId:'slot',sets:1,reps:5,weight:40,min:12,speed:6,opaqueConfig:{keep:true}},sets:[]}]}})
 const host=render(<Workout/>);tap(host,'Choose exercise');act(()=>choose!(ex));const e=useStore.getState().S.active.entries[0];expect(e.id).toBe(id);expect(e.opaqueEntry).toEqual({keep:true});expect(e.target.opaqueConfig).toEqual({keep:true});if(kind==='cardio'){expect(e.sets[0]).toMatchObject({min:12,speed:6});expect(e.sets[0]).not.toHaveProperty('w')}else expect(e.sets[0].w).toBeLessThan(40)
})
