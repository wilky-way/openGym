// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DevicesSheet, PairingSheet, PairRedeemSheet } from '../src/components/Devices'
import { OwedSheet, signInAgain, KeptChangesRows } from '../src/components/ServerSync'
import { configureAuthUiServices } from '../src/lib/auth-ui-services'
import { configureUx, createBrowserUx } from '../src/platform/ux'
const m = vi.hoisted(() => ({
  user: null as any, base: '', owner: null as string | null, readFails: false, sheets: [] as ((close: () => void) => any)[], sync: {status: 'offline'} as any,
  api: vi.fn(), pair: vi.fn(), configure: vi.fn(), setUser: vi.fn(), adopt: vi.fn(), toast: vi.fn(), signOut: vi.fn(), syncNow: vi.fn(), ask: vi.fn(), menu:vi.fn(), download:vi.fn(), keptState:vi.fn(), keptChanges:vi.fn(),
}))
vi.mock('../src/lib/api', () => ({ api: (...args: any[]) => m.api(...args), pairRedeem: (...args: any[]) => m.pair(...args), setRemoteAuth: (...args: any[]) => m.configure(...args), webauthnOK: () => true }))
vi.mock('../src/lib/client-io', () => ({ clientPlatform: () => ({ server: {baseUrl: () => m.base}, kv: {get: (key: string) => { if (m.readFails) throw new Error(secret); return key === 'gym_owner' ? m.owner : null }, subscribe: () => () => {}} }) }))
vi.mock('../src/store/useStore', () => {
  const snapshot = () => ({ user: m.user, sync: m.sync, setUser: m.setUser, adoptProfile: m.adopt, signOut: m.signOut, syncNow: m.syncNow, keptState:m.keptState, keptChanges:m.keptChanges, keptRev:0 })
  const store = (select: any) => select(snapshot()); store.getState = snapshot
  return { useStore: store }
})
vi.mock('../src/store/useUI', () => ({useUI: {getState: () => ({toast: m.toast, openSheet: (render: any) => m.sheets.push(render)})}}))
let host: HTMLDivElement, root: Root
const secret = ['opaque', 'credential', 'sentinel'].join('-')
const OTHER = {id:'other', name:'Training phone', kind:'paired', created:1, lastSeen:2, revokedAt:null}
const SELF = {...OTHER, id:'self', name:'Laptop', kind:'browser'}
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!
const click = async (text: string) => { await act(async () => { button(text).click() }) }
const render = (node: any) => act(() => root.render(node))
const input = (placeholder: string, value: string) => {
  const el = host.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)!
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', {bubbles:true})) })
}
const submit = () => act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true})) })
const openDevice = async (id = 'other') => {
  m.user = {id:'athlete', name:'Athlete'}
  m.api.mockResolvedValue({devices: [OTHER, SELF], current:'self', token:secret})
  render(<DevicesSheet close={() => {}} />); await settle()
  const row = [...host.querySelectorAll<HTMLElement>('.lrow')].find(el => el.textContent?.startsWith(id === 'self' ? 'Laptop' : 'Training phone'))!
  act(() => row.click()); render(m.sheets.at(-1)!(() => {})); await settle()
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  configureUx(createBrowserUx()); vi.clearAllMocks(); m.user = null; m.base = ''; m.owner=null; m.readFails=false; m.sheets.length=0; m.sync = {status:'offline'}
  configureAuthUiServices({askAddDeviceData: m.ask, menuSheet: m.menu, download: m.download})
  m.api.mockResolvedValue({ok:true}); m.pair.mockResolvedValue({token:secret, user:{id:'paired', name:'Athlete'}}); m.configure.mockImplementation(async (base: string) => { m.base=base }); m.adopt.mockResolvedValue({}); m.signOut.mockResolvedValue({owed:false})
  host = document.createElement('div'); document.body.appendChild(host); root=createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
describe('per-device sessions', () => {
  it('shows current, revoked and paired device metadata without exposing credentials', async () => {
    m.user={id:'athlete'}; m.api.mockResolvedValue({devices:[{...OTHER, token:secret}, {...SELF, revokedAt:3}], current:'self', token:secret})
    render(<DevicesSheet close={() => {}} />); await settle()
    expect(host.textContent).toContain('Training phone'); expect(host.textContent).toContain('This device'); expect(host.textContent).toContain('Revoked')
    expect(host.outerHTML).not.toContain(secret); expect(host.textContent).toContain('paired')
  })
  it('renames only the selected id', async () => {
    await openDevice(); input('Device name','Gym phone'); await click('Save')
    expect(m.api).toHaveBeenCalledWith('/api/account/devices/rename', {method:'POST',body:JSON.stringify({id:'other',name:'Gym phone'})})
    expect(m.signOut).not.toHaveBeenCalled()
  })
  it('revokes another device after confirmation while keeping this session', async () => {
    await openDevice(); await click('Revoke access'); expect(m.api).not.toHaveBeenCalledWith('/api/account/devices/revoke', expect.anything())
    await click('Confirm revoke')
    expect(m.api).toHaveBeenCalledWith('/api/account/devices/revoke', {method:'POST',body:JSON.stringify({id:'other'})})
    expect(m.signOut).not.toHaveBeenCalled()
  })
  it('revokes this device and marks auth refused while keeping its local profile', async () => {
    await openDevice('self'); await click('Revoke access'); await click('Confirm revoke')
    expect(m.api).toHaveBeenCalledWith('/api/account/devices/revoke', {method:'POST',body:JSON.stringify({id:'self'})})
    expect(m.syncNow).toHaveBeenCalledTimes(1); expect(m.signOut).not.toHaveBeenCalled(); expect(m.setUser).not.toHaveBeenCalled()
  })
  it('keeps local data after current-device revoke even when the status refresh fails', async () => {
    await openDevice('self'); m.syncNow.mockRejectedValueOnce(new Error(secret)); await click('Revoke access'); await click('Confirm revoke')
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Your data was kept')
    expect(m.setUser).not.toHaveBeenCalled(); expect(m.signOut).not.toHaveBeenCalled(); expect(host.outerHTML).not.toContain(secret)
  })
  it('does not sign a different account out after a delayed revoke response', async () => {
    await openDevice('self'); await click('Revoke access'); let answer!: (v: any) => void; m.api.mockImplementationOnce(() => new Promise(resolve => {answer=resolve}))
    await click('Confirm revoke'); m.user={id:'different'}; await act(async () => answer({ok:true}))
    expect(m.signOut).not.toHaveBeenCalled(); expect(m.syncNow).not.toHaveBeenCalled()
  })
  it('shows safe errors even when a refusal contains a credential', async () => {
    await openDevice(); m.api.mockRejectedValueOnce(new Error(secret)); await click('Save')
    expect(host.outerHTML).not.toContain(secret); expect(host.querySelector('[role=alert]')).not.toBeNull()
  })
})
describe('pairing', () => {
  it('creates an expiring one-time code, without requesting or displaying a bearer', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T12:00:00Z')); m.api.mockResolvedValue({code:'ABCDEFGH', token:secret})
    render(<PairingSheet close={() => {}} />); await click('Create pairing code')
    expect(m.api).toHaveBeenCalledWith('/api/pair/create',{method:'POST',body:'{}'}); expect(host.textContent).toContain('ABCDEFGH'); expect(host.outerHTML).not.toContain(secret)
    act(() => vi.advanceTimersByTime(5*60000)); expect(host.textContent).toContain('This code has expired.'); expect(host.textContent).not.toContain('ABCDEFGH')
  })
  it('persists through Platform before adopting, and always asks about local workouts', async () => {
    const order: string[]=[]; m.configure.mockImplementation(async (base: string) => {m.base=base;order.push('connection')}); m.setUser.mockImplementation(() => {order.push('user')}); m.adopt.mockImplementation(async () => {order.push('adopt')})
    const close=vi.fn(); render(<PairRedeemSheet close={close} />); input('https://your-server.example','https://gym.example'); input('Pairing code','abcdefgh'); await submit()
    expect(m.pair).toHaveBeenCalledWith('https://gym.example','ABCDEFGH'); expect(m.configure).toHaveBeenCalledWith('https://gym.example', secret)
    expect(order).toEqual(['connection','user','adopt']); expect(m.setUser).toHaveBeenCalledWith({id:'paired',name:'Athlete'},{adopt:{alwaysAsk:true}})
    expect(m.adopt).toHaveBeenCalledWith(expect.any(Function),{alwaysAsk:true}); expect(host.outerHTML).not.toContain(secret)
  })
  it('keeps the local profile and does not adopt when connection persistence fails', async () => {
    m.configure.mockRejectedValueOnce(new Error(secret)); render(<PairRedeemSheet close={() => {}} />); input('https://your-server.example','https://gym.example'); input('Pairing code','ABCDEFGH'); await submit()
    expect(m.setUser).not.toHaveBeenCalled(); expect(m.adopt).not.toHaveBeenCalled(); expect(host.outerHTML).not.toContain(secret)
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Your data is kept here')
  })
  it.each(['http://gym.example','https://name:password@gym.example','https://gym.example/path','https://gym.example?token=unsafe'])('rejects a non-origin endpoint %s before redemption', async server => {
    render(<PairRedeemSheet close={() => {}} />); input('https://your-server.example',server); input('Pairing code','ABCDEFGH'); await submit()
    expect(m.pair).not.toHaveBeenCalled(); expect(m.configure).not.toHaveBeenCalled()
  })
  it('requires a signed-in account to sign out before changing servers', async () => {
    m.user={id:'signed-in'}; render(<PairRedeemSheet close={() => {}} />); input('https://your-server.example','https://gym.example'); input('Pairing code','ABCDEFGH'); await submit()
    expect(m.pair).not.toHaveBeenCalled(); expect(m.setUser).not.toHaveBeenCalled()
  })
  it('re-pairs a refused remote session without clearing its local profile', async () => {
    m.user={id:'paired'}; m.base='https://gym.example'; m.sync={status:'auth'}
    signInAgain(); render(m.sheets.at(-1)!(() => {}))
    expect(host.querySelector<HTMLInputElement>('input[type=url]')?.value).toBe(m.base)
    input('Pairing code','ABCDEFGH'); await submit()
    expect(m.configure).toHaveBeenCalledWith(m.base,secret); expect(m.setUser).toHaveBeenCalledWith({id:'paired',name:'Athlete'},{adopt:{alwaysAsk:true}})
    expect(m.signOut).not.toHaveBeenCalled()
  })
  it('does not change servers while recovering a refused remote session', async () => {
    m.user={id:'paired'}; m.base='https://gym.example'; m.sync={status:'auth'}
    render(<PairRedeemSheet close={() => {}} />); input('https://your-server.example','https://other.example'); input('Pairing code','ABCDEFGH'); await submit()
    expect(m.pair).not.toHaveBeenCalled(); expect(m.setUser).not.toHaveBeenCalled()
  })
  it('does not relabel a saved account copy under a different server after partial sign-out', async () => {
    m.user=null; m.owner='old-account'; m.base='https://old.example'
    render(<PairRedeemSheet close={() => {}} />); input('https://your-server.example','https://new.example'); input('Pairing code','ABCDEFGH'); await submit()
    expect(m.pair).not.toHaveBeenCalled(); expect(m.configure).not.toHaveBeenCalled(); expect(m.setUser).not.toHaveBeenCalled()
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Your data is kept here')
  })
  it('does not overwrite a newer login while connection persistence is pending', async () => {
    let stored: () => void = () => {}
    m.configure.mockImplementationOnce((base: string) => {m.base=base;return new Promise<void>(resolve => {stored=resolve})})
    render(<PairRedeemSheet close={() => {}} />); input('https://your-server.example','https://gym.example'); input('Pairing code','ABCDEFGH'); await submit()
    m.user={id:'newer-login'}; await act(async () => stored())
    expect(m.setUser).not.toHaveBeenCalled(); expect(m.adopt).not.toHaveBeenCalled()
  })
  it('does not apply pairing after closing during connection persistence', async () => {
    let stored: () => void = () => {}
    m.configure.mockImplementationOnce((base: string) => {m.base=base;return new Promise<void>(resolve => {stored=resolve})})
    render(<PairRedeemSheet close={() => {}} />); input('https://your-server.example','https://gym.example'); input('Pairing code','ABCDEFGH'); await submit()
    render(null); await act(async () => stored())
    expect(m.setUser).not.toHaveBeenCalled(); expect(m.adopt).not.toHaveBeenCalled()
  })
  it('drops a pairing response after this sheet closes', async () => {
    let answer!: (v: any) => void; m.pair.mockImplementationOnce(() => new Promise(resolve => {answer=resolve}))
    render(<PairRedeemSheet close={() => {}} />); input('https://your-server.example','https://gym.example'); input('Pairing code','ABCDEFGH'); await submit()
    render(null); await act(async () => answer({token:secret,user:{id:'paired'}}))
    expect(m.configure).not.toHaveBeenCalled(); expect(m.setUser).not.toHaveBeenCalled()
  })
})
it('going ahead anyway stays open when a durable kept-copy write fails', async () => {
  m.signOut.mockResolvedValue({owed:true,stashed:false,count:2}); const close=vi.fn(), done=vi.fn()
  render(<OwedSheet kind="signout" count={2} exportBackup={() => {}} close={close} done={done} />); await click('Sign out anyway')
  expect(close).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled(); expect(m.toast).toHaveBeenCalledWith('Couldn’t keep a copy of the changes on this device. Nothing was removed.')
})

it('discards a delayed pairing code after account switch', async () => {
  m.user={id:'old'}; let answer: (v: any) => void = () => {}; m.api.mockImplementationOnce(() => new Promise(resolve => {answer=resolve}))
  render(<PairingSheet close={() => {}} />); await click('Create pairing code'); m.user={id:'new'}
  await act(async () => answer({code:'OLD-CODE'}))
  expect(host.textContent).not.toContain('OLD-CODE')
})
it('clears a displayed pairing code when the active account changes', async () => {
  m.user={id:'old'}; m.api.mockResolvedValueOnce({code:'OLD-CODE'})
  render(<PairingSheet close={() => {}} />); await click('Create pairing code')
  expect(host.textContent).toContain('OLD-CODE'); m.user={id:'new'}; render(<PairingSheet close={() => {}} />)
  expect(host.textContent).not.toContain('OLD-CODE')
})

// UI twins isolate the seam; store/auth-transaction.test.ts verifies real carrier and upload fencing.
vi.mock('../src/lib/auth-transactions', () => ({authenticate: async (exchange: any, valid: any, options: any) => {
  if (!valid()) return null
  const user = await exchange()
  if (!valid()) return null
  const {useStore} = await import('../src/store/useStore')
  useStore.getState().setUser(user, options)
  return user
}}))

it.each(['Save', 'Confirm revoke'])('rejects device %s after switching accounts while its sheet is open', async action => {
  await openDevice(); if (action === 'Confirm revoke') await click('Revoke access')
  m.api.mockClear(); const next={id:'B',workouts:[{id:'saved-B'}]}; m.user=next
  await click(action)
  expect(m.api).not.toHaveBeenCalled(); expect(next.workouts).toEqual([{id:'saved-B'}]); expect(m.toast).toHaveBeenCalledWith('The account changed. Open this action again.')
})
it('rejects forced sign-out after switching accounts while its confirm is open', async () => {
  m.user={id:'A'}; render(<OwedSheet kind="signout" count={2} exportBackup={()=>{}} close={()=>{}} done={()=>{}} />)
  const next={id:'B',workouts:[{id:'saved-B'}]};m.user=next;await click('Sign out anyway')
  expect(m.signOut).not.toHaveBeenCalled();expect(next.workouts).toEqual([{id:'saved-B'}]);expect(m.toast).toHaveBeenCalledWith('The account changed. Open this action again.')
})
it('releases pairing busy state and keeps credentials out of a failed ownership read', async () => {
  render(<PairRedeemSheet close={()=>{}} />);input('https://your-server.example','https://gym.example');input('Pairing code','ABCDEFGH');m.readFails=true;await submit()
  expect(button('Pair device').disabled).toBe(false);expect(host.outerHTML).not.toContain(secret);expect(m.pair).not.toHaveBeenCalled();expect(host.querySelector('[role=alert]')).not.toBeNull()
})
it('rejects pairing opened before a different account signs in',async()=> {
  render(<PairRedeemSheet close={()=>{}} />);input('https://your-server.example','https://gym.example');input('Pairing code','ABCDEFGH')
  m.user={id:'B',saved:{workouts:[{id:'private-B'}]}};await submit()
  expect(m.pair).not.toHaveBeenCalled();expect(m.configure).not.toHaveBeenCalled();expect(m.user.saved).toEqual({workouts:[{id:'private-B'}]})
})

it.each(['Sign out anyway','Try again'])('completes %s after the expected user-to-null sign-out',async action=> {
  m.user={id:'A'};const close=vi.fn(),done=vi.fn()
  m.signOut.mockImplementationOnce(async()=>{m.user=null;return {owed:false}})
  render(<OwedSheet kind="signout" count={2} exportBackup={()=>{}} close={close} done={done} />);await click(action)
  expect(close).toHaveBeenCalledTimes(1);expect(done).toHaveBeenCalledWith({owed:false});expect(m.toast).not.toHaveBeenCalledWith('The account changed. Open this action again.')
})

it.each(['before confirmation','during lookup'])('stale kept-copy export aborts %s after an account switch',async timing=> {
  m.user={id:'A'};m.keptChanges.mockResolvedValue([{server:'',uid:'A',name:'Athlete'}]);m.keptState.mockResolvedValue({workouts:[{id:'private-A'}]})
  render(<KeptChangesRows />);await settle();act(()=>host.querySelector<HTMLElement>('.lrow')!.click())
  const action=m.menu.mock.calls[0]![0].items[0].onClick
  const next={id:'B',saved:{workouts:[{id:'private-B'}]}};const saved=JSON.stringify(next.saved)
  if(timing==='before confirmation'){m.user=next;await act(async()=>action());expect(m.keptState).not.toHaveBeenCalled()}
  else {let answer!:(state:any)=>void;m.keptState.mockImplementationOnce(()=>new Promise(resolve=>{answer=resolve}));await act(async()=>{void action()});m.user=next;await act(async()=>answer({workouts:[{id:'private-A'}]}))}
  expect(m.download).not.toHaveBeenCalled();expect(JSON.stringify(next.saved)).toBe(saved);expect(m.toast).toHaveBeenCalledWith('The account changed. Open this action again.')
})
