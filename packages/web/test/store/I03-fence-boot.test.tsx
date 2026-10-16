// @vitest-environment happy-dom
// Copied from the RM Opus boot probe packet (scratch was removed after its first read).
import {it,expect,vi,afterEach} from 'vitest'
import {initializeStore,useStore,DEF,clone,KEY} from '../../src/store/useStore'
import {initializeSyncEngine} from '../../src/store/sync-engine'
import {createBrowserPlatform,browserServerEndpoint} from '../../src/platform/browser'
import {configureClientIO} from '../../src/lib/client-io'
const doc=()=>({...clone(DEF),workouts:[{id:'w1',d:'2026-10-01',entries:[]}]})
let dispose=()=>{}
afterEach(()=>dispose())
function boot(seed:Record<string,string>){
 const map=new Map(Object.entries(seed)),reload=vi.fn(),toast=vi.fn()
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 const base=createBrowserPlatform(),platform={...base,kv,server:browserServerEndpoint(kv),nav:{...base.nav,reload}}
 configureClientIO(platform);initializeStore(platform)
 let threw:unknown=null
 try{dispose=initializeSyncEngine({platform,api:async()=>({}),prompts:{toast,askAddDeviceData:async()=>false}})}catch(e){threw=e}
 let wrote=true
 if(!threw){useStore.getState().update(s=>{s.restSec=77});wrote=JSON.parse(map.get(KEY)||'{}').restSec===77}
 return{reload:reload.mock.calls.length,threw:threw?String(threw):null,wrote,user:useStore.getState().user?.id??null,held:useStore.getState().sync?.held}
}
const cases:Record<string,Record<string,string>>={
 'signed-in A, own copy':{[KEY]:JSON.stringify(doc()),gym_owner:'A',gym_user:JSON.stringify({id:'A'}),gym_state_owner:'A'},
 'signed-in A, guest copy awaiting adoption (tag "")':{[KEY]:JSON.stringify(doc()),gym_owner:'A',gym_user:JSON.stringify({id:'A'}),gym_state_owner:''},
 'signed-in A, copy tagged by previous account B':{[KEY]:JSON.stringify(doc()),gym_owner:'A',gym_user:JSON.stringify({id:'A'}),gym_state_owner:'B'},
 'signed-in A, legacy no tag':{[KEY]:JSON.stringify(doc()),gym_owner:'A',gym_user:JSON.stringify({id:'A'})},
 'gym_user A but no gym_owner (legacy pre-owner)':{[KEY]:JSON.stringify(doc()),gym_user:JSON.stringify({id:'A'})},
 'interrupted switch: owner A, user B':{[KEY]:JSON.stringify(doc()),gym_owner:'A',gym_user:JSON.stringify({id:'B'}),gym_state_owner:'A'},
 'guest, tag "" ':{[KEY]:JSON.stringify(doc()),gym_state_owner:''},
 'signed out, stale owner left':{[KEY]:JSON.stringify(doc()),gym_owner:'A',gym_state_owner:'A'},
}
for(const[name,seed]of Object.entries(cases))it(name,()=>{const r=boot(seed);expect(r.threw).toBeNull();expect(r.reload).toBe(0)})
