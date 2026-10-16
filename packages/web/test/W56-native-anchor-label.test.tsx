// @vitest-environment happy-dom
import {workoutSheetPlatform} from './workout-sheet-environment'
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {it,expect,beforeEach,afterEach,vi} from 'vitest'
import Workout from '../src/views/Workout'
import {useStore,clone,DEF} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {beginWorkout} from '../src/sheets-d'
import {importProgramme,saveImportedProgramme} from '@opengym/core/programme-import'
import {activate} from '@opengym/core/programme'
import {relativeDefinition as definition} from '../../core/test/native-relative-fixture'
import {NativeTarget} from '../src/components/NativeTarget'
vi.mock('../src/components/Media',()=>({default:()=>null,Thumb:()=>null,WorkoutThumb:()=>null}))
vi.mock('../src/lib/sound',()=>({beep:vi.fn(),chime:vi.fn(),vibrate:vi.fn(),alertBuzz:vi.fn(),unlock:vi.fn()}))
vi.mock('../src/lib/api',()=>({api:vi.fn().mockResolvedValue({}),appBase:()=>'/'}))
let root:Root,host:HTMLDivElement
const state=()=>useStore.getState().S
const entry=()=>state().active.entries[0]
const row=(i:number)=>[...host.querySelectorAll('.setrow:not(.side)')][i]!
const type=(input:HTMLInputElement,value:string)=>act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}))})
const weight=(i:number,w:string)=>type(row(i).querySelector('input')!,w)
const tick=(i:number)=>act(()=>(row(i).querySelector('button[aria-label*="done"]') as HTMLButtonElement).click())
const bytes=()=>({state:JSON.stringify(state()),saved:workoutSheetPlatform.kv.get('gym_state_v1'),wid:workoutSheetPlatform.kv.get('gym_state_wid')})
function start(view='list',chain=false) {
 const S=clone(DEF);S.gifSize='off';S.sound=false;S.weighIn=false;S.workoutView=view;S.effort='off';S.restSec=0
 const d=definition();if(chain)d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].nativePrescription.sets[2].relativeLoad.anchor.rowOrdinal=2;saveImportedProgramme(S,importProgramme(d));activate(S,d,{today:'2026-10-13',cycleId:'reader-ui'})
 act(()=>useStore.setState({S,user:null}));act(()=>beginWorkout([S.routines[0].id],null));act(()=>root.render(<Workout/>))
}
beforeEach(()=>{
 vi.spyOn(workoutSheetPlatform.transport,'fetch').mockResolvedValue(new Response('{}',{status:200}))
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks()})


function menuAt(i:number,label:string){
 act(()=>row(i).querySelector<HTMLButtonElement>('button.n')!.click())
 const sheet=useUI.getState().sheets.at(-1)!,el=document.createElement('div');document.body.append(el);const r=createRoot(el)
 try{act(()=>r.render(sheet.render(()=>{})));const item=[...el.querySelectorAll<HTMLElement>('.menu-item')].find(x=>x.textContent?.includes(label));expect(item).toBeTruthy();act(()=>item!.click())}finally{act(()=>r.unmount());el.remove()}
}
const label=(i:number)=>row(i).querySelector('[data-testid="native-target"]')!.textContent!
function setupCopy(){start('list',true);weight(0,'100');tick(0);weight(1,'80');tick(1);menuAt(0,'Copy this set');weight(1,'200');tick(1)}
it('normal Copy identifies the current working anchor through pending, completion, anchor edits and fresh checks',()=>{
 start('list',true);weight(0,'100');tick(0);menuAt(0,'Copy this set');weight(1,'200');tick(1)
 expect(row(2).querySelector('button.n')!.textContent).toBe('3')
 expect(label(3)).toContain('10% below set 3 actual load (working)')
 expect(label(3)).toContain('Pending: complete anchor set 3 (working)')
 weight(2,'80');tick(2);weight(3,'70');tick(3)
 const frozen=structuredClone(entry().sets[3].nativeLoadEvaluation)
 expect(frozen).toMatchObject({anchor:{identity:{rowOrdinal:2},actualLoad:{value:80,unit:'kg'}},plannedLoad:{value:72.5,unit:'kg'}})
 expect(label(3)).toContain('below set 3 actual load (working)')
 weight(2,'200');expect(label(3)).toContain('Planned 72.5 kg (at completion)');expect(entry().sets[3].nativeLoadEvaluation).toEqual(frozen)
 tick(3);expect(entry().sets[3].nativeLoadEvaluation).toBeUndefined();expect(label(3)).toContain('Planned 180 kg')
 tick(3);expect(entry().sets[3].nativeLoadEvaluation).toMatchObject({anchor:{actualLoad:{value:200}},plannedLoad:{value:180}})
})
it('normal Copy and phase menus distinguish warm-up2 from working1 and preserve zero and frozen receipts',()=>{
 start();weight(0,'0');tick(0);menuAt(0,'Copy this set');menuAt(1,'Make it a warm-up set');menuAt(1,'Make it a warm-up set')
 expect(entry().sets[0].nativeExtraIdentity).toBeTruthy();expect(entry().sets[1].nativeRowIdentity.rowOrdinal).toBe(1)
 expect(row(1).querySelector('button.n')!.textContent).toBe('2');expect(row(2).querySelector('button.n')!.textContent).toBe('1')
 expect(label(2)).toContain('below set 2 actual load (warm-up)');expect(label(2)).toContain('Planned 0 kg')
 weight(2,'0');tick(2);const frozen=structuredClone(entry().sets[2].nativeLoadEvaluation)
 expect(frozen).toMatchObject({anchor:{identity:{rowOrdinal:1},actualLoad:{value:0}},plannedLoad:{value:0}})
 tick(1);expect(label(3)).toContain('Pending: complete anchor set 2 (warm-up)')
 expect(label(2)).toContain('Planned 0 kg (at completion)');expect(entry().sets[2].nativeLoadEvaluation).toEqual(frozen)
 menuAt(1,'Count it as a working set');expect(label(2)).toContain('below set 1 actual load (working)')
 expect(entry().sets[2].nativeLoadEvaluation).toEqual(frozen)
})
it('normal anchor removal names the original reference, keeps completed receipts and refuses fresh completion despite an extra',()=>{
 setupCopy();weight(3,'70');tick(3);const frozen=structuredClone(entry().sets[3].nativeLoadEvaluation)
 menuAt(2,'Remove this set');expect(label(2)).toContain('below original set 2 actual load');expect(label(2)).toContain('Planned 72.5 kg (at completion)')
 expect(entry().sets[2].nativeLoadEvaluation).toEqual(frozen);tick(2);const before=bytes();tick(2)
 expect(bytes()).toEqual(before);expect(label(2)).toContain('anchor missing');expect(entry().sets[2].done).toBe(false)
})
for(const fault of ['duplicate','source','variant','template','extra'])it(`presentation never borrows a same-number anchor with ${fault} identity`,()=>{
 setupCopy();const e=structuredClone(entry()),dependent=e.sets[3]
 if(fault==='duplicate')e.sets.push(structuredClone(e.sets[2]))
 else if(fault==='source')e.sets[2].nativeRowIdentity.source.cell='Z99'
 else if(fault==='variant')e.sets[2].nativeRowIdentity.variantKey='other'
 else if(fault==='template')e.sets[2].nativeRowIdentity.sourceTemplateId='other'
 else e.sets[2].nativeExtraIdentity={kind:'athlete-extra',id:'dual'}
 const before=JSON.stringify(e);act(()=>root.render(<NativeTarget row={dependent} entry={e}/>))
 expect(host.textContent).toContain('below original set 2 actual load');expect(host.textContent).not.toContain('(working)');expect(JSON.stringify(e)).toBe(before)
})
it('history without current entry context explicitly names the original set and retains the frozen calculation',()=>{
 setupCopy();weight(3,'70');tick(3);const dependent=structuredClone(entry().sets[3]),before=JSON.stringify(dependent)
 act(()=>root.render(<NativeTarget row={dependent}/>))
 expect(host.textContent).toContain('below original set 2 actual load');expect(host.textContent).toContain('Planned 72.5 kg (at completion)');expect(JSON.stringify(dependent)).toBe(before)
})
it('pending labels without entry context explicitly keep the original reference',()=>{
 start();const dependent=structuredClone(entry().sets[1]);dependent.nativeLoadReason='Pending: complete anchor set 1'
 act(()=>root.render(<NativeTarget row={dependent}/>))
 expect(host.textContent).toContain('below original set 1 actual load');expect(host.textContent).toContain('Pending: complete anchor original set 1')
})
