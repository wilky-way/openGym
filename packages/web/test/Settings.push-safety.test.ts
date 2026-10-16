// @vitest-environment happy-dom
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { configureClientIO, clientCapabilities } from '../src/lib/client-io'
import { createBrowserPlatform, browserServerEndpoint } from '../src/platform/browser'
import { createSyncEngine } from '../src/store/sync-engine'
import { useStore, initialStoreState, DEF, clone, KEY } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { settingsTarget, settingsUpdate } from '../src/lib/settings-target'
import { enablePush, disablePush, syncPushSubscription } from '../src/lib/push'
const api = vi.hoisted(()=>vi.fn())
vi.mock('../src/lib/api',()=>({api:(...args:any[])=>api(...args)}))
let map:Map<string,string>,dispose:()=>void,steps:Record<string,any>,reg:any,sub:any
let pause:string,answer:(value:any)=>void
const toast=vi.fn()
function deferred(name:string,value:any){return vi.fn(()=>name===pause?new Promise(resolve=>{answer=()=>resolve(value)}):Promise.resolve(value))}
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));vi.clearAllMocks();pause='';answer=undefined as any
 map=new Map([[KEY,JSON.stringify({...clone(DEF),workouts:[{id:'A-private',entries:[]} ]})],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})]])
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 const platform={...createBrowserPlatform(),kv,server:browserServerEndpoint(kv),info:{...createBrowserPlatform().info,canWebPush:true}}
 configureClientIO(platform);useStore.setState(initialStoreState(kv));const engine=createSyncEngine(p=>useStore.setState(p),useStore.getState,{platform,api:async()=>({state:clone(DEF),rev:1}),prompts:{toast,askAddDeviceData:async()=>false}});useStore.setState(engine.actions);dispose=engine.dispose;useUI.setState({toast})
 sub={endpoint:'https://synthetic.example/push',toJSON:()=>({endpoint:'https://synthetic.example/push'}),unsubscribe:deferred('unsubscribe',true),options:{applicationServerKey:new Uint8Array([9]).buffer}}
 reg={pushManager:{getSubscription:deferred('subscription',sub),subscribe:deferred('subscribe',sub)}}
 steps={permission:deferred('permission','granted'),ready:deferred('ready',reg),share:deferred('share',undefined),key:deferred('key',{key:'AQ'}),status:deferred('status',{subscribed:false})}
 configureClientIO(platform,{...clientCapabilities(),randomId:()=> 'synthetic-id',push:{supported:()=>true,permission:()=> 'granted',requestPermission:()=>steps.permission(),ready:()=>steps.ready(),shareDeviceId:()=>steps.share()}} as any)
 api.mockImplementation((path:string)=>path.includes('public-key')?steps.key():path.includes('status')?steps.status():Promise.resolve({ok:true}))
})
afterEach(()=>{dispose();vi.useRealTimers()})
for(const [kind,stage] of [
 ...['permission','ready','key','subscribe','share'].map(s=>['enable',s]),
 ...['ready','subscription','unsubscribe'].map(s=>['disable',s]),
 ...['ready','subscription','key','unsubscribe','subscribe','share','status'].map(s=>['sync',s]),
] as [string,string][]) it(`push ${kind}: A → B during ${stage} preserves real W07 bytes and drops later writes`,async()=>{
 pause=stage
 // The status branch requires a matching application key; the replacement branch differs.
 if(stage==='status')sub.options.applicationServerKey=new Uint8Array([1]).buffer
 const target=settingsTarget(),valid=()=>settingsUpdate(target)
 const operation=kind==='enable'?enablePush(valid):kind==='disable'?disablePush(valid):syncPushSubscription(valid)
 const rejected=expect(operation).rejects.toThrow(/target changed/)
 for(let n=0;n<60&&!answer;n++)await Promise.resolve()
 expect(answer).toBeTypeOf('function')
 useStore.getState().setUser({id:'B'},{adopt:{alwaysAsk:true}});useStore.getState().update(s=>{s.workouts=[{id:'B-private',entries:[]}];s.activeEquipId='B-profile'},false)
 const bytes=map.get(KEY),state=clone(useStore.getState().S),calls=api.mock.calls.length
 answer(undefined);await rejected
 expect(map.get(KEY)).toBe(bytes);expect(useStore.getState().S).toEqual(state);expect(useStore.getState().user?.id).toBe('B');expect(api.mock.calls.length).toBe(calls)
 expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/))
})
