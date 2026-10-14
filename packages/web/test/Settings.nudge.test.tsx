import { configureTestClient } from './client-fixture'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from '../src/views/SettingsA'
import { bindUI } from '../src/components/ui'

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})

const mocks: any = vi.hoisted(() => {
  const state: any = { S: null, user: { id: 'u1', name: 'One' } }
  state.snapshot = () => ({
    S: state.S,
    user: state.user,
    update: (mut: any) => {
      const next: any = structuredClone(state.S)
      mut(next)
      state.S = next
    },
    replaceState: vi.fn(), setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../src/store/useStore', () => {
  const useStore: any = (selector: any) => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  useStore.subscribe = () => () => {} // Selector-only fixture; ownership transitions use the real-store regressions.
  return { useStore, DEF: { reminder: { on: false, time: '08:00', tz: null, nudge: false, tone: 'friendly' } }, hasData: () => false }
})
vi.mock('../src/store/useUI', () => {
  const snap: any = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI: any = (selector: any) => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../src/lib/api', () => ({
  api: vi.fn(() => Promise.resolve({})), webauthnOK: () => false, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), IS_ANDROID: false,
}))
vi.mock('../src/lib/push', () => ({
  pushSupported: () => true, syncPushSubscription: () => Promise.resolve(true),
  enablePush: vi.fn(), disablePush: vi.fn(), sendTestPush: vi.fn(),
}))
vi.mock('../src/lib/wakelock', () => ({ wakeLockSupported: () => false }))

vi.mock('../src/lib/settings-a-services', () => ({ settingsAServices: () => ({
  loadStarterPlan: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),

 download: (text: any, name: any) => { const a: any = document.createElement('a'); a.download = name; a.click() },
}) }))



let sheet: any = null
bindUI({ getState: () => ({ openSheet: (render: any) => { sheet = render; return { close: () => {} } } }) })

let host: any, root: any
beforeEach(() => {
  configureTestClient()
  sheet = null
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {},
    reminder: { on: true, time: '08:00', tz: 'Europe/Zurich' },
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount: any = async () => { await act(async () => { root.render(<Settings page="reminders" />) }) }
const row: any = (text: any) => [...host.querySelectorAll('.lrow')].find((r: any) => r.textContent.includes(text))
const nudgeRow: any = () => row('Nudge me when I skip a planned workout')
const toneRow: any = () => row('Nudge tone')
const toggleNudge: any = async () => {
  const sw: any = nudgeRow().querySelector('input[type=checkbox], button, [role=switch]')
  await act(async () => { sw.click() })
  await mount()
}
const choose: any = async (label: any) => {
  act(() => { toneRow().click() })
  expect(sheet).toBeTypeOf('function')
  const box: any = document.createElement('div')
  document.body.appendChild(box)
  const sheetRoot: any = createRoot(box)
  act(() => sheetRoot.render(sheet(() => {})))
  const option: any = [...box.querySelectorAll('button.lrow')].find((b: any) => b.querySelector('.lrow-t')?.textContent === label)
  expect(option).toBeTruthy()
  act(() => { option.click() })
  act(() => sheetRoot.unmount())
  box.remove()
  await mount()
}

describe('Settings — missed-workout nudge, web push', () => {

  it('is off by default, under the reminder, with no tone until it is on', async () => {
    await mount()
    expect(nudgeRow()).toBeTruthy()
    expect(toneRow()).toBeFalsy()
    expect(host.textContent).not.toContain('After 3 missed days in a row')
  })

  it('switches on, keeps the reminder as it was, and offers the three tones', async () => {
    await mount()
    await toggleNudge()
    expect(mocks.S.reminder).toMatchObject({ on: true, time: '08:00', nudge: true })
    expect(toneRow().textContent).toContain('Friendly')
    expect(host.textContent).toContain('After 3 missed days in a row it goes quiet until your next workout.')
    await choose('Drill sergeant')
    expect(mocks.S.reminder.tone).toBe('drill')
    expect(toneRow().textContent).toContain('Drill sergeant')
    await choose('Guilt trip')
    expect(mocks.S.reminder.tone).toBe('guilt')
    await toggleNudge()
    expect(mocks.S.reminder.nudge).toBe(false)
    expect(toneRow()).toBeFalsy()
  })

  it('is not offered while the reminder is off', async () => {
    mocks.S.reminder = { on: false, time: '08:00', nudge: true }
    await mount()
    expect(nudgeRow()).toBeFalsy()
  })
})
