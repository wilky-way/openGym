// @vitest-environment happy-dom
import {testPlatform,startFlow} from './programme-ui-harness'
import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {DEF,KEY,useStore} from '../src/store/useStore'
import {useUI} from '../src/store/useUI'
import {bindUI} from '../src/components/ui'
import {activate,skip} from '@opengym/core/programme'
import {projectCycle} from '@opengym/core/programme-calendar'
import Programs from '../src/views/Programs'
import ProgrammeToday,{notTodaySheet} from '../src/components/ProgrammeToday'
import ProgrammeImport from '../src/components/ProgrammeImport'
import ProgrammeRollover,{rolloverSheet} from '../src/components/ProgrammeRollover'
import {programmeSkipSheet,programmeSessionSheet} from '../src/components/ProgrammeSession'
import {initializePublicActions} from '../src/store/public-actions'

const date='2026-10-12'
const definition:any={id:'synthetic',name:'Synthetic programme',unit:'kg',weeks:[1,2].map(index=>({index,days:[{key:'d1',sessions:[{routineSnapshot:{name:'Synthetic day',ex:[]}}]}]}))}
const other={...definition,id:'other',name:'Synthetic other'}
let roots:Root[]=[]
const mount=(el:React.ReactNode)=>{const host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root);act(()=>root.render(el));return host}
const button=(host:HTMLElement,label:string)=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent?.trim()===label);expect(b,label).toBeTruthy();return b!}
const click=async(host:HTMLElement,label:string)=>{await act(async()=>button(host,label).click())}
const sheet=()=>{const sh=useUI.getState().sheets.at(-1)!;return mount(sh.render(()=>{}))}
const settle=async()=>act(async()=>{await vi.dynamicImportSettled()})
const replace=(S:any,user='A')=>{useStore.getState().setUser({id:user});useStore.getState().replaceState(S)}
const put=(mode='active')=>{
 const S=structuredClone(DEF);activate(S,definition,{cycleId:'c',today:date});S.programmes.definitions.push(structuredClone(other))
 if(mode==='paused')S.programmes.cycles[0].status='paused'
 if(mode==='rollover'||mode==='finished'){skip(S,'c','c:w1d1',{today:date});if(mode==='finished')skip(S,'c','c:w2d1',{today:date})}
 replace(S);return S
}
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.setSystemTime(new Date(date+'T12:00:00'));bindUI(useUI);useUI.setState({sheets:[],toastAction:null,toastMsg:''});localStorage.clear();const cache=new Map<string,string|Uint8Array>();testPlatform.objects={get:async(b,k)=>cache.get(b+':'+k)??null,put:async(b,k,v)=>{cache.set(b+':'+k,v)},delete:async(b,k)=>{cache.delete(b+':'+k)},keys:async()=>[]};testPlatform.transport.fetch=vi.fn(async()=>new Response(JSON.stringify({items:[],etag:'empty'})));put()})
afterEach(()=>{act(()=>roots.splice(0).forEach(root=>root.unmount()));document.body.innerHTML=''})

// All actions use the real sync store updater/persistence and real setUser + replaceState.
// The boundary variant switches after all pre-call validation, before the producer.
const paths=['programs-resume','today-resume','block-repeat','block-next','block-stop','end','repeat-week','routine-skip','not-today-skip','shift','move','pause','rollover-accept','load','switch','library-load','library-switch','import-save','shift-undo','rollover-undo'] as const
type Path=typeof paths[number]
async function capture(path:Path):Promise<()=>unknown> {
 if(path==='programs-resume'||path==='today-resume'||path==='repeat-week')put('paused')
 if(path.startsWith('block-'))put('finished')
 if(path.startsWith('rollover-'))put('rollover')
 if(path==='today-resume'){const host=mount(<ProgrammeToday/>),b=button(host,'Pick up at week 1');return ()=>b.click()}
 if(path.startsWith('block-')){const host=mount(<ProgrammeRollover/>),label=path==='block-repeat'?'Repeat block':path==='block-next'?'Pick next program':'Stop program',b=button(host,label);return ()=>b.click()}
 if(path==='end'){const host=mount(<Programs/>);await click(host,'End program');const b=button(sheet(),'End program');return ()=>b.click()}
 if(path==='repeat-week'){await click(mount(<ProgrammeToday/>),'Repeat week 1');const b=button(sheet(),'Repeat week');return ()=>b.click()}
 if(path==='routine-skip'){act(()=>programmeSkipSheet(useStore.getState().S.routines[0]));const b=button(sheet(),'Skip this session');return ()=>b.click()}
 if(['not-today-skip','shift','move','pause','shift-undo'].includes(path)){
  act(()=>notTodaySheet('c'));const host=sheet()
  if(path==='not-today-skip'){await click(host,'Skip d1 instead');const b=button(sheet(),'Skip this session');return ()=>b.click()}
  const label=path==='move'?'Move session':path==='pause'?'Pause for travel':'Shift: do it tomorrow',b=button(host,label)
  if(path==='shift-undo'){await act(async()=>b.click());return useUI.getState().toastAction!.run}
  return ()=>b.click()
 }
 if(path==='rollover-accept'||path==='rollover-undo'){
  act(()=>rolloverSheet('c'));const b=button(sheet(),'Accept and continue')
  if(path==='rollover-undo'){await act(async()=>b.click());return useUI.getState().toastAction!.run}
  return ()=>b.click()
 }
 if(path==='import-save'){
  const host=mount(<ProgrammeImport/>),input=host.querySelector<HTMLInputElement>('input[type=file]')!
  Object.defineProperty(input,'files',{value:[{name:'synthetic.json',size:300,text:async()=>JSON.stringify({...other,id:'imported'})}]})
  await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));const b=button(host,'Save program');return ()=>b.click()
 }
 if(['load','switch','library-load','library-switch'].includes(path)){
  const switching=path.endsWith('switch')
  if(!switching){const S=structuredClone(DEF);S.programmes.definitions=[structuredClone(other)];replace(S)}
  const fromServer=path.startsWith('library-')
  if(fromServer)testPlatform.transport.fetch=vi.fn(async url=>new Response(JSON.stringify(String(url).includes('/other')?{definition:other,n:1,versionId:'v1',level:'Valid'}:{items:[{id:'other',name:other.name,versionId:'v1',versionN:1,level:'Valid',private:false,inUse:false,bytes:300,updatedAt:date}],etag:'synthetic'})))
  const host=mount(<Programs/>);await settle()
  const card=[...host.querySelectorAll<HTMLButtonElement>('button.program-card')].find(b=>b.textContent?.startsWith(other.name))!;expect(card).toBeTruthy();await act(async()=>card.click());await settle()
  await click(host,switching?'Switch to this program':'Start this program');const b=button(host,switching?'Confirm switch':'Confirm load');return ()=>b.click()
 }
 throw new Error(path)
}
// Keep the captured DOM node, even when React removes it after the switch.
async function action(path:Path){if(path==='programs-resume'){put('paused');const host=mount(<Programs/>),b=button(host,'Resume program');return ()=>b.click()}return capture(path)}
it.each(paths)('%s rejects a captured A action after real sync store switches to B, preserving saved bytes',async path=>{
 const run=await action(path),B=structuredClone(useStore.getState().S);B.accountMarker='B'
 let bytes:string|null=null
 await act(async()=>{replace(B,'B');bytes=testPlatform.kv.get(KEY);await run()});await settle()
 expect(testPlatform.kv.get(KEY)).toBe(bytes);expect(useStore.getState().S.accountMarker).toBe('B');expect(useUI.getState().toastMsg).toMatch(/changed/i)
})
it.each(paths)('%s guards inside the real sync store producer at an injected A→B boundary',async path=>{
 const run=await action(path),B=structuredClone(useStore.getState().S);B.accountMarker='B'
 const original=useStore.getState().update;let bytes:string|null=null,entered=false
 useStore.setState({update:(mut,push)=>{entered=true;replace(B,'B');bytes=testPlatform.kv.get(KEY);original(mut,push)}})
 await act(async()=>{await run()});await settle()
 expect(entered).toBe(true);expect(testPlatform.kv.get(KEY)).toBe(bytes);expect(useStore.getState().S.accountMarker).toBe('B');expect(useUI.getState().toastMsg).toMatch(/changed/i)
})
it.each(paths)('%s still writes on the same account after an ordinary settings edit',async path=>{
 const run=await action(path)
 act(()=>useStore.getState().update(s=>{s.sound=!s.sound}));const before=testPlatform.kv.get(KEY)
 await act(async()=>{await run()});await settle()
 expect(testPlatform.kv.get(KEY)).not.toBe(before)
 if(path.startsWith('library-'))expect(useStore.getState().S.programmes.installed.other.versionId).toBe('v1')
})
it.each(paths)('%s rejects same-account document replacement with matching programme ids',async path=>{
 const run=await action(path),replacement=structuredClone(useStore.getState().S);replacement.replacementMarker=true
 let before:string|null=null
 await act(async()=>{useStore.getState().replaceState(replacement);before=testPlatform.kv.get(KEY);await run()});await settle();expect(testPlatform.kv.get(KEY)).toBe(before);expect(useUI.getState().toastMsg).toMatch(/changed/i)
})
it('rejects a Skip confirmation when the same active id is reopened with a new start',async()=>{
 act(()=>useStore.getState().update(s=>{s.active={id:'reopened',start:1,routineIds:[],entries:[]}}));const run=await action('routine-skip')
 act(()=>useStore.getState().update(s=>{s.active={id:'reopened',start:2,routineIds:[],entries:[]}}));const before=testPlatform.kv.get(KEY)
 await act(async()=>{await run()});expect(testPlatform.kv.get(KEY)).toBe(before);expect(useUI.getState().toastMsg).toContain('workout')
})
it('session preview refuses Start after its occurrence was skipped',async()=>{
 const S=useStore.getState().S,o=projectCycle(S.programmes.cycles[0],S.workouts,date,S.queue).next!
 act(()=>programmeSessionSheet(o));const b=button(sheet(),'Start')
 act(()=>useStore.getState().update(s=>skip(s,'c',o.instanceId,{today:date})));const before=testPlatform.kv.get(KEY)
 await act(async()=>b.click());expect(startFlow).not.toHaveBeenCalled();expect(testPlatform.kv.get(KEY)).toBe(before);expect(useUI.getState().toastMsg).toContain('program changed')
})
it.each(['week','block'] as const)('pins mixed %s repeat seeds and durable bytes to legacy bump semantics',path=>{
 const d={...definition,repeat:{bump:{history:5,fixed:5,manual:5}},tmSeeds:{history:{fromE1rm:{pct:.9}},fixed:{value:40,unit:'kg'}}}
 const S=structuredClone(DEF);activate(S,d,{cycleId:'c',today:date});const old=S.programmes.cycles[0];old.tm={history:44,fixed:45,manual:60};old.tmSeed={history:44,fixed:40,manual:55};old.unknown={kept:true}
 if(path==='block'){skip(S,'c','c:w1d1',{today:date});skip(S,'c','c:w2d1',{today:date})}else old.status='paused'
 replace(S);initializePublicActions({platform:testPlatform,toast:message=>useUI.getState().toast(message),materializeTmSeed:input=>({history:88,...input.options.tm})})
 act(()=>{if(path==='week')useStore.getState().repeatProgrammeWeek('c',date);else useStore.getState().finishProgrammeBlock('c','repeat',{today:date})})
 const expected=path==='week'?{history:88,fixed:45,manual:60}:{history:93,fixed:50,manual:65},cycles=useStore.getState().S.programmes.cycles
 expect(cycles.at(-1).tm).toEqual(expected);expect(cycles.at(-1).tmSeed).toEqual(expected);expect(cycles[0].tm).toEqual(old.tm);expect(cycles[0].tmSeed).toEqual(old.tmSeed);expect(cycles[0].unknown).toEqual({kept:true});expect(JSON.parse(testPlatform.kv.get(KEY)!).programmes.cycles.at(-1).tmSeed).toEqual(expected)
})

it('session preview still starts its pending occurrence after an ordinary settings edit',async()=>{
 const S=useStore.getState().S,o=projectCycle(S.programmes.cycles[0],S.workouts,date,S.queue).next!
 act(()=>programmeSessionSheet(o));const b=button(sheet(),'Start')
 act(()=>useStore.getState().update(s=>{s.sound=false}));await act(async()=>b.click())
 expect(startFlow).toHaveBeenCalledExactlyOnceWith([o.routineId])
})
it('allows Skip after ordinary edits on the same active-session instance',async()=>{
 act(()=>useStore.getState().update(s=>{s.active={id:'reopened',start:1,routineIds:[],entries:[]}}));const run=await action('routine-skip')
 act(()=>useStore.getState().update(s=>{s.active.name='Edited title';s.sound=false}));const before=testPlatform.kv.get(KEY)
 await act(async()=>{await run()});expect(testPlatform.kv.get(KEY)).not.toBe(before);expect(useStore.getState().S.programmes.cycles[0].occurrences[0].status).toBe('skipped')
})
it('invalidates an A confirmation after switching away and back to A',async()=>{
 const run=await action('end'),S=structuredClone(useStore.getState().S);let before:string|null=null
 await act(async()=>{replace(S,'B');replace(S,'A');before=testPlatform.kv.get(KEY);await run()})
 expect(testPlatform.kv.get(KEY)).toBe(before);expect(useUI.getState().toastMsg).toMatch(/changed/i)
})
it('keeps stale-generation metadata out of the durable state document',()=>{
 const S=structuredClone(useStore.getState().S);const initial=useStore.getState().documentInstance
 act(()=>useStore.getState().replaceState(S));expect(useStore.getState().documentInstance).toBe(initial!+1)
 expect(JSON.parse(testPlatform.kv.get(KEY)!)).not.toHaveProperty('documentInstance')
})

it('compares the session instance in the actual producer draft, even if the published store is unchanged',async()=>{
 act(()=>useStore.getState().update(s=>{s.active={id:'reopened',start:1,routineIds:[],entries:[]}}));const run=await action('routine-skip'),original=useStore.getState().update
 const before=testPlatform.kv.get(KEY)
 useStore.setState({update:(mut,push)=>original(draft=>{draft.active.start=2;mut(draft)},push)})
 await act(async()=>{await run()});expect(testPlatform.kv.get(KEY)).toBe(before);expect(useStore.getState().S.active.start).toBe(1)
})
it('rejects an async library activation after a same-account replacement with matching ids',async()=>{
 let complete:(value:Response)=>void=()=>{},began:(value?:unknown)=>void=()=>{}
 const started=new Promise(resolve=>{began=resolve})
 testPlatform.transport.fetch=vi.fn(()=>{began();return new Promise<Response>(resolve=>{complete=resolve})})
 const result=useStore.getState().activateLibraryProgramme(other.id,{},'v1','c').catch((error:Error)=>error)
 await started;const S=structuredClone(useStore.getState().S);S.replacementMarker=true
 act(()=>useStore.getState().replaceState(S));const before=testPlatform.kv.get(KEY)
 await act(async()=>complete(new Response(JSON.stringify({definition:other,n:1,versionId:'v1',level:'Valid'}))))
 expect(await result).toBeInstanceOf(Error);expect(testPlatform.kv.get(KEY)).toBe(before)
})
it('discards a private file read completed after a same-account document replacement',async()=>{
 const host=mount(<ProgrammeImport/>),input=host.querySelector<HTMLInputElement>('input[type=file]')!
 let complete:(value:string)=>void=()=>{};const raw=new Promise<string>(resolve=>{complete=resolve})
 Object.defineProperty(input,'files',{value:[{name:'synthetic.json',size:300,text:()=>raw}]})
 await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})))
 act(()=>useStore.getState().replaceState(structuredClone(useStore.getState().S)));const before=testPlatform.kv.get(KEY)
 await act(async()=>complete(JSON.stringify(other)))
 expect(host.textContent).not.toContain('Save program');expect(testPlatform.kv.get(KEY)).toBe(before);expect(useUI.getState().toastMsg).toMatch(/changed/i)
})

it('preserves paused-programme preview Start dispatch for a still-pending occurrence',async()=>{
 const S=put('paused'),o=projectCycle(S.programmes.cycles[0],S.workouts,date,S.queue).occurrences[0]!
 act(()=>programmeSessionSheet(o));await click(sheet(),'Start');expect(startFlow).toHaveBeenCalledExactlyOnceWith([o.routineId])
})

it('reloads server library metadata after same-account replacement while ordinary settings edits keep it',async()=>{
 const item={id:'server-only',name:'Synthetic server only',versionId:'v1',versionN:1,level:'Valid',private:false,inUse:false,bytes:300,updatedAt:date}
 const fetch=vi.fn(async()=>new Response(JSON.stringify({items:[item],etag:'synthetic'})));testPlatform.transport.fetch=fetch
 const host=mount(<Programs/>);await vi.waitFor(async()=>{await settle();expect(host.textContent).toContain(item.name)});expect(fetch).toHaveBeenCalledTimes(1)
 act(()=>useStore.getState().update(s=>{s.sound=false}));await settle();expect(host.textContent).toContain(item.name);expect(fetch).toHaveBeenCalledTimes(1)
 act(()=>useStore.getState().replaceState(structuredClone(useStore.getState().S)));await vi.waitFor(async()=>{await settle();expect(host.textContent).toContain(item.name)})
 expect(fetch).toHaveBeenCalledTimes(2)
})

it.each(['shift-undo','rollover-undo'] as const)('%s keeps its original session epoch after a workout starts and is discarded',async path=>{
 const run=await action(path)
 act(()=>{useStore.getState().update(s=>{s.active={id:'temporary',start:1,routineIds:[],entries:[]}});useStore.getState().update(s=>{s.active=null})})
 const before=testPlatform.kv.get(KEY);await act(async()=>{await run()})
 expect(testPlatform.kv.get(KEY)).toBe(before);expect(useUI.getState().toastMsg).toContain('workout changed')
})

it('a captured End opener cannot retarget its confirmation to account B',async()=>{
 const host=mount(<Programs/>),end=button(host,'End program'),B=structuredClone(useStore.getState().S);let before:string|null=null
 await act(async()=>{replace(B,'B');before=testPlatform.kv.get(KEY);end.click()})
 const confirm=button(sheet(),'End program');await act(async()=>confirm.click())
 expect(testPlatform.kv.get(KEY)).toBe(before);expect(useUI.getState().toastMsg).toMatch(/changed/i)
})

it('Not today nested Skip retains the parent session instance when the same id is reopened',async()=>{
 act(()=>useStore.getState().update(s=>{s.active={id:'reopened',start:1,routineIds:[],entries:[]}}))
 act(()=>notTodaySheet('c'));const parent=sheet(),skipButton=button(parent,'Skip d1 instead')
 act(()=>useStore.getState().update(s=>{s.active={id:'reopened',start:2,routineIds:[],entries:[]}}));const before=testPlatform.kv.get(KEY)
 await act(async()=>skipButton.click());await click(sheet(),'Skip this session')
 expect(testPlatform.kv.get(KEY)).toBe(before);expect(useStore.getState().S.programmes.cycles[0].occurrences[0].status).toBe('pending');expect(useUI.getState().toastMsg).toContain('workout')
})
it('Not today nested Skip permits ordinary edits to the same session instance',async()=>{
 act(()=>useStore.getState().update(s=>{s.active={id:'reopened',start:1,routineIds:[],entries:[]}}))
 act(()=>notTodaySheet('c'));const parent=sheet()
 act(()=>useStore.getState().update(s=>{s.active.name='Edited title'}));const before=testPlatform.kv.get(KEY)
 await click(parent,'Skip d1 instead');await click(sheet(),'Skip this session')
 expect(testPlatform.kv.get(KEY)).not.toBe(before);expect(useStore.getState().S.programmes.cycles[0].occurrences[0].status).toBe('skipped')
})
