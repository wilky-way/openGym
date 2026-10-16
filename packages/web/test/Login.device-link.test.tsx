import { configureTestClient } from './client-fixture'
// @vitest-environment happy-dom
import React, { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login, {RegisterSheet} from '../src/views/Login'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
configureTestClient()

/* The sign-in screen's way in for a device whose person already has a profile elsewhere (#95):
   a code from the signed-in device gives this one a passkey of its own, instead of "Create new
   profile" making a second, empty one. Only where this browser can make a passkey. */
const mocks: any = vi.hoisted(() => {
  const state: any = { webauthn: true, config: null, sheets: [], user: null }
  state.snapshot = () => ({
    config: state.config, S: {}, user: state.user, linkCode: null,
    setUser: vi.fn(), adoptProfile: vi.fn(), setGuest: vi.fn(), loadConfig: vi.fn(async () => state.config),
    pushState: vi.fn(), pullState: vi.fn(),
  })
  return state
})
vi.mock('../src/store/useStore', () => {
  const useStore: any = (selector: any) => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  useStore.subscribe = () => () => {} // Selector-only fixture; ownership transitions use the real-store regressions.
  return { useStore, hasData: () => false }
})
vi.mock('../src/store/useUI', () => {
  const snap: any = () => ({ toast: vi.fn(), openSheet: (render: any) => { mocks.sheets.push(render); return {} } })
  const useUI: any = (selector: any) => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('../src/lib/api', () => ({
  webauthnOK: () => mocks.webauthn, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), BIO: 'your fingerprint', bio: () => 'your fingerprint',
  api: vi.fn(), passkeyAssertion: vi.fn(), passwordLogin: vi.fn(), passwordRegister: vi.fn(), passwordResetRedeem: vi.fn(),
  createPasskey: vi.fn(),
}))
vi.mock('../src/lib/demo', () => ({ DEMO: false, REPO: 'https://example.invalid' }))
vi.mock('../src/lib/auth-ui-services', () => ({ askAddDeviceData: vi.fn(), confirmSheet: vi.fn() }))

const mounted: any = []
function mount(el: any) {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const buttons: any = (host: any) => [...host.querySelectorAll('button')].map((b: any) => b.textContent)
const button: any = (host: any, text: any) => [...host.querySelectorAll('button')].find((b: any) => b.textContent === text)

beforeEach(() => { mocks.webauthn = true; mocks.config = null; mocks.sheets.length = 0 })
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }: any) => { root.unmount(); host.remove() }) }) })

describe('Login: a code from another device', () => {
  it('sits under the ways in where passkeys work, and opens the sheet that redeems a code', () => {
    mocks.config = { allow_guest: true }
    const page: any = mount(<Login />)
    const all: any = buttons(page)
    expect(all.indexOf('Use a code from your other device')).toBe(all.indexOf('Create new profile') + 1)
    act(() => button(page, 'Use a code from your other device').click())
    const sheet: any = mount(mocks.sheets[0](() => {}))
    expect(sheet.querySelector('h3').textContent).toBe('Add this device')
    expect(sheet.querySelector('input[placeholder="Code from your other device"]')).toBeTruthy()
  })

  it('is not offered in a browser that cannot make a passkey, with or without passwords', () => {
    mocks.webauthn = false
    expect(buttons(mount(<Login />))).not.toContain('Use a code from your other device')
    mocks.config = { password_login: true }
    expect(buttons(mount(<Login />))).not.toContain('Use a code from your other device')
  })
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

it('refuses profile creation opened before another account signed in', async () => {
  const page=mount(<RegisterSheet close={()=>{}} />), input=page.querySelector('input')
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Athlete');input.dispatchEvent(new Event('input',{bubbles:true}))})
  mocks.user={id:'B',saved:{workouts:[{id:'private-B'}]}}
  const {passkeyRegister}=await import('../src/lib/api')
  await act(async()=>button(page,'Create passkey').click())
  expect(passkeyRegister).not.toHaveBeenCalled();expect(mocks.user.saved).toEqual({workouts:[{id:'private-B'}]})
  mocks.user=null
})

it('can sign in and create a profile after StrictMode setup-cleanup-setup',async()=> {
  const {passkeyLogin,passkeyRegister}=await import('../src/lib/api')
  vi.mocked(passkeyLogin).mockResolvedValueOnce({id:'A',name:'Athlete'})
  vi.mocked(passkeyRegister).mockResolvedValueOnce({id:'B',name:'Athlete'})
  const login=mount(<StrictMode><Login /></StrictMode>)
  await act(async()=>button(login,'Sign in with passkey').click())
  expect(passkeyLogin).toHaveBeenCalledTimes(1)
  const register=mount(<StrictMode><RegisterSheet close={()=>{}} /></StrictMode>),input=register.querySelector('input')
  act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Athlete');input.dispatchEvent(new Event('input',{bubbles:true}))})
  await act(async()=>button(register,'Create passkey').click())
  expect(passkeyRegister).toHaveBeenCalledWith('Athlete','')
})
