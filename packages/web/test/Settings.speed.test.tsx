// @vitest-environment happy-dom
// Settings → General → Speed unit (Discord "miles per hour"): follows the weight unit until
// chosen, and choosing converts nothing — speeds stay stored in km/h.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../src/views/SettingsB'

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


let host: any, root: any
beforeEach(() => {
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

const mount = () => act(() => root.render(<Settings page="units" />))
const segButton = (label: string) => [...host.querySelectorAll('.seg button')].find((b: any) => b.textContent === label)

describe('Settings — speed unit', () => {
  it('shows km/h for a kg profile and mph for a pound profile until one is chosen', () => {
    mount()
    expect(segButton('km/h').getAttribute('aria-pressed')).toBe('true')
    act(() => root.unmount())
    root = createRoot(host)
    mocks.S.unit = 'lb'
    mount()
    expect(segButton('mph').getAttribute('aria-pressed')).toBe('true')
  })

  it('stores the choice and nothing else', () => {
    mocks.S.routines = [{ id: 'c', name: 'Cardio', ex: [{ id: '2138', sets: 1, min: 20, speed: 8 }] }]
    const before = structuredClone(mocks.S)
    mount()
    act(() => { segButton('mph').click() })
    expect(mocks.S.speedUnit).toBe('mph')
    expect({ ...mocks.S, speedUnit: undefined }).toEqual({ ...before, speedUnit: undefined })
    mount()
    expect(segButton('mph').getAttribute('aria-pressed')).toBe('true')
    act(() => { segButton('km/h').click() })
    expect(mocks.S.speedUnit).toBe('kmh')
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
