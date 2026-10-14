// @vitest-environment happy-dom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {createSyncEngine} from '../../src/store/sync-engine'
import {useStore,initialStoreState,DEF,clone,KEY} from '../../src/store/useStore'
import {createBrowserPlatform,browserServerEndpoint} from '../../src/platform/browser'
import {configureClientIO} from '../../src/lib/client-io'
let map:Map<string,string>,dispose:()=>void,refuse:boolean,api:ReturnType<typeof vi.fn<(path:string,options?:RequestInit)=>Promise<any>>>
const toast=vi.fn()
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));vi.clearAllMocks();refuse=false
 const original={...clone(DEF),workouts:[{id:'only-original',entries:[]}],_ts:1}
 map=new Map([[KEY,JSON.stringify(original)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_sync',JSON.stringify({rev:1,ts:1})]])
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{if(refuse&&k===KEY)throw new Error('synthetic quota');map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 const platform={...createBrowserPlatform(),kv,server:browserServerEndpoint(kv)};configureClientIO(platform);useStore.setState(initialStoreState(kv))
 api=vi.fn(async()=>({state:clone(original),rev:1}));const engine=createSyncEngine(p=>useStore.setState(p),useStore.getState,{platform,api,prompts:{toast,askAddDeviceData:async()=>false}});useStore.setState({...engine.actions,ready:true});dispose=engine.dispose
})
afterEach(()=>{dispose();vi.useRealTimers()})
for(const action of ['reset','replace','merge'])it(`${action}: refused opt-in replacement preserves original bytes/state/index and arms no upload`,async()=>{
 const bytes=map.get(KEY),state=clone(useStore.getState().S),index=useStore.getState().index;refuse=true
 const run=()=>action==='reset'?useStore.getState().resetEverything({durable:true}):useStore.getState().importBackup({...clone(DEF),workouts:[{id:'imported',entries:[]}]},{durable:true,mergeWith:action==='merge'?{state:clone(DEF),rev:1}:null})
 expect(run).toThrow(/could not be saved/);await Promise.resolve();expect(map.get(KEY)).toBe(bytes);expect(useStore.getState().S).toEqual(state);expect(useStore.getState().index).toBe(index)
 await vi.advanceTimersByTimeAsync(3000);expect(api).not.toHaveBeenCalled();expect(toast).toHaveBeenCalledWith('Could not save the replacement. Your previous data is kept.')
})
for(const action of ['reset','replace','merge'])it(`${action}: a durable replacement succeeds and then arms its ordinary upload`,async()=>{
 if(action==='reset')await useStore.getState().resetEverything({durable:true})
 else useStore.getState().importBackup({...clone(DEF),workouts:[{id:'imported',entries:[]}]},{durable:true,mergeWith:action==='merge'?{state:clone(DEF),rev:1}:null})
 expect(JSON.parse(map.get(KEY)!)).toEqual(useStore.getState().S);await vi.advanceTimersByTimeAsync(1600);expect(api.mock.calls.some(([,opts])=>opts?.method==='PUT')).toBe(true)
})
for(const change of ['account','profile','edit','inside-updater'])it(`reset completion: ${change} after the server read starts preserves the changed saved bytes`,async()=>{
 let answer!:(response:any)=>void;api.mockImplementation(()=>new Promise(resolve=>{answer=resolve}))
 const operation=useStore.getState().resetEverything({durable:true})
 for(let n=0;n<20&&!answer;n++)await Promise.resolve();expect(answer).toBeTypeOf('function')
 let bytes:string|undefined
 const changeTarget=()=>{
  if(change==='account')useStore.getState().setUser({id:'B'},{adopt:{alwaysAsk:true}})
  useStore.getState().update(s=>{if(change==='edit')s.workouts=[{id:'late-edit',entries:[]}];else s.activeEquipId='new-profile'},false);bytes=map.get(KEY)
 }
 if(change==='inside-updater'){
  const update=useStore.getState().update
  useStore.setState({update(mut,push){useStore.setState({update});changeTarget();update(mut,push)}})
 }else changeTarget()
 answer({state:{...clone(DEF),workouts:[{id:'server-old',entries:[]}]},rev:1});await operation;await Promise.resolve()
 expect(map.get(KEY)).toBe(bytes);expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/))
})
