// @vitest-environment happy-dom
import '../helpers/plan-views'

import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {it,expect,vi} from 'vitest'
const sheets: any=vi.hoisted(()=>({exConfigSheet:vi.fn(),exercisePicker:vi.fn(),glyphPicker:vi.fn(),confirmSheet:vi.fn(),menuSheet:vi.fn()}))
vi.mock('../../src/sheets',()=>sheets)
vi.mock('../../src/components/BodyMap',()=>({default:()=>null}))
import RoutineEdit from '../../src/views/RoutineEdit'
import {DEF,useStore} from '../../src/store/useStore'
import {useUI} from '../../src/store/useUI'
import {activate} from '@opengym/core/programme'
it.each([false,true])('real editor Remove scopes distinct lifts and limits ambiguous twins (%s)',(ambiguous: any)=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const S: any=structuredClone(DEF);const slot: any=(id: any)=>({id,sets:3,reps:8,weight:100})
 const definition: any={id:'editor',name:'Synthetic',weeks:[1,2].map((index: any)=>({index,days:[{key:'d1',sessions:[{sessionTemplateId:'am',routineSnapshot:{name:'Morning',ex:(ambiguous ? index===1?['0025','0027','0025']:['0025'] : index===1?['0025','0027']:['0027','0025']).map(slot)}},{sessionTemplateId:'pm',routineSnapshot:{name:'Evening',ex:[slot('0025')]}}]}]}))}
 const c: any=activate(S,definition,{cycleId:'c'});const id: any=c.occurrences[0].routineId;if(ambiguous) for(const r of S.routines) for(const e of r.ex) {delete e.slotId;delete e.slotScope};useStore.setState({S,user:null})
 const host: any=document.createElement('div');document.body.append(host);const root: any=createRoot(host)
 act(()=>root.render(<MemoryRouter initialEntries={['/plan/r/'+id]}><Routes><Route path='/plan/r/:id' element={<RoutineEdit/>}/></Routes></MemoryRouter>))
 act(()=>host.querySelector('[data-routine-row] .item').click());act(()=>sheets.exConfigSheet.mock.calls.at(-1)[3]());expect(sheets.menuSheet).toHaveBeenCalled();act(()=>sheets.menuSheet.mock.calls.at(-1)[0].items[1].onClick())
 expect(useStore.getState().S.routines.map((r: any)=>r.ex.map((e: any)=>e.id))).toEqual(ambiguous ? [['0027','0025'],['0025'],['0025'],['0025']] : [['0027'],['0025'],['0027'],['0025']]);if(ambiguous) expect(useUI.getState().toastMsg).toContain('This edit applies to this session only')
 act(()=>root.unmount());host.remove()
})
