// @vitest-environment happy-dom
import { testPlatform, setupProgrammeUi, workoutDetailSheet, dayOverrideSheet, startFlow } from './programme-ui-harness'
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {DEF,useStore} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {initializePublicActions} from '../src/store/public-actions'
import {bindUI} from '../src/components/ui'
import {createExerciseIndex,isAssisted} from '@opengym/core/exercises'
import {activate,skip} from '@opengym/core/programme'
import Programs from '../src/views/Programs'
import ProgrammeRollover from '../src/components/ProgrammeRollover'
import ProgrammeToday from '../src/components/ProgrammeToday'
const custom={id:'synthetic-assisted',n:'Synthetic assisted',eq:'leverage machine',assisted:true,custom:true}
const definition:any={id:'synthetic-server',name:'Synthetic server programme',unit:'kg',source:{kind:'library',private:true},weeks:[{index:1,rir:2,days:[{key:'d1',sessions:[{routineSnapshot:{name:'Day',ex:[{id:custom.id,sets:1,reps:5,weight:50}]}}]}]}]}
const entry=()=>({definition:structuredClone(definition),n:1,versionId:'synthetic-v1',level:'Valid'})
const summary=()=>({id:definition.id,name:definition.name,versionId:'synthetic-v1',versionN:1,level:'Valid',private:true,inUse:false,bytes:400,updatedAt:'2026-10-12T12:00:00Z'})
let roots:Root[]=[]
const mount=(el:React.ReactNode)=>(()=>{const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(el));return host})()
const click=async(host:HTMLElement,text:string)=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent===text)!;expect(button).toBeTruthy();await act(async()=>button.click())}
const settle=async()=>{await act(async()=>{await vi.dynamicImportSettled()})}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-12T12:00:00'));bindUI(useUI);useUI.setState({sheets:[],toastAction:null});localStorage.clear();const S=structuredClone(DEF);S.unit='kg';S.customEx=[custom];useStore.setState({S,user:{id:'synthetic-user'}})
 const cache=new Map<string,string|Uint8Array>();testPlatform.objects={get:async(b,k)=>cache.get(b+':'+k)??null,put:async(b,k,v)=>{cache.set(b+':'+k,v)},delete:async(b,k)=>{cache.delete(b+':'+k)},keys:async()=>[]}
 testPlatform.transport.fetch=vi.fn(async path=>new Response(JSON.stringify(String(path).includes('/'+definition.id)?entry():{items:[summary()],etag:'synthetic-etag'})))
})
afterEach(()=>{act(()=>roots.splice(0).forEach(root=>root.unmount()));vi.useRealTimers()})
it('lists server metadata, fetches the exact version, previews effort, and activates only after confirmation',async()=>{
 const host=mount(<Programs/>);await settle();expect(host.textContent).toContain('Private import');expect(useStore.getState().S.programmes.definitions).toEqual([])
 await click(host,definition.name+'Valid · Private importLibrary');await settle();expect(host.textContent).toContain('2 RIR');await click(host,'Start this program');expect(useStore.getState().S.programmes.cycles).toEqual([])
 await click(host,'Confirm load');await settle();expect(useStore.getState().S.programmes.installed[definition.id].versionId).toBe('synthetic-v1');expect(useStore.getState().S.programmes.cycles[0].snapshot).toEqual(definition)
 expect(testPlatform.transport.fetch).toHaveBeenCalledWith('/api/programmes/library/synthetic-server?version=synthetic-v1',expect.anything())
})
it('rejects from-e1rm confirmation without a resolver and preserves the state',async()=>{
 const original=testPlatform.transport.fetch;testPlatform.transport.fetch=vi.fn(async(path,options)=>String(path).includes('/'+definition.id)?new Response(JSON.stringify({...entry(),definition:{...definition,tmSeeds:{lift:{fromE1rm:{pct:.9}}}}})):original(path,options))
 const host=mount(<Programs/>);await settle();await click(host,definition.name+'Valid · Private importLibrary');await settle();await click(host,'Start this program');const before=structuredClone(useStore.getState().S);await click(host,'Confirm load')
 expect(host.querySelector('[role=alert]')?.textContent).toContain('training max history');expect(useStore.getState().S).toEqual(before)
})
it('keeps current logs intact on uncached/offline fetch and supports retry',async()=>{
 const host=mount(<Programs/>);await settle();testPlatform.transport.fetch=vi.fn().mockRejectedValue(new TypeError('Offline'));const before=structuredClone(useStore.getState().S)
 await click(host,definition.name+'Valid · Private importLibrary');await settle();expect(host.querySelector('[role=alert]')?.textContent).toContain('not saved on this device');expect(useStore.getState().S).toEqual(before)
 expect([...host.querySelectorAll('button')].some(b=>b.textContent==='Refresh library')).toBe(true)
})
it('clears private content on account switch and discards a late response',async()=>{
 let complete:(value:Response)=>void=()=>{};testPlatform.transport.fetch=vi.fn(()=>new Promise<Response>(resolve=>{complete=resolve}))
 const host=mount(<Programs/>);act(()=>useStore.setState({user:null}));await act(async()=>complete(new Response(JSON.stringify({items:[summary()],etag:'late'}))));await settle()
 expect(host.textContent).not.toContain(definition.name);expect(host.textContent).toContain('Sign in to load')
})
it('removes an already-loaded private detail immediately on sign out',async()=>{
 const host=mount(<Programs/>);await settle();await click(host,definition.name+'Valid · Private importLibrary');await settle();expect(host.textContent).toContain(definition.name)
 act(()=>useStore.setState({user:null}));expect(host.textContent).not.toContain(definition.name)
})
it.each(['week','block'] as const)('the %s repeat UI requires history or explicit manual seed review',async path=>{
 const S:any=structuredClone(DEF);S.customEx=[custom];const d={...definition,tmSeeds:{lift:{fromE1rm:{pct:.9}}}}
 activate(S,d,{cycleId:'c',today:'2026-10-12'},createExerciseIndex(S.customEx));S.programmes.cycles[0].tm={lift:44};S.programmes.cycles[0].tmSeed={lift:44}
 if(path==='block')skip(S,'c','c:w1d1',{today:'2026-10-12'});else S.programmes.cycles[0].status='paused'
 useStore.setState({S});const before=structuredClone(S);const host=mount(path==='block'?<ProgrammeRollover/>:<ProgrammeToday/>)
 await click(host,path==='block'?'Repeat block':'Repeat week 1')
 if(path==='block'){expect(useStore.getState().S).toEqual(before);const sh=useUI.getState().sheets.at(-1)!;await click(mount(sh.render(()=>{})),'Confirm repeat');expect(useStore.getState().S.programmes.cycles).toHaveLength(2);return}
 if(path==='week'){const sh=useUI.getState().sheets.at(-1)!;await click(mount(sh.render(()=>{})),'Repeat week')}
 expect(useStore.getState().S).toEqual(before);expect(useUI.getState().toastMsg).toContain('training max history')
})
it.each(['week','block'] as const)('the %s repeat rematerializes through the exact index seam while preserving the prior frozen TM',path=>{
 const S:any=structuredClone(DEF);S.unit='kg';S.customEx=[custom];activate(S,{...definition,tmSeeds:{lift:{fromE1rm:{pct:.9}}}},{cycleId:'c',today:'2026-10-12'},createExerciseIndex(S.customEx));S.programmes.cycles[0].tm={lift:44};S.programmes.cycles[0].tmSeed={lift:44}
 if(path==='block')skip(S,'c','c:w1d1',{today:'2026-10-12'});else S.programmes.cycles[0].status='paused'
 useStore.setState({S});const resolver=vi.fn(input=>({lift:isAssisted(custom.id,input.index)?88:33}));initializePublicActions({platform:testPlatform,toast:message=>useUI.getState().toast(message),materializeTmSeed:resolver})
 act(()=>{if(path==='week')useStore.getState().repeatProgrammeWeek('c','2026-10-12');else useStore.getState().finishProgrammeBlock('c','repeat',{today:'2026-10-12'})})
 const cycles=useStore.getState().S.programmes.cycles;expect(cycles.at(-1).tmSeed).toEqual({lift:88});expect(cycles[0].tm).toEqual({lift:44});expect(cycles[0].tmSeed).toEqual({lift:44});expect(resolver).toHaveBeenCalledTimes(1);expect(resolver.mock.calls[0]![0].options.tm).toBeUndefined()
})
it.each(['week','block'] as const)('the %s repeat carries fixed TM seeds without a resolver',path=>{
 const S:any=structuredClone(DEF);S.unit='kg';activate(S,{...definition,tmSeeds:{lift:{value:40,unit:'kg'}}},{cycleId:'c',today:'2026-10-12'});S.programmes.cycles[0].tm={lift:45}
 if(path==='block')skip(S,'c','c:w1d1',{today:'2026-10-12'});else S.programmes.cycles[0].status='paused'
 useStore.setState({S});act(()=>{if(path==='week')useStore.getState().repeatProgrammeWeek('c','2026-10-12');else useStore.getState().finishProgrammeBlock('c','repeat',{today:'2026-10-12'})});expect(useStore.getState().S.programmes.cycles.at(-1).tmSeed).toEqual({lift:45})
})
it.each(['from-e1rm','fixed'] as const)('block repeat freezes the activation-time authored bump for %s seeds',kind=>{
 const S:any=structuredClone(DEF);S.unit='kg';S.customEx=[custom]
 const d={...definition,repeat:{bump:{lift:5}},tmSeeds:{lift:kind==='fixed'?{value:40,unit:'kg'}:{fromE1rm:{pct:.9}}}}
 activate(S,d,{cycleId:'c',today:'2026-10-12'},createExerciseIndex(S.customEx));const old=kind==='fixed'?45:44;S.programmes.cycles[0].tm={lift:old};S.programmes.cycles[0].tmSeed={lift:old};skip(S,'c','c:w1d1',{today:'2026-10-12'});useStore.setState({S})
 initializePublicActions({platform:testPlatform,toast:message=>useUI.getState().toast(message),...(kind==='from-e1rm'?{materializeTmSeed:()=>({lift:88})}:{})})
 act(()=>useStore.getState().finishProgrammeBlock('c','repeat',{today:'2026-10-12'}))
 const cycles=useStore.getState().S.programmes.cycles,next=cycles.at(-1),expected=kind==='fixed'?50:93
 expect(next.tm).toEqual({lift:expected});expect(next.tmSeed).toEqual(next.tm);expect(cycles[0].tm).toEqual({lift:old});expect(cycles[0].tmSeed).toEqual({lift:old})
 expect(JSON.parse(testPlatform.kv.get('gym_state_v1')!).programmes.cycles.at(-1).tmSeed).toEqual({lift:expected})
})
it('discards a private file read that completes after switching accounts',async()=>{
 const {default:ProgrammeImport}=await import('../src/components/ProgrammeImport');const host=mount(<ProgrammeImport/>),input=host.querySelector<HTMLInputElement>('input[type=file]')!
 let complete:(value:string)=>void=()=>{};const pending=new Promise<string>(resolve=>{complete=resolve})
 Object.defineProperty(input,'files',{value:[{name:'private.json',size:300,text:()=>pending}]})
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));act(()=>useStore.setState({S:structuredClone(DEF),user:{id:'synthetic-user-B'}}));await act(async()=>complete(JSON.stringify(definition)))
 expect(host.textContent).not.toContain(definition.name);expect(host.textContent).not.toContain('Save program');expect(useStore.getState().S.programmes.definitions).toEqual([])
})
it('removes an imported private preview and rejects its stale Save button on account switch',async()=>{
 const {default:ProgrammeImport}=await import('../src/components/ProgrammeImport');const host=mount(<ProgrammeImport/>),input=host.querySelector<HTMLInputElement>('input[type=file]')!
 Object.defineProperty(input,'files',{value:[{name:'private.json',size:300,text:async()=>JSON.stringify({...definition,weeks:[{index:1,days:[{key:'d1',sessions:[{routineSnapshot:{ex:[]}}]}]}]})}]})
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(host.textContent).toContain(definition.name)
 const save=[...host.querySelectorAll('button')].find(b=>b.textContent==='Save program')!;act(()=>{useStore.setState({S:structuredClone(DEF),user:{id:'synthetic-user-B'}});save.click()})
 expect(host.textContent).not.toContain(definition.name);expect(useStore.getState().S.programmes.definitions).toEqual([])
})

it('invalidates an open calendar day when accounts change and blocks captured workout clicks',async()=>{
 const {default:ProgrammeCalendar}=await import('../src/components/ProgrammeCalendar')
 const S:any=structuredClone(DEF);S.workouts=[{id:'private-A',d:'2026-10-12',name:'Private account A workout',entries:[]}];useStore.setState({S})
 const host=mount(<ProgrammeCalendar/>);const day=host.querySelector<HTMLButtonElement>('[data-date="2026-10-12"] .program-calendar-date')!;act(()=>day.click())
 const sheet=useUI.getState().sheets.at(-1)!,detail=mount(sheet.render(()=>{}));expect(detail.textContent).toContain('Private account A workout')
 const captured=[...detail.querySelectorAll('button')].find(b=>b.textContent==='Private account A workout')!
 act(()=>{useStore.setState({S:structuredClone(DEF),user:{id:'synthetic-user-B'}});captured.click()})
 expect(detail.textContent).not.toContain('Private account A workout');expect(workoutDetailSheet).not.toHaveBeenCalled();expect(dayOverrideSheet).not.toHaveBeenCalled()
})
it('invalidates a captured session sheet and blocks Start after a server change',async()=>{
 const {programmeSessionSheet}=await import('../src/components/ProgrammeSession')
 const S:any=structuredClone(DEF);activate(S,definition,{cycleId:'c',today:'2026-10-12'},createExerciseIndex(S.customEx));useStore.setState({S})
 const {projectCycle}=await import('@opengym/core/programme-calendar');act(()=>programmeSessionSheet(projectCycle(S.programmes.cycles[0],S.workouts,'2026-10-12',S.queue).next!))
 const sheet=useUI.getState().sheets.at(-1)!,host=mount(sheet.render(()=>{}));const captured=[...host.querySelectorAll('button')].find(b=>b.textContent==='Start')!
 const previous=testPlatform.server.baseUrl;testPlatform.server.baseUrl=()=> 'https://synthetic-B.invalid'
 act(()=>{useStore.setState({S:structuredClone(DEF)});captured.click()})
 expect(startFlow).not.toHaveBeenCalled();expect(host.textContent).not.toContain('Day');testPlatform.server.baseUrl=previous
})
it.each(['routine-skip','not-today-skip','repeat-week','end'] as const)('rejects %s confirmation after an account switch even if cycle IDs match',async path=>{
 const S:any=structuredClone(DEF);S.customEx=[custom];activate(S,definition,{cycleId:'c',today:'2026-10-12'},createExerciseIndex(S.customEx));useStore.setState({S})
 let label=''
 if(path==='routine-skip'){const {programmeSkipSheet}=await import('../src/components/ProgrammeSession');act(()=>programmeSkipSheet(S.routines[0]));label='Skip this session'}
 if(path==='not-today-skip'){const {notTodaySheet}=await import('../src/components/ProgrammeToday');act(()=>notTodaySheet('c'));const sh=useUI.getState().sheets.at(-1)!,host=mount(sh.render(()=>{}));await click(host,'Skip d1 instead');label='Skip this session'}
 if(path==='repeat-week'){act(()=>useStore.setState({S:{...S,programmes:{...S.programmes,cycles:S.programmes.cycles.map((c:any)=>({...c,status:'paused'}))}}}));await click(mount(<ProgrammeToday/>),'Repeat week 1');label='Repeat week'}
 if(path==='end'){await click(mount(<Programs/>),'End program');label='End program'}
 const sheet=useUI.getState().sheets.at(-1)!,confirmation=mount(sheet.render(()=>{}));const captured=[...confirmation.querySelectorAll('button')].find(b=>b.textContent===label)!
 const B=structuredClone(useStore.getState().S);act(()=>{useStore.setState({S:B,user:{id:'synthetic-user-B'}});captured.click()})
 expect(useStore.getState().S).toEqual(B);expect(useUI.getState().toastMsg).toContain('Account changed')
})
it('switches to a server-only programme from the chooser using its pinned version',async()=>{
 const S:any=structuredClone(DEF);S.customEx=[custom];activate(S,{...definition,id:'old',name:'Old programme'},{cycleId:'c',today:'2026-10-12'},createExerciseIndex(S.customEx));useStore.setState({S})
 const host=mount(<Programs/>);await settle();await click(host,'Switch program')
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('button.lrow')].find(b=>b.textContent?.startsWith('Choose next program'))!.click())
 const sheet=useUI.getState().sheets.at(-1)!,choices=mount(sheet.render(()=>{}));expect(choices.textContent).toContain(definition.name);await click(choices,definition.name);await settle();await click(host,'Confirm switch');await settle()
 expect(host.querySelector('[role=alert]')?.textContent).toBeUndefined();const cycles=useStore.getState().S.programmes.cycles;expect(cycles[0].status).toBe('archived');expect(cycles.at(-1).programmeId).toBe(definition.id);expect(useStore.getState().S.programmes.installed[definition.id].versionId).toBe('synthetic-v1')
})
it.each(['load','switch'] as const)('rejects a captured %s confirmation after an account change',async path=>{
 if(path==='switch'){const S:any=structuredClone(DEF);S.customEx=[custom];activate(S,{...definition,id:'old'},{cycleId:'c',today:'2026-10-12'},createExerciseIndex(S.customEx));useStore.setState({S})}
 const host=mount(<Programs/>);await settle();await click(host,definition.name+'Valid · Private importLibrary');await settle();await click(host,path==='load'?'Start this program':'Switch to this program')
 const captured=[...host.querySelectorAll('button')].find(b=>b.textContent===(path==='load'?'Confirm load':'Confirm switch'))!;const B=structuredClone(DEF)
 await act(async()=>{useStore.setState({S:B,user:{id:'synthetic-user-B'}});captured.click()});await settle();expect(useStore.getState().S).toEqual(B)
})

it('refuses a Not today skip confirmation whose pending occurrence changed',async()=>{
 const d={...definition,weeks:[{index:1,days:[{key:'d1',sessions:[{routineSnapshot:{name:'First',ex:[]}}]},{key:'d2',sessions:[{routineSnapshot:{name:'Second',ex:[]}}]}]}]}
 const S:any=structuredClone(DEF);activate(S,d,{cycleId:'c',today:'2026-10-12'});useStore.setState({S})
 const {notTodaySheet}=await import('../src/components/ProgrammeToday');act(()=>notTodaySheet('c'));const sh=useUI.getState().sheets.at(-1)!;await click(mount(sh.render(()=>{})),'Skip d1 instead');const dialog=useUI.getState().sheets.at(-1)!,host=mount(dialog.render(()=>{}))
 act(()=>useStore.getState().update((draft:any)=>skip(draft,'c','c:w1d1',{today:'2026-10-12'})));const before=structuredClone(useStore.getState().S);await click(host,'Skip this session')
 expect(useStore.getState().S).toEqual(before);expect(useUI.getState().toastMsg).toContain('program changed')
})
it('refuses a captured routine skip after its programme ownership is removed',async()=>{
 const S:any=structuredClone(DEF);activate(S,definition,{cycleId:'c',today:'2026-10-12'});useStore.setState({S})
 const {programmeSkipSheet}=await import('../src/components/ProgrammeSession');act(()=>programmeSkipSheet(S.routines[0]));const sh=useUI.getState().sheets.at(-1)!,host=mount(sh.render(()=>{}))
 act(()=>useStore.getState().update((draft:any)=>delete draft.routines[0].programme));const before=structuredClone(useStore.getState().S);await click(host,'Skip this session')
 expect(useStore.getState().S).toEqual(before);expect(useUI.getState().toastMsg).toContain('program changed')
})
