// @vitest-environment happy-dom
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter,Routes,Route} from 'react-router-dom'
import {it,expect,vi} from 'vitest'
const sheets=vi.hoisted(()=>({exConfigSheet:vi.fn(),exercisePicker:vi.fn(),glyphPicker:vi.fn(),confirmSheet:vi.fn(),menuSheet:vi.fn()}))
vi.mock('../sheets.jsx',()=>sheets)
vi.mock('../components/Media.jsx',()=>({Thumb:()=>null}))
vi.mock('../components/BodyMap.jsx',()=>({default:()=>null}))
import RoutineEdit from './RoutineEdit.jsx'
import {DEF,useStore} from '../store/useStore.js'
import {useUI} from '../store/useUI.js'
import {activate} from '../lib/programme.js'
it.each([false,true])('real editor Remove scopes distinct lifts and limits ambiguous twins (%s)',ambiguous=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const S=structuredClone(DEF);const slot=id=>({id,sets:3,reps:8,weight:100})
 const definition={id:'editor',name:'Synthetic',weeks:[1,2].map(index=>({index,days:[{key:'d1',sessions:[{sessionTemplateId:'am',routineSnapshot:{name:'Morning',ex:(ambiguous ? index===1?['0025','0027','0025']:['0025'] : index===1?['0025','0027']:['0027','0025']).map(slot)}},{sessionTemplateId:'pm',routineSnapshot:{name:'Evening',ex:[slot('0025')]}}]}]}))}
 const c=activate(S,definition,{cycleId:'c'});const id=c.occurrences[0].routineId;if(ambiguous) for(const r of S.routines) for(const e of r.ex) {delete e.slotId;delete e.slotScope};useStore.setState({S,user:null})
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 act(()=>root.render(<MemoryRouter initialEntries={['/plan/r/'+id]}><Routes><Route path='/plan/r/:id' element={<RoutineEdit/>}/></Routes></MemoryRouter>))
 act(()=>host.querySelector('[data-routine-row] .item').click());act(()=>sheets.exConfigSheet.mock.calls.at(-1)[3]());expect(sheets.menuSheet).toHaveBeenCalled();act(()=>sheets.menuSheet.mock.calls.at(-1)[0].items[1].onClick())
 expect(useStore.getState().S.routines.map(r=>r.ex.map(e=>e.id))).toEqual(ambiguous ? [['0027','0025'],['0025'],['0025'],['0025']] : [['0027'],['0025'],['0027'],['0025']]);if(ambiguous) expect(useUI.getState().toastMsg).toContain('This edit applies to this session only')
 act(()=>root.unmount());host.remove()
})
