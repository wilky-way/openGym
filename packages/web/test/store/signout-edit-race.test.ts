// @vitest-environment happy-dom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {createSyncEngine} from '../../src/store/sync-engine'
import {useStore,initialStoreState,DEF,clone,KEY} from '../../src/store/useStore'
import {useUI,configureUI} from '../../src/store/useUI'
import {createBrowserPlatform,browserServerEndpoint} from '../../src/platform/browser'
let map:Map<string,string>,dispose:()=>void,answer:(response:any)=>void,failPush:boolean,refusePrimary:boolean
let api:ReturnType<typeof vi.fn<(path:string,options?:RequestInit)=>Promise<any>>>
const toast=vi.fn()
const stopTimers=vi.fn(()=>{useUI.getState().stopRest();useUI.getState().abandonWork()})
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));vi.clearAllMocks();failPush=false;refusePrimary=false;answer=undefined as any
 const original={...clone(DEF),workouts:[{id:'before-logout',d:'2026-01-01',entries:[],_at:1}],_ts:1}
 map=new Map([[KEY,JSON.stringify(original)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_sync',JSON.stringify({rev:1,ts:1})],['gym_state_owner','A'],['gym_state_wid','saved-A']])
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{if(refusePrimary&&k===KEY)throw new Error('synthetic quota');map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 const platform={...createBrowserPlatform(),kv,server:browserServerEndpoint(kv)};useStore.setState(initialStoreState(kv))
 api=vi.fn(async(path:string,options?:RequestInit)=>{
  if(path.startsWith('/api/logout'))return await new Promise(resolve=>{answer=resolve})
  if(options?.method==='PUT'){if(failPush)throw new Error('synthetic offline');return{rev:2}}
  return{state:clone(useStore.getState().S),rev:2}
 })
 const engine=createSyncEngine(p=>useStore.setState(p),useStore.getState,{platform,api,prompts:{toast,askAddDeviceData:async()=>false,stopTimers},acquireAuthLock:async()=>()=>{},acquireSyncLock:async()=>()=>{}});useStore.setState({...engine.actions,ready:true});dispose=engine.dispose
 configureUI({platform,deviceId:()=>undefined,notifyRestOver:async()=>{}})
})
afterEach(()=>{useUI.getState().stopWork();useUI.getState().stopRest();dispose();vi.useRealTimers()})
for(const action of ['signOut','signOutAll'] as const)for(const force of [false,true])it(`${action}, force=${force}: abandoning a running hold preserves its seconds and completes after server logout`,async()=>{
 useStore.getState().update(s=>{s.active={id:'running-hold',entries:[{id:'plank',sets:[{sec:45}]}]}},false)
 if(force){failPush=true;useStore.getState().update(s=>{s.workouts.push({id:'initially-owed',entries:[]})},false)}
 else{await useStore.getState().syncNow();expect(useStore.getState().unsyncedChanges().owed).toBe(false)}
 // The real UI follows legacy abandonWork: >=2 seconds are logged through the real updater,
 // leaving the set unfinished with its original planSec. No UI callback is bound (reload path).
 useUI.getState().startWork(45,'Plank',null,{idx:0,i:0,id:'plank'});vi.advanceTimersByTime(3_000)
 expect(useUI.getState().work?.left).toBe(42)
 const before=map.get(KEY),pending=useStore.getState()[action]({force})
 const completed=expect(pending).resolves.toMatchObject(force?{owed:true,stashed:true}:{owed:false})
 for(let n=0;n<100&&!answer;n++)await Promise.resolve();expect(answer).toBeTypeOf('function')
 expect(stopTimers).toHaveBeenCalledOnce();expect(useUI.getState().work).toBeNull();expect(map.get(KEY)).not.toBe(before)
 const held={sec:3,planSec:45}
 expect(JSON.parse(map.get(KEY)!).active.entries[0].sets[0]).toEqual(held)
 // The server has invalidated the session; completion must need no second logout request.
 answer({ok:true});await completed
 expect(api.mock.calls.filter(([path])=>path.startsWith('/api/logout')).map(([path])=>path)).toEqual([action==='signOut'?'/api/logout':'/api/logout/all'])
 expect(useStore.getState().user).toBeNull();expect(map.has('gym_owner')).toBe(false)
 const copies=await useStore.getState().keptChanges();expect(copies).toHaveLength(1);expect(copies[0].uid).toBe('A')
 const kept=await useStore.getState().keptState(copies[0].server,'A')
 expect(kept.active.id).toBe('running-hold');expect(kept.active.entries[0].sets[0]).toEqual(held)
 if(force)expect(kept.workouts.some((w:any)=>w.id==='initially-owed')).toBe(true)
 expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/changed.*kept/))
})
for(const action of ['signOut','signOutAll'] as const)for(const force of [false,true])it(`${action}, force=${force}: a peer workout joined while abandoning a hold is owed before logout`,async()=>{
 useStore.getState().update(s=>{s.active={id:'running-hold',entries:[{id:'plank',sets:[{sec:45}]}]}},false)
 await useStore.getState().syncNow();expect(useStore.getState().unsyncedChanges().owed).toBe(false)
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 const platform={...createBrowserPlatform(),kv,server:browserServerEndpoint(kv)};let peer:any=initialStoreState(kv)
 const peerEngine=createSyncEngine(p=>{peer={...peer,...p}},()=>peer,{platform,api:async()=>({rev:3}),prompts:{toast,askAddDeviceData:async()=>false}});peer={...peer,...peerEngine.actions,ready:false}
 stopTimers.mockImplementationOnce(()=>{
  peer.update((s:any)=>{s.workouts.push({id:'peer-during-timer-stop',entries:[]})},false)
  useUI.getState().stopRest();useUI.getState().abandonWork()
 })
 useUI.getState().startWork(45,'Plank',null,{idx:0,i:0,id:'plank'});vi.advanceTimersByTime(3_000)
 api.mockImplementation(async(path:string)=>path.startsWith('/api/logout')?{ok:true}:{rev:2})
 try{
  const result=await useStore.getState()[action]({force})
  expect(result).toMatchObject(force?{owed:true,stashed:true}:{owed:true})
  const held={sec:3,planSec:45}
  if(force){
   expect(useStore.getState().user).toBeNull()
   const copies=await useStore.getState().keptChanges(),kept=await useStore.getState().keptState(copies[0].server,'A')
   expect(kept.workouts.some((w:any)=>w.id==='peer-during-timer-stop')).toBe(true);expect(kept.active.entries[0].sets[0]).toEqual(held)
  }else{
   expect(api.mock.calls.some(([path])=>path.startsWith('/api/logout'))).toBe(false);expect(useStore.getState().user?.id).toBe('A')
   const saved=JSON.parse(map.get(KEY)!);expect(saved.workouts.some((w:any)=>w.id==='peer-during-timer-stop')).toBe(true);expect(saved.active.entries[0].sets[0]).toEqual(held)
  }
 }finally{peerEngine.dispose()}
})
for(const scenario of ['forced-dirty','clean-signout','clean-everywhere'] as const)it(`${scenario}: a workout saved during logout is never deleted or overwritten by the final clear`,async()=>{
 if(scenario==='forced-dirty'){failPush=true;useStore.getState().update(s=>{s.workouts.push({id:'initially-owed',entries:[]})},false)}
 else {await useStore.getState().syncNow();expect(useStore.getState().unsyncedChanges().owed).toBe(false)}
 const pending=scenario==='clean-everywhere'?useStore.getState().signOutAll():useStore.getState().signOut({force:scenario==='forced-dirty'})
 const settled=pending.catch((error:unknown)=>error)
 for(let n=0;n<100&&!answer;n++)await Promise.resolve();expect(answer).toBeTypeOf('function')
 useStore.getState().update(s=>{s.workouts.push({id:'during-logout',entries:[],_at:Date.now()})},false)
 const bytes=map.get(KEY),state=clone(useStore.getState().S),user=useStore.getState().user
 answer({ok:true});await settled;await Promise.resolve()
 expect(map.get(KEY)).toBe(bytes);expect(useStore.getState().S).toEqual(state);expect(useStore.getState().user).toBe(user);expect(map.get('gym_owner')).toBe('A')
 expect(JSON.parse(map.get(KEY)!).workouts.some((w:any)=>w.id==='during-logout')).toBe(true);expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed.*kept/));await expect(pending).rejects.toThrow(/account.*changed|data changed/)
})
it('the final data fence checks inside the real updater and preserves a last-moment new document',async()=>{
 await useStore.getState().syncNow();const pending=useStore.getState().signOut(),settled=pending.catch((error:unknown)=>error)
 for(let n=0;n<100&&!answer;n++)await Promise.resolve()
 const update=useStore.getState().update;let bytes:string|undefined
 useStore.setState({update(mut,push){useStore.setState({update});update(s=>{s.workouts.push({id:'inside-updater',entries:[]})},false);bytes=map.get(KEY);update(mut,push)}})
 answer({ok:true});await settled;expect(map.get(KEY)).toBe(bytes);expect(useStore.getState().user?.id).toBe('A');await expect(pending).rejects.toThrow(/account.*changed|data changed/)
})
for(const scenario of ['forced-dirty','clean-signout','clean-everywhere','refused-wid'] as const)it(`${scenario}: a peer save before its storage event arrives cannot be cleared`,async()=>{
 if(scenario==='forced-dirty'){failPush=true;useStore.getState().update(s=>{s.workouts.push({id:'initially-owed',entries:[]})},false)}
 else {await useStore.getState().syncNow();expect(useStore.getState().unsyncedChanges().owed).toBe(false)}
 const pending=scenario==='clean-everywhere'?useStore.getState().signOutAll():useStore.getState().signOut({force:scenario==='forced-dirty'}),settled=pending.catch((error:unknown)=>error)
 for(let n=0;n<100&&!answer;n++)await Promise.resolve()
 // A second real engine owns a separate in-memory document over the shared durable KV.
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{if(scenario==='refused-wid'&&k==='gym_state_wid')throw new Error('synthetic metadata quota');map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 let peer:any=initialStoreState(kv);const platform={...createBrowserPlatform(),kv,server:browserServerEndpoint(kv)}
 const engine=createSyncEngine(p=>{peer={...peer,...p}},()=>peer,{platform,api:async()=>({rev:3}),prompts:{toast,askAddDeviceData:async()=>false}});peer={...peer,...engine.actions,ready:false}
 try {
  const wid=map.get('gym_state_wid');peer.update((draft:any)=>{draft.workouts.push({id:'peer-during-logout',entries:[]})},false);const bytes=map.get(KEY)
  if(scenario==='refused-wid')expect(map.get('gym_state_wid')).toBe(wid)
  expect(useStore.getState().S.workouts.some((w:any)=>w.id==='peer-during-logout')).toBe(false)
  answer({ok:true});await settled
  expect(map.get(KEY)).toBe(bytes);expect(JSON.parse(map.get(KEY)!).workouts.some((w:any)=>w.id==='peer-during-logout')).toBe(true);expect(map.get('gym_owner')).toBe('A')
  await expect(pending).rejects.toThrow(/account.*changed|data changed/)
 }finally{engine.dispose()}
})

it('the in-memory final fence preserves an edit whose primary save failed while logout was pending',async()=>{
 await useStore.getState().syncNow();const pending=useStore.getState().signOut(),settled=pending.catch((error:unknown)=>error)
 for(let n=0;n<100&&!answer;n++)await Promise.resolve()
 const bytes=map.get(KEY),wid=map.get('gym_state_wid');refusePrimary=true
 useStore.getState().update(s=>{s.workouts.push({id:'unsaved-during-logout',entries:[]})},false);const state=clone(useStore.getState().S)
 expect(map.get(KEY)).toBe(bytes);expect(map.get('gym_state_wid')).toBe(wid);refusePrimary=false
 answer({ok:true});await settled
 expect(map.get(KEY)).toBe(bytes);expect(useStore.getState().S).toEqual(state);expect(useStore.getState().S.workouts.some((w:any)=>w.id==='unsaved-during-logout')).toBe(true)
 await expect(pending).rejects.toThrow(/account.*changed|data changed/)
})
