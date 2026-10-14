// @vitest-environment happy-dom
import '../helpers/plan-views'

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/api', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../../src/sheets', () => ({ exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../../src/components/BodyMap', () => ({ default: () => null }))
vi.mock('../../src/sheets-plan-history', async (importOriginal: any) => ({ ...await importOriginal(), printPlan: vi.fn() }))
import RoutineEdit from '../../src/views/RoutineEdit'
import { DEF, useStore } from '../../src/store/useStore'
import { printPlan } from '../../src/sheets-plan-history'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: any, host: any

function mount(ex: any, name: any = 'Push day') {
  const S: any = JSON.parse(JSON.stringify(DEF))
  S.routines = [{ id: 'r1', name, emoji: 'dumbbell', ex }]
  useStore.setState({ S, user: { id: 'u1', name: 'Ana' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
}
const printButton: any = () => [...host.querySelectorAll('button')].find((b: any) => b.textContent.trim() === 'Print / Save as PDF')

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
    const [S, owner, opts] = (printPlan as any).mock.calls[0]
    expect(S.routines[0].id).toBe('r1')
    expect(owner).toBe('Ana')
    expect(opts).toEqual({ routineId: 'r1' })
  })

  it('has nothing to print for an empty routine', () => {
    mount([])
    expect(printButton().disabled).toBe(true)
  })
})
