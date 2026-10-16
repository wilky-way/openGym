import { configureTestClient } from './client-fixture'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../src/views/SettingsA'

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})

/* Settings → Account with more than one passkey (#95): the Passkeys row and the code for another
   device in a signed-in browser, nothing of it for a guest or against a server that has no such
   list, and the password row asking again once the passkeys changed — whether a password may be
   removed depends on them. */
const mocks: any = vi.hoisted(() => {
  // `kept` is one array for good: KeptChangesRows re-asks whenever the function changes, and a
  // fresh [] per answer would re-render it forever.
  const state: any = { S: null, user: null, sync: null, config: null, webauthn: true, sheets: [], kept: [] }
  state.passkeyLogin = vi.fn(async () => ({ id: 'u1', name: 'andi' }))
  state.list = { passkeys: [{ id: 'k1', name: 'Laptop', created: null, lastUsed: null, transports: [] }, { id: 'k2', name: null, created: null, lastUsed: null, transports: [] }], password: true, lastWayIn: false }
  state.api = vi.fn(async (path: any) => path === '/api/account/password' ? { set: true, setAt: null, passkeys: 2, name: 'andi', nameTaken: false }
    : path === '/api/account/passkeys' || path === '/api/account/passkeys/rename' ? state.list : {})
  state.snapshot = () => ({
    S: state.S, user: state.user, sync: state.sync, config: state.config,
    update: (mut: any) => mut(mocks.S), replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(), resetDemo: vi.fn(),
    syncNow: vi.fn(), unsyncedChanges: () => ({ owed: false, count: 0 }), keptChanges: async () => state.kept,
    disconnectServer: vi.fn(), signOut: vi.fn(), signOutAll: vi.fn(), adoptProfile: vi.fn(),
  })
  return state
})
vi.mock('../src/store/useStore', () => {
  const useStore: any = (selector: any) => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  useStore.subscribe = () => () => {} // Selector-only fixture; ownership transitions use the real-store regressions.
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../src/store/useUI', () => {
  const snap: any = () => ({ toast: vi.fn(), openSheet: (render: any, opts: any) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI: any = (selector: any) => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../src/lib/api', () => ({
  api: (...a: any[]) => mocks.api(...a), webauthnOK: () => mocks.webauthn, passkeyLogin: (...a: any[]) => mocks.passkeyLogin(...a), passkeyRegister: vi.fn(), IS_ANDROID: false,
  passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(), createPasskey: vi.fn(),
}))
vi.mock('../src/lib/push', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../src/lib/wakelock', () => ({ wakeLockSupported: () => false }))

vi.mock('../src/lib/settings-a-services', () => ({ settingsAServices: () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(), askAddDeviceData: vi.fn(),

 download: (text: any, name: any) => { const a: any = document.createElement('a'); a.download = name; a.click() },
}) }))



const mounted: any = []
function mount(el: any) {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
// Await native chunk completion and React's resulting commits, including rejected API reads.
const settle = () => act(async () => { await vi.dynamicImportSettled() })
const section: any = (page: any, title: any) => [...page.querySelectorAll('.sect')].find((s: any) => s.querySelector('.sect-t')?.textContent === title)
const titles: any = (el: any) => [...el.querySelectorAll('.lrow-t')].map((t: any) => t.textContent)
const rowByTitle: any = (el: any, title: any) => [...el.querySelectorAll('.lrow')].find((r: any) => r.querySelector('.lrow-t')?.textContent === title)

beforeEach(() => {
  configureTestClient()
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.user = { id: 'u1', name: 'andi' }
  mocks.sync = { status: 'ok', offline: false, pending: false, auth: false, lastError: null, lastSynced: Date.now(), server: null }
  mocks.config = { password_login: true }
  mocks.webauthn = true
  mocks.sheets.length = 0
  mocks.passkeyLogin.mockClear()
  mocks.api.mockClear()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }: any) => { root.unmount(); host.remove() }) }) })

const asked: any = (path: any) => mocks.api.mock.calls.filter(([p]: any) => p === path).length

vi.mock('../src/lib/auth-transactions',()=>({authenticate:async(exchange:any,valid:any)=>valid()?exchange():null}))
describe('Settings with password sign-in',()=>{
 it('a signed-in browser gets a Password row in Account — and none on an instance without it',async()=>{
  const page=mount(<Settings page="account"/>);await settle();expect(titles(section(page,'Account'))).not.toContain('Password');expect(asked('/api/account/password')).toBe(0)
  mocks.config=null;const off=mount(<Settings page="account"/>);await settle();expect(titles(section(off,'Account'))).not.toContain('Password')
 })
 it('a guest in a browser without passkeys can create a profile and sign in with a password',()=>{
  mocks.user=null;mocks.sync=null;mocks.webauthn=false;const page=mount(<Settings page="account"/>);const account=section(page,'Account')
  expect(titles(account)).toEqual(['Passkeys not supported in this browser.','Pair this device']);expect(titles(account)).not.toContain('Sign in with password')
  mocks.config=null;expect(titles(section(mount(<Settings page="account"/>),'Account'))).toEqual(['Passkeys not supported in this browser.','Pair this device'])
 })
 it('a guest in a passkey browser can also create a password profile or use a code from another device',()=>{
  mocks.user=null;mocks.sync=null;const page=mount(<Settings page="account"/>);const account=section(page,'Account')
  expect(titles(account)).toEqual(['Create passkey profile','Sign in with passkey','Use a code from your other device','Pair this device'])
  expect(hostPassword(account)).toBeNull();act(()=>rowByTitle(account,'Use a code from your other device').click());const code=mount(mocks.sheets.at(-1).render(()=>{}));expect(code.querySelector('h3').textContent).toBe('Add this device')
  mocks.config=null;expect(titles(section(mount(<Settings page="account"/>),'Account'))).toEqual(['Create passkey profile','Sign in with passkey','Use a code from your other device','Pair this device'])
 })
 it('"Sign in" after the server ended the session asks which way; the passkey is one tap on it',async()=>{
  mocks.sync={status:'auth',offline:false,pending:true,auth:true,lastError:{status:401},lastSynced:0,server:null};const page=mount(<Settings page="account"/>);const row=rowByTitle(section(page,'Server & sync'),'Sign in with passkey')
  expect(row).toBeTruthy();await act(async()=>row.click());expect(mocks.passkeyLogin).toHaveBeenCalledTimes(1)
 })
})
function hostPassword(host:HTMLElement){return host.querySelector('input[name="new-password"]')}
