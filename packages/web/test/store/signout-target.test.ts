// @vitest-environment happy-dom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {createSyncEngine, type SyncServices} from '../../src/store/sync-engine'
import {useStore,initialStoreState,DEF,clone,KEY} from '../../src/store/useStore'
import {useUI} from '../../src/store/useUI'
import {createBrowserPlatform,browserServerEndpoint} from '../../src/platform/browser'
import {configureClientIO} from '../../src/lib/client-io'
import {captureSheetContext} from '../../src/lib/sheet-context'
let lockAvailable:boolean, map:Map<string,string>,dispose:()=>void,logout:(value:any)=>void,api:ReturnType<typeof vi.fn<(path:string,options?:RequestInit)=>Promise<any>>>
let services:SyncServices
const toast=vi.fn()
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));vi.clearAllMocks();logout=undefined as any;lockAvailable=true
 const original={...clone(DEF),activeEquipId:'same-profile',workouts:[{id:'A-private',entries:[]}],_ts:1}
 map=new Map([[KEY,JSON.stringify(original)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_sync',JSON.stringify({rev:1,ts:1})]])
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 const platform={...createBrowserPlatform(),kv,server:browserServerEndpoint(kv)};configureClientIO(platform);useStore.setState(initialStoreState(kv));useUI.setState({toast})
 api=vi.fn((path:string)=>path.startsWith('/api/logout')?new Promise(resolve=>{logout=resolve}):Promise.resolve({state:clone(original),rev:1}))
 services={platform,api,prompts:{toast,askAddDeviceData:async()=>false},acquireAuthLock:async()=>()=>{},acquireSyncLock:async()=>lockAvailable?()=>{}:null};const engine=createSyncEngine(p=>useStore.setState(p),useStore.getState,services);useStore.setState({...engine.actions,ready:false});dispose=engine.dispose
})
afterEach(()=>{dispose();vi.useRealTimers()})
for(const action of ['signOut','signOutAll'])for(const change of ['account','profile','edit'])it(`${action}: ${change} during logout aborts without clearing real saved bytes`,async()=>{
 const document=JSON.stringify(useStore.getState().S),valid=captureSheetContext({updater:true,target:draft=>JSON.stringify(draft)===document})
 const operation=useStore.getState()[action]({valid}),rejected=expect(operation).rejects.toThrow(/changed/)
 for(let n=0;n<40&&!logout;n++)await Promise.resolve();expect(logout).toBeTypeOf('function')
 if(change==='account'){useStore.getState().setUser({id:'B'},{adopt:{alwaysAsk:true}});useStore.getState().update(s=>{s.workouts=[{id:'B-private',entries:[]}];s.activeEquipId='same-profile'},false)}
 else useStore.getState().update(s=>{if(change==='profile')s.activeEquipId='new-profile';else s.workouts.push({id:'late-local-edit',entries:[]})},false)
 const bytes=map.get(KEY),state=clone(useStore.getState().S),user=useStore.getState().user;logout({ok:true});await rejected
 expect(map.get(KEY)).toBe(bytes);expect(useStore.getState().S).toEqual(state);expect(useStore.getState().user).toBe(user);expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/))
})
for(const action of ['signOut','signOutAll'])it(`${action}: a late switch inside the post-await updater probe returns before session clearing`,async()=>{
 const document=JSON.stringify(useStore.getState().S),valid=captureSheetContext({updater:true,target:draft=>JSON.stringify(draft)===document})
 const operation=useStore.getState()[action]({valid}),rejected=expect(operation).rejects.toThrow(/changed/)
 for(let n=0;n<40&&!logout;n++)await Promise.resolve()
 const update=useStore.getState().update;let bytes:string|undefined
 useStore.setState({update(mut,push){useStore.setState({update});useStore.getState().setUser({id:'B'},{adopt:{alwaysAsk:true}});update(s=>{s.workouts=[{id:'B-private',entries:[]}]},false);bytes=map.get(KEY);update(mut,push)}})
 logout({ok:true});await rejected;expect(map.get(KEY)).toBe(bytes);expect(useStore.getState().user?.id).toBe('B');expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/))
})
for(const action of ['signOut','signOutAll'])it(`${action}: an unavailable host carrier lock refuses without sending logout or clearing bytes`,async()=>{
 lockAvailable=false;const valid=captureSheetContext({updater:true}),bytes=map.get(KEY),state=clone(useStore.getState().S),user=useStore.getState().user
 await expect(useStore.getState()[action]({valid,force:true})).rejects.toThrow(/lock is not available/)
 expect(map.get(KEY)).toBe(bytes);expect(useStore.getState().S).toEqual(state);expect(useStore.getState().user).toBe(user);expect(api.mock.calls.some(([path])=>path.startsWith('/api/logout'))).toBe(false)
})
for(const action of ['signOut','signOutAll'])for(const lock of ['acquireAuthLock','acquireSyncLock'] as const)it(`${action}: absent ${lock} fails closed before any request or local clearing`,async()=>{
 delete services[lock];api.mockResolvedValue({ok:true});const valid=captureSheetContext({updater:true}),bytes=map.get(KEY),user=useStore.getState().user
 await expect(useStore.getState()[action]({valid,force:true})).rejects.toThrow(/lock is not configured/)
 expect(map.get(KEY)).toBe(bytes);expect(useStore.getState().user).toBe(user);expect(api).not.toHaveBeenCalled()
})

for(const action of ['signOut','signOutAll'])it(`${action}: an unavailable exclusive auth lease fails closed even when the shared fallback works`,async()=>{
 services.acquireAuthLock=async()=>null;api.mockResolvedValue({ok:true});const valid=captureSheetContext({updater:true}),bytes=map.get(KEY),user=useStore.getState().user
 await expect(useStore.getState()[action]({valid,force:true})).rejects.toThrow(/lock is not available/)
 expect(map.get(KEY)).toBe(bytes);expect(useStore.getState().user).toBe(user);expect(api).not.toHaveBeenCalled()
})
for(const action of ['signOut','signOutAll'])it(`${action}: a profile switch during the exclusive lock probe aborts before any request`,async()=>{
 let release!:(unlock:()=>void)=>void;const unlock=vi.fn();services.acquireAuthLock=()=>new Promise(resolve=>{release=resolve})
 const valid=captureSheetContext({updater:true}),operation=useStore.getState()[action]({valid,force:true}),rejected=expect(operation).rejects.toThrow(/changed/)
 useStore.getState().update(s=>{s.activeEquipId='new-profile'},false);const bytes=map.get(KEY);release(unlock);await rejected
 expect(unlock).toHaveBeenCalledOnce();expect(map.get(KEY)).toBe(bytes);expect(api).not.toHaveBeenCalled();expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/))
})
