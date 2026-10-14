// @vitest-environment happy-dom
// Settings → "Show connection status" (#369, #330): in Appearance, where a phone kept local with
// no account sees it too — Server & sync only renders for a signed-in profile.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../src/views/SettingsB'
import { bindUI } from '../src/components/ui'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state: any = { S: null, user: null }
  state.snapshot = () => ({
    S: state.S,
    user: state.user,
    update: (mut: any) => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../src/store/useStore', () => {
  const useStore = (selector: any) => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  useStore.subscribe = () => () => {} // Selector-only fixture; ownership transitions use the real-store regressions.
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../src/store/useUI', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = (selector: any) => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})

// The Settings view reads the build-time version constant at render time.


// SelectRow opens its choices through the bound UI store; capture the sheet to render it here.
let sheet: any = null
bindUI({ getState: () => ({ openSheet: render => { sheet = render; return { close: () => {} } } }) })

let host: any, root: any
beforeEach(() => {
  sheet = null
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
  }
  mocks.user = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings page="look" />))
const row = () => [...host.querySelectorAll('.lrow')].find((r: any) => r.textContent.includes('Show connection status'))

describe('Show connection status', () => {
  it('is there with no account, on a phone kept local, and on by default', () => {
    mount()
    expect(row()).toBeTruthy()
    expect(row().textContent).toContain('A dot on Home still warns when syncing is stuck.')
    expect(row().querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('true')
  })

  it('switches the profile setting off and on', () => {
    mount()
    act(() => { row().querySelector('[role="switch"]').click() })
    expect(mocks.S.connStatus).toBe(false)
    mount()
    expect(row().querySelector('[role="switch"]').getAttribute('aria-checked')).toBe('false')
    act(() => { row().querySelector('[role="switch"]').click() })
    expect(mocks.S.connStatus).toBe(true)
  })

  // #454: the no-server line's × sets connLocal off; switching the status on is the way back.
  it('switching it on brings back the no-server line its × hid', () => {
    mocks.S = { ...mocks.S, connStatus: false, connLocal: false }
    mount()
    act(() => { row().querySelector('[role="switch"]').click() })
    expect(mocks.S.connStatus).toBe(true)
    expect(mocks.S.connLocal).toBe(true)
  })
})

describe('guest footers', () => {
  const footers = () => [...host.querySelectorAll('.sect-f')].map((f: any) => f.textContent)

  it('Look & Home does not promise a guest that anything syncs with a profile', () => {
    mount()
    expect(host.textContent).not.toContain('synced with your profile')
    mocks.user = { id: 'u1' }
    act(() => root.render(<Settings key="in" page="look" />))
    expect(host.textContent).toContain('synced with your profile')
  })

})

import { configureSettingsB } from '../src/views/SettingsB'
import { configureUx, createBrowserUx } from '../src/platform/ux'
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-02-18T12:00:00Z'))
 configureUx(createBrowserUx())
 configureSettingsB({ navigate: ('nav' in mocks ? mocks.nav : vi.fn()), confirmSheet: vi.fn(), menuSheet: vi.fn(), starterPlanSheet: vi.fn(), equipmentProfileSheet: vi.fn(), plateInventorySheet: vi.fn(), dumbbellInventorySheet: vi.fn() })
})
afterEach(() => vi.useRealTimers())
