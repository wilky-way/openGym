import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {createSyncEngine,type AuthTransaction} from '../../src/store/sync-engine'
import {initialStoreState,DEF,KEY,clone} from '../../src/store/useStore'
const disposes:(()=>void)[]=[]
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))})
afterEach(()=>{disposes.splice(0).forEach(dispose=>dispose());vi.useRealTimers()})
function make(){
 const map=new Map([[KEY,JSON.stringify({...clone(DEF),workouts:[{id:'A-private',entries:[]}]})],['gym_owner','A'],['gym_user',JSON.stringify({id:'A'})]])
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 let state:any=initialStoreState(kv);const api=vi.fn(async()=>({ok:true})),unlock=vi.fn()
 const engine=createSyncEngine(patch=>{state={...state,...patch}},()=>state,{platform:{kv,server:{baseUrl:()=>''},nav:{href:()=> 'https://synthetic.example/'}} as any,api,acquireAuthLock:async()=>unlock,acquireSyncLock:async()=>()=>{},prompts:{toast:vi.fn(),askAddDeviceData:async()=>false}})
 state={...state,...engine.actions,ready:true};disposes.push(engine.dispose)
 const becomeB=()=>{map.set(KEY,JSON.stringify({...clone(DEF),workouts:[{id:'B-private',entries:[]}]}));map.set('gym_owner','B');map.set('gym_user',JSON.stringify({id:'B'}));state={...state,...initialStoreState(kv)}}
 return{get:()=>state,map,api,unlock,becomeB,begin:engine.actions.beginAuthTransaction as ()=>Promise<AuthTransaction>}
}
it('non-carrier-changing refusal releases its marker without assigning or quarantining the user',async()=>{
 const h=make(),before=new Map(h.map),user=h.get().user,state=h.get().S,index=h.get().index,tx=await h.begin()
 await expect(tx.commit(async()=>{throw Object.assign(new Error('last-way-in'),{status:409})},()=>true,{carrierUnchanged:true})).rejects.toThrow('last-way-in')
 expect(new Map([...h.map].filter(([key])=>key!=='gym_auth_unchanged'))).toEqual(new Map([...before].filter(([key])=>key!=='gym_auth_unchanged')));expect(h.get().user).toBe(user);expect(h.get().S).toBe(state);expect(h.get().index).toBe(index);expect(h.get().sync.held).toBe(false);expect(h.unlock).toHaveBeenCalledOnce()
})
it('non-carrier-changing success leaves owner, user and saved document untouched',async()=>{
 const h=make(),before=new Map(h.map),user=h.get().user,tx=await h.begin()
 expect(await tx.commit(async()=>user,()=>true,{carrierUnchanged:true})).toBe(user)
 expect(new Map([...h.map].filter(([key])=>key!=='gym_auth_unchanged'))).toEqual(new Map([...before].filter(([key])=>key!=='gym_auth_unchanged')));expect(h.get().user).toBe(user);expect(h.get().sync.held).toBe(false)
})
for(const failure of [false,true])it(`a late ${failure?'refusal':'reply'} preserves the owner established during a non-carrier transaction`,async()=>{
 const h=make(),tx=await h.begin();let answer!:(user:any)=>void,reject!:(e:Error)=>void
 const pending=tx.commit(()=>new Promise((resolve,no)=>{answer=resolve;reject=no}),()=>h.get().user?.id==='A',{carrierUnchanged:true})
 const result=failure?expect(pending).rejects.toThrow('refused'):expect(pending).resolves.toBeNull()
 h.becomeB();const bytes=h.map.get(KEY),user=h.get().user
 if(failure)reject(new Error('refused'));else answer({id:'A'});await result
 expect(h.map.get(KEY)).toBe(bytes);expect(h.map.get('gym_owner')).toBe('B');expect(h.get().user).toBe(user);expect(h.map.has('gym_auth_transaction')).toBe(false)
})
it('an owner change before a safe exchange aborts without quarantining or dispatching',async()=>{
 const h=make(),tx=await h.begin();h.becomeB();const before=new Map(h.map),user=h.get().user,exchange=vi.fn(async()=>({id:'A'}))
 expect(await tx.commit(exchange,()=>false,{carrierUnchanged:true})).toBeNull();before.delete('gym_auth_transaction')
 expect(exchange).not.toHaveBeenCalled();expect(new Map([...h.map].filter(([key])=>key!=='gym_auth_unchanged'))).toEqual(new Map([...before].filter(([key])=>key!=='gym_auth_unchanged')));expect(h.get().user).toBe(user)
})
it('a non-carrier transaction never removes a foreign auth marker on a late reply',async()=>{
 const h=make(),tx=await h.begin();let answer!:(u:any)=>void
 const pending=tx.commit(()=>new Promise(resolve=>{answer=resolve}),()=>true,{carrierUnchanged:true})
 h.becomeB();h.map.set('gym_auth_transaction','external-B-transaction');const before=new Map(h.map),user=h.get().user
 answer({id:'A'});expect(await pending).toBeNull();expect(new Map([...h.map].filter(([key])=>key!=='gym_auth_unchanged'))).toEqual(new Map([...before].filter(([key])=>key!=='gym_auth_unchanged')));expect(h.get().user).toBe(user);expect(h.get().sync.held).toBe(true)
})
it('the default carrier-changing lost-revoke response still quarantines and holds sync',async()=>{
 const h=make(),bytes=h.map.get(KEY),tx=await h.begin()
 await expect(tx.commit(async()=>{await h.api();throw Object.assign(new Error('current device revoke response lost'),{code:'device-revoked'})},()=>true)).rejects.toThrow('current device revoke')
 expect(h.get().user).toBeNull();expect(h.map.get('gym_auth_transaction')).toBe('quarantined');expect(h.map.get('gym_owner')).toBe('A');expect(h.map.get(KEY)).toBe(bytes);expect(h.get().sync.held).toBe(true)
 h.api.mockClear();await h.get().pushState();expect(h.api).not.toHaveBeenCalled()
})
