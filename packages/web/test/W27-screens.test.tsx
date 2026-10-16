// @vitest-environment happy-dom
import './helpers/plan-views'
import './workout-sheet-environment'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, it, expect, vi } from 'vitest'
import { EXIDX, createExerciseIndex } from '@opengym/core/exercises'
import { freshState, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { bindUI } from '../src/components/ui'
import { exerciseDetailSheet, exConfigSheet, exercisePicker } from '../src/sheets/sheets-exercises'
import { workoutDetailSheet } from '../src/sheets-plan-history'
import { setupPlanHistoryTest } from './helpers/plan-history'
import Library from '../src/views/Library'
import MuscleExplorer from '../src/components/MuscleExplorer'
import RoutineEdit from '../src/views/RoutineEdit'
import Workout from './W17-harness'

const ex = EXIDX['0025']!
let roots: Root[] = [], hosts: HTMLElement[] = []
function mount(node: ReactNode) { const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root); hosts.push(host); act(() => root.render(node)); return host }
function sheet() { const top = useUI.getState().sheets.at(-1)!; return mount(top.render(() => {})) }
beforeEach(() => {
  setupPlanHistoryTest(); bindUI(useUI)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  const S = { ...freshState(), gifSize: 'full', routines: [{ id: 'r1', name: 'Push', ex: [{ id: ex.id, sets: 1, reps: 5, weight: 20 }] }] }
  useStore.setState({ S, index: createExerciseIndex(), user: null }); useUI.setState({ sheets: [] })
})
afterEach(() => { act(() => roots.forEach(r => r.unmount())); hosts.forEach(h => h.remove()); roots = []; hosts = []; vi.restoreAllMocks(); vi.useRealTimers() })
it('renders catalogue animation in exercise detail', () => { exerciseDetailSheet(ex); expect(sheet().querySelector('video.catvid')).toBeTruthy() })
it('renders catalogue animation in exercise configuration', () => { exConfigSheet(ex, null, () => {}); expect(sheet().querySelector('video.catvid')).toBeTruthy() })
it('renders lazy catalogue thumbs in picker rows', () => { exercisePicker(() => {}); expect(sheet().querySelector('.item img.thumb[loading=lazy]')).toBeTruthy() })
it('renders catalogue thumbs in library rows', () => { expect(mount(<Library />).querySelector('.item img.thumb')).toBeTruthy() })
it('renders catalogue thumbs in routine editor rows', () => { const host = mount(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>); expect(host.querySelector('[data-routine-row] img.thumb')).toBeTruthy() })
it('renders catalogue thumbs in the muscle explorer list', () => {
  const host = mount(<MuscleExplorer />)
  act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.startsWith('Biceps'))!.click())
  expect(host.querySelector('.list .item img.thumb')).toBeTruthy()
})
it.each(['cards', 'focus'])('renders workout animation and honours small/off in %s view', view => {
  const S = useStore.getState().S
  S.active = { id: 'media-workout', d: '2026-10-15', start: Date.now(), cur: 0, workoutView: view, entries: [{ id: ex.id, target: { sets: 1, reps: 5, weight: 20 }, sets: [{ w: 20, r: 5, done: false }] }] }
  const host = mount(<Workout />)
  expect(host.querySelector('video.catvid')).toBeTruthy()
  act(() => host.querySelector<HTMLButtonElement>('.giftoggle')!.click()); expect(host.querySelector('video')).toBeNull(); expect(host.querySelector('.wthumb img.thumb')).toBeTruthy()
  act(() => host.querySelector<HTMLButtonElement>('.wthumb')!.click()); expect(host.querySelector('video')).toBeTruthy()
  act(() => useStore.getState().update(s => { s.gifSize = 'off' })); expect(host.querySelector('.exmedia,.wthumb')).toBeNull()
})
it('renders catalogue thumbs in past-workout detail exercise rows (legacy sheets:2488)', () => {
  workoutDetailSheet({ id: 'w1', name: 'Push', d: '2026-09-16', start: 1000, end: 2000, entries: [{ id: ex.id, sets: [{ w: 20, r: 5, done: true }] }] })
  expect(sheet().querySelector('.wd-ex img.thumb')).toBeTruthy()
})
