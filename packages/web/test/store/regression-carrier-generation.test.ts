import {afterEach,it,expect,vi} from 'vitest'
import {createSyncEngine} from '../../src/store/sync-engine'
import {initialStoreState,DEF,clone,KEY} from '../../src/store/useStore'
const disposes:(()=>void)[]=[]
afterEach(()=>{disposes.splice(0).forEach(fn=>fn());vi.useRealTimers()})
it.each(['replace','import','reset','takeServer'])('queued carrier PUT re-snapshots after same-owner %s',async kind=>{
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
  const doc=(name:string)=>({...clone(DEF),_ts:100,_wid:'base',_rev:1,workouts:[{id:name,entries:[]}]})
  const map=new Map([[KEY,JSON.stringify(doc('old-private'))],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_state_owner','A'],['gym_state_wid','g1:initial'],['gym_state_instance','1']])
  const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
  let state:any={...initialStoreState(kv),documentInstance:1},unlock!:(release:()=>void)=>void,entered!:()=>void,calls=0
  const waiting=new Promise<void>(resolve=>{entered=resolve}),lease=new Promise<()=>void>(resolve=>{unlock=resolve}),puts:any[]=[]
  const api=vi.fn(async(path:string,options?:RequestInit)=>{if(options?.method==='PUT'){puts.push(JSON.parse(options.body as string).state);return{rev:3}}return{state:doc('replacement-only'),rev:2}})
  const engine=createSyncEngine(patch=>{state={...state,...patch}},()=>state,{platform:{kv,server:{baseUrl:()=>''},nav:{href:()=> 'https://synthetic.example/',reload:vi.fn()}} as any,api,acquireSyncLock:async()=>{if(++calls===1){entered();return lease}return()=>{}},prompts:{toast:()=>{},askAddDeviceData:async()=>false}})
  state={...state,...engine.actions,ready:true};disposes.push(engine.dispose)
  const pending=state.pushState();await waiting
  if(kind==='replace')state.replaceState(doc('replacement-only'),false,{durable:true})
  else if(kind==='import')state.importBackup(doc('replacement-only'),{durable:true})
  else if(kind==='reset')await state.resetEverything({durable:true})
  else await state.adoptProfile(async()=>false,{alwaysAsk:true})
  const replacement=state.S.workouts.map((w:any)=>w.id)
  expect(state.documentInstance).toBeGreaterThan(1)
  unlock(()=>{});await pending
  expect(puts.length).toBeGreaterThan(0)
  for(const sent of puts)expect(sent.workouts.map((w:any)=>w.id)).toEqual(replacement)
  expect(puts.some(sent=>sent.workouts.some((w:any)=>w.id==='old-private'))).toBe(false)
})
