// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../src/views/SettingsB'
import { bindUI } from '../src/components/ui'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state: any = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
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
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = () => act(() => root.render(<Settings page="advanced" />))
const row = () => [...host.querySelectorAll('.lrow')].find((r: any) => r.textContent.includes('Planned sessions start from'))
const choose = (label: string) => {
  act(() => { row().click() })
  expect(sheet).toBeTypeOf('function')
  const box = document.createElement('div')
  document.body.appendChild(box)
  const sheetRoot = createRoot(box)
  act(() => sheetRoot.render(sheet(() => {})))
  const option = [...box.querySelectorAll('button.lrow')].find((b: any) => b.querySelector('.lrow-t')?.textContent === label)
  expect(option).toBeTruthy()
  act(() => { (option as HTMLButtonElement).click() })
  act(() => sheetRoot.unmount())
  box.remove()
}

describe('Settings — planned sessions start from', () => {
  it('reads an older profile without the setting as the plan', () => {
    mount()
    expect(row()).toBeTruthy()
    expect(row().textContent).toContain('Your plan')
  })

  it('switches to the last session and back, writing startFrom to the store', () => {
    mount()
    choose('Your last session')
    expect(mocks.S.startFrom).toBe('last')
    mount()
    expect(row().textContent).toContain('Your last session')
    choose('Your plan')
    expect(mocks.S.startFrom).toBe('plan')
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
