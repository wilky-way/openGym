// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))
vi.mock('../lib/plan-share.js', async importOriginal => ({ ...await importOriginal(), printPlan: vi.fn() }))
import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { printPlan } from '../lib/plan-share.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host

function mount(ex, name = 'Push day') {
  const S = JSON.parse(JSON.stringify(DEF))
  S.routines = [{ id: 'r1', name, emoji: 'dumbbell', ex }]
  useStore.setState({ S, user: { id: 'u1', name: 'Ana' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
}
const printButton = () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Print / Save as PDF')

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('RoutineEdit — print this routine (#282)', () => {
  it('opens the print dialog with this routine alone on the web', () => {
    mount([{ id: '0025', sets: 3, mode: 'reps', reps: 5, weight: 80 }])
    act(() => printButton().click())
    expect(printPlan).toHaveBeenCalledOnce()
    const [S, owner, opts] = printPlan.mock.calls[0]
    expect(S.routines[0].id).toBe('r1')
    expect(owner).toBe('Ana')
    expect(opts).toEqual({ routineId: 'r1' })
  })

  it('has nothing to print for an empty routine', () => {
    mount([])
    expect(printButton().disabled).toBe(true)
  })
})
