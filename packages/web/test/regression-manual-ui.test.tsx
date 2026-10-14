// @vitest-environment happy-dom
globalThis.IS_REACT_ACT_ENVIRONMENT=true
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {it,expect} from 'vitest'
import {initializeStore,useStore,DEF,clone,KEY} from '../src/store/useStore'
import {initializeSyncEngine} from '../src/store/sync-engine'
import {createPublicActions} from '../src/store/public-actions'
import {createBrowserPlatform,browserServerEndpoint} from '../src/platform/browser'
import {configureClientIO} from '../src/lib/client-io'
import {configureProgrammeUi} from '../src/lib/programme-ui-services'
import {configureUI,useUI} from '../src/store/useUI'
import {bindUI} from '../src/components/ui'
import Programs from '../src/views/Programs'
import {progressionProgramme} from '../../core/test/fixtures/synthetic-progression'
import {materializeTmSeed} from '@opengym/core/materialize-tm-seed'
import {evaluate} from '@opengym/core/progression-engine/index'
it.each(['authored-lb', 'exact-kg'])('manual activation UI: 100 kg TM at 65 percent with %s rounding',async rounding=>{
 const d=progressionProgramme();d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].tm={key:'bench',percentages:[65,80]};d.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].pyramid=[5,'max']
 // Keep the original probe's 2.5 lb rounding, plus a separately authored 0.5 kg grid.
 if(rounding==='exact-kg') d.progressionRules[0].rounding.increment=.5*2.2046226218
 const doc={...clone(DEF),unit:'kg',active:null,workouts:[],programmes:{...clone(DEF.programmes),definitions:[d]}}
 const map=new Map([[KEY,JSON.stringify(doc)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_state_owner','A']])
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 const platform={...createBrowserPlatform(),kv,server:browserServerEndpoint(kv),transport:{fetch:async()=>new Response(JSON.stringify({items:[],etag:'synthetic'}),{status:200,headers:{'content-type':'application/json'}})}}
 configureClientIO(platform);initializeStore(platform)
 const dispose=initializeSyncEngine({platform,api:async()=>({}),prompts:{toast:()=>{},askAddDeviceData:async()=>false}})
 const actions=createPublicActions(useStore.getState,{platform,toast:()=>{},materializeTmSeed});useStore.setState(actions)
 configureUI({platform,deviceId:()=>undefined,notifyRestOver:async()=>{}});bindUI(useUI)
 configureProgrammeUi({platform,initialProgramId:()=>d.id,startFlow:()=>{},confirmSheet:()=>{},workoutDetailSheet:()=>{},dayOverrideSheet:()=>{}})
 // This probe needs no server library; keep real activation and real sync store persistence.
 useStore.setState({listProgrammeLibrary:async()=>({items:[],etag:'synthetic'})} as any)
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host)
 const click=(text:string)=>{const b=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent?.trim()===text);expect(b,text).toBeTruthy();act(()=>b!.click())}
 try{
  await act(async()=>root.render(<Programs/>));click('Start this program')
  const label=[...host.querySelectorAll('label')].find(l=>l.textContent?.includes('Training max: bench (kg)'))
  expect(label).toBeTruthy();const input=label!.querySelector('input')!
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'100');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}))})
  click('Confirm load');await act(async()=>{})
  const c=useStore.getState().S.programmes.cycles.at(-1)!
  const result=evaluate({definition:c.snapshot,cycle:c,logs:[],profile:{unit:'kg',effortScale:'rir'},weeks:[1]} as any)
  expect(result.error).toBeUndefined()
  expect(c.snapshot.unit).toBe('lb');expect(c.tmSeed!.bench).toBeCloseTo(100*2.2046226218,8)
  expect(c.tmUnit).toBe('kg');expect(c.tm!.bench).toBeCloseTo(100,8)
  const persisted=JSON.parse(map.get(KEY)!).programmes.cycles.at(-1)
  expect(persisted.tmSeed).toEqual(c.tmSeed);expect(persisted.tmUnit).toBe('kg')
  const set=result.weeks[0]!.slots[0]!.sets[0]!
  expect(set.why.at(-1)!.inputs.roundedFrom).toBeCloseTo(65,8)
  expect(set.load).toBeCloseTo(rounding==='exact-kg'?65:142.5/2.2046226218,8)
 }finally{act(()=>root.unmount());host.remove();dispose()}
})
