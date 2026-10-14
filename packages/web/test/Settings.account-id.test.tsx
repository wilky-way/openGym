import { configureTestClient } from './client-fixture'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../src/views/SettingsA'

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})

const mocks: any = vi.hoisted(() => {
  const state: any = { S: null, user: null }
  state.toast = vi.fn()
  state.snapshot = () => ({
    S: state.S, user: state.user,
    sync: { status: 'ok', offline: false, pending: false, auth: false, lastError: null, lastSynced: Date.now(), server: 'https://gym.example.com' },
    update: (mut: any) => mut(mocks.S), replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(), resetDemo: vi.fn(),
    syncNow: vi.fn(), unsyncedChanges: () => ({ owed: false, count: 0 }), keptChanges: async () => [],
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
  const snap: any = () => ({ toast: (...a: any[]) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI: any = (selector: any) => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../src/lib/api', () => ({
  api: vi.fn(() => Promise.resolve({})), webauthnOK: () => true, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../src/lib/push', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../src/lib/wakelock', () => ({ wakeLockSupported: () => false }))

vi.mock('../src/lib/settings-a-services', () => ({ settingsAServices: () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(), askAddDeviceData: vi.fn(),

 download: (text: any, name: any) => { const a: any = document.createElement('a'); a.download = name; a.click() },
}) }))



const ID: any = 'k3v9q0x2mz7a'
const mounted: any = []
function mount(el: any) {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
// Await the clipboard operation and its continuation; the refusing branch is also completed.
const tick = async () => { await Promise.allSettled(writeText.mock.results.map((r: any) => r.value)); await vi.dynamicImportSettled() }
const section: any = (page: any, title: any) => [...page.querySelectorAll('.sect')].find((s: any) => s.querySelector('.sect-t')?.textContent === title)
const idRow: any = (el: any) => [...el.querySelectorAll('.lrow')].find((r: any) => r.querySelector('.lrow-t')?.textContent === 'Account ID')

let writeText: any
beforeEach(() => {
  configureTestClient()
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.user = { id: ID, name: 'andi' }
  mocks.toast.mockClear()
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }: any) => { root.unmount(); host.remove() }) }) })

describe('Settings → Account ID', () => {
  it('a signed-in browser shows the id under Account, and a tap copies it', async () => {
    const page: any = mount(<Settings page="account" />)
    const row: any = idRow(section(page, 'Account'))
    expect(row).toBeTruthy()
    expect(row.querySelector('.acct-id').textContent).toBe(ID)
    act(() => row.click())
    await tick()
    expect(writeText).toHaveBeenCalledWith(ID)
    expect(mocks.toast).toHaveBeenCalledWith('Account ID copied')
  })

  it('a clipboard that refuses says nothing, and the id stays on screen', async () => {
    writeText.mockImplementation(() => Promise.reject(new Error('denied')))
    const page: any = mount(<Settings page="account" />)
    act(() => idRow(page).click())
    await tick()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(idRow(page).textContent).toContain(ID)
  })

  it('plain http without the Clipboard API still copies it, the way a selection copy does', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const execCommand: any = vi.fn(() => true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true })
    try {
      const page: any = mount(<Settings page="account" />)
      act(() => idRow(page).click())
      await tick()
      expect(execCommand).toHaveBeenCalledWith('copy')
      expect(mocks.toast).toHaveBeenCalledWith('Account ID copied')
    } finally { Reflect.deleteProperty(document, 'execCommand') }
  })

  it('a guest has no account and no id', () => {
    mocks.user = null
    const page: any = mount(<Settings page="account" />)
    expect(idRow(page)).toBeUndefined()
  })
})
