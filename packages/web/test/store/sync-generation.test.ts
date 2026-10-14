import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSyncEngine } from '../../src/store/sync-engine'
import { initialStoreState, DEF, clone, KEY } from '../../src/store/useStore'
import { captureProgrammeTarget, updateProgramme } from '../../src/lib/programme-target'

const disposes: (() => void)[] = []
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')) })
afterEach(() => { disposes.splice(0).forEach(dispose => dispose()); vi.useRealTimers() })
const document = () => ({ ...clone(DEF), _ts: 100, _wid: 'initial', _rev: 1,
  workouts: [{ id: 'synthetic-workout', entries: [] }] })
function tabs(wid = 'initial-write') {
  const map = new Map([[KEY, JSON.stringify(document())], ['gym_owner', 'A'],
    ['gym_user', JSON.stringify({id:'A'})], ['gym_state_owner', 'A'], ['gym_state_wid',wid],
    ['gym_sync', JSON.stringify({rev:1,ts:100,wid:'initial'})], ['gym_state_instance','1']])
  const listeners: Set<(key: string) => void>[] = [], events: {tab: number; key: string}[] = []
  const make = () => {
    const tab = listeners.length, subscribed = new Set<(key:string)=>void>(); listeners.push(subscribed)
    const emit = (key:string) => { listeners.forEach((_, peer) => { if (peer !== tab) events.push({tab:peer,key}) }) }
    const kv = { get:(key:string)=>map.get(key)??null,
      set(key:string,value:string) { map.set(key,value); emit(key) }, remove(key:string) { map.delete(key); emit(key) },
      subscribe(fn:(key:string)=>void) { subscribed.add(fn); return()=>subscribed.delete(fn) } }
    const platform:any = {kv,server:{baseUrl:()=>''},nav:{href:()=> 'https://synthetic.example/',reload:vi.fn()}}
    let state:any = {...initialStoreState(kv),documentInstance:1,update() {}}
    const api=vi.fn(async()=>({rev:2}))
    const engine=createSyncEngine(patch=>{state={...state,...patch}},()=>state,{platform,api,
      prompts:{toast:vi.fn(),askAddDeviceData:async()=>false}})
    state={...state,...engine.actions,ready:true}; disposes.push(engine.dispose)
    return {get:()=>state,platform,api}
  }
  const A=make(), B=make()
  const flush=()=> { for(let count=0;events.length;count++) { if(count>1000)throw new Error('Event loop did not settle'); const e=events.shift()!;listeners[e.tab]!.forEach(fn=>fn(e.key)) } }
  return {A,B,map,flush}
}

it.each([false,true])('a deliberate replacement propagates its generation to a peer (events delivered: %s)', delivered=>{
  const {A,B,map,flush}=tabs(), target=captureProgrammeTarget(B.platform,B.get)
  A.get().replaceState(document(),false)
  if(delivered)flush()
  const before=new Map(map)
  expect(updateProgramme(s=>{s.targetW=123},target,B.get)).toBe(false)
  expect(B.get().documentInstance).toBe(A.get().documentInstance)
  expect(map).toEqual(before)
  expect(JSON.parse(map.get(KEY)!)).not.toHaveProperty('documentInstance')
})

it('ordinary peer edits preserve callbacks and merge both tabs changes',()=>{
  const {A,B,map,flush}=tabs(), target=captureProgrammeTarget(B.platform,B.get)
  A.get().update((s:any)=>{s.bodyweight=[{d:'2026-10-13',w:80,t:Date.now()}]})
  flush()
  expect(updateProgramme(s=>{s.targetW=123},target,B.get)).toBe(true)
  const saved=JSON.parse(map.get(KEY)!)
  expect(saved.bodyweight).toHaveLength(1);expect(saved.targetW).toBe(123)
  expect(A.get().documentInstance).toBe(1);expect(B.get().documentInstance).toBe(1)
})

it('a failed sign-out replacement keeps the original document and ownership',async()=>{
  const {A,map}=tabs(), before=map.get(KEY), owner=map.get('gym_owner'), user=map.get('gym_user')
  const set=A.platform.kv.set
  A.platform.kv.set=(key:string,value:string)=>{if(key===KEY)throw new Error('quota');set(key,value)}
  await expect(A.get().signOut({force:true})).rejects.toThrow(/Replacement could not be saved/)
  expect(map.get(KEY)).toBe(before);expect(map.get('gym_owner')).toBe(owner);expect(map.get('gym_user')).toBe(user)
})

it('quota generation refusal keeps the old document and its valid callbacks',()=>{
  const {A,map}=tabs(), before=new Map(map), target=captureProgrammeTarget(A.platform,A.get), set=A.platform.kv.set
  A.platform.kv.set=(key:string,value:string)=>{if(key==='gym_state_instance')throw new Error('quota generation');set(key,value)}
  expect(()=>A.get().replaceState({...document(),workouts:[{id:'replacement',entries:[]}]},false,{durable:true})).toThrow()
  expect(map).toEqual(before);expect(A.get().documentInstance).toBe(1)
  expect(updateProgramme(s=>{s.targetW=123},target,A.get)).toBe(true)
  expect(A.get().S.workouts[0].id).toBe('synthetic-workout')
})
it.each(['update','pushState'])('hydration owner switch refuses %s without changing B bytes or sending A data',async action=>{
  const doc=(id:string)=>({...document(),_wid:id,workouts:[{id:id+'-private',entries:[]}]})
  const map=new Map([[KEY,JSON.stringify(doc('A'))],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_state_owner','A'],['gym_state_wid','A-write']])
  let reads=0
  const kv={get(key:string){const value=map.get(key)??null;if(key===KEY&&++reads===3){map.set(KEY,JSON.stringify(doc('B')));map.set('gym_owner','B');map.set('gym_user',JSON.stringify({id:'B'}));map.set('gym_state_owner','B');map.set('gym_state_wid','B-write')}return value},set:(key:string,value:string)=>{map.set(key,value)},remove:(key:string)=>{map.delete(key)},subscribe:()=>()=>{}}
  let state:any=initialStoreState(kv);const api=vi.fn(async()=>({rev:2})), producer=vi.fn((s:any)=>{s.targetW=123})
  const engine=createSyncEngine(patch=>{state={...state,...patch}},()=>state,{platform:{kv,server:{baseUrl:()=>''},nav:{href:()=> 'https://synthetic.example/',reload:vi.fn()}} as any,api,prompts:{toast:vi.fn(),askAddDeviceData:async()=>false}})
  state={...state,...engine.actions,ready:true};disposes.push(engine.dispose);const before=new Map(map)
  if(action==='update')state.update(producer,false);else await state.pushState()
  expect(map).toEqual(before);expect(producer).not.toHaveBeenCalled();expect(api).not.toHaveBeenCalled();expect(JSON.parse(map.get(KEY)!).workouts[0].id).toBe('B-private')
})

it.each(['initial-write','g1:initial-write'])('a durable primary replacement refuses old peer callbacks even if publishing its write id fails (%s)',wid=>{
  const {A,B,map}=tabs(wid), target=captureProgrammeTarget(B.platform,B.get), set=A.platform.kv.set
  let writes=0
  A.platform.kv.set=(key:string,value:string)=>{if(key==='gym_state_wid'&&++writes>=(wid.startsWith('g1:')?1:2))throw new Error('quota write id');set(key,value)}
  A.get().replaceState(document(),false,{durable:true})
  expect(A.get().documentInstance).toBe(2)
  const before=new Map(map)
  expect(updateProgramme(s=>{s.targetW=123},target,B.get)).toBe(false)
  expect(map).toEqual(before)
})

it.each([false,true])('a peer that sees a reservation takes the later replacement exactly (events delivered: %s)',delivered=>{
  const {A,B,map,flush}=tabs(), target=captureProgrammeTarget(B.platform,B.get), set=A.platform.kv.set
  A.platform.kv.set=(key:string,value:string)=>{
    set(key,value)
    if(key==='gym_state_instance') {
      expect(updateProgramme(s=>{s.targetW=123},target,B.get)).toBe(false)
      expect(B.get().documentInstance).toBe(2)
    }
  }
  A.get().replaceState({...document(),workouts:[{id:'replacement-only',entries:[]}]},false,{durable:true})
  if(delivered)flush()
  // A fresh producer after reservation must not merge the previous document back.
  B.get().update((s:any)=>{s.targetW=124},false)
  expect(JSON.parse(map.get(KEY)!).workouts.map((w:any)=>w.id)).toEqual(['replacement-only'])
  expect(B.get().S.workouts.map((w:any)=>w.id)).toEqual(['replacement-only'])
})
