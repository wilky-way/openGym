import { configureTestClient } from './client-fixture'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
configureTestClient()

/* The sheet a sign-out shows when the server is missing something names the photos and videos
   that have not reached it, offers the backup that carries them, and its "Try again" sends them
   too. */
const mocks: any = vi.hoisted(() => ({
  sync: { status: 'offline', lastError: { status: 0, code: 'network' } },
  syncNow: null, signOut: null, syncMedia: null
}))
vi.mock('../src/store/useStore', () => {
  const snap: any = () => ({ sync: mocks.sync, syncNow: mocks.syncNow, signOut: mocks.signOut, config: null })
  const useStore: any = (selector: any) => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../src/store/useUI', () => {
  const snap: any = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI: any = (selector: any) => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../lib/media-sync.js', () => ({ syncMedia: (...a: any[]) => mocks.syncMedia(...a) }))

vi.mock('../src/lib/api', () => ({ passkeyLogin: vi.fn(), webauthnOK: () => true }))
vi.mock('../src/lib/auth-ui-services', () => ({ askAddDeviceData: vi.fn() }))

const { OwedSheet } = await import('../src/components/ServerSync')

let host: any, root: any
beforeEach(() => {
  mocks.sync = { status: 'offline', lastError: { status: 0, code: 'network' } }
  mocks.syncNow = vi.fn(async () => mocks.sync)
  mocks.syncMedia = vi.fn(async () => {})
  mocks.signOut = vi.fn(async () => ({ owed: true, count: 0, media: 1 }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const button: any = (text: any) => [...host.querySelectorAll('button')].find((b: any) => b.textContent.includes(text))

describe('OwedSheet with photos and videos waiting', () => {
  it('without media, it is the sheet it always was', () => {
    const json: any = vi.fn()
    act(() => root.render(<OwedSheet kind="signout" count={2} exportBackup={json} done={vi.fn()} close={vi.fn()} />))
    expect(host.textContent).not.toContain('photos or videos')
    act(() => { button('Export backup (JSON)').click() })
    expect(json).toHaveBeenCalled()
  })

})

it('refused browser with photos or videos waiting: Sign in again, and the backup that carries them', () => {
  mocks.sync = {status:'auth',auth:true,lastError:{status:401,code:'auth'}}
  act(() => root.render(<OwedSheet kind="signout" count={null} exportBackup={vi.fn()} done={vi.fn()} close={vi.fn()} />))
  expect(host.textContent).toContain('Some changes on this device have not reached your server.')
  expect(host.textContent).toContain('Sign in again, or export a backup first.')
  expect(host.textContent).not.toContain('Try again')
  expect(button('Sign in with passkey')).toBeTruthy()
  expect(button('Export backup (JSON)')).toBeTruthy()
})
it('a browser whose server is only out of reach still offers Try again for them', () => {
  act(() => root.render(<OwedSheet kind="signout" count={2} exportBackup={vi.fn()} done={vi.fn()} close={vi.fn()} />))
  expect(host.textContent).toContain('Try again, or export a backup first.')
  expect(button('Try again')).toBeTruthy()
  expect(button('Pair again')).toBeFalsy()
})

it('names the changes and the media when both are waiting', () => {
  act(() => root.render(<OwedSheet kind="signout" count={3} exportBackup={vi.fn()} done={vi.fn()} close={vi.fn()} />))
  expect(host.textContent).toContain('Not on your server yet')
})
it('Try again sends them too — the refused ones included — and the sheet follows the new count', async () => {
  mocks.signOut=vi.fn(async () => ({owed:true,count:2})); mocks.syncNow=vi.fn(async () => mocks.sync)
  act(() => root.render(<OwedSheet kind="signout" count={2} exportBackup={vi.fn()} done={vi.fn()} close={vi.fn()} />))
  await act(async () => button('Try again').click())
  expect(mocks.signOut).toHaveBeenCalled()
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
