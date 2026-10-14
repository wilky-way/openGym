import { expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createSyncEngine } from '../../src/store/sync-engine'
import { initialStoreState, DEF, KEY } from '../../src/store/useStore'
const copy = (v:any) => JSON.parse(JSON.stringify(v))
let disposes: (()=>void)[] = []
beforeEach(()=> {vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))})
afterEach(()=>{for(const d of disposes)d(); disposes=[];vi.useRealTimers()})
function make(map = new Map<string,string>(), deny = (key:string,value:string)=>false, api:any = async()=>({ok:true,rev:2}), ask = async (_extras:any)=>false) {
 const subscriptions=new Set<(key:string|null)=>void>()
 const kv = {get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{if(deny(k,v))throw new Error('quota');map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:(f:(key:string|null)=>void)=>{subscriptions.add(f);return()=>{subscriptions.delete(f)}}}
 const platform:any = {kv,server:{baseUrl:()=>''},nav:{href:()=> 'https://synthetic.example/'}}
 let s:any = {...initialStoreState(kv),update(){}}
 const toast=vi.fn()
 const e = createSyncEngine((p:any)=>{s={...s,...p}},()=>s,{platform,api,prompts:{toast,askAddDeviceData:ask}})
 s={...s,...e.actions,ready:true};disposes.push(e.dispose)
 return {get:()=>s,map,kv,toast,dispose:e.dispose,emit:(key:string|null)=>{for(const f of subscriptions)f(key)}}
}
it('a refused adoption marker leaves guest ownership intact and re-asks after reload',async()=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest-private',entries:[]}]},server={...copy(DEF),_ts:200,workouts:[{id:'account-server',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)]]);let refused=true;const uploads:any[]=[]
 const api=async(path:string,o:any)=>path==='/api/config'?{}:path==='/api/me'?{user:{id:'A'}}:o?.method==='PUT'?(uploads.push(JSON.parse(o.body)),{ok:true,rev:3}):{state:copy(server),rev:2}
 const h=make(map,key=>refused && (key==='gym_adopt'||key==='gym_stash'),api)
 h.get().setUser({id:'A'},{adopt:true});h.get().update((s:any)=>{s.workouts.push({id:'account-after',entries:[]})},false)
 await h.get().resumeAdoption(async()=>false)
 expect(h.get().sync.held).toBe(true);expect(uploads).toEqual([]);expect(map.get('gym_adopt')).toBeUndefined();expect(map.get('gym_owner')).toBeUndefined();expect(map.get('gym_user')).toBeUndefined()
 h.dispose();refused=false
 const h2=make(map,()=>false,api);await h2.get().boot()
 await h2.get().resumeAdoption(async()=>false)
 expect(map.get('gym_owner')).toBe('A');expect(JSON.parse(map.get('gym_user')!).id).toBe('A')
 expect(uploads.flatMap(x=>x.state.workouts.map((w:any)=>w.id))).not.toContain('guest-private')
 expect(h2.get().S.workouts.map((w:any)=>w.id)).toEqual(['account-server'])
 expect((Object.values(JSON.parse(map.get('gym_stash')!)) as any[])[0].state.workouts.map((w:any)=>w.id)).toContain('guest-private')
})
it('a quarantined unreadable-owner switch recovers by signing in after reads work again',async()=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'A-private',entries:[]}]},b={...copy(DEF),_ts:200,workouts:[{id:'B-private',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})]]),uploads:any[]=[]
 const h=make(map,()=>false,async(path:string,o:any)=>o?.method==='PUT'?(uploads.push(JSON.parse(o.body)),{ok:true,rev:3}):{state:copy(b),rev:2})
 const get=h.kv.get;let refused=true;h.kv.get=(k:string)=>{if(refused && k==='gym_owner')throw new Error('unreadable owner');return get(k)}
 expect(()=>h.get().setUser({id:'B'},{adopt:true})).toThrow();expect(h.get().user).toBeNull();await h.get().pushState();expect(uploads).toEqual([])
 expect(map.get(KEY)).toBe(JSON.stringify(a));refused=false
 h.get().setUser({id:'B'},{adopt:true});await h.get().resumeAdoption()
 expect(h.get().user.id).toBe('B');expect(h.get().sync.held).toBe(false);expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['B-private'])
 expect(JSON.parse(map.get('gym_stash')!)['https://synthetic.example|A'].state.workouts.map((w:any)=>w.id)).toEqual(['A-private'])
})
it('unwritable adoption marker and stash settle repeated retries, then recover in the same instance',async()=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest-before',entries:[]}]},server={...copy(DEF),_ts:200,workouts:[{id:'account-server',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)]]);let refused=true;const uploads:any[]=[];let reads=0,asks=0
 const h=make(map,key=>refused && (key==='gym_adopt'||key==='gym_stash'),async(path:string,o:any)=>o?.method==='PUT'?(uploads.push(JSON.parse(o.body)),{ok:true,rev:3}):(reads++,{state:copy(server),rev:2}))
 h.get().setUser({id:'A'},{adopt:true});h.get().update((s:any)=>{s.workouts.push({id:'account-after',entries:[]})},false)
 for(let i=0;i<5;i++)await h.get().resumeAdoption(async()=>{asks++;return false})
 expect(asks).toBe(5);expect(reads).toBe(10);expect(uploads).toEqual([]);expect(h.get().sync.held).toBe(true)
 refused=false;await h.get().resumeAdoption(async()=>false)
 expect(h.get().sync.held).toBe(false);expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['account-server','account-after'])
 expect(uploads.at(-1).state.workouts.map((w:any)=>w.id)).toEqual(['account-server','account-after'])
 expect((Object.values(JSON.parse(map.get('gym_stash')!)) as any[])[0].state.workouts.map((w:any)=>w.id)).toContain('guest-before')
})
it('boot on unreadable ownership settles locally with a recovery message and permits safe re-sign-in',async()=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'only-local',entries:[]}]},map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})]])
 const api=vi.fn(async (path:string)=>path==='/api/config'?{}:path==='/api/me'?{user:{id:'B'}}:{state:{...copy(DEF),workouts:[{id:'B-private',entries:[]}]},rev:2})
 const h=make(map,()=>false,api)
 const get=h.kv.get;let refused=true;h.kv.get=(k:string)=>{if(refused && k==='gym_owner')throw new Error('read unavailable');return get(k)}
 // the standalone harness normally starts ready; explicitly model fresh shell boot.
 const original=h.get();original.ready=false
 await h.get().boot();await h.get().pushState()
 expect(h.get().ready).toBe(true);expect(h.get().user).toBeNull();expect(h.get().sync.held).toBe(true)
 expect(map.get(KEY)).toBe(JSON.stringify(a));expect(api).not.toHaveBeenCalled()
 expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/restore storage access and sign in again/))
 refused=false;h.get().setUser({id:'B'},{adopt:true});await h.get().resumeAdoption()
 expect(h.get().user.id).toBe('B');expect(h.get().sync.held).toBe(false)
 expect(JSON.parse(map.get('gym_stash')!)['https://synthetic.example|A'].state.workouts.map((w:any)=>w.id)).toEqual(['only-local'])
})
it('boot holds unclaimed guest data until a renewed adoption answer resolves',async()=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest-private',entries:[]}]},server={...copy(DEF),_ts:200,workouts:[{id:'account-server',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)]]),uploads:any[]=[];let answer!:(v:boolean)=>void
 const ask=vi.fn(async()=>await new Promise<boolean>(r=>{answer=r}))
 const api=async(path:string,o:any)=>path==='/api/config'?{}:path==='/api/me'?{user:{id:'A'}}:o?.method==='PUT'?(uploads.push(JSON.parse(o.body)),{ok:true,rev:3}):{state:copy(server),rev:2}
 const h=make(map,()=>false,api,ask);await h.get().boot()
 expect(ask).toHaveBeenCalledTimes(1);expect(h.get().sync.held).toBe(true)
 await h.get().pushState();await h.get().pullState();expect(uploads).toEqual([])
 answer(false);await h.get().resumeAdoption()
 expect(h.get().sync.held).toBe(false);expect(map.get('gym_adopt')).toBeUndefined()
 expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['account-server'])
 expect(uploads.flatMap(x=>x.state.workouts.map((w:any)=>w.id))).not.toContain('guest-private')
})
it.each([false,true])('an unwritable adoption marker keeps guest ownership and prevents uploads even when Add them=%s',async add=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest-private',entries:[]}]},server={...copy(DEF),_ts:200,workouts:[{id:'account-server',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)],['gym_guest','1']]),uploads:any[]=[]
 const h=make(map,k=>k==='gym_adopt',async(_path:string,o:any)=>o?.method==='PUT'?(uploads.push(JSON.parse(o.body)),{ok:true,rev:3}):{state:copy(server),rev:2})
 h.get().setUser({id:'A'},{adopt:true});await h.get().resumeAdoption(async()=>add)
 expect(h.get().sync.held).toBe(true);await h.get().pushState();expect(uploads).toEqual([])
 expect(map.get('gym_owner')).toBeUndefined();expect(map.get('gym_user')).toBeUndefined();expect(map.get('gym_guest')).toBe('1')
 expect(map.get(KEY)).toBe(JSON.stringify(guest))
})
it.each([null, 'B'])('boot re-asks a saved guest-tagged copy despite account metadata and an adoption marker for %s',async oldUid=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest-private',entries:[]}]},server={...copy(DEF),_ts:200,workouts:[{id:'account-server',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_state_owner','']]),uploads:any[]=[]
 if(oldUid)map.set('gym_adopt',JSON.stringify({uid:oldUid,rejoined:false,pre:{workouts:['guest-private'],bodyweight:[],customEx:[]}}))
 const ask=vi.fn(async()=>false)
 const api=async(path:string,o:any)=>path==='/api/config'?{}:path==='/api/me'?{user:{id:'A'}}:o?.method==='PUT'?(uploads.push(JSON.parse(o.body)),{ok:true,rev:3}):{state:copy(server),rev:2}
 const h=make(map,()=>false,api,ask);expect(h.get().sync.held).toBe(true)
 await h.get().pushState();expect(uploads).toEqual([])
 await h.get().boot();await h.get().resumeAdoption()
 expect(ask).toHaveBeenCalledTimes(1);expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['account-server'])
 expect(uploads.flatMap(x=>x.state.workouts.map((w:any)=>w.id))).not.toContain('guest-private')
})
it.each(['{bad',JSON.stringify({uid:'A'}),JSON.stringify({uid:'A',pre:null}),JSON.stringify({uid:'A',rejoined:'false',pre:{workouts:[],bodyweight:[],customEx:[]}})])('boot holds and re-asks an incomplete adoption marker %s',async mark=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest-private',entries:[]}]},server={...copy(DEF),_ts:200,workouts:[{id:'account-server',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_adopt',mark]]),uploads:any[]=[]
 const ask=vi.fn(async()=>false)
 const api=async(path:string,o:any)=>path==='/api/config'?{}:path==='/api/me'?{user:{id:'A'}}:o?.method==='PUT'?(uploads.push(JSON.parse(o.body)),{ok:true,rev:3}):{state:copy(server),rev:2}
 const h=make(map,()=>false,api,ask);expect(h.get().sync.held).toBe(true);await h.get().boot();await h.get().resumeAdoption()
 expect(ask).toHaveBeenCalledTimes(1);expect(h.get().S.workouts.map((w:any)=>w.id)).toEqual(['account-server'])
 expect(uploads.flatMap(x=>x.state.workouts.map((w:any)=>w.id))).not.toContain('guest-private')
})
it.each(['{bad',JSON.stringify({uid:'A'}),'unreadable'])('a peer tab cannot authenticate or upload with an incomplete adoption marker %s',async mark=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest-private',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)]]),uploads:any[]=[]
 const h=make(map,()=>false,async(_path:string,o:any)=>o?.method==='PUT'?(uploads.push(JSON.parse(o.body)),{ok:true,rev:3}):{state:copy(guest),rev:2})
 map.set('gym_owner','A');map.set('gym_user',JSON.stringify({id:'A'}));map.set('gym_state_owner','A');map.set('gym_state_wid','peer-write')
 map.set('gym_sync',JSON.stringify({rev:2,ts:100}));map.set('gym_dirty','1');map.set('gym_adopt',mark)
 if(mark==='unreadable'){const get=h.kv.get;h.kv.get=(k:string)=>{if(k==='gym_adopt')throw new Error('unreadable marker');return get(k)}}
 h.emit('gym_owner');h.emit('gym_sync');await h.get().pushState()
 expect(h.get().user).toBeNull();expect(uploads).toEqual([])
 expect(JSON.parse(map.get(KEY)!).workouts.map((w:any)=>w.id)).toEqual(['guest-private'])
})
it('a refused replacement save retains the adoption marker across reload even after the guest stash succeeds',async()=> {
 const guest={...copy(DEF),_ts:100,workouts:[{id:'guest-private',entries:[]}]},server={...copy(DEF),_ts:200,workouts:[{id:'account-server',entries:[]}]}
 const map=new Map([[KEY,JSON.stringify(guest)]]),uploads:any[]=[]
 const api=async(path:string,o:any)=>path==='/api/config'?{}:path==='/api/me'?{user:{id:'A'}}:o?.method==='PUT'?(uploads.push(JSON.parse(o.body)),{ok:true,rev:3}):{state:copy(server),rev:2}
 const h=make(map,k=>k===KEY,api);h.get().setUser({id:'A'},{adopt:true});await h.get().resumeAdoption()
 expect(h.get().sync.held).toBe(true);expect(map.get('gym_adopt')).toBeDefined()
 expect(JSON.parse(map.get(KEY)!).workouts.map((w:any)=>w.id)).toEqual(['guest-private']);h.dispose()
 const ask=vi.fn(async()=>false),h2=make(map,()=>false,api,ask);await h2.get().boot();await h2.get().resumeAdoption()
 expect(ask).toHaveBeenCalledTimes(1);expect(h2.get().sync.held).toBe(false)
 expect(uploads.flatMap(x=>x.state.workouts.map((w:any)=>w.id))).not.toContain('guest-private')
})
it('same-ms recovery reinit and failed pointer allocate distinct unused aside copies',()=> {
 const raw='{new unreadable',key=KEY+'.corrupt-'+Date.now(),map=new Map([[KEY,raw],[key,'older untracked payload']])
 const h=make(map,k=>k===KEY+'_corrupt_key');h.get().update((s:any)=>{s.restSec=120},false);h.dispose()
 expect(map.get(key+'-1')).toBe(raw);expect(map.get(KEY)).toBe(raw)
 const h2=make(map,k=>k===KEY+'_corrupt_key');h2.get().update((s:any)=>{s.restSec=150},false);h2.dispose()
 expect(map.get(key)).toBe('older untracked payload');expect(map.get(key+'-1')).toBe(raw);expect(map.get(key+'-2')).toBe(raw)
 const h3=make(map);h3.get().update((s:any)=>{s.restSec=180},false)
 expect(map.get(KEY+'_corrupt_key')).toBe(key+'-3');expect(map.get(key+'-1')).toBe(raw);expect(map.get(key+'-2')).toBe(raw)
})
it('stash replay with failed local save and failed PUT survives reload and later durable replay',async()=> {
 const server={...copy(DEF),_ts:100,workouts:[{id:'server',entries:[]}]},kept={...copy(DEF),_ts:50,workouts:[{id:'kept-unsynced',entries:[]}],active:{id:'only-active',entries:[]}}
 const all={'https://synthetic.example|A':{server:'https://synthetic.example',uid:'A',state:kept}},map=new Map([[KEY,JSON.stringify(server)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_stash',JSON.stringify(all)]])
 let refused=true;const api=async(path:string,o:any)=>path==='/api/config'?{}:path==='/api/me'?{user:{id:'A'}}:o?.method==='PUT'?(refused?Promise.reject(new Error('offline')):{ok:true,rev:3}):{state:copy(server),rev:2}
 const h=make(map,k=>refused && k===KEY,api);await h.get().boot();expect(JSON.parse(map.get('gym_stash')!)).toEqual(all);h.dispose()
 refused=false;const h2=make(map,()=>false,api);await h2.get().boot()
 expect(h2.get().S.active.id).toBe('only-active');expect(JSON.parse(map.get(KEY)!).active.id).toBe('only-active');expect(h2.get().S.workouts.map((w:any)=>w.id)).toContain('kept-unsynced');expect(map.get('gym_stash')).toBeUndefined()
})
it('refused stash during boot quarantines authentication and settles with recovery guidance',async()=> {
 const a={...copy(DEF),_ts:100,workouts:[{id:'only-local',entries:[]}]},map=new Map([[KEY,JSON.stringify(a)],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_dirty','1']])
 const h=make(map,k=>k==='gym_stash',async (path:string)=>path==='/api/config'?{}:path==='/api/me'?{user:{id:'B'}}:{state:copy(DEF),rev:2})
 h.get().ready=false;await h.get().boot();expect(h.get().ready).toBe(true);expect(h.get().user).toBeNull();expect(map.get(KEY)).toBe(JSON.stringify(a))
 await h.get().boot();expect(h.get().ready).toBe(true);expect(map.get(KEY)).toBe(JSON.stringify(a));expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/free some storage and sign in again/i))
})
