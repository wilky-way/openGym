import React,{act} from 'react'
import {createRoot,type Root} from 'react-dom/client'
import OwnershipRecovery from '../../src/components/OwnershipRecovery'
// @vitest-environment happy-dom
import {beforeEach,afterEach,it,expect,vi} from 'vitest'
import {initializeStore,useStore,DEF,clone,KEY} from '../../src/store/useStore'
import {initializeSyncEngine} from '../../src/store/sync-engine'
import {createBrowserPlatform,browserServerEndpoint} from '../../src/platform/browser'
import {configureClientIO} from '../../src/lib/client-io'
const doc=(id='device-private')=>({...clone(DEF),workouts:[{id,entries:[]}],future:{retained:true}})
let dispose=()=>{}
const roots:Root[]=[]
globalThis.IS_REACT_ACT_ENVIRONMENT=true
beforeEach(()=>{sessionStorage.clear();vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))})
afterEach(()=>{act(()=>roots.splice(0).forEach(root=>root.unmount()));document.body.innerHTML='';dispose();vi.restoreAllMocks();vi.useRealTimers()})
function fixture(tag='B',owner='A',user='A') {
 const map=new Map([[KEY,JSON.stringify(doc())],['gym_owner',owner],['gym_user',JSON.stringify({id:user})],['gym_state_owner',tag]])
 const reload=vi.fn(),puts:any[]=[]
 const kv={get:(k:string)=>map.get(k)??null,set:(k:string,v:string)=>{map.set(k,v)},remove:(k:string)=>{map.delete(k)},subscribe:()=>()=>{}}
 const base=createBrowserPlatform(),platform={...base,kv,server:browserServerEndpoint(kv),nav:{...base.nav,reload}}
 const api=vi.fn(async(path:string,options?:RequestInit)=>{if(options?.method==='PUT'){puts.push(JSON.parse(options.body as string));return{rev:2}}if(path==='/api/me')return{user:{id:owner}};if(path==='/api/data')return{state:doc('server-only'),rev:1};return{}})
 const start=()=>{configureClientIO(platform);initializeStore(platform);dispose=initializeSyncEngine({platform,api,prompts:{toast:()=>{},askAddDeviceData:async()=>false}})}
 start();return{map,kv,reload,puts,api,start}
}
it.each(['A','B'])('partial tag boot stays held and keeps the device copy before taking the verified profile (%s)',user=>{
 return (async()=>{const f=fixture('B','A',user),before=f.map.get(KEY);expect(f.reload).not.toHaveBeenCalled();expect(useStore.getState().sync.held).toBe(true);await useStore.getState().boot();expect(f.api).not.toHaveBeenCalled();useStore.getState().update(s=>{s.restSec=77});expect(f.map.get(KEY)).toBe(before)
 const token=useStore.getState().sync.recovery.fingerprint
 expect(await useStore.getState().recoverOwnership('keep',token)).toBe(true)
 expect(useStore.getState().S.workouts.map((w:any)=>w.id)).toEqual(['server-only'])
 const stashes=JSON.parse(f.map.get('gym_stash')||'{}');expect(Object.values(stashes).some((x:any)=>x.state.workouts[0]?.id==='device-private'&&x.state.future.retained)).toBe(true)
 expect(f.puts.some(x=>x.state.workouts.some((w:any)=>w.id==='device-private'))).toBe(false)
 expect(useStore.getState().sync.recovery).toBeNull();useStore.getState().update(s=>{s.restSec=77},false);expect(useStore.getState().S.restSec).toBe(77)
 })()
})
it('sign-out works with persistent tag-write quota and keeps the original copy',async()=>{
 const f=fixture(),set=f.kv.set;f.kv.set=(k,v)=>{if(k==='gym_state_owner')throw new DOMException('quota','QuotaExceededError');set(k,v)}
 const token=useStore.getState().sync.recovery.fingerprint
 expect(await useStore.getState().recoverOwnership('signout',token)).toBe(true)
 expect(useStore.getState().user).toBeNull();expect(f.map.get('gym_owner')).toBeUndefined();expect(f.map.get('gym_state_owner')).toBeUndefined()
 expect(Object.values(JSON.parse(f.map.get('gym_stash')||'{}')).some((x:any)=>x.state.workouts[0]?.id==='device-private')).toBe(true)
 dispose();f.start();expect(f.reload).not.toHaveBeenCalled();expect(useStore.getState().sync.recovery).toBeUndefined()
})
it('a killed-between-primary-and-tag snapshot is recoverable without reloading',async()=>{
 const f=fixture();f.map.set(KEY,JSON.stringify(doc('saved-primary')));dispose();f.start();await useStore.getState().boot();expect(f.reload).not.toHaveBeenCalled();expect(f.api).not.toHaveBeenCalled();expect(useStore.getState().S.workouts[0].id).toBe('saved-primary');expect(useStore.getState().sync.recovery).toBeTruthy()
})
it('a runtime owner mismatch reloads once for the same fingerprint across rehydration',()=>{
 const f=fixture('A'),A=new Map(f.map)
 const B=()=>{f.map.set(KEY,JSON.stringify(doc('B-private')));f.map.set('gym_owner','B');f.map.set('gym_user',JSON.stringify({id:'B'}));f.map.set('gym_state_owner','B')}
 B();useStore.getState().update(s=>{s.restSec=77});expect(f.reload).toHaveBeenCalledOnce()
 dispose();f.map.clear();for(const[k,v]of A)f.map.set(k,v);f.start();B();const before=new Map(f.map);useStore.getState().update(s=>{s.restSec=77})
 expect(f.reload).toHaveBeenCalledOnce();expect(f.map).toEqual(before);expect(useStore.getState().sync.recovery).toBeTruthy()
})
it('an old recovery choice cannot act on a newer durable owner',async()=>{
 const f=fixture(),token=useStore.getState().sync.recovery.fingerprint;f.map.set('gym_owner','C');f.map.set('gym_user',JSON.stringify({id:'C'}));f.map.set(KEY,JSON.stringify(doc('C-private')))
 const before=new Map(f.map);expect(await useStore.getState().recoverOwnership('signout',token)).toBe(false);expect(f.map).toEqual(before);expect(f.api).not.toHaveBeenCalled()
})

it.each(['Keep this device’s copy','Sign out'])('the visible recovery screen executes %s safely',async label=>{
 const f=fixture(),host=document.createElement('div');document.body.append(host);const root=createRoot(host);roots.push(root)
 act(()=>root.render(<OwnershipRecovery />))
 expect(host.textContent).toContain('Nothing will sync')
 const button=[...host.querySelectorAll('button')].find(b=>b.textContent===label)!
 expect(button).toBeTruthy()
 await act(async()=>{button.click();await vi.waitFor(()=>expect(useStore.getState().sync.recovery).toBeNull())})
 if(label==='Sign out')expect(useStore.getState().user).toBeNull()
 else expect(useStore.getState().S.workouts[0].id).toBe('server-only')
 expect(f.puts.some(x=>x.state.workouts.some((w:any)=>w.id==='device-private'))).toBe(false)
})

it('session guard storage refusal falls back in-app without attempting a reload',()=>{
 const f=fixture('A')
 vi.spyOn(window.sessionStorage,'setItem').mockImplementation(()=>{throw new DOMException('quota','QuotaExceededError')})
 f.map.set('gym_owner','B');f.map.set('gym_user',JSON.stringify({id:'B'}));f.map.set('gym_state_owner','B');f.map.set(KEY,JSON.stringify(doc('B-private')))
 const before=new Map(f.map);useStore.getState().update(s=>{s.restSec=77})
 expect(f.reload).not.toHaveBeenCalled();expect(f.map).toEqual(before);expect(useStore.getState().sync.recovery).toBeTruthy()
})
it('a failed verified-profile fetch keeps recovery usable for the next choice',async()=>{
 const f=fixture(),token=useStore.getState().sync.recovery.fingerprint
 f.api.mockImplementationOnce(async()=>({user:{id:'A',name:'Verified A'}})).mockImplementationOnce(async()=>{throw new Error('offline')})
 await expect(useStore.getState().recoverOwnership('keep',token)).rejects.toThrow('offline')
 const next=useStore.getState().sync.recovery.fingerprint
 expect(next).not.toBe(token)
 expect(await useStore.getState().recoverOwnership('signout',next)).toBe(true)
 expect(useStore.getState().user).toBeNull()
})

it('explicit sign-out can cancel a stranded auth quarantine while keeping the device copy',async()=>{
 const f=fixture();f.map.set('gym_auth_transaction','quarantine-stranded');dispose();f.start()
 const token=useStore.getState().sync.recovery.fingerprint
 expect(await useStore.getState().recoverOwnership('signout',token)).toBe(true)
 expect(f.map.has('gym_auth_transaction')).toBe(false);expect(useStore.getState().user).toBeNull()
 expect(Object.values(JSON.parse(f.map.get('gym_stash')||'{}')).some((x:any)=>x.state.workouts[0]?.id==='device-private')).toBe(true)
 expect(f.puts).toEqual([])
})
