// @vitest-environment happy-dom
import '../helpers/plan-views'

// The setting is only worth anything if the screens actually follow it: the toggle has to
// write the field, and the Plan list has to draw the week in that order.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from '../../src/views/Plan'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks: any = vi.hoisted(() => {
  const state: any = { S: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: (mut: any) => {
      const next: any = structuredClone(state.S)
      mut(next)
      state.S = next
    },
     setUser: vi.fn(), pullState: vi.fn(), pushState: vi.fn(),
    signOut: vi.fn(), signOutAll: vi.fn(), resetDemo: vi.fn(), disconnectServer: vi.fn(),
  })
  return state
})
vi.mock('../../src/store/useStore', () => {
  const useStore: any = (selector: any) => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
 useStore.subscribe = () => () => {}
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('../../src/store/useUI', () => {
  const snap: any = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI: any = (selector: any) => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../../src/sheets', () => ({
  starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(),
  importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(),
  dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), planToolsSheet: vi.fn(),
}))



let host: any, root: any
beforeEach(() => {
  mocks.S = {
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: false, effort: 'none',
    gifSize: 'full', workouts: [], routines: [], exWeights: {}, week: {}, dayPlan: {},
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const segButton: any = (label: any) => [...host.querySelectorAll('.seg button')].find((b: any) => b.textContent === label)
const dayRows: any = () => [...host.querySelectorAll('.item .tt')].map((e: any) => e.textContent)

describe('Plan — the week schedule follows the setting', () => {
  const mount: any = () => act(() => root.render(<Plan />))
  const planDays: any = () => [...host.querySelectorAll('.plan-day')].map((e: any) => e.getAttribute('aria-label'))

  it('runs Monday to Sunday by default', () => {
    mount()
    expect(planDays()).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'])
  })

  it('runs Sunday to Saturday for a Sunday profile', () => {
    mocks.S.weekStart = 0
    mount()
    expect(planDays()).toEqual(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'])
  })

  it('keeps a routine attached to its day, not to its position in the list', () => {
    mocks.S.routines = [{ id: 'r1', name: 'Push', emoji: null, ex: [] }]
    mocks.S.week = { 0: 'r1' }        // Sunday
    mocks.S.weekStart = 0
    mount()
    const rows: any = [...host.querySelectorAll('.plan-day')]
    expect(rows[0].getAttribute('aria-label')).toBe('Sunday')
    expect(rows[0].querySelector('.tt').textContent).toBe('Push')
    expect(rows[1].textContent).not.toContain('Push')
  })
})

describe('Plan — a combined day (combine routines)', () => {
  const mount: any = () => act(() => root.render(<Plan />))
  const day: any = (name: any) => [...host.querySelectorAll('.plan-day')].find((el: any) => el.getAttribute('aria-label') === name)

  beforeEach(() => {
    mocks.S.routines = [
      { id: 'r1', name: 'Push', emoji: null, ex: [{ id: 'a' }, { id: 'b' }] },
      { id: 'r2', name: 'Core', emoji: null, ex: [{ id: 'c' }] },
    ]
  })

  it('reads as one session with both names and the routine count', () => {
    mocks.S.week = { 1: ['r1', 'r2'] }
    mount()
    const mon: any = day('Monday')
    expect(mon.querySelector('.tt').textContent).toBe('Push + Core')
    expect(mon.querySelector('.ss').textContent).toBe('2 routines')
  })

  it('an empty day is a rest day, one tappable row', () => {
    mocks.S.week = {}
    mount()
    const tue: any = day('Tuesday')
    expect(tue.querySelector('.tt').textContent).toBe('Rest day')
    expect(tue.getAttribute('role')).toBe('button')
    expect(tue.querySelectorAll('button').length).toBe(0)
  })
})
