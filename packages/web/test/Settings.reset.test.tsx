import { configureTestClient } from './client-fixture'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../src/views/SettingsA'

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})

// "Reset everything" is one dialog with two truths. A guest's data lives in this browser only.
// A signed-in profile pushes the empty state to the server like any other change, so the wipe

const mocks: any = vi.hoisted(() => {
  const state: any = { S: null, user: null }
  state.replaceState = vi.fn()
  state.resetEverything = vi.fn()
  state.confirmSheet = vi.fn()
  state.api = vi.fn(() => Promise.resolve({ ok: true }))
  state.toast = vi.fn()
  state.snapshot = () => ({
    S: state.S,
    user: state.user,
    update: (mut: any) => {
      const next: any = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: state.replaceState, resetEverything: state.resetEverything, setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../src/store/useStore', () => {
  const useStore: any = (selector: any) => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  useStore.subscribe = () => () => {} // Selector-only fixture; ownership transitions use the real-store regressions.
  return { useStore, DEF: { reminder: { time: '17:30' }, workouts: [] }, hasData: () => false }
})
vi.mock('../src/store/useUI', () => {
  const snap: any = () => ({ toast: (...a: any[]) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI: any = (selector: any) => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../src/lib/api', () => ({
  api: (...a: any[]) => mocks.api(...a), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../src/lib/push', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../src/lib/wakelock', () => ({ wakeLockSupported: () => false }))

vi.mock('../src/lib/settings-a-services', () => ({ settingsAServices: () => ({
  starterPlanSheet: vi.fn(), confirmSheet: (...a: any[]) => mocks.confirmSheet(...a), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(),

 download: (text: any, name: any) => { const a: any = document.createElement('a'); a.download = name; a.click() },
}) }))



let host: any, root: any
beforeEach(() => {
  configureTestClient()
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.user = null
  mocks.replaceState.mockClear()
  mocks.resetEverything.mockClear()
  mocks.confirmSheet.mockClear()
  mocks.api.mockClear()
  mocks.toast.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount: any = () => act(() => root.render(<Settings page="data" />))
const resetRow: any = () => [...host.querySelectorAll('.lrow')].find((r: any) => r.textContent.includes('Reset everything'))
const openDialog: any = () => {
  act(() => { resetRow().click() })
  expect(mocks.confirmSheet).toHaveBeenCalledTimes(1)
  return mocks.confirmSheet.mock.calls[0][0]
}

describe('Settings — reset everything', () => {
  it('guest: says the wipe is local, resets to the defaults, resets the stored data', async () => {
    mount()
    const dialog: any = openDialog()
    expect(dialog.title).toBe('Reset everything?')
    expect(dialog.message).toBe('Deletes your plan, workouts, body weight, photos and videos on this device. This cannot be undone.')
    await act(async () => { await dialog.onConfirm() })
    // the store's reset: the empty copy, stamped (useStore resetEverything)
    expect(mocks.resetEverything).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('All data reset')
    expect(mocks.replaceState).not.toHaveBeenCalled()
  })

  it('signed in: says the wipe reaches the server and every device', async () => {
    mocks.user = { uid: 'u1', name: 'Ana' }
    mount()
    const dialog: any = openDialog()
    expect(dialog.message).toBe('Deletes your plan, workouts, body weight, photos and videos from your profile on this server and on every signed-in device. This cannot be undone.')
    await act(async () => { await dialog.onConfirm() })
    expect(mocks.resetEverything).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('All data reset')
  })

})
