// @vitest-environment happy-dom
import '../helpers/plan-views'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { DEF, useStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import { createExerciseIndex } from '@opengym/core/exercises'
import { configurePlanHistoryPrint } from '../../src/platform/plan-history'
import RoutineEdit, { removeRoutineExercise } from '../../src/views/RoutineEdit'
const sheets = vi.hoisted(() => ({ exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(), supersetSheet: vi.fn() }))
const body = vi.hoisted(() => vi.fn(() => null))
vi.mock('../../src/sheets', () => sheets)
vi.mock('../../src/components/BodyMap', () => ({ default: body }))
const custom = [
  { id: 'custom-cardio', n: 'Synthetic cardio', bp: 'cardio', tg: 'cardiovascular system', eq: 'other', custom: true },
  { id: 'custom-bw', n: 'Synthetic bodyweight', bp: 'chest', tg: 'chest', eq: 'body weight', custom: true, primaries: ['chest'], secondaries: [] },
  { id: 'custom-loaded', n: 'Synthetic loaded', bp: 'chest', tg: 'chest', eq: 'dumbbell', custom: true, primaries: ['chest'], secondaries: [] },
]
let root: Root, host: HTMLElement
const print = vi.fn()
function mount(ex: any[]) {
  useStore.setState({ S: { ...structuredClone(DEF), customEx: custom, routines: [{ id: 'r', name: 'Synthetic', ex }] }, index: createExerciseIndex(custom), user: null })
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r']}><Routes><Route path='/plan/r/:id' element={<RoutineEdit />} /></Routes></MemoryRouter>))
}
function click(text: string) { act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!.click()) }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  Object.values(sheets).forEach(mock => mock.mockReset()); sheets.exercisePicker.mockReturnValue({ close: vi.fn() }); body.mockClear(); print.mockClear(); configurePlanHistoryPrint(print)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
it('custom lookup supplies the row name and equipment availability', () => {
  mount([{ id: 'custom-loaded', sets: 3, reps: 5, weight: 10 }])
  expect(host.querySelector('.item-open .tt')!.textContent).toBe('Synthetic loaded')
  act(() => useStore.getState().update(s => { s.equipProfiles = [{ id: 'home', name: 'Synthetic home', equipment: ['body weight'] }]; s.activeEquipId = 'home'; s.equipFilterOn = true }))
  expect(host.textContent).toContain('1 of 1 exercises need equipment outside')
})
it('custom cardio defaults are added from quick picker', () => {
  mount([]); click('Add exercise'); act(() => sheets.exercisePicker.mock.calls[0]![0](custom[0], true))
  expect(useStore.getState().S.routines[0].ex[0]).toEqual({ id: 'custom-cardio', sets: 1, min: 20, speed: 8 })
})
it.each([true, false])('custom replacement changes lifting slot to cardio (quick=%s)', quick => {
  mount([{ id: 'custom-bw', sets: 3, reps: 5, weight: 0 }]); act(() => host.querySelector<HTMLElement>('.item')!.click())
  act(() => sheets.exConfigSheet.mock.calls[0]![6]())
  act(() => sheets.exercisePicker.mock.calls[0]![0](custom[0], quick))
  if (quick) expect(useStore.getState().S.routines[0].ex[0]).toEqual({ id: 'custom-cardio', sets: 1, min: 20, speed: 8 })
  else expect(sheets.exConfigSheet.mock.calls[1]![1]).toEqual({ id: 'custom-cardio', sets: 1, min: 20, speed: 8 })
})
it('custom bodyweight prescription line marks an added load', () => {
  mount([{ id: 'custom-bw', sets: 3, reps: 5, weight: 10 }])
  expect(host.querySelector('.item-open .ss')!.textContent).toBe('3 × 5 · +10 kg')
})
it('custom muscle metadata reaches the planned coverage map', () => {
  mount([{ id: 'custom-loaded', sets: 3, reps: 5, weight: 10 }])
  expect((body.mock.calls.at(-1) as any)[0].load.chest).toBeGreaterThan(0)
})
it('custom index reaches generated print HTML', () => {
  mount([{ id: 'custom-bw', sets: 3, reps: 5, weight: 0 }]); click('Print / Save as PDF')
  expect(print.mock.calls[0]![0]).toContain('Synthetic bodyweight'); expect(print.mock.calls[0]![0]).not.toContain('0kg')
})
it('custom removal toast names the exercise from the current index', () => {
  mount([{ id: 'custom-loaded', sets: 3, reps: 5, weight: 10 }]); act(() => { removeRoutineExercise('r', 0) })
  expect(useUI.getState().toastMsg).toBe('“Synthetic Loaded” left the routine.')
})
it('new custom cardio created while the Add picker is open uses the live index', () => {
  mount([]); click('Add exercise')
  const ex = { ...custom[0]!, id: 'created-cardio', n: 'Created synthetic cardio' }
  act(() => useStore.getState().update(s => { s.customEx.push(ex) }))
  act(() => sheets.exercisePicker.mock.calls[0]![0](ex, true))
  expect(useStore.getState().S.routines[0].ex[0]).toEqual({ id: 'created-cardio', sets: 1, min: 20, speed: 8 })
})
it.each([true, false])('new custom cardio created while Replace is open uses the live index (quick=%s)', quick => {
  mount([{ id: 'custom-bw', sets: 3, reps: 5, weight: 0 }]); act(() => host.querySelector<HTMLElement>('.item')!.click())
  act(() => sheets.exConfigSheet.mock.calls[0]![6]())
  const ex = { ...custom[0]!, id: 'created-cardio', n: 'Created synthetic cardio' }
  act(() => useStore.getState().update(s => { s.customEx.push(ex) }))
  act(() => sheets.exercisePicker.mock.calls[0]![0](ex, quick))
  if (quick) expect(useStore.getState().S.routines[0].ex[0]).toEqual({ id: 'created-cardio', sets: 1, min: 20, speed: 8 })
  else expect(sheets.exConfigSheet.mock.calls[1]![1]).toEqual({ id: 'created-cardio', sets: 1, min: 20, speed: 8 })
})
