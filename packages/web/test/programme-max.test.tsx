// @vitest-environment happy-dom
import {testPlatform} from './programme-ui-harness'
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {customAdaptiveState,maxState} from '../../core/test/fixtures/synthetic-max'
import {DEF,KEY,useStore} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {bindUI} from '../src/components/ui'
import {adjustProgrammeMaxSheet} from '../src/components/ProgrammeMaxEditor'
import {repeatBlockSheet} from '../src/components/ProgrammeRollover'
import {skip} from '@opengym/core/programme'
import {progressionDisplay,entryPrescription} from '../src/lib/progression-display'
let roots:Root[]=[]
const mount=(el:React.ReactNode)=>{const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(el));return host}
const sheet=()=>mount(useUI.getState().sheets.at(-1)!.render(()=>{}))
const button=(host:HTMLElement,text:string)=>[...host.querySelectorAll('button')].find(b=>b.textContent===text)!
const fill=(host:HTMLElement,label:string,value:string)=>{const input=host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})}
beforeEach(()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.setSystemTime(new Date('2026-10-15T12:00:00'))
 bindUI(useUI);useUI.setState({sheets:[]});testPlatform.transport.fetch=vi.fn(async()=>new Response(JSON.stringify({items:[],etag:'synthetic'})));const S={...structuredClone(DEF),...maxState()}
 useStore.getState().setUser({id:'A'});useStore.getState().replaceState(S)
})
afterEach(()=>{act(()=>roots.splice(0).forEach(r=>r.unmount()));document.body.innerHTML=''})
it('reviews a future prescription, saves dated history and keeps the running workout/logs',()=>{
 act(()=>useStore.getState().update(S=>{S.active={id:'running',start:1,routineIds:[S.routines[0].id],entries:[{id:'0025',sets:[{w:100,r:5,done:true}]}]};S.workouts=[{id:'logged',d:'2026-10-14',entries:[]}]}))
 const before=structuredClone(useStore.getState().S)
 act(()=>adjustProgrammeMaxSheet('c'));const host=sheet();expect(host.textContent).toContain('Adjust TM')
 fill(host,'New max (lb)','240');fill(host,'Reason (optional)','Reviewed technique')
 expect(host.querySelector('[aria-label="Future prescription preview"]')?.textContent).toContain('120 / 120 lb')
 act(()=>button(host,'Save max').click())
 const S=useStore.getState().S,c=S.programmes.cycles[0]
 expect(c.maxAdjustments[0]).toMatchObject({value:240,reason:'Reviewed technique',effectiveOn:'2026-10-15'})
 expect(S.active).toEqual(before.active);expect(S.workouts).toEqual(before.workouts);expect(c.tmSeed).toEqual({bench:200})
 expect(JSON.parse(testPlatform.kv.get(KEY)!).programmes.cycles[0].maxAdjustments).toEqual(c.maxAdjustments)
 expect(progressionDisplay(S,c.snapshot,c,[1],'2026-10-15')!.slots[0]!.prescription.sets[0]!.load).toBe(120)
})
it.each(['0','-1',''])('disables invalid UI input %j without writing',value=>{
 act(()=>adjustProgrammeMaxSheet('c'));const host=sheet(),before=testPlatform.kv.get(KEY)
 fill(host,'New max (lb)',value);expect(button(host,'Save max').disabled).toBe(true)
 act(()=>button(host,'Save max').click());expect(testPlatform.kv.get(KEY)).toBe(before)
})
it.each(['account','generation','cycle','producer-switch'])('rejects a stale %s callback without changing saved bytes',kind=>{
 act(()=>adjustProgrammeMaxSheet('c'));const host=sheet();fill(host,'New max (lb)','240');const save=button(host,'Save max')
 const replacement=structuredClone(useStore.getState().S);replacement.marker='B'
 let before:string|null=null
 const replace=()=>{if(kind==='account'||kind==='producer-switch')useStore.getState().setUser({id:'B'});useStore.getState().replaceState(replacement);before=testPlatform.kv.get(KEY)}
 if(kind==='producer-switch'){
  const update=useStore.getState().update;useStore.setState({update:(mut,push)=>{replace();update(mut,push)}})
 }else act(()=>{if(kind==='cycle'){useStore.getState().update(S=>{S.programmes.cycles[0].maxAdjustments=[]});before=testPlatform.kv.get(KEY)}else replace()})
 act(()=>save.click());expect(testPlatform.kv.get(KEY)).toBe(before);if(kind==='account'||kind==='generation')expect(host.textContent).toContain('Account changed');else expect(useUI.getState().toastMsg).toMatch(/changed/i)
})
it.each([false,true])('Repeat reviews optional saved bump=%s once and preserves the archived cycle',bump=>{
 act(()=>useStore.getState().update(S=>{const c=S.programmes.cycles[0];c.snapshot.repeat={bump:{bench:5}};for(const o of c.occurrences)skip(S,c.id,o.instanceId,{today:'2026-10-15'})}))
 const prior=structuredClone(useStore.getState().S.programmes.cycles[0])
 act(()=>repeatBlockSheet('c'));const host=sheet();expect(useStore.getState().S.programmes.cycles).toHaveLength(1)
 expect(host.querySelector<HTMLInputElement>('input[type=number]')!.value).toBe('200')
 if(bump)act(()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
 expect(Number(host.querySelector<HTMLInputElement>('input[type=number]')!.value)).toBe(bump?205:200)
 act(()=>button(host,'Confirm repeat').click())
 const cycles=useStore.getState().S.programmes.cycles
 expect(cycles[1].tmSeed.bench).toBe(bump?205:200);expect(cycles[1].tm.bench).toBe(bump?205:200)
 expect(cycles[0].tmSeed).toEqual(prior.tmSeed);expect(cycles[0].snapshot).toEqual(prior.snapshot)
})
it('rejects unknown lift keys in reviewed repeat options before seeding the draft',()=>{
 act(()=>useStore.getState().update(S=>{for(const o of S.programmes.cycles[0].occurrences)skip(S,'c',o.instanceId,{today:'2026-10-15'})}))
 const before=testPlatform.kv.get(KEY)
 expect(()=>useStore.getState().finishProgrammeBlock('c','repeat',{today:'2026-10-15',repeatMax:{unit:'lb',values:{unknown:200}}})).toThrow('Review')
 expect(testPlatform.kv.get(KEY)).toBe(before)
})

it('the guarded public max action forwards the custom assisted index to its previous-value audit',()=>{
 const S={...structuredClone(DEF),...customAdaptiveState()};useStore.getState().replaceState(S)
 const event=useStore.getState().setTrainingMax('c',{lift:'bench',value:240,unit:'lb',today:'2026-10-20'})
 expect(event.previous).toBe(200)
})
it('the editor and repeat review resolve current maxes through a real custom assisted index',()=>{
 const S={...structuredClone(DEF),...customAdaptiveState()};useStore.getState().replaceState(S);vi.setSystemTime(new Date('2026-10-20T12:00:00'))
 act(()=>adjustProgrammeMaxSheet('c'));const editor=sheet();expect(editor.textContent).toContain('Current: 200 lb')
 act(()=>editor.querySelector('select')!.dispatchEvent(new Event('change',{bubbles:true})))
 expect(editor.querySelector<HTMLInputElement>('input[type=number]')!.value).toBe('200')
 act(()=>repeatBlockSheet('c'));const review=sheet();expect(review.querySelector<HTMLInputElement>('input[type=number]')!.value).toBe('200')
 act(()=>review.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
 expect(review.querySelector<HTMLInputElement>('input[type=number]')!.value).toBe('200')
})

it('the max editor preview uses custom dumbbell inventory through its builder',()=>{
 const S={...structuredClone(DEF),...maxState()},c=S.programmes.cycles[0],custom={id:'synthetic-custom-max',n:'Synthetic custom bell',eq:'dumbbell',custom:true}
 S.customEx=[custom];S.dumbbells={lb:{weights:[40,90,125]}}
 for(const w of c.snapshot.weeks)w.days[0].sessions[0].routineSnapshot.ex[0].id=custom.id
 for(const r of S.routines)r.ex[0].id=custom.id
 c.snapshot.progressionRules[0].rounding.usePlates=true
 useStore.getState().replaceState(S);act(()=>adjustProgrammeMaxSheet('c'));const editor=sheet();fill(editor,'New max (lb)','240')
 expect(editor.querySelector('[aria-label="Future prescription preview"]')?.textContent).toContain('125 / 125 lb')
})
import {readFileSync} from 'node:fs'
import {parse} from '@babel/parser'
import {resolve} from 'node:path'
it('inert preview audit edge forwards the same caller index',()=>{
 const ast=parse(readFileSync(resolve(import.meta.dirname,'../src/components/ProgrammeMaxEditor.tsx'),'utf8'),{sourceType:'module',plugins:['typescript','jsx']})
 let call:any
 const visit=(node:any)=>{if(!node||typeof node!=='object')return;if(node.type==='CallExpression'&&node.callee.name==='setTrainingMax')call=node;for(const v of Object.values(node))Array.isArray(v)?v.forEach(visit):visit(v)}
 visit(ast.program);expect(call.arguments.at(-1)).toMatchObject({type:'Identifier',name:'index'})
})

it('missing cycle openers refuse without opening a broken sheet',()=>{act(()=>{adjustProgrammeMaxSheet('missing');repeatBlockSheet('missing')});expect(useUI.getState().sheets).toHaveLength(0);expect(useUI.getState().toastMsg).toContain('program changed')})

import Programs from '../src/views/Programs'
import {configureProgrammeUi,programmeUi} from '../src/lib/programme-ui-services'
it('legacy cycle detail shows its adjusted max ahead of the immutable seed',()=>{
 const S={...structuredClone(DEF),...maxState(false)};useStore.getState().replaceState(S)
 useStore.getState().setTrainingMax('c',{lift:'bench',value:240,unit:'lb',today:'2026-10-15'})
 configureProgrammeUi({...programmeUi(),initialProgramId:()=> 'c'})
 const host=mount(<Programs/>),panel=host.querySelector('.training-maxes')!
 expect(panel.querySelector('output')?.textContent).toContain('240 lb');expect(panel.textContent).toContain('Manual')
 expect(useStore.getState().S.programmes.cycles[0].tmSeed.bench).toBe(200)
})
it.each([
 {prior:200,date:'2026-10-15',expected:'200 lb'},
 {prior:null,date:'2026-10-15',expected:'Unavailable'},
 {prior:200,date:'2026-10-20',expected:'240 lb'},
 {prior:null,date:'2026-10-20',expected:'240 lb'},
])('detail respects a future legacy max boundary: $prior at $date',({prior,date,expected})=>{
 const S={...structuredClone(DEF),...maxState(false)},c=S.programmes.cycles[0]
 delete c.snapshot.tmSeeds;delete c.tmSeed;if(prior===null)c.tm={}
 useStore.getState().replaceState(S)
 useStore.getState().setTrainingMax('c',{lift:'bench',value:240,unit:'lb',today:'2026-10-20'})
 vi.setSystemTime(new Date(date+'T12:00:00'))
 configureProgrammeUi({...programmeUi(),initialProgramId:()=> 'c'})
 const before=structuredClone(useStore.getState().S),host=mount(<Programs/>)
 expect(host.querySelector('.training-maxes output')?.textContent).toContain(expected)
 expect(useStore.getState().S).toEqual(before)
})

import {buildSessionEntries} from '@opengym/core/session-start'
it('a max edit keeps active entry prescription diagnostics frozen while future previews change',()=>{
 const S=useStore.getState().S
 useStore.getState().update(draft=>{draft.active={id:'running',start:Date.now()-1,routineIds:[draft.routines[0].id],entries:buildSessionEntries(draft,draft.routines[0])}})
 const active=structuredClone(useStore.getState().S.active)
 useStore.getState().setTrainingMax('c',{lift:'bench',value:240,unit:'lb',today:'2026-10-15'})
 const after=useStore.getState().S,c=after.programmes.cycles[0],entry=after.active.entries[0]
 expect(entryPrescription(after,entry,'2026-10-15')!.slots[0]!.prescription.sets[0]!.load).toBe(100)
 expect(progressionDisplay(after,c.snapshot,c,[1],'2026-10-15')!.slots[0]!.prescription.sets[0]!.load).toBe(120)
 expect(after.active).toEqual(active)
})

it.each([false,true])('Repeat defaults to the dated legacy baseline before a future max change, saved bump=%s',bump=>{
 const S={...structuredClone(DEF),...maxState(false)},c=S.programmes.cycles[0]
 delete c.snapshot.tmSeeds;delete c.tmSeed;c.snapshot.repeat={bump:{bench:5}}
 useStore.getState().replaceState(S)
 useStore.getState().setTrainingMax('c',{lift:'bench',value:240,unit:'lb',today:'2026-10-20'})
 act(()=>useStore.getState().update(draft=>{for(const o of draft.programmes.cycles[0].occurrences)skip(draft,'c',o.instanceId,{today:'2026-10-15'})}))
 const prior=structuredClone(useStore.getState().S.programmes.cycles[0])
 act(()=>repeatBlockSheet('c'));const review=sheet()
 expect(review.querySelector<HTMLInputElement>('input[type=number]')!.value).toBe('200')
 if(bump)act(()=>review.querySelector<HTMLInputElement>('input[type=checkbox]')!.click())
 expect(review.querySelector<HTMLInputElement>('input[type=number]')!.value).toBe(bump ? '205' : '200')
 act(()=>button(review,'Confirm repeat').click())
 const cycles=useStore.getState().S.programmes.cycles
 expect(cycles[1].tm.bench).toBe(bump ? 205 : 200);expect(cycles[1].tmSeed.bench).toBe(bump ? 205 : 200)
 expect(cycles[0].tmSeed).toBeUndefined();expect(cycles[0].snapshot).toEqual(prior.snapshot)
 expect(cycles[0].maxAdjustments).toEqual(prior.maxAdjustments);expect(cycles[0].tm).toEqual(prior.tm)
})
import {beginWorkout,configureWorkoutSheets,startFlow} from '../src/sheets-d'
import ProgrammeToday from '../src/components/ProgrammeToday'
it.each([true,false])('actual early Start uses the session date for a future max, typed=%s',typed=>{
 configureWorkoutSheets({confirmSheet:o=>o.onConfirm?.(),menuSheet:()=>{},bwSheet:o=>o.onDone(null)})
 configureProgrammeUi({...programmeUi(),startFlow})
 const S={...structuredClone(DEF),...maxState(typed)}
 useStore.getState().replaceState(S)
 useStore.getState().setTrainingMax('c',{lift:'bench',value:240,unit:'lb',today:'2026-10-18'})
 act(()=>useStore.getState().update(draft=>skip(draft,'c',draft.programmes.cycles[0].occurrences[0].instanceId,{today:'2026-10-15'})))
 const before=structuredClone(useStore.getState().S.programmes.cycles[0])
 const host=mount(<ProgrammeToday/>),start=button(host,'Start');expect(start.disabled).toBe(false)
 if(typed) {
  expect(host.textContent).toContain('100 lb')
  expect(progressionDisplay(useStore.getState().S,before.snapshot,before,[2],'2026-10-15')!.slots[0]!.prescription.sets[0]!.load).toBe(120)
 }
 act(()=>start.click())
 const active=useStore.getState().S.active
 expect(active.d).toBe('2026-10-15');expect(active.entries[0].sets.map((s:any)=>s.w)).toEqual([100,100])
 expect(active.entries[0].target.pyramidWeight).toEqual([100,100])
 if(typed)expect(entryPrescription(useStore.getState().S,active.entries[0],'2026-10-15')!.slots[0]!.prescription.sets[0]!.load).toBe(100)
 expect(useStore.getState().S.programmes.cycles[0].maxAdjustments).toEqual(before.maxAdjustments)
})
it.each([
 {typed:true,date:'2026-10-18'}, {typed:false,date:'2026-10-18'},
 {typed:true,date:'2026-10-25'}, {typed:false,date:'2026-10-25'},
])('actual Start at or after a future max boundary applies it, typed=$typed at $date',({typed,date})=>{
 configureWorkoutSheets({confirmSheet:o=>o.onConfirm?.(),menuSheet:()=>{},bwSheet:o=>o.onDone(null)})
 useStore.getState().replaceState({...structuredClone(DEF),...maxState(typed)})
 useStore.getState().setTrainingMax('c',{lift:'bench',value:240,unit:'lb',today:'2026-10-18'})
 act(()=>useStore.getState().update(draft=>skip(draft,'c',draft.programmes.cycles[0].occurrences[0].instanceId,{today:'2026-10-15'})))
 vi.setSystemTime(new Date(date+'T12:00:00'))
 act(()=>beginWorkout(['c-w2d1'],null))
 const active=structuredClone(useStore.getState().S.active)
 expect(active.d).toBe(date);expect(active.entries[0].sets.map((s:any)=>s.w)).toEqual([120,120])
 useStore.getState().setTrainingMax('c',{lift:'bench',value:260,unit:'lb',today:date})
 expect(useStore.getState().S.active).toEqual(active)
})
it.each([
 {value:Number.MIN_VALUE,unit:'lb',definitionUnit:'kg',profileUnit:'lb'},
 {value:Number.MAX_VALUE,unit:'kg',definitionUnit:'kg',profileUnit:'lb'},
])('public Repeat refuses nonpositive or nonfinite converted maxes %j',({value,unit,definitionUnit,profileUnit})=>{
 const S={...structuredClone(DEF),...maxState(false)},c=S.programmes.cycles[0]
 S.unit=profileUnit;c.snapshot.unit=definitionUnit
 for(const o of c.occurrences)skip(S,'c',o.instanceId,{today:'2026-10-15'})
 useStore.getState().replaceState(S);const before=structuredClone(useStore.getState().S),bytes=testPlatform.kv.get(KEY)
 expect(()=>useStore.getState().finishProgrammeBlock('c','repeat',{today:'2026-10-15',repeatMax:{unit,values:{bench:value}}})).toThrow(/positive finite|non-finite/)
 expect(useStore.getState().S).toEqual(before);expect(testPlatform.kv.get(KEY)).toBe(bytes)
})
