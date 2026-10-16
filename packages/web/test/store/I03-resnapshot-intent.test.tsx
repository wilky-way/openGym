// @vitest-environment happy-dom
import {it,expect,vi,afterEach} from 'vitest'
import {createSyncEngine} from '../../src/store/sync-engine'
import {initialStoreState,DEF,clone,KEY} from '../../src/store/useStore'
const drops:(()=>void)[]=[]
afterEach(()=>{drops.splice(0).forEach(f=>f());vi.useRealTimers()})
for(const kind of ['reset','import'])for(const replacement of [false,true])it(`re-snapshot ${kind}/${replacement} eventually replaces remote without resurrecting deleted rows`,async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
 const doc=(id:string,ts=100)=>({...clone(DEF),_ts:ts,_rev:1,_wid:'initial',active:null,workouts:[{id,d:'2026-10-13',_ts:ts,entries:[]}]})
 const map=new Map([[KEY,JSON.stringify(doc('old-local'))],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_state_owner','A'],['gym_state_wid','g1:initial'],['gym_state_instance','1'],['gym_sync',JSON.stringify({rev:1,ts:100,wid:'initial'})]])
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 let st:any=initialStoreState(kv),remote:any={...doc('old-server',Date.now()+86400000),_rev:7,_wid:'server-seven'},rev=7,block=false,unlock!:(release:()=>void)=>void,leases=0
 const puts:any[]=[]
 const api=vi.fn(async(path:string,options?:RequestInit)=>{
  if(options?.method!=='PUT'){
   if(kind==='reset')throw new Error('temporary offline while looking up reset ids')
   return{state:clone(remote),rev}
  }
  const b=JSON.parse(String(options.body));puts.push(clone(b))
  if(b.baseRev!=null&&b.baseRev!==rev)throw{status:409,data:{state:clone(remote),rev}}
  remote=clone(b.state);return{rev:++rev}
 })
 const platform:any={kv,server:{baseUrl:()=>''},nav:{href:()=> 'https://synthetic.example/',reload:()=>{}}}
 const engine=createSyncEngine(p=>{st={...st,...p}},()=>st,{platform,api,prompts:{toast:()=>{},askAddDeviceData:async()=>false},acquireSyncLock:async()=>block&&++leases===1?new Promise<()=>void>(r=>{unlock=r}):()=>{}})
 st={...st,...engine.actions,ready:true};drops.push(engine.dispose)
 let peer:any=initialStoreState(kv)
 const second=createSyncEngine(p=>{peer={...peer,...p}},()=>peer,{platform,api,prompts:{toast:()=>{},askAddDeviceData:async()=>false},acquireSyncLock:async()=>()=>{}})
 peer={...peer,...second.actions,ready:true};drops.push(second.dispose)
 if(kind==='reset')await st.resetEverything({durable:true})
 else {await st.importConflict(doc('backup'));st.importBackup(doc('backup'),{durable:true})}
 block=true;const pending=st.pushState();for(let i=0;i<40&&!unlock;i++)await Promise.resolve();expect(unlock).toBeTypeOf('function')
 // A second tab's real reset/import invalidates the first tab's queued document.
 if(replacement){if(kind==='reset')await peer.resetEverything({durable:true});else{await peer.importConflict(doc('backup'));peer.importBackup(doc('backup'),{durable:true})}}
 const expected=kind==='reset'?[]:['backup']
 unlock(()=>{});await pending;await peer.pushState()
 expect(remote.workouts.map((w:any)=>w.id)).toEqual(expected)
 // The import read revision 7; a fresh snapshot retains that exact replace intent.
 expect(puts[0].baseRev).toBe(kind==='import'?7:undefined)
 expect(puts.length).toBeLessThanOrEqual(5);expect(leases).toBeLessThanOrEqual(4)
})
it.each([['reset', 'import'], ['import', 'reset'], ['import', 'import']] as const)('a newer local %s → %s replacement supersedes the abandoned intent', async (first, next) => {
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
 const doc=(id:string)=>({...clone(DEF),_ts:100,_rev:1,_wid:'initial',active:null,workouts:[{id,entries:[]}]})
 const map=new Map([[KEY,JSON.stringify(doc('initial'))],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_state_owner','A'],['gym_state_wid','g1:initial'],['gym_state_instance','1']])
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 let st:any=initialStoreState(kv),unlock!:(release:()=>void)=>void,leases=0
 const puts:any[]=[]
 const engine=createSyncEngine(p=>{st={...st,...p}},()=>st,{platform:{kv,server:{baseUrl:()=>''},nav:{href:()=> 'https://synthetic.example/',reload:()=>{}}} as any,
  api:async(_path,options)=>{puts.push(JSON.parse(String(options!.body)));return{rev:10}},
  prompts:{toast:()=>{},askAddDeviceData:async()=>false},acquireSyncLock:async()=>++leases===1?new Promise<()=>void>(r=>{unlock=r}):()=>{}})
 st={...st,...engine.actions,ready:true};drops.push(engine.dispose)
 st.replaceState(doc('first'),true,first==='import'?{baseRev:7,baseWid:'read-seven'}:{})
 const pending=st.pushState();for(let i=0;i<40&&!unlock;i++)await Promise.resolve();expect(unlock).toBeTypeOf('function')
 st.replaceState(doc('newest'),true,next==='import'?{baseRev:9,baseWid:'read-nine'}:{})
 unlock(()=>{});await pending
 expect(puts).toHaveLength(1);expect(puts[0].state.workouts.map((w:any)=>w.id)).toEqual(['newest'])
 expect(puts[0].baseRev).toBe(next==='import'?9:undefined)
 expect(puts[0].baseWid).toBe(next==='import'?'read-nine':undefined)
})
it.each(['newer-reset', 'new-session'] as const)('a %s after the stale catch cannot reuse the abandoned import revision', async scenario => {
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
 const doc=(id:string)=>({...clone(DEF),_ts:100,_rev:1,_wid:'initial',active:null,workouts:[{id,entries:[]}]})
 const map=new Map([[KEY,JSON.stringify(doc('initial'))],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_state_owner','A'],['gym_state_wid','g1:initial'],['gym_state_instance','1']])
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 let st:any=initialStoreState(kv),peer:any=initialStoreState(kv),unlock!:(release:()=>void)=>void,entered!:()=>void,leases=0
 const waiting=new Promise<void>(r=>{entered=r}),puts:any[]=[]
 const platform:any={kv,server:{baseUrl:()=>''},nav:{href:()=> 'https://synthetic.example/',reload:()=>{}}}
 const api=async(_path:string,options?:RequestInit)=>{
  if(options?.method==='PUT'){const body=JSON.parse(String(options.body));puts.push({uid:st.user?.id,...body});return{rev:10}}
  return{state:null,rev:0}
 }
 const engine=createSyncEngine(p=>{st={...st,...p}},()=>st,{platform,api,prompts:{toast:()=>{},askAddDeviceData:async()=>false},acquireSyncLock:async()=>{if(++leases===1){entered();return new Promise<()=>void>(r=>{unlock=r})}return()=>{}}})
 st={...st,...engine.actions,ready:true};drops.push(engine.dispose)
 const second=createSyncEngine(p=>{peer={...peer,...p}},()=>peer,{platform,api,prompts:{toast:()=>{},askAddDeviceData:async()=>false}})
 peer={...peer,...second.actions,ready:true};drops.push(second.dispose)
 st.replaceState(doc('import-seven'),true,{baseRev:7,baseWid:'read-seven'})
 const pending=st.pushState();await waiting
 peer.replaceState(doc('peer-replacement'),false)
 unlock(()=>queueMicrotask(()=>queueMicrotask(()=>{
  if(scenario==='newer-reset')st.replaceState(doc('newest-reset'),true)
  else{st.setUser({id:'B'});st.replaceState(doc('B-profile'),false)}
 })))
 await pending
 if(scenario==='new-session')await st.pushState()
 expect(puts).toHaveLength(1);expect(puts[0].baseRev).toBeUndefined();expect(puts[0].baseWid).toBeUndefined()
 expect(puts[0].uid).toBe(scenario==='new-session'?'B':'A')
 expect(puts[0].state.workouts.map((w:any)=>w.id)).toEqual([scenario==='new-session'?'B-profile':'newest-reset'])
})
