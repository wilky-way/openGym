// @vitest-environment happy-dom
import '../helpers/plan-views'

// Plan → Schedule → This week (v1.3.11): one row per weekday, whatever is on it. #276 had moved
// "add a second routine" into a small ＋ in a planned day's header; the day's own picker now does
// all of it (one routine, several for a combined day, or a rest day), so every day is one

// last entry of the Plan menu.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Plan from '../../src/views/Plan'
import { dayAssignSheet, menuSheet } from '../../src/sheets'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks: any = vi.hoisted(() => {
  const state: any = { S: null,  nav: null }
  state.snapshot = () => ({
    S: state.S,
    user: null,
    update: (mut: any) => {
      const next: any = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  return state
})
vi.mock('../../src/store/useStore', () => {
  const useStore: any = (selector: any) => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  useStore.subscribe = () => () => {}
  return { useStore, DEF: { reminder: { time: '17:30' } }, hasData: () => false }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))

vi.mock('../../src/sheets', () => ({
  starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), menuSheet: vi.fn(), confirmSheet: vi.fn(),
  planHasRoutines: (s: any) => (s.routines || []).some((r: any) => r.ex.length), exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))

let host: any, root: any
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.removeItem('gym_plan_view')
  mocks.nav = vi.fn()
  mocks.S = {
    unit: 'kg', workouts: [], exWeights: {}, week: { 1: ['r1'] }, dayPlan: {},
    routines: [{ id: 'r1', name: 'Push', emoji: null, ex: [] }, { id: 'r2', name: 'Pull', emoji: null, ex: [] }],
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount: any = () => act(() => root.render(<Plan />))
const day: any = (name: any) => host.querySelector(`.plan-day[aria-label="${name}"]`)

describe('Plan — the weekday rows', () => {
  it('a planned day keeps its picker tap and offers a read-only preview (W24)', () => {
    mount()
    const monday: any = day('Monday')
    expect(monday.querySelector('.tt').textContent).toBe('Push')
    expect(monday.querySelectorAll('button').length).toBe(1) // W24 deliberately adds the read-only Preview action.
    act(() => monday.click())
    expect(dayAssignSheet).toHaveBeenCalledWith(1)
  })

  it('an empty day is a rest day that asks to be planned, and opens the same picker', () => {
    mount()
    const tuesday: any = day('Tuesday')
    expect(tuesday.textContent).toContain('Rest day')
    expect(tuesday.textContent).toContain('Tap to plan something')
    act(() => tuesday.click())
    expect(dayAssignSheet).toHaveBeenCalledWith(2)
  })

  it('opens on the keyboard too', () => {
    mount()
    act(() => { day('Friday').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(dayAssignSheet).toHaveBeenCalledWith(5)
  })
})

describe('Plan — the menu', () => {
  const openMenu: any = () => {
    act(() => host.querySelector('button[aria-label="Plan options"]').click())
    return (menuSheet as any).mock.calls.at(-1)[0]
  }

  it('greys out share and print while there is nothing to share, and says why', () => {
    mount()
    const menu: any = openMenu()
    const item: any = (label: any) => menu.items.find((i: any) => i && i.label === label)
    expect(item('Export plan file').disabled).toBe(true)
    expect(item('Print / Save as PDF').disabled).toBe(true)
    expect(item('Import a plan file').disabled).toBeFalsy()
    expect(menu.subtitle).toContain('Add an exercise to a routine first')
  })
})
