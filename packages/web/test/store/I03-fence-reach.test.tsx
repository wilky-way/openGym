// @vitest-environment happy-dom
// Copied from the RM Opus reachable quota probe packet.
import {it,expect,vi,afterEach} from 'vitest'
import {initializeStore,useStore,DEF,clone,KEY} from '../../src/store/useStore'
import {initializeSyncEngine} from '../../src/store/sync-engine'
import {createBrowserPlatform,browserServerEndpoint} from '../../src/platform/browser'
import {configureClientIO} from '../../src/lib/client-io'
let dispose=()=>{}
afterEach(()=>dispose())
it('tag write fails once at sign-out; next sign-in + reboot',async()=>{
 const doc={...clone(DEF),workouts:[{id:'b1',d:'2026-10-01',entries:[]}]}
 const map=new Map<string,string>([[KEY,JSON.stringify(doc)],['gym_owner','B'],['gym_user',JSON.stringify({id:'B'})],['gym_state_owner','B']])
 let failTag=false;const reload=vi.fn()
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{if(failTag&&k==='gym_state_owner'){failTag=false;throw new DOMException('quota','QuotaExceededError')};map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 const base=createBrowserPlatform(),platform={...base,kv,server:browserServerEndpoint(kv),nav:{...base.nav,reload}}
 const start=()=>{configureClientIO(platform);initializeStore(platform);dispose=initializeSyncEngine({platform,api:async()=>({}),prompts:{toast:()=>{},askAddDeviceData:async()=>false}})}
 start();failTag=true;await useStore.getState().signOut({force:true})
 try{useStore.getState().setUser({id:'A'},{adopt:{alwaysAsk:false}})}catch{}
 dispose();reload.mockClear();start();expect(reload.mock.calls.length).toBe(0)
})
