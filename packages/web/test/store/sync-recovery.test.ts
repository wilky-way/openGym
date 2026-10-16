import { expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createSyncEngine } from '../../src/store/sync-engine'
import { initialStoreState, DEF, KEY } from '../../src/store/useStore'
const copy = (v:any) => JSON.parse(JSON.stringify(v))
let disposes: (()=>void)[] = []
beforeEach(()=> {vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))})
afterEach(()=>{for(const d of disposes)d(); disposes=[];vi.useRealTimers()})
function make(map = new Map<string,string>(), deny = (key:string,value:string)=>false, api:any = async()=>({ok:true,rev:2})) {
 const kv = {get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{if(deny(k,v))throw Object.assign(new Error('quota'), {name:'QuotaExceededError'});map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 const toast=vi.fn()
 const platform:any = {kv,server:{baseUrl:()=>''},nav:{href:()=> 'https://synthetic.example/'}}
 let s:any = {...initialStoreState(kv),update(){}}
 const e = createSyncEngine((p:any)=>{s={...s,...p}},()=>s,{platform,api,prompts:{toast,askAddDeviceData:async()=>false}})
 s={...s,...e.actions,ready:true};disposes.push(e.dispose)
 return {get:()=>s,map,kv,toast}
}
it('a same-timestamp aside stays intact and the new corrupt copy uses a unique key',()=> {
 const key = KEY+'.corrupt-'+Date.now();const map=new Map([[KEY,'{new unreadable'],[key,'prior recoverable bytes']]);const h=make(map)
 h.get().update((s:any)=>{s.restSec=120},false)
 expect(map.get(key)).toBe('prior recoverable bytes')
 const next=map.get(KEY+'_corrupt_key')!;expect(next).not.toBe(key);expect(map.get(next)).toBe('{new unreadable')
})
it('quota-refused account stash blocks switching and preserves the prior unsynced workout',async()=> {
 const old={...copy(DEF),_ts:200,workouts:[{id:'only-local',d:'2026-10-13',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(old)],['gym_owner','old'],['gym_user',JSON.stringify({id:'old'})],['gym_dirty','1']])
 const h=make(map,k=>k==='gym_stash')
 expect(()=>h.get().setUser({id:'new'},{adopt:true})).toThrow(/switch was refused/)
 expect(h.get().S.workouts).toEqual(old.workouts);expect(map.get('gym_stash')).toBeUndefined()
 expect(JSON.parse(map.get(KEY)!).workouts).toEqual(old.workouts)
 expect(h.get().user).toBeNull();expect(map.get('gym_owner')).toBe('old')
 await Promise.resolve();expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/out of storage/))
})
it('quota-refused replay retains the sole durable running workout even after a successful PUT',async()=> {
 const server={...copy(DEF),_ts:100,workouts:[{id:'server-workout',entries:[]}]}
 const kept={...copy(DEF),_ts:50,active:{id:'only-active',entries:[]}}
 const all={'https://synthetic.example|old':{server:'https://synthetic.example',uid:'old',state:kept}}
 const map=new Map([[KEY,JSON.stringify(server)],['gym_owner','old'],['gym_user',JSON.stringify({id:'old'})],['gym_stash',JSON.stringify(all)]])
 const api=async(path:string,o:any)=>path==='/api/config'?{}:path==='/api/me'?{user:{id:'old'}}:o?.method==='PUT'?{ok:true,rev:2}:{state:copy(server),rev:1}
 const h=make(map,k=>k===KEY,api)
 await h.get().boot()
 expect(h.get().S.active.id).toBe('only-active');expect(JSON.parse(map.get(KEY)!).active).toBeNull();expect(JSON.parse(map.get('gym_stash')!)).toEqual(all)
 await Promise.resolve();expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/out of storage/))
})
it('Keep profile as is retains guest workouts and holds adoption if quota refuses the kept copy',async()=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'only-guest',entries:[]}]}
 const server={...copy(DEF),_ts:200,workouts:[{id:'server',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)]])
 const h=make(map,k=>k==='gym_stash',async()=>({state:copy(server),rev:1}))
 h.get().setUser({id:'new'},{adopt:true});await h.get().resumeAdoption()
 expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['only-guest']);expect(map.get('gym_stash')).toBeUndefined()
 expect(JSON.parse(map.get(KEY)!).workouts.map((w:any)=>w.id)).toEqual(['only-guest'])
 expect(h.get().sync.held).toBe(true)
 await Promise.resolve();expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/profile was not replaced/))
})
it('a delayed account A pull never persists or uploads under account B after Keep profile as is',async()=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'private-A',entries:[]}]}
 const b={...copy(DEF),_ts:200,workouts:[{id:'private-B',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_sync',JSON.stringify({rev:1,ts:100})]])
 let resolveOld:any;let reads=0;const uploads:any[]=[]
 const api=async(path:string,o:any)=> {
  if(o?.method==='PUT'){uploads.push(JSON.parse(o.body));return {ok:true,rev:3}}
  if(path==='/api/data' && ++reads===1)return await new Promise(r=>resolveOld=r)
  return {state:copy(b),rev:2}
 }
 const h=make(map,()=>false,api)
 const pulling=h.get().pullState()
 h.get().setUser({id:'B'},{adopt:true})
 resolveOld({state:{...copy(a),_ts:150},rev:2});await pulling
 expect(h.get().user.id).toBe('B');expect(h.get().S.workouts.map((w:any)=>w.id)).not.toContain('private-A')
 await h.get().resumeAdoption()
 expect(h.get().S.workouts.map((w:any)=>w.id)).not.toContain('private-A')
 expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['private-B'])
 expect(JSON.parse(map.get(KEY)!).workouts.map((w:any)=>w.id)).toEqual(['private-B'])
 expect(uploads.flatMap(x=>x.state.workouts.map((w:any)=>w.id))).not.toContain('private-A')
})
it.each([null,undefined])('K10 r1 missing-peer %s 409 removes an offloaded definition',async peer=> {
 const local={...copy(DEF),_ts:100,programmes:{version:1,definitions:[{id:'synthetic-offloaded',_ts:10}],cycles:[],offloaded:{'synthetic-offloaded':{versionId:'v',at:500}}}}
 const map=new Map([[KEY,JSON.stringify(local)],['gym_owner','old'],['gym_user',JSON.stringify({id:'old'})],['gym_sync',JSON.stringify({rev:3,ts:100})]])
 let puts=0;const h=make(map,()=>false,async()=>{if(++puts===1)throw Object.assign(new Error('409'),{status:409,data:{state:peer,rev:0}});return {ok:true,rev:1}})
 await h.get().pushState()
 expect(h.get().S.programmes.definitions.map((d:any)=>d.id)).not.toContain('synthetic-offloaded')
})
it('K10 r1 same-Reset 409 removes the obsolete offload marker',async()=> {
 const local={...copy(DEF),_ts:200,resetAt:100,programmes:{version:1,definitions:[],cycles:[],offloaded:{'synthetic-offloaded':{versionId:'v',at:50}}}}
 const remote={...copy(DEF),_ts:300,resetAt:100,programmes:{version:1,definitions:[],cycles:[]}}
 const map=new Map([[KEY,JSON.stringify(local)],['gym_owner','old'],['gym_user',JSON.stringify({id:'old'})],['gym_sync',JSON.stringify({rev:1,ts:200})]])
 let puts=0;const h=make(map,()=>false,async()=>{if(++puts===1)throw Object.assign(new Error('409'),{status:409,data:{state:remote,rev:2}});return {ok:true,rev:3}})
 await h.get().pushState()
 expect(h.get().S.programmes.offloaded?.['synthetic-offloaded']).toBeUndefined()
})
it('the reviewer delayed 409 reproducer cannot retry an A upload under B',async()=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'private-A',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_sync',JSON.stringify({rev:1,ts:100})]])
 let rejectOld:any;let calls=0;const uploads:any[]=[]
 const h=make(map,()=>false,async(path:string,o:any)=> {
  uploads.push({owner:map.get('gym_owner'),body:JSON.parse(o.body)})
  if(++calls===1) return await new Promise((r,j)=>rejectOld=j)
  return {ok:true,rev:3}
 })
 const pushing=h.get().pushState();h.get().setUser({id:'B'},{adopt:true})
 rejectOld(Object.assign(new Error('409'),{status:409,data:{state:{...copy(a),_ts:200},rev:2}}));await pushing
 expect(uploads).toHaveLength(1);expect(uploads[0].owner).toBe('A')
 expect(h.get().S.workouts.map((w:any)=>w.id)).not.toContain('private-A')
 expect(JSON.parse(map.get(KEY)!).workouts.map((w:any)=>w.id)).not.toContain('private-A')
 expect(h.get().sync.held).toBe(true)
})
it.each(['success','409','401','network'])('a delayed account A push %s cannot change or upload account B',async mode=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'private-A',entries:[]}]}
 const b={...copy(DEF),_ts:200,workouts:[{id:'private-B',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_sync',JSON.stringify({rev:1,ts:100})]])
 let resolveOld:any,rejectOld:any;const uploads:any[]=[]
 const api=async(path:string,o:any)=> {
  if(o?.method==='PUT'){
   uploads.push({uid:map.get('gym_owner'),body:JSON.parse(o.body)})
   if(uploads.length===1)return await new Promise((resolve,reject)=>{resolveOld=resolve;rejectOld=reject})
   return {ok:true,rev:3}
  }
  return {state:copy(b),rev:2}
 }
 const h=make(map,()=>false,api);const pushing=h.get().pushState()
 h.get().setUser({id:'B'},{adopt:true})
 await h.get().resumeAdoption()
 const saved=map.get(KEY),sync=map.get('gym_sync'),status=copy(h.get().sync)
 if(mode==='success')resolveOld({ok:true,rev:99,wid:'A-write'})
 else rejectOld(mode==='409'?Object.assign(new Error('conflict'),{status:409,data:{state:copy(a),rev:99}}):mode==='401'?Object.assign(new Error('auth'),{status:401}):new TypeError('Failed to fetch'))
 await pushing
 expect(map.get(KEY)).toBe(saved);expect(map.get('gym_sync')).toBe(sync);expect(h.get().sync).toEqual(status)
 expect(h.get().user.id).toBe('B');expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['private-B'])
 expect(uploads).toHaveLength(1);expect(uploads[0].uid).toBe('A')
 await h.get().pushState()
 expect(uploads.at(-1).uid).toBe('B');expect(uploads.at(-1).body.state.workouts.map((w:any)=>w.id)).toEqual(['private-B'])
})
it('a delayed pull from an earlier session of the same account is ignored',async()=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'session-one',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_sync',JSON.stringify({rev:1,ts:100})]])
 let resolveOld:any;const h=make(map,()=>false,async()=>await new Promise(r=>resolveOld=r))
 const pulling=h.get().pullState();h.get().setUser(null);h.get().setUser({id:'A'},{adopt:true})
 const saved=map.get(KEY);resolveOld({state:{...copy(a),workouts:[{id:'stale-session',entries:[]}]},rev:9});await pulling
 expect(map.get(KEY)).toBe(saved);expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['session-one']);expect(h.get().sync.held).toBe(true)
})
it('a quota-refused unique corrupt aside keeps both existing copies and the unreadable original',async()=> {
 const key=KEY+'.corrupt-'+Date.now(),raw='{new unreadable'
 const map=new Map([[KEY,raw],[key,'prior recoverable bytes']]);let refuse=true
 const h=make(map,k=>refuse && k.startsWith(KEY+'.corrupt-'))
 h.get().update((s:any)=>{s.restSec=120},false)
 expect(map.get(KEY)).toBe(raw);expect(map.get(key)).toBe('prior recoverable bytes');expect(map.get(KEY+'_corrupt_key')).toBeUndefined()
 await Promise.resolve();expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/out of storage/))
 refuse=false;h.get().update((s:any)=>{s.restSec=150},false)
 const next=map.get(KEY+'_corrupt_key')!;expect(next).not.toBe(key);expect(map.get(next)).toBe(raw);expect(map.get(key)).toBe('prior recoverable bytes')
})
it('a refused recovery pointer write is retried with a new aside key without overwriting the first copy',()=> {
 const raw='{new unreadable';const map=new Map([[KEY,raw]]);let refuse=true
 const h=make(map,k=>refuse && k===KEY+'_corrupt_key')
 h.get().update((s:any)=>{s.restSec=120},false)
 const first=KEY+'.corrupt-'+Date.now();expect(map.get(first)).toBe(raw);expect(map.get(KEY)).toBe(raw)
 refuse=false;h.get().update((s:any)=>{s.restSec=150},false)
 const next=map.get(KEY+'_corrupt_key')!;expect(next).not.toBe(first);expect(map.get(first)).toBe(raw);expect(map.get(next)).toBe(raw)
})
it.each([true,false])('quota refusal holds guest adoption even when the adoption marker write succeeds=%s',async markerWritable=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'only-guest',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)]]);const uploads:any[]=[]
 const h=make(map,k=>k==='gym_stash'||(!markerWritable && k==='gym_adopt'),async(path:string,o:any)=>{if(o?.method==='PUT')uploads.push(JSON.parse(o.body));return {state:null,rev:0}})
 h.get().setUser({id:'new'},{adopt:true})
 await expect(h.get().adoptProfile(async()=>false,{alwaysAsk:true})).rejects.toThrow(/replacement was refused/)
 expect(h.get().sync.held).toBe(true);expect(h.get().S.workouts).toEqual(guest.workouts);expect(map.get(KEY)).toBe(JSON.stringify(guest))
 await h.get().pushState();expect(uploads).toEqual([])
})
it('a delayed adoption answer from A never splits or adopts data after switching to B',async()=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest',entries:[]}]}
 const a={...copy(DEF),_ts:200,workouts:[{id:'private-A',entries:[]}]}
 const b={...copy(DEF),_ts:300,workouts:[{id:'private-B',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)]]);let answer:any;let asked:any
 const asking=new Promise(r=>asked=r),uploads:any[]=[]
 const h=make(map,()=>false,async(path:string,o:any)=>{if(o?.method==='PUT'){uploads.push(JSON.parse(o.body));return {ok:true,rev:4}};return {state:map.get('gym_owner')==='A'?copy(a):copy(b),rev:2}})
 h.get().setUser({id:'A'},{adopt:true})
 const adopting=h.get().adoptProfile(async()=>{asked();return await new Promise(r=>answer=r)})
 await asking;h.get().setUser({id:'B'},{adopt:true});const saved=map.get(KEY)
 answer(false);await adopting
 expect(map.get(KEY)).toBe(saved);expect(h.get().sync.held).toBe(true);expect(uploads).toEqual([])
 await h.get().resumeAdoption()
 expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['private-B']);expect(uploads.flatMap(x=>x.state.workouts.map((w:any)=>w.id))).not.toContain('private-A')
})
it('a refused account switch cannot upload the retained A profile using the already-changed B cookie',async()=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'private-A',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_dirty','1']]);const uploads:any[]=[]
 let auth='A';const h=make(map,k=>k==='gym_stash',async(path:string,o:any)=>{if(o?.method==='PUT')uploads.push({auth,body:JSON.parse(o.body)});return {ok:true,rev:2}})
 h.get().update((s:any)=>{s.restSec=120});const saved=map.get(KEY)
 auth='B';expect(()=>h.get().setUser({id:'B'},{adopt:true})).toThrow(/switch was refused/)
 await h.get().pushState();await vi.advanceTimersByTimeAsync(31000)
 expect(uploads).toEqual([]);expect(map.get(KEY)).toBe(saved);expect(map.get('gym_owner')).toBe('A');expect(h.get().user).toBeNull();expect(map.get('gym_user')).toBeUndefined()
})
it('a quota-refused kept copy retains the original before/later adoption split for retry',async()=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest-before',entries:[]}]}
 const server={...copy(DEF),_ts:200,workouts:[{id:'account-server',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)]]);let refuse=true;const uploads:any[]=[]
 const h=make(map,k=>refuse && k==='gym_stash',async(path:string,o:any)=>{if(o?.method==='PUT'){uploads.push(JSON.parse(o.body));return {ok:true,rev:2}}return {state:copy(server),rev:1}})
 h.get().setUser({id:'new'},{adopt:true});const pre=JSON.parse(map.get('gym_adopt')!).pre
 h.get().update((s:any)=>{s.workouts.push({id:'account-after',entries:[]})},false)
 await h.get().resumeAdoption();expect(JSON.parse(map.get('gym_adopt')!).pre).toEqual(pre)
 refuse=false;await h.get().resumeAdoption()
 expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['account-server','account-after']);expect(uploads.at(-1).state.workouts.map((w:any)=>w.id)).toEqual(['account-server','account-after'])
 const kept=Object.values(JSON.parse(map.get('gym_stash')!)) as any[];expect(kept[0].state.workouts.map((w:any)=>w.id)).toContain('guest-before')
})
it('a preservation failure from an obsolete adoption cannot hold or mark the newer account',async()=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest-before',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)]]);let h:any,switched=false
 h=make(map,()=>false,async()=>({state:{...copy(DEF),_ts:200,workouts:[{id:'account-server',entries:[]}]},rev:1}))
 h.get().setUser({id:'B'},{adopt:true})
 const set=h.kv.set;h.kv.set=(key:string,value:string)=>{
  if(key==='gym_stash' && !switched){switched=true;h.get().setUser({id:'C'});throw Object.assign(new Error('quota'),{name:'QuotaExceededError'})}
  set(key,value)
 }
 await h.get().resumeAdoption()
 expect(switched).toBe(true);expect(h.get().user.id).toBe('C');expect(h.get().sync.held).toBe(false);expect(map.get('gym_adopt')).toBeUndefined()
})
it.each(['pushState','pullState'])('an unavailable KV owner makes %s settle safely without a request and allows retry',async action=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'only-local',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})]]);const api=vi.fn(async()=>({ok:true,rev:2,state:copy(a)}));const h=make(map,()=>false,api)
 const get=h.kv.get;let refused=true;h.kv.get=(key:string)=>{if(refused && key==='gym_owner')throw new Error('read unavailable');return get(key)}
 await expect(h.get()[action]()).resolves.toBeUndefined();expect(api).not.toHaveBeenCalled();expect(h.get().sync.lastError.code).toBe('ownership-unavailable');expect(map.get(KEY)).toBe(JSON.stringify(a))
 refused=false;await h.get()[action]();expect(api).toHaveBeenCalled()
})
it('a 409 retry goes through the public push hold guard even without a session change',async()=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'only-local',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})]]);let rejectOld:any,answer:any,asked:any;const uploads:any[]=[]
 const asking=new Promise(r=>asked=r)
 const h=make(map,()=>false,async(path:string,o:any)=>{if(o?.method==='PUT'){uploads.push(JSON.parse(o.body));return await new Promise((r,j)=>rejectOld=j)}return {state:{...copy(DEF),_ts:200,workouts:[{id:'remote',entries:[]}]},rev:2}})
 const pushing=h.get().pushState()
 const adopting=h.get().adoptProfile(async()=>{asked();return await new Promise(r=>answer=r)})
 await asking;rejectOld(Object.assign(new Error('conflict'),{status:409,data:{state:{...copy(a),_ts:150},rev:9}}));await pushing
 expect(uploads).toHaveLength(1);expect(h.get().sync.held).toBe(true);expect(JSON.parse(map.get(KEY)!).workouts.map((w:any)=>w.id)).toEqual(['only-local'])
 answer(false);await adopting
 expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['remote']);expect(uploads).toHaveLength(1)
})
it.each([null,undefined])('K10 r1 consumes existing offload manifests through replay of a malformed stash peer %s',async peer=> {
 const local={...copy(DEF),_ts:100,workouts:[{id:'local',entries:[]}],programmes:{version:1,definitions:[{id:'offloaded',_ts:9999}],cycles:[],offloaded:{offloaded:{versionId:'v1',at:500}}}}
 const map=new Map([[KEY,JSON.stringify(local)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_stash',JSON.stringify({'https://synthetic.example|A':{uid:'A',server:'https://synthetic.example',state:peer}})]])
 const h=make(map,()=>false,async(path:string,o:any)=>path==='/api/config'?{}:path==='/api/me'?{user:{id:'A'}}:o?.method==='PUT'?{ok:true,rev:3}:{state:copy(local),rev:1})
 await h.get().boot();expect(h.get().S.programmes.definitions).toEqual([]);expect(h.get().S.programmes.offloaded.offloaded).toEqual({versionId:'v1',at:500});expect(map.get('gym_stash')).toBeUndefined()
})
it('a failed owner metadata write also revokes old-account uploads after the stash succeeded',async()=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'private-A',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_dirty','1']]);const uploads:any[]=[]
 const h=make(map,key=>key==='gym_owner_name',async(path:string,o:any)=>{if(o?.method==='PUT')uploads.push(JSON.parse(o.body));return {ok:true,rev:2}})
 expect(()=>h.get().setUser({id:'B',name:'New account'},{adopt:true})).toThrow(/quota/)
 await h.get().pushState();expect(uploads).toEqual([]);expect(h.get().user).toBeNull()
 expect(JSON.parse(map.get('gym_stash')!)['https://synthetic.example|A'].state.workouts.map((w:any)=>w.id)).toEqual(['private-A'])
})
it('an initially quota-refused adoption marker keeps the original split in memory through preservation failure and retry',async()=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest-before',entries:[]}]},server={...copy(DEF),_ts:200,workouts:[{id:'account-server',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)]]);let refused=true;const uploads:any[]=[]
 const h=make(map,key=>refused && (key==='gym_adopt'||key==='gym_stash'),async(path:string,o:any)=>{if(o?.method==='PUT'){uploads.push(JSON.parse(o.body));return {ok:true,rev:3}}return {state:copy(server),rev:2}})
 h.get().setUser({id:'A'},{adopt:true});expect(map.get('gym_adopt')).toBeUndefined()
 h.get().update((s:any)=>{s.workouts.push({id:'account-after',entries:[]})},false)
 await h.get().resumeAdoption();expect(h.get().sync.held).toBe(true);expect(uploads).toEqual([])
 refused=false;await h.get().resumeAdoption()
 expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['account-server','account-after']);expect(uploads.at(-1).state.workouts.map((w:any)=>w.id)).toEqual(['account-server','account-after'])
 expect((Object.values(JSON.parse(map.get('gym_stash')!)) as any[])[0].state.workouts.map((w:any)=>w.id)).toContain('guest-before')
})
it('an unreadable owner during a switch revokes A authentication after credentials have changed to B',async()=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'private-A',entries:[]}]},map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})]]),uploads:any[]=[]
 const h=make(map,()=>false,async(path:string,o:any)=>{if(o?.method==='PUT')uploads.push(JSON.parse(o.body));return {ok:true,rev:2}})
 const get=h.kv.get;h.kv.get=(key:string)=>{if(key==='gym_owner')throw new Error('read unavailable');return get(key)}
 expect(()=>h.get().setUser({id:'B'},{adopt:true})).toThrow(/read unavailable/)
 await h.get().pushState();expect(uploads).toEqual([]);expect(h.get().user).toBeNull();expect(map.get(KEY)).toBe(JSON.stringify(a));expect(map.get('gym_user')).toBe(JSON.stringify({id:'A'}))
})
