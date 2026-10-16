import { browserAuthLock, browserSyncLock } from '../../src/platform/auth-lock'
import { afterEach, expect, it, vi } from 'vitest'
import { createSyncEngine, type AcquireAuthLock } from '../../src/store/sync-engine'
import { initialStoreState, DEF, KEY } from '../../src/store/useStore'
const copy = (v: unknown) => JSON.parse(JSON.stringify(v))
const disposes: (() => void)[] = []
afterEach(() => { disposes.splice(0).forEach(dispose => dispose()) })
function lock(): AcquireAuthLock & {sync: AcquireAuthLock} {
  let held = false, readers = 0
  const exclusive: AcquireAuthLock = async () => { if (held || readers) return null; held = true; return () => { held = false } }
  const shared: AcquireAuthLock = async () => { if (held) return null; readers++; return () => { readers-- } }
  return Object.assign(exclusive, {sync:shared})
}
function make(acquireAuthLock = lock(), map = new Map<string, string>(), carrier = { uid: 'A' }, bus?: Map<symbol, Set<(key:string)=>void>>) {
  if (!map.size) {
    map.set(KEY, JSON.stringify({...copy(DEF), workouts: [{id:'private-A',entries:[]}]}))
    map.set('gym_owner', 'A'); map.set('gym_user', JSON.stringify({id:'A'})); map.set('gym_dirty', '1')
  }
  const instance=Symbol(), subscriptions=new Set<(key:string)=>void>();bus?.set(instance,subscriptions)
  const broadcast=(key:string)=>{for(const [tab,listeners] of bus??[]) if(tab!==instance) for(const listener of listeners) queueMicrotask(()=>listener(key))}
  const kv = {get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v);broadcast(k)},remove:(k:string)=>{map.delete(k);broadcast(k)},subscribe:(listener:(key:string)=>void)=>{subscriptions.add(listener);return()=>subscriptions.delete(listener)}}
  const uploads: {carrier: string; body: unknown}[] = []
  const api = vi.fn(async (path: string, options?: RequestInit) => {
    if (options?.method === 'PUT') uploads.push({carrier:carrier.uid, body:JSON.parse(String(options.body))})
    return {state:copy(DEF), rev:1}
  })
  let state: any = {...initialStoreState(kv), update(){}}
  const engine = createSyncEngine(patch => { state = {...state, ...patch} }, () => state, {
    platform: {kv, server:{baseUrl:()=>''},nav:{href:()=> 'https://synthetic.example/'}} as any,
    acquireAuthLock, acquireSyncLock:acquireAuthLock.sync, api, prompts:{toast:vi.fn(),askAddDeviceData:async()=>false},
  })
  state = {...state, ...engine.actions, ready:true}; disposes.push(engine.dispose)
  return {get:()=>state,map,kv,uploads,api,carrier,begin:engine.actions.beginAuthTransaction}
}
it('a discarded verification never changes the cookie or uploads', async () => {
  const h = make(), transaction = await h.begin(), exchange = vi.fn(async () => { h.carrier.uid='B'; return {id:'B'} })
  expect(await transaction.commit(exchange, () => false)).toBeNull()
  expect(exchange).not.toHaveBeenCalled(); expect(h.carrier.uid).toBe('A'); expect(h.get().user.id).toBe('A')
  expect(h.uploads).toEqual([])
})
it('cancellation after cookie installation quarantines the old owner and blocks every sync path', async () => {
  const h = make(), transaction = await h.begin(); let answer!: (u: {id:string}) => void; let live=true
  const committing = transaction.commit(() => new Promise(resolve => { h.carrier.uid='B'; answer=resolve }), () => live, {adopt:{alwaysAsk:true}})
  await h.get().pushState(); await h.get().pullState(); await h.get().syncNow(); expect(h.api).not.toHaveBeenCalled()
  live=false; answer({id:'B'}); expect(await committing).toBeNull()
  expect(h.get().user).toBeNull(); expect(h.get().sync.held).toBe(true); expect(h.map.get('gym_owner')).toBe('A')
  await h.get().resumeAdoption(); await h.get().pushState(); await h.get().pullState(); await h.get().syncNow()
  expect(h.uploads).toEqual([]); expect(JSON.parse(h.map.get(KEY)!).workouts[0].id).toBe('private-A')
})
it('cancellation during bearer persistence quarantines, including after restart', async () => {
  const h=make(), transaction=await h.begin(); let stored!: () => void; let live=true
  const committing=transaction.commit(async () => { h.carrier.uid='B'; await new Promise<void>(resolve => {stored=resolve}); return {id:'B'} },()=>live,{adopt:{alwaysAsk:true}})
  live=false; stored(); await committing
  const restarted=make(lock(),h.map,h.carrier); await restarted.get().boot(); await restarted.get().syncNow(); await restarted.get().pushState()
  expect(restarted.api).not.toHaveBeenCalled(); expect(restarted.uploads).toEqual([]); expect(restarted.get().user).toBeNull()
  expect(restarted.map.get('gym_owner')).toBe('A'); expect(restarted.get().S.workouts[0].id).toBe('private-A')
})
it('competing ceremonies in another tab are refused until the carrier exchange settles',async()=> {
  const acquire=lock(), bus=new Map<symbol,Set<(key:string)=>void>>(), first=make(acquire,undefined,undefined,bus), other=make(acquire,first.map,first.carrier,bus), transaction=await first.begin()
  await expect(first.begin()).rejects.toThrow(/in progress/); await expect(other.begin()).rejects.toThrow(/in progress/)
  await other.get().pushState(); expect(other.uploads).toEqual([])
  let answer!: (u:{id:string})=>void
  const pending=transaction.commit(()=>new Promise(resolve=>{answer=resolve}),()=>true,{adopt:{alwaysAsk:true}})
  transaction.cancel(); await expect(other.begin()).rejects.toThrow(/in progress/)
  first.carrier.uid='B';answer({id:'B'});await pending
  expect(first.get().user.id).toBe('B');expect(first.get().sync.held).toBe(true);expect(first.uploads).toEqual([])
  const next=await other.begin(); next.cancel()
})
it('a lost verify response stays quarantined even if the cookie was already installed',async()=> {
  const h=make(),transaction=await h.begin()
  await expect(transaction.commit(async()=>{h.carrier.uid='B';throw new Error('network')},()=>true)).rejects.toThrow('network')
  await h.get().pushState();expect(h.uploads).toEqual([]);expect(h.get().user).toBeNull();expect(h.get().sync.held).toBe(true)
})
it('quarantine requires new explicit authentication and durable adoption before sync resumes',async()=> {
  const h=make(),first=await h.begin()
  await expect(first.commit(async()=>{throw new Error('network')},()=>true)).rejects.toThrow()
  const next=await h.begin(); await next.commit(async()=>{h.carrier.uid='B';return {id:'B'}},()=>true,{adopt:{alwaysAsk:true}})
  expect(h.map.has('gym_auth_transaction')).toBe(false);expect(h.get().user.id).toBe('B');expect(h.get().sync.held).toBe(true)
  expect(JSON.parse(h.map.get('gym_adopt')!).alwaysAsk).toBe(true);await h.get().pushState();expect(h.uploads).toEqual([])
})
it('stale sign-out does not clear account B after the logout response arrives', async () => {
  const h=make();let answer!: (v: unknown)=>void
  h.api.mockImplementation(async (path: string) => path==='/api/logout' ? await new Promise(resolve=>{answer=resolve}) as any : {state:copy(DEF),rev:1})
  const leaving=h.get().signOut({force:true})
  for(let i=0;i<30 && !answer;i++)await Promise.resolve()
  expect(answer).toBeTypeOf('function')
  h.get().setUser({id:'B'},{adopt:{alwaysAsk:true}})
  h.get().update((document: any)=>{document.workouts=[{id:'private-B',entries:[]}]},false)
  const before=copy(h.get().S), saved=h.map.get(KEY)
  answer({ok:true});await expect(leaving).rejects.toThrow(/account changed/)
  expect(h.get().user.id).toBe('B');expect(h.get().S).toEqual(before);expect(h.map.get(KEY)).toBe(saved)
})
it('refuses authentication until another tab’s queued native PUT dispatches under its old carrier',async()=> {
  const leases=lock(), h=make(leases), other=make(leases,h.map,h.carrier);let dispatch!:()=>void
  other.api.mockImplementation(async (_path:string,options?:RequestInit)=>{
    if(options?.method==='PUT') { await new Promise<void>(resolve=>{dispatch=resolve});other.uploads.push({carrier:h.carrier.uid,body:JSON.parse(String(options.body))}) }
    return {state:copy(DEF),rev:1}
  })
  const pushing=other.get().pushState();await Promise.resolve();await Promise.resolve();expect(dispatch).toBeTypeOf('function')
  await expect(h.begin()).rejects.toThrow(/in progress/)
  dispatch();await pushing
  const transaction=await h.begin();await transaction.commit(async()=>{h.carrier.uid='B';return {id:'B'}},()=>true,{adopt:{alwaysAsk:true}})
  expect(other.uploads).toHaveLength(1);expect(other.uploads[0]?.carrier).toBe('A');expect(h.get().user.id).toBe('B')
})

it('passive tabs resume after successful authentication and adoption without uploading the former owner',async()=> {
  const leases=lock(),bus=new Map<symbol,Set<(key:string)=>void>>(), first=make(leases,new Map(),{uid:'A'},bus), other=make(leases,first.map,first.carrier,bus)
  const transaction=await first.begin();await transaction.commit(async()=>{first.carrier.uid='B';return {id:'B'}},()=>true,{adopt:{alwaysAsk:true}})
  await first.get().adoptProfile(async()=>false,{alwaysAsk:true})
  for(let i=0;i<30;i++)await Promise.resolve()
  expect(other.get().user?.id).toBe('B');expect(other.get().sync.held).toBe(false)
  other.api.mockClear();await other.get().syncNow();expect(other.api).toHaveBeenCalledWith('/api/data',undefined)
  other.get().update((document:any)=>{document.workouts=[{id:'private-B',entries:[]}]},false);await other.get().pushState()
  expect(other.uploads.length).toBeGreaterThan(0);expect(other.uploads.every(upload=>upload.carrier==='B')).toBe(true)
  expect(other.uploads.flatMap(upload=>(upload.body as any).state.workouts.map((workout:any)=>workout.id))).not.toContain('private-A')
})
it('does not install a new cookie before a delayed logout has finished changing the carrier',async()=> {
  const h=make();let answer!:(v:unknown)=>void
  h.api.mockImplementation(async(path:string)=>path==='/api/logout'?await new Promise(resolve=>{answer=resolve}) as any:{state:copy(DEF),rev:1})
  const leaving=h.get().signOut({force:true});for(let i=0;i<50&&!answer;i++)await Promise.resolve()
  expect(answer).toBeTypeOf('function');await expect(h.begin()).rejects.toThrow(/in progress/)
  answer({ok:true});await leaving
  const transaction=await h.begin();await transaction.commit(async()=>{h.carrier.uid='B';return {id:'B'}},()=>true,{adopt:{alwaysAsk:true}})
  expect(h.get().user.id).toBe('B');expect(h.carrier.uid).toBe('B')
})

it('a stale kept-copy callback never saves B workouts under account A',async()=> {
  const h=make();h.api.mockRejectedValue(new Error('offline'))
  const read=h.kv.get;let armed=true
  h.kv.get=(key:string)=>{
    const value=read(key)
    if(key==='gym_stash'&&armed){armed=false;queueMicrotask(()=>{
      h.get().setUser({id:'B'},{adopt:{alwaysAsk:true}})
      h.get().update((document:any)=>{document.workouts=[{id:'private-B',entries:[]}]},false)
    })}
    return value
  }
  await h.get().signOut({force:true}).catch(()=>{})
  expect(h.get().user.id).toBe('B');expect(JSON.parse(h.map.get(KEY)!).workouts[0].id).toBe('private-B')
  const kept=JSON.parse(h.map.get('gym_stash')||'{}')
  expect(JSON.stringify(Object.values(kept).filter((entry:any)=>entry.uid==='A'))).not.toContain('private-B')
})

it('unsupported host locks keep existing sync working and refuse new authentication',async()=> {
  const acquire=Object.assign(async()=>browserAuthLock(),{sync:browserSyncLock})
  const h=make(acquire);await h.get().pushState()
  expect(h.uploads).toHaveLength(1);expect(h.uploads[0]?.carrier).toBe('A')
  await expect(h.begin()).rejects.toThrow(/in progress/)
  await h.get().pullState();expect(h.api).toHaveBeenCalledWith('/api/data',undefined)
})

for(const dirty of [false,true])it(`pre-exchange cancel restores a passive ${dirty?'dirty':'no-base'} session without reload`,async()=>{
 const leases=lock(),bus=new Map<symbol,Set<(key:string)=>void>>()
 const map=new Map([[KEY,JSON.stringify({...copy(DEF),workouts:[{id:'private-A',entries:[]}]})],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})],['gym_state_owner','A'],['gym_state_wid','saved-A']])
 if(dirty)map.set('gym_dirty','1')
 const first=make(leases,map,{uid:'A'},bus),other=make(leases,first.map,first.carrier,bus),before=map.get(KEY),user=other.get().user,tx=await first.begin()
 for(let n=0;n<40;n++)await Promise.resolve();expect(other.get().user).toBeNull()
 tx.cancel();for(let n=0;n<40;n++)await Promise.resolve()
 expect(map.get(KEY)).toBe(before);expect(other.get().user).toBe(user);expect(other.get().sync.held).toBe(false);expect(map.has('gym_auth_transaction')).toBe(false)
 await other.get().syncNow();await other.get().pushState();expect(other.api).toHaveBeenCalled();expect(other.uploads.every(upload=>upload.carrier==='A')).toBe(true)
})
it('pre-exchange cancellation never replays an old document over edits made in the passive tab',async()=>{
 const leases=lock(),bus=new Map<symbol,Set<(key:string)=>void>>(),first=make(leases,new Map(),{uid:'A'},bus),other=make(leases,first.map,first.carrier,bus),tx=await first.begin()
 for(let n=0;n<40;n++)await Promise.resolve()
 other.get().update((draft:any)=>{draft.workouts.push({id:'during-hold',entries:[]})},false);const bytes=first.map.get(KEY)
 tx.cancel();for(let n=0;n<40;n++)await Promise.resolve()
 expect(first.map.get(KEY)).toBe(bytes);expect(other.get().S.workouts.some((w:any)=>w.id==='during-hold')).toBe(true);expect(other.get().user?.id).toBe('A')
})
it('cancel proof cannot restore A after the durable owner and record change to B',async()=>{
 const leases=lock(),bus=new Map<symbol,Set<(key:string)=>void>>(),first=make(leases,new Map(),{uid:'A'},bus),other=make(leases,first.map,first.carrier,bus),tx=await first.begin()
 for(let n=0;n<40;n++)await Promise.resolve()
 first.map.set('gym_owner','B');first.map.set('gym_user',JSON.stringify({id:'B'}));first.map.set(KEY,JSON.stringify({...copy(DEF),workouts:[{id:'private-B',entries:[]}]}));const bytes=first.map.get(KEY)
 tx.cancel();for(let n=0;n<40;n++)await Promise.resolve()
 expect(other.get().user).not.toEqual({id:'A'});expect(first.map.get(KEY)).toBe(bytes);await other.get().pushState();expect(other.uploads).toEqual([])
})
it('a failed unchanged-completion proof keeps passive auth quarantined and data durable',async()=>{
 const leases=lock(),bus=new Map<symbol,Set<(key:string)=>void>>(),first=make(leases,new Map(),{uid:'A'},bus),other=make(leases,first.map,first.carrier,bus),before=first.map.get(KEY),tx=await first.begin()
 for(let n=0;n<40;n++)await Promise.resolve()
 const set=first.kv.set;vi.spyOn(first.kv,'set').mockImplementation((key,value)=>{if(key==='gym_auth_unchanged')throw new Error('synthetic quota');set(key,value)})
 tx.cancel();for(let n=0;n<40;n++)await Promise.resolve()
 expect(first.map.get(KEY)).toBe(before);expect(other.get().user).toBeNull();expect(other.get().sync.held).toBe(true);expect(first.map.get('gym_auth_transaction')).toBe('quarantined');expect(other.uploads).toEqual([])
})
it('coalesced cancellation events cannot resume a passive session with another transaction proof',async()=>{
 const leases=lock(),bus=new Map<symbol,Set<(key:string)=>void>>(),first=make(leases,new Map(),{uid:'A'},bus),other=make(leases,first.map,first.carrier,bus),queue:(()=>void)[]=[]
 const listeners=[...bus.values()][1]!;const originals=[...listeners];listeners.clear();for(const listener of originals)listeners.add(key=>{queue.push(()=>listener(key))})
 const one=await first.begin();for(let n=0;n<40;n++)await Promise.resolve();queue.splice(0).forEach(deliver=>deliver());expect(other.get().user).toBeNull()
 one.cancel();const two=await first.begin();two.cancel();for(let n=0;n<40;n++)await Promise.resolve()
 const bytes=first.map.get(KEY);queue.splice(0).forEach(deliver=>deliver());expect(other.get().user).toBeNull();expect(first.map.get(KEY)).toBe(bytes)
})
it('a prior cancel proof cannot bypass the server-base requirement after a new carrier-changing ceremony',async()=>{
 const leases=lock(),bus=new Map<symbol,Set<(key:string)=>void>>(),first=make(leases,new Map(),{uid:'A'},bus),other=make(leases,first.map,first.carrier,bus)
 const one=await first.begin();one.cancel();for(let n=0;n<40;n++)await Promise.resolve()
 expect(first.map.has('gym_auth_unchanged')).toBe(true)
 const two=await first.begin();expect(first.map.has('gym_auth_unchanged')).toBe(false)
 await two.commit(async()=>({id:'A'}),()=>true);for(let n=0;n<40;n++)await Promise.resolve()
 expect(other.get().user).toBeNull();expect(first.map.has('gym_auth_unchanged')).toBe(false)
})

it('an unrelated active marker cannot resume a passive auth session', async () => {
 const leases=lock(),bus=new Map<symbol,Set<(key:string)=>void>>(),first=make(leases,new Map(),{uid:'A'},bus),other=make(leases,first.map,first.carrier,bus)
 const tx=await first.begin(); await vi.waitFor(()=>expect(other.get().user).toBeNull())
 first.map.set('gym_auth_unchanged','active-unrelated'); first.map.delete('gym_auth_transaction')
 for (const listener of [...bus.values()][1]!) listener('gym_auth_transaction')
 expect(other.get().user).toBeNull(); expect(other.uploads).toEqual([]); tx.cancel()
})
