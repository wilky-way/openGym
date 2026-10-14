// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Login from '../src/views/Login'
import { configureTestClient } from './client-fixture'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const platform = configureTestClient()

/* The sign-in screen with password sign-in (#118). Only an instance that advertises
   `password_login` shows any of it; there, a browser without passkey support finally has a way
   in instead of being told to stay local, and creating a profile can use a password. */
const mocks: any = vi.hoisted(() => {
  const state: any = { webauthn: true, config: null, sheets: [] }
  state.snapshot = () => ({
    config: state.config, S: {},
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
}))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: 'https://example.invalid' }))
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

beforeEach(() => { mocks.webauthn = true; mocks.config = null; mocks.sheets.length = 0; platform.kv.remove('gym_server_url') })
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }: any) => { root.unmount(); host.remove() }) }) })

describe('Login with password sign-in', () => {
  it('an instance without it looks exactly as before', () => {
    const page: any = mount(<Login />)
    expect(buttons(page)).not.toContain('Sign in with password')
    expect(page.textContent).toContain('Passkeys use your fingerprint. No passwords to remember.')
    mocks.webauthn = false
    const noPasskeys: any = mount(<Login />)
    expect(noPasskeys.textContent).toContain("This browser doesn't do passkeys, but you can still use openGym locally on this device.")
    expect(buttons(noPasskeys)).not.toContain('Sign in with password')
  })

})

it('never offers a password even when a legacy server advertises it', () => {
  mocks.config = { password_login: true, allow_guest: false }
  const page: any = mount(<Login />)
  expect(buttons(page)).not.toContain('Sign in with password')
  expect(page.textContent).toContain('No passwords to remember.')
  mocks.webauthn = false
  expect(buttons(mount(<Login />))).not.toContain('Create new profile')
})

it('offers pairing only for a remote server', () => {
  platform.kv.set('gym_server_url', 'https://synthetic.example')
  const page = mount(<Login />)
  expect(buttons(page)).toContain('Pair this device')
  expect(buttons(page)).not.toContain('Sign in with passkey')
  expect(buttons(page)).not.toContain('Create new profile')
  expect(buttons(page)).not.toContain('Use a code from your other device')
})

// UI twins isolate the seam; store/auth-action.test.ts verifies real carrier and upload fencing.
vi.mock('../src/lib/auth-actions', () => ({authenticate: async (exchange: any, valid: any, options: any) => {
  if (!valid()) return null
  const user = await exchange()
  if (!valid()) return null
  const {useStore} = await import('../src/store/useStore')
  useStore.getState().setUser(user, options)
  return user
}}))
