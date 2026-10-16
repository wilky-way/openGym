// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Settings → "Server & sync": which server, which account, how things stand, when this device
   last held what the server holds, how much is still waiting, and "Sync now" with its outcome.
   Then the way out — Disconnect, Sign out, Sign out everywhere — which no longer promises a sync
   it never checked, and which asks before leaving changes the server has not got: try again,
   export a backup, or go ahead anyway with the changes kept on the device. */
const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, sync: null, unsynced: { owed: false, count: 0 }, kept: [], sheets: [], navs: [] }
  state.toast = vi.fn()
  state.confirmSheet = vi.fn()
  state.syncNow = vi.fn(async () => state.sync)
  state.signOut = vi.fn()
  state.signOutAll = vi.fn()
  state.shareExport = vi.fn(async () => {})
  state.snapshot = () => ({
    S: state.S, user: state.user, sync: state.sync,
    update: vi.fn(), replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(), resetDemo: vi.fn(),
    syncNow: state.syncNow, unsyncedChanges: () => state.unsynced, keptChanges: async () => state.kept,
    signOut: state.signOut, signOutAll: state.signOutAll,
    adoptProfile: vi.fn(),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: (render, opts) => { mocks.sheets.push({ render, opts }); return {} } })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => to => mocks.navs.push(to) }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})), webauthnOK: () => true, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false, enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn() }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))

vi.mock('../sheets.jsx', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: (...a) => mocks.confirmSheet(...a), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn(), askAddDeviceData: vi.fn(),
}))

globalThis.__APP_VERSION__ ??= 'test'

const BASE = 'https://gym.example.com'
const USER = { id: 'u1', name: 'andi' }
const sync = (status, extra = {}) => ({ status, offline: false, pending: false, auth: false, lastError: null, lastSynced: 0, server: BASE, ...extra })

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none', gifSize: 'full', workouts: [], routines: [], exWeights: {} }
  mocks.user = USER
  mocks.sync = sync('ok', { lastSynced: Date.now() - 5 * 60000 })
  mocks.unsynced = { owed: false, count: 0 }
  mocks.kept = []
  mocks.sheets.length = 0
  mocks.navs.length = 0
  mocks.toast.mockClear(); mocks.confirmSheet.mockClear(); mocks.syncNow.mockClear()
  mocks.signOut.mockReset(); mocks.signOutAll.mockReset(); mocks.shareExport.mockClear()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

const block = page => [...page.querySelectorAll('.sect')].find(s => s.querySelector('.sect-t')?.textContent === 'Server & sync')
const rowByTitle = (el, title) => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const buttonByText = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent === text)
const openSheet = (i = -1) => mount(mocks.sheets.at(i).render(() => {}))

describe('Server & sync', () => {
  it('a signed-in browser in step: server, account, "All synced" with the time, and Sync now reporting back', async () => {
    const page = mount(<Settings page="account" />)
    const b = block(page)
    expect(b).toBeTruthy()
    expect(rowByTitle(b, 'gym.example.com').textContent).toContain('Signed in as andi')
    expect(rowByTitle(b, 'All synced').textContent).toContain('Last synced: 5 minutes ago')
    expect(rowByTitle(b, 'Sign in with passkey')).toBeUndefined()       // nothing to fix

    await act(async () => { rowByTitle(b, 'Sync now').click() })
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('All synced')
  })

  it('refused by the server: says so, how much is waiting, and offers sign-in again', async () => {
    mocks.sync = sync('auth', { auth: true, pending: true, lastSynced: Date.now() - 2 * 86400000, lastError: { status: 401, code: 'auth' } })
    mocks.unsynced = { owed: true, count: 3 }
    const page = mount(<Settings page="account" />)
    const b = block(page)
    const status = rowByTitle(b, 'The server refuses this browser')
    expect(status.textContent).toContain('Last synced: 2 days ago')
    expect(status.textContent).toContain('Not on your server yet: 3 changes')
    expect(rowByTitle(b, 'Sign in with passkey')).toBeTruthy()

    // Sync now reports the outcome, whatever it is.
    await act(async () => { rowByTitle(b, 'Sync now').click() })
    expect(mocks.toast).toHaveBeenCalledWith('The server refuses this browser')
  })

  it('a browser with a server error shows the HTTP code; one that never synced here says so', () => {
    mocks.sync = sync('error', { pending: true, lastError: { status: 502, code: 'http' } })
    mocks.unsynced = { owed: true, count: 1 }
    const page = mount(<Settings page="account" />)
    const status = rowByTitle(block(page), 'Server error (HTTP 502)')
    expect(status.textContent).toContain('Not synced with this server yet')
    expect(status.textContent).toContain('Not on your server yet: 1 change')
    // The browser's account rows follow in their own section.
    expect(rowByTitle(page, 'Sign out')).toBeTruthy()
  })

  it('while everything is fine, a change still in its debounce is not counted as waiting', () => {
    mocks.unsynced = { owed: true, count: 1 }
    const page = mount(<Settings page="account" />)
    expect(rowByTitle(block(page), 'All synced').textContent).not.toContain('Not on your server yet')
  })

  it('a guest has no server block, and lists the changes a forced sign out kept', async () => {
    mocks.user = null
    mocks.sync = sync('local', { server: null })
    mocks.kept = [{ server: BASE, uid: 'u1', name: 'andi', at: 1 }]
    const page = mount(<Settings page="account" />)
    await settle()
    expect(block(page)).toBeUndefined()
    const kept = rowByTitle(page, 'Changes kept for andi')
    expect(kept.textContent).toContain('gym.example.com')
    expect(kept.textContent).toContain('Added back when this device connects as that account again.')
  })

  it('signed in as another account, the changes kept for the first are listed in the block', async () => {
    mocks.user = { id: 'u2', name: 'bea' }
    mocks.kept = [{ server: BASE, uid: 'u1', name: 'andi', at: 1 }]
    const page = mount(<Settings page="account" />)
    await settle()
    expect(rowByTitle(block(page), 'Changes kept for andi')).toBeTruthy()
  })
})

describe('leaving the server', () => {
  const confirm = () => mocks.confirmSheet.mock.calls.at(-1)[0]

  it('Disconnect no longer promises a sync it did not check, and goes straight through when nothing is waiting', async () => {
    mocks.signOut.mockResolvedValueOnce({ owed: false })
    const page = mount(<Settings page="account" />)
    act(() => rowByTitle(page, 'Sign out').click())
    expect(confirm().message).not.toMatch(/synced to your server first/)
    expect(confirm().message).toContain('checks that the server has every change')
    await act(async () => { await confirm().onConfirm() })
    expect(mocks.signOut).toHaveBeenCalledWith(undefined)
    expect(mocks.sheets).toHaveLength(0)
    expect(mocks.navs).toEqual(['/home'])
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('with changes waiting it asks: how many, try again, export, or sign out anyway — which keeps them', async () => {
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 2 })
    const page = mount(<Settings page="account" />)
    act(() => rowByTitle(page, 'Sign out').click())
    await act(async () => { await confirm().onConfirm() })
    expect(mocks.navs).toEqual([])                         // nothing left, nothing wiped
    expect(mocks.sheets.at(-1).opts).toMatchObject({ kind: 'center' })
    const sheet = openSheet()
    expect(sheet.textContent).toContain('Not on your server yet: 2 changes')
    expect(sheet.textContent).toContain('keeps a copy of these changes on this device')

    const downloaded = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await act(async () => { buttonByText(sheet, 'Export backup (JSON)').click() })
    expect(downloaded).toHaveBeenCalledTimes(1)
    downloaded.mockRestore()

    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 2, stashed: true })
    await act(async () => { buttonByText(sheet, 'Sign out anyway').click() })
    expect(mocks.signOut).toHaveBeenLastCalledWith({ force: true })
    expect(mocks.navs).toEqual(['/home'])
    expect(mocks.toast).toHaveBeenLastCalledWith('The changes your server has not seen are kept on this device, and added back when it connects as this account again.')
  })

  it('"Try again" syncs, and leaves once the server has everything', async () => {
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 1 })
    const page = mount(<Settings page="account" />)
    act(() => rowByTitle(page, 'Sign out').click())
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()

    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 1 })
    mocks.sync = sync('offline', { offline: true, pending: true, lastError: { status: 0, code: 'network' } })
    await act(async () => { buttonByText(sheet, 'Try again').click() })
    expect(mocks.syncNow).toHaveBeenCalledTimes(1)
    expect(mocks.navs).toEqual([])
    expect(sheet.textContent).toContain('The server cannot be reached')   // why it is still waiting (the device itself is online)

    mocks.signOut.mockResolvedValueOnce({ owed: false })
    await act(async () => { buttonByText(sheet, 'Try again').click() })
    expect(mocks.navs).toEqual(['/home'])
  })

  it('refused by the server, "Try again" makes way for "Sign in" — signing in brings the changes over', async () => {
    mocks.sync = sync('auth', { auth: true, pending: true, lastError: { status: 401, code: 'auth' } })
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: null })
    const page = mount(<Settings page="account" />)
    act(() => rowByTitle(page, 'Sign out').click())
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()
    expect(sheet.textContent).toContain('Some changes on this device have not reached your server.')
    expect(buttonByText(sheet, 'Try again')).toBeUndefined()
    // The sentence names the button that is there (it said "Try again" beside "Sign in").
    expect(sheet.textContent).toContain('Sign in again, or export a backup first.')
    expect(sheet.textContent).not.toContain('Try again')
    expect(buttonByText(sheet, 'Sign in with passkey')).toBeTruthy()
  })

  it('a browser the server refuses is told to sign in again, next to the button that does', async () => {
    mocks.sync = sync('auth', { auth: true, pending: true, lastError: { status: 401, code: 'auth' } })
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 2 })
    const page = mount(<Settings page="account" />)
    act(() => rowByTitle(page, 'Sign out').click())
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()
    expect(sheet.textContent).toContain('Sign in again, or export a backup first.')
    expect(sheet.textContent).not.toContain('Try again')
    expect(buttonByText(sheet, 'Sign in with passkey')).toBeTruthy()
  })

  it('a server that is only out of reach still offers Try again, and says so', async () => {
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 1 })
    const page = mount(<Settings page="account" />)
    act(() => rowByTitle(page, 'Sign out').click())
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()
    expect(sheet.textContent).toContain('Try again, or export a backup first.')
    expect(buttonByText(sheet, 'Try again')).toBeTruthy()
  })

  it('a copy that cannot be kept aside is not wiped either, and it says so', async () => {
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 1 })
    const page = mount(<Settings page="account" />)
    act(() => rowByTitle(page, 'Sign out').click())
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 1, stashed: false })
    await act(async () => { buttonByText(sheet, 'Sign out anyway').click() })
    expect(mocks.navs).toEqual([])
    expect(mocks.toast).toHaveBeenLastCalledWith('Couldn’t keep a copy of the changes on this device. Nothing was removed.')
  })

  it('browser: Sign out checks first too, and "Sign out everywhere" keeps passkeys usable', async () => {
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 4 })
    const page = mount(<Settings page="account" />)
    act(() => rowByTitle(page, 'Sign out').click())
    expect(confirm().message).not.toMatch(/synced to your profile first/)
    await act(async () => { await confirm().onConfirm() })
    const sheet = openSheet()
    expect(sheet.textContent).toContain('Not on your server yet: 4 changes')
    mocks.signOut.mockResolvedValueOnce({ owed: true, count: 4, stashed: true })
    await act(async () => { buttonByText(sheet, 'Sign out anyway').click() })
    expect(mocks.signOut).toHaveBeenLastCalledWith({ force: true })
    expect(mocks.navs).toEqual(['/home'])

    act(() => rowByTitle(page, 'Sign out everywhere').click())
    expect(confirm().message).toContain('Your passkeys keep working, so you can sign in with them again anytime.')
    mocks.signOutAll.mockRejectedValueOnce(new Error('HTTP 502'))
    await act(async () => { await confirm().onConfirm() })
    expect(mocks.toast).toHaveBeenLastCalledWith('Couldn’t sign out everywhere. You’re still signed in.')
  })
})
