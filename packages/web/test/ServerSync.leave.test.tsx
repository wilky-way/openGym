import { configureTestClient } from './client-fixture'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
configureTestClient()

/* When Disconnect, Sign out or Sign out everywhere fails, the toast says what that action was and
   what still stands: "Sign out everywhere" was the only wording, whichever one had failed. */
const mocks: any = vi.hoisted(() => ({ toast: null, signOut: null, signOutAll: null }))
vi.mock('../src/store/useStore', () => {
  const snap: any = () => ({
    sync: null, config: null, syncNow: async () => null,
    signOut: (...a: any[]) => mocks.signOut(...a),
    signOutAll: (...a: any[]) => mocks.signOutAll(...a)
  })
  const useStore: any = (selector: any) => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../src/store/useUI', () => {
  const snap: any = () => ({ toast: (m: any) => mocks.toast(m), openSheet: vi.fn() })
  const useUI: any = (selector: any) => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../src/lib/media-sync', () => ({ syncMedia: vi.fn() }))

vi.mock('../src/lib/api', () => ({ passkeyLogin: vi.fn(), webauthnOK: () => true }))
vi.mock('../src/lib/auth-ui-services', () => ({ askAddDeviceData: vi.fn() }))

const { leaveServer, OwedSheet } = await import('../src/components/ServerSync')

const fail: any = () => vi.fn(async () => { throw new Error('boom') })
beforeEach(() => {
  mocks.toast = vi.fn()
  mocks.signOut = fail()
  mocks.signOutAll = fail()
})

describe('leaving the server, when it fails', () => {
  it.each([
    ['signout', 'signOut', 'Couldn’t sign out. You’re still signed in.'],
    ['everywhere', 'signOutAll', 'Couldn’t sign out everywhere. You’re still signed in.']
  ])('%s says its own words and leaves the screen where it is', async (kind: any, method: any, line: any) => {
    const done: any = vi.fn()
    await leaveServer(kind, { exportBackup: vi.fn(), exportBackupZip: vi.fn(), done })
    expect(mocks[method]).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith(line)
    expect(done).not.toHaveBeenCalled()
  })
})

describe('the sheet that offers going ahead anyway, when that fails', () => {
  it.each([
    ['signout', 'signOut', 'Sign out anyway', 'Couldn’t sign out. You’re still signed in.']
  ])('%s says its own words', async (kind: any, method: any, label: any, line: any) => {
    const host: any = document.createElement('div')
    document.body.appendChild(host)
    const root: any = createRoot(host)
    act(() => root.render(<OwedSheet kind={kind} count={2} exportBackup={vi.fn()} exportBackupZip={vi.fn()} done={vi.fn()} close={vi.fn()} />))
    const btn: any = [...host.querySelectorAll('button')].find((b: any) => b.textContent.includes(label))
    await act(async () => { btn.click() })
    expect(mocks[method]).toHaveBeenCalledWith({ force: true })
    expect(mocks.toast).toHaveBeenCalledWith(line)
    act(() => root.unmount()); host.remove()
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
