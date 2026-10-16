// @vitest-environment happy-dom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSyncEngine } from '../src/store/sync-engine'
import { useStore, initialStoreState, DEF, KEY, clone } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { createBrowserPlatform, browserServerEndpoint } from '../src/platform/browser'
import { configureClientIO } from '../src/lib/client-io'
import { configureSettingsA } from '../src/lib/settings-a-services'
import { settingsTarget, settingsUpdate } from '../src/lib/settings-target'
import SettingsA, { importSettingsBackup, exportSettingsBackup } from '../src/views/SettingsA'
import { PasskeysSheet } from '../src/components/Passkeys'
import { configureAuthUiServices } from '../src/lib/auth-ui-services'
import { zipStore } from '@opengym/core/zip'
import { bindUI } from '../src/components/ui'
const m = vi.hoisted(() => ({ api: vi.fn(), proof: vi.fn(), nav: vi.fn(), push: false }))
vi.mock('react-router-dom', () => ({ useNavigate: () => m.nav }))
vi.mock('../src/lib/api', () => ({ api: (...args: any[]) => m.api(...args), webauthnOK: () => true, passkeyAssertion: (...args: any[]) => m.proof(...args), passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), createPasskey: vi.fn() }))
vi.mock('../src/lib/push', () => ({pushSupported:()=>m.push, syncPushSubscription:async()=>true, enablePush:vi.fn(),disablePush:vi.fn(),sendTestPush:vi.fn()}))
let map: Map<string,string>, platform: ReturnType<typeof createBrowserPlatform>, dispose: () => void
let host: HTMLDivElement, root: Root
let confirms: any[], menus: any[], sheets: ((close: () => void) => ReactNode)[]
const toast = vi.fn(), download = vi.fn(), importApp = vi.fn(), importHevy = vi.fn()
const recovery = KEY + '.corrupt-123', pointer = KEY + '_corrupt_key'
function mount(node: ReactNode) { act(() => root.render(node)) }
function row(title: string) { return [...host.querySelectorAll<HTMLButtonElement>('.lrow')].find(el => el.querySelector('.lrow-t')?.textContent === title)! }
const flush = () => act(async () => { for(let n=0;n<10;n++) await Promise.resolve() })
async function click(title: string) { await act(async () => row(title).click()) }
const backup = () => new File([JSON.stringify({...clone(DEF), workouts:[{id:'imported',d:'2025-01-02',entries:[]}], routines:[]})], 'backup.json')
function switchToB() {
  useStore.getState().setUser({id:'B',name:'B'},{adopt:{alwaysAsk:true}})
  useStore.getState().update(s => { s.workouts=[{id:'B-private',d:'2025-01-01',entries:[]}]; s.activeEquipId='same-profile' },false)
}
function snapshot() { return { bytes: map.get(KEY), wid: map.get('gym_wid'), S:clone(useStore.getState().S), user:useStore.getState().user } }
function unchanged(before: ReturnType<typeof snapshot>) {
  expect(map.get(KEY)).toBe(before.bytes)
  expect(map.get('gym_wid')).toBe(before.wid)
  expect(useStore.getState().S).toEqual(before.S)
  expect(useStore.getState().user).toBe(before.user)
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/))
}
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-13T12:00:00Z'));vi.clearAllMocks()
  confirms=[];menus=[];sheets=[];m.push=false
  map=new Map([[KEY,JSON.stringify({...clone(DEF),workouts:[{id:'A-private',d:'2025-01-01',entries:[]}],activeEquipId:'same-profile'})],['gym_owner','A'],['gym_user',JSON.stringify({id:'A',name:'A'})]])
  const kv={get:(key:string)=>map.get(key)??null,set:(key:string,value:string)=>{map.set(key,value)},remove:(key:string)=>{map.delete(key)},subscribe:()=>()=>{}}
  platform={...createBrowserPlatform(), kv, server:browserServerEndpoint(kv),nav:{href:()=> 'https://synthetic.example/',searchParams:()=>new URLSearchParams(),replaceQuery(){},reload:vi.fn()}}
  configureClientIO(platform)
  useStore.setState({...initialStoreState(kv)})
  const engine=createSyncEngine(patch=>useStore.setState(patch),useStore.getState,{platform,api:async()=>({state:clone(DEF),rev:1}),prompts:{toast,askAddDeviceData:async()=>false},acquireAuthLock:async()=>()=>{},acquireSyncLock:async()=>()=>{}})
  useStore.setState({...engine.actions, ready:false});dispose=engine.dispose
  useUI.setState({toast,openSheet:((render:any)=>{sheets.push(render);return{close(){}}}) as any})
  bindUI(useUI)
  configureSettingsA({confirmSheet:options=>confirms.push(options),menuSheet:options=>menus.push(options),download,importFromApp:importApp,importFromHevy:importHevy})
  configureAuthUiServices({askAddDeviceData:async()=>false,menuSheet:options=>menus.push(options),download})
  m.api.mockResolvedValue({passkeys:[{id:'key-A',name:'Laptop',created:null,lastUsed:null,transports:[]}],lastWayIn:false})
  m.proof.mockResolvedValue({proof:'synthetic'})
  host=document.createElement('div');document.body.append(host);root=createRoot(host)
})
afterEach(()=>{act(()=>root.unmount());host.remove();dispose();vi.useRealTimers()})
for(const title of ['Reset everything','Sign out','Sign out everywhere','Delete recovery copy']) {
 it(`${title}: an A → B confirmation preserves B’s real W07 saved bytes`,async()=>{
  map.set(pointer,recovery);map.set(recovery,'unreadable-A')
  mount(<SettingsA page={title.includes('Sign out')?'account':'data'} />);await flush();await click(title)
  switchToB();const before=snapshot()
  await act(async()=>{await confirms.at(-1).onConfirm()})
  unchanged(before);expect(map.get(recovery)).toBe('unreadable-A');expect(map.get(pointer)).toBe(recovery)
 })
 it(`${title}: revalidates inside the updater after the caller’s pre-check`,async()=>{
  map.set(pointer,recovery);map.set(recovery,'unreadable-A')
  mount(<SettingsA page={title.includes('Sign out')?'account':'data'} />);await flush();await click(title)
  const realUpdate=useStore.getState().update
  let before!:ReturnType<typeof snapshot>
  useStore.setState({update(mut,push){ useStore.setState({update:realUpdate});switchToB();before=snapshot();realUpdate(mut,push) }})
  await act(async()=>{await confirms.at(-1).onConfirm()})
  unchanged(before);expect(map.get(recovery)).toBe('unreadable-A')
 })
}
it('changing the active profile refuses a reset with no stamp or saved-byte rewrite',async()=>{
 mount(<SettingsA page="data"/>);await click('Reset everything')
 useStore.getState().update(s=>{s.activeEquipId='new-profile'},false);const before=snapshot()
 await act(async()=>{await confirms.at(-1).onConfirm()});unchanged(before)
})
it('replacing the recovery target refuses deletion even with the same account/profile',async()=>{
 map.set(pointer,recovery);map.set(recovery,'original');mount(<SettingsA page="data"/>);await click('Delete recovery copy')
 map.set(recovery,'replacement');const before=snapshot();await act(async()=>{await confirms.at(-1).onConfirm()})
 unchanged(before);expect(map.get(recovery)).toBe('replacement')
})
it('exports the exact aside bytes and keeps the only copy after a refused export',async()=>{
 map.set(pointer,recovery);map.set(recovery,'{not JSON');mount(<SettingsA page="data"/>);await click('Export recovery copy')
 expect(download).toHaveBeenCalledWith('{not JSON',recovery+'.txt');expect(map.get(recovery)).toBe('{not JSON')
 download.mockRejectedValueOnce(new Error('disk'));await click('Export recovery copy');expect(map.get(recovery)).toBe('{not JSON')
 expect(toast).toHaveBeenCalledWith('Could not export the recovery copy. It is still on this device.')
})
it('deletes only the specifically confirmed recovery copy',async()=>{
 map.set(pointer,recovery);map.set(recovery,'unreadable');map.set(recovery+'-other','keep');mount(<SettingsA page="data"/>);await click('Delete recovery copy')
 const bytes=map.get(KEY);await act(async()=>{await confirms.at(-1).onConfirm()})
 expect(map.has(recovery)).toBe(false);expect(map.has(pointer)).toBe(false);expect(map.get(recovery+'-other')).toBe('keep');expect(map.get(KEY)).toBe(bytes)
})
it('import file read started as A cannot open a B confirmation',async()=>{
 let answer!:(text:string)=>void
 const file=backup();vi.spyOn(file,'text').mockImplementation(()=>new Promise(resolve=>{answer=resolve}))
 const pending=importSettingsBackup(file);for(let n=0;n<10&&!answer;n++)await Promise.resolve()
 switchToB();const before=snapshot();answer(JSON.stringify(clone(DEF)));await pending
 unchanged(before);expect(confirms).toEqual([]);expect(menus).toEqual([])
})
for(const mode of ['confirm','replace','merge'] as const) {
 it(`import ${mode}: A → B at confirm preserves B’s saved bytes`,async()=>{
  useStore.setState({importConflict:async()=>mode==='confirm'?null:{workouts:2,state:clone(DEF),rev:2}})
  await importSettingsBackup(backup());switchToB();const before=snapshot()
  const callback=mode==='confirm'?confirms.at(-1).onConfirm:menus.at(-1).items[mode==='replace'?0:1].onClick
  await callback();unchanged(before)
 })
 it(`import ${mode}: checks the actual updater draft on a late account switch`,async()=>{
  useStore.setState({importConflict:async()=>mode==='confirm'?null:{workouts:2,state:clone(DEF),rev:2}})
  await importSettingsBackup(backup());const realUpdate=useStore.getState().update
  let before!:ReturnType<typeof snapshot>
  useStore.setState({update(mut,push){useStore.setState({update:realUpdate});switchToB();before=snapshot();realUpdate(mut,push)}})
  const callback=mode==='confirm'?confirms.at(-1).onConfirm:menus.at(-1).items[mode==='replace'?0:1].onClick
  await callback();unchanged(before)
 })
}
it('the conflict read arriving after an A → B switch does not open or import into B',async()=>{
 let answer!:(value:any)=>void;useStore.setState({importConflict:()=>new Promise(resolve=>{answer=resolve})})
 const pending=importSettingsBackup(backup());for(let n=0;n<30&&!answer;n++)await Promise.resolve()
 switchToB();const before=snapshot();answer({workouts:1,state:clone(DEF)});await pending
 unchanged(before);expect(menus).toEqual([]);expect(confirms).toEqual([])
})
it('imports a CRC-validated legacy zip’s JSON without reviving deleted media uploads',async()=>{
 const zip=await zipStore([{name:'opengym-backup.json',blob:new Blob([JSON.stringify(clone(DEF))])}],{now:new Date('2025-01-01T12:00:00Z')})
 await importSettingsBackup(new File([zip],'backup.zip'));expect(confirms).toHaveLength(1)
 await confirms[0].onConfirm();expect(useStore.getState().S.workouts).toEqual([]);expect(toast).toHaveBeenCalledWith('Backup imported')
})
it('rejects a corrupt zip before writing any state',async()=>{
 const zip=await zipStore([{name:'opengym-backup.json',blob:new Blob([JSON.stringify(clone(DEF))])}],{now:new Date('2025-01-01T12:00:00Z')})
 const bytes=new Uint8Array(await zip.arrayBuffer());bytes[60]=bytes[60]!^1
 const before=map.get(KEY);await importSettingsBackup(new File([bytes],'corrupt.zip'))
 expect(map.get(KEY)).toBe(before);expect(confirms).toEqual([])

})
it('JSON export keeps unknown/private prescriptions and reports the private-backup warning',async()=>{
 useStore.getState().update(s=>{s.unknown={nested:'keep'};s.programmes.definitions=[{id:'private',private:true}]},false)
 await exportSettingsBackup();expect(JSON.parse(download.mock.calls[0]![0]).unknown).toEqual({nested:'keep'});expect(map.get(KEY)).toBe(JSON.stringify(useStore.getState().S))
})
it('the external app picker passes the captured target and aborts a stale selected file',async()=>{
 mount(<SettingsA page="data"/>);await click('Import from another app');switchToB();const before=snapshot()
 const input=host.querySelector<HTMLInputElement>('input[accept^=".csv"]')!;Object.defineProperty(input,'files',{value:[new File(['csv'],'test.csv')]})
 await act(async()=>{input.dispatchEvent(new Event('change',{bubbles:true}))})
 unchanged(before);expect(importApp).not.toHaveBeenCalled()
})
it('revoke passkey: A → B during the owner proof preserves B’s real W07 saved bytes',async()=>{
 mount(<PasskeysSheet close={()=>{}}/>);await flush();await click('Laptop');mount(sheets.at(-1)!(()=>{}));await flush()
 const remove=[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Remove passkey')!;act(()=>remove.click());mount(sheets.at(-1)!(()=>{}))
 let answer!:(proof:any)=>void;m.proof.mockImplementation(()=>new Promise(resolve=>{answer=resolve}))
 const button=[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Confirm with a passkey')!
 act(()=>button.click());switchToB();const before=snapshot();await act(async()=>{answer({proof:'synthetic'});await Promise.resolve()})
 unchanged(before);expect(m.api.mock.calls.some(([,opts])=>opts?.method==='DELETE')).toBe(false)
})
it('an authorization-only updater probe succeeds without stamping or persisting',()=>{
 const target=settingsTarget(),before=map.get(KEY)
 expect(settingsUpdate(target)).toBe(true);expect(map.get(KEY)).toBe(before)
 expect(()=>settingsUpdate(target,()=>{throw new Error('unexpected')})).toThrow('unexpected')
})
for (const late of [false,true]) it(`invalid server address reset: stale A → B ${late?'inside updater':'at confirm'} preserves every B key`,async()=>{
 map.set('gym_server_url','javascript:broken');map.set('gym_device_token','synthetic-device-secret')
 mount(<SettingsA page="account"/>);await click('Reset server address')
 let before!:Map<string,string>
 if(late){const update=useStore.getState().update;useStore.setState({update(mut,push){useStore.setState({update});switchToB();before=new Map(map);update(mut,push)}})}
 else {switchToB();before=new Map(map)}
 await act(async()=>{await confirms.at(-1).onConfirm()})
 expect(map).toEqual(before);expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/));expect(platform.nav.reload).not.toHaveBeenCalled()
})
it('invalid server address reset synchronously removes only that malformed key and reloads',async()=>{
 map.set('gym_server_url','javascript:broken');map.set('gym_device_token','synthetic-device-secret');map.set(recovery,'keep this aside')
 const before=new Map(map);before.delete('gym_server_url')
 mount(<SettingsA/>);await click('Reset server address');confirms.at(-1).onConfirm()
 expect(map).toEqual(before);expect(platform.nav.reload).toHaveBeenCalledOnce();expect(useStore.getState().user?.id).toBe('A')
})
it('an unsafe corrupt-copy pointer never exposes a delete action for the primary record',()=>{
 map.set(pointer,KEY);mount(<SettingsA page="data"/>);expect(row('Delete recovery copy')).toBeUndefined();expect(map.has(KEY)).toBe(true)
})
it('a nudge-tone picker opened as A cannot update B’s same-profile saved document',async()=>{
 m.push=true;useStore.getState().update(s=>{s.reminder={on:true,nudge:true,tone:'friendly',unknown:'keep'}},false)
 mount(<SettingsA page="reminders"/>);await flush();await click('Nudge tone');mount(sheets.at(-1)!(()=>{}))
 switchToB();const before=snapshot();await click('Drill sergeant');unchanged(before)
})
it('revoke passkey: a late updater A → B switch aborts before owner proof is applied',async()=>{
 mount(<PasskeysSheet close={()=>{}}/>);await flush();await click('Laptop');mount(sheets.at(-1)!(()=>{}));await flush()
 const remove=[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Remove passkey')!;act(()=>remove.click());mount(sheets.at(-1)!(()=>{}))
 const update=useStore.getState().update;let before!:ReturnType<typeof snapshot>
 useStore.setState({update(mut,push){useStore.setState({update});switchToB();before=snapshot();update(mut,push)}})
 const button=[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Confirm with a passkey')!
 await act(async()=>{button.click();await Promise.resolve()});unchanged(before)
 expect(m.api.mock.calls.some(([,opts])=>opts?.method==='DELETE')).toBe(false)
})
it('revoke passkey fails closed without the W15 authentication lock and keeps saved bytes',async()=>{
 useStore.setState({beginAuthTransaction:async()=>{throw new Error('Authentication lock is not configured')}})
 mount(<PasskeysSheet close={()=>{}}/>);await flush();await click('Laptop');mount(sheets.at(-1)!(()=>{}));await flush()
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Remove passkey')!.click());mount(sheets.at(-1)!(()=>{}))
 const before=map.get(KEY)
 await act(async()=>{[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Confirm with a passkey')!.click()})
 expect(map.get(KEY)).toBe(before);expect(m.api.mock.calls.some(([,opts])=>opts?.method==='DELETE')).toBe(false)
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not confirm')
})
describe('guest footers',()=>{
 it('Account says guest mode once: the banner says it, the footer only when the banner is off',()=>{
  useStore.setState({user:null,S:clone(DEF)});mount(<SettingsA page="account"/>);
  const footers=()=>[...host.querySelectorAll('.sect-f')].filter(el=>el.textContent?.includes('Guest mode'))
  expect(footers()).toEqual([]);useStore.getState().update(s=>{s.connStatus=false},false);mount(<SettingsA page="account"/>);expect(footers()).toHaveLength(1)
 })
 it('Account says guest mode in the footer once the banner\'s × hid it (#454)',()=>{
  useStore.setState({user:null,S:{...clone(DEF),connLocal:false}});mount(<SettingsA page="account"/>);
  expect([...host.querySelectorAll('.sect-f')].filter(el=>el.textContent?.includes('Guest mode'))).toHaveLength(1)
 })
})
for(const action of ['Reset everything','Sign out','Delete recovery copy'])it(`${action}: a peer-tab durable owner change refuses the old in-memory account without writing`,async()=>{
 map.set(pointer,recovery);map.set(recovery,'unreadable-A');mount(<SettingsA page={action==='Sign out'?'account':'data'}/>);await flush();await click(action)
 map.set('gym_owner','B');const before=new Map(map);await act(async()=>{await confirms.at(-1).onConfirm()})
 expect(map).toEqual(before);expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/))
})
it('same-account document replacement invalidates an old reset target before W16’s instance seam is integrated',async()=>{
 mount(<SettingsA page="data"/>);await click('Reset everything');useStore.getState().replaceState({...clone(DEF),workouts:[{id:'replacement',entries:[]}]},false);const before=snapshot()
 await act(async()=>{await confirms.at(-1).onConfirm()});unchanged(before)
})
it('a valid exported backup above 5 MiB round-trips unknown fields without a new size restriction',async()=>{
 useStore.getState().update(s=>{s.unknown=Array.from({length:160000},()=>({value:'keep'}))},false)
 await exportSettingsBackup();const text=download.mock.calls.at(-1)![0];expect(new Blob([text]).size).toBeGreaterThan(5*1024*1024)
 await importSettingsBackup(new File([text],'large-valid.json'));expect(confirms).toHaveLength(1)
 await confirms[0].onConfirm();expect(useStore.getState().S.unknown).toHaveLength(160000);expect(useStore.getState().S.unknown[0]).toEqual({value:'keep'})
})
it('a profile change on the passkey editor refuses opening its stale nested removal',async()=>{
 mount(<PasskeysSheet close={()=>{}}/>);await flush();await click('Laptop');mount(sheets.at(-1)!(()=>{}));await flush()
 useStore.getState().update(s=>{s.activeEquipId='new-profile'},false);const before=snapshot(),count=sheets.length
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Remove passkey')!.click());unchanged(before);expect(sheets).toHaveLength(count)
})
for(const action of ['reset','replace','merge'])it(`${action}: UI opts into durable W07 replacement and reports a refused save without success`,async()=>{
 if(action==='reset'){mount(<SettingsA page="data"/>);await click('Reset everything')}
 else {useStore.setState({importConflict:async()=>action==='merge'?{workouts:1,state:clone(DEF),rev:1}:null});await importSettingsBackup(backup())}
 const before=snapshot(),index=useStore.getState().index
 const write=vi.spyOn(platform.kv,'set').mockImplementation((key,value)=>{if(key===KEY)throw new Error('synthetic quota');map.set(key,value)})
 try {
  await act(async()=>{await(action==='merge'?menus.at(-1).items[1].onClick():confirms.at(-1).onConfirm())})
  expect(map.get(KEY)).toBe(before.bytes);expect(useStore.getState().S).toEqual(before.S);expect(useStore.getState().index).toBe(index);expect(useStore.getState().user).toBe(before.user)
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/Could not.*kept/));expect(toast).not.toHaveBeenCalledWith('Backup imported');expect(toast).not.toHaveBeenCalledWith('All data reset');expect(m.nav).not.toHaveBeenCalled()
 }finally{write.mockRestore()}
})
for(const title of ['Sign out','Sign out everywhere'])for(const action of ['Sign out anyway','Try again'])it(`${title} owed-sheet ${action}: A → B preserves B’s real saved bytes`,async()=>{
 useStore.setState({unsyncedChanges:()=>({owed:true,count:1})});mount(<SettingsA page="account"/>);await flush();await click(title)
 await act(async()=>{await confirms.at(-1).onConfirm()});expect(sheets).toHaveLength(1);mount(sheets.at(-1)!(()=>{}))
 switchToB();const before=snapshot();const button=[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent===action)!
 await act(async()=>{button.click()});unchanged(before);expect(m.nav).not.toHaveBeenCalled()
})
it('a document-instance change rejects the old recovery-copy delete without persistence',async()=>{
 map.set(pointer,recovery);map.set(recovery,'keep');mount(<SettingsA page="data"/>);await click('Delete recovery copy')
 const instance=useStore.getState().documentInstance;act(()=>useStore.getState().replaceState(clone(useStore.getState().S),false));expect(useStore.getState().documentInstance).toBe((instance??0)+1);const before=snapshot();await act(async()=>{await confirms.at(-1).onConfirm()});unchanged(before);expect(map.get(recovery)).toBe('keep')
})
async function openPasskeyRemoval() {
 mount(<PasskeysSheet close={()=>{}}/>);await flush();await click('Laptop');mount(sheets.at(-1)!(()=>{}));await flush()
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Remove passkey')!.click());mount(sheets.at(-1)!(()=>{}))
}
it('a real auth-transaction passkey refusal keeps the existing user and saved bytes',async()=>{
 await openPasskeyRemoval();const before=snapshot()
 m.api.mockImplementation((_path,opts)=>opts?.method==='DELETE'?Promise.reject(Object.assign(new Error('last way in'),{status:409,data:{code:'last-way-in'}})):Promise.resolve({}))
 await act(async()=>{[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Confirm with a passkey')!.click()})
 expect(map.get(KEY)).toBe(before.bytes);expect(useStore.getState().S).toEqual(before.S);expect(useStore.getState().user).toBe(before.user)
 expect(host.textContent).toContain('It is your only way in');expect(map.has('gym_auth_transaction')).toBe(false);expect(toast).not.toHaveBeenCalledWith('Passkey removed')
})
it('revoke passkey: A → B during the real DELETE transaction preserves B’s bytes and user',async()=>{
 await openPasskeyRemoval();let answer!:(result:any)=>void
 m.api.mockImplementation((_path,opts)=>opts?.method==='DELETE'?new Promise(resolve=>{answer=resolve}):Promise.resolve({}))
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Confirm with a passkey')!.click());await flush();expect(answer).toBeTypeOf('function')
 // An external owner/document installation while the held transaction is in flight.
 const b={...clone(DEF),activeEquipId:'same-profile',workouts:[{id:'B-private',entries:[]}],_ts:44}
 map.set(KEY,JSON.stringify(b));map.set('gym_owner','B');map.set('gym_user',JSON.stringify({id:'B'}));useStore.setState(initialStoreState(platform.kv))
 const before=snapshot();await act(async()=>{answer({passkeys:[],lastWayIn:false});await Promise.resolve()})
 unchanged(before);expect(toast).not.toHaveBeenCalledWith('Passkey removed')
})

it('queued passkey removal keeps the original profile guard before its child renderer mounts',async()=>{
 mount(<PasskeysSheet close={()=>{}}/>);await flush();await click('Laptop');mount(sheets.at(-1)!(()=>{}));await flush()
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Remove passkey')!.click())
 useStore.getState().update(s=>{s.activeEquipId='new-profile'},false);const before=snapshot()
 mount(sheets.at(-1)!(()=>{}));await act(async()=>{[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Confirm with a passkey')!.click()})
 unchanged(before);expect(m.proof).not.toHaveBeenCalled();expect(m.api.mock.calls.some(([,opts])=>opts?.method==='DELETE')).toBe(false)
})

it('queued Add-passkey opened as A refuses proof and registration when mounted under B',async()=>{
 mount(<PasskeysSheet close={()=>{}}/>);await flush()
 act(()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Add a passkey')!.click())
 const child=sheets.at(-1)!;switchToB();const before=snapshot()
 mount(child(()=>{}));await flush()
 await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.textContent==='Confirm with a passkey')!.click())
 unchanged(before);expect(m.proof).not.toHaveBeenCalled()
 expect(m.api.mock.calls.some(([path])=>path==='/api/account/passkeys/options'||path==='/api/account/passkeys/verify')).toBe(false)
})
