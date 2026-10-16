// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import SettingsB, { configureSettingsB, type SettingsBPage, type SettingsBServices } from '../src/views/SettingsB'
import { useStore, freshState } from '../src/store/useStore'
import { bindUI } from '../src/components/ui'
import { useUI } from '../src/store/useUI'
import { configureUx, createBrowserUx } from '../src/platform/ux'
const duration = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('../src/components/DurationWheel', () => ({ durationSheet: duration.open }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root, services: SettingsBServices
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-02-18T12:00:00Z'))
 configureUx(createBrowserUx()); bindUI(useUI)
 useUI.setState({ sheets: [] })
 useStore.setState({ S: freshState(), user: null, setUnit: vi.fn() })
 services = { navigate: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(), equipmentProfileSheet: vi.fn(), plateInventorySheet: vi.fn(), dumbbellInventorySheet: vi.fn() }
 configureSettingsB(services); duration.open.mockClear()
 host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const mount = (page: SettingsBPage) => act(() => root.render(<SettingsB page={page} />))
const row = (title: string) => [...host.querySelectorAll<HTMLElement>('.lrow')].find(e => e.querySelector('.lrow-t')?.textContent === title)!
const click = (el: HTMLElement) => act(() => el.click())
const pick = (title: string, label: string) => click([...row(title).querySelectorAll<HTMLButtonElement>('button')].find(e => e.textContent === label)!)
const toggle = (title: string) => click(row(title).querySelector<HTMLButtonElement>('[role=switch]')!)

describe('Settings B — state preservation', () => {
 it('rest wheels save only on Done and retain the main and burst bounds', () => {
  mount('workout'); click(row('Rest timer'))
  const main = duration.open.mock.calls[0]![0]
  expect(main).toMatchObject({ value: 90, max: 900, off: 'Off' })
  expect(useStore.getState().S.restSec).toBe(90)
  act(() => main.onDone(0)); expect(useStore.getState().S.restSec).toBe(0)
  click(row('Rest-pause rest')); const burst = duration.open.mock.calls[1]![0]
  expect(burst).toMatchObject({ min: 5, max: 300, value: 15 })
  act(() => burst.onDone(25)); expect(useStore.getState().S.restPauseSec).toBe(25)
 })
 it('offers conversion and relabeling, leaving the choice untouched until the menu action', () => {
  mount('units'); pick('Weight unit','lb')
  expect(useStore.getState().S.unit).toBe('kg'); expect(useStore.getState().setUnit).not.toHaveBeenCalled()
  const menu = vi.mocked(services.menuSheet).mock.calls[0]![0]
  expect(menu.title).toBe('Convert to lb?')
  menu.items[0]!.onClick(); expect(useStore.getState().setUnit).toHaveBeenLastCalledWith('lb',undefined)
  menu.items[1]!.onClick(); expect(useStore.getState().setUnit).toHaveBeenLastCalledWith('lb',{ convert: false })
  pick('Weight unit','kg'); expect(services.menuSheet).toHaveBeenCalledTimes(1)
 })
 it('changes only the displayed decimals and keeps English-only controls absent', () => {
  useStore.getState().update(s => { s.lang = 'de'; s.exWeights = { x: 20.125 } })
  const before = structuredClone(useStore.getState().S)
  mount('units'); pick('Weight decimals','0.25')
  expect(useStore.getState().S).toEqual({ ...before, wdec: 2 })
  expect(host.textContent).not.toContain('Language'); expect(useStore.getState().S.lang).toBe('de')
 })
 it('effort falls back to showRir, remembers RPE when disabled and leaves logged scales unchanged', () => {
  useStore.getState().update(s => { s.effort = null; s.showRir = true; s.workouts = [{ id: 'synthetic', ex: [{ id: 'x', sets: [{ r: 5, rir: 2, effortScale: 'rir' }] }] }] })
  const logs = structuredClone(useStore.getState().S.workouts)
  mount('workout'); expect(row('Effort scale').querySelector('[aria-pressed=true]')?.textContent).toBe('RIR')
  pick('Effort scale','RPE'); expect(useStore.getState().S).toMatchObject({ effort: 'rpe', lastEffortScale: 'rpe' })
  expect(useStore.getState().S).not.toHaveProperty('showRir')
  toggle("Don't track effort"); expect(useStore.getState().S.effort).toBe('none')
  toggle("Don't track effort"); expect(useStore.getState().S.effort).toBe('rpe')
  expect(useStore.getState().S.workouts).toEqual(logs)
 })
 it('restores RIR by default and permits either segmented scale from none', () => {
  mount('workout'); toggle("Don't track effort"); expect(useStore.getState().S.effort).toBe('rir')
  toggle("Don't track effort"); pick('Effort scale','RPE'); expect(useStore.getState().S.effort).toBe('rpe')
 })
 it('collapse preference clears only the active override, and layout changes only the saved default', () => {
  useStore.getState().update(s => { s.active = { id: 'session', workoutView: 'focus', collapseCompleted: false, ex: [] } })
  mount('workout'); toggle('Collapse completed exercises')
  expect(useStore.getState().S.collapseCompleted).toBe(true)
  expect(useStore.getState().S.active).toEqual({ id: 'session', workoutView: 'focus', ex: [] })
  pick('Layout','List'); expect(useStore.getState().S.workoutView).toBe('list')
  expect(useStore.getState().S.active.workoutView).toBe('focus')
 })
 it('fine-tuning overlays defaults and preserves unrelated control values', () => {
  useStore.getState().update(s => { s.wc = { exerciseButtons: true, future: 'kept' } })
  mount('advanced'); toggle('Weight and reps buttons')
  expect(useStore.getState().S.wc).toEqual({ steppers: false, setShortcuts: false, pairButtons: false, exerciseButtons: true, exerciseChips: true, swipeSets: true, future: 'kept' })
 })
 it('equipment summaries follow each unit and inventory taps delegate to typed services', () => {
  useStore.getState().update(s => { s.plates = { kg: { 20: 2 }, lb: { 45: 1 } }; s.dumbbells = { kg: { weights: [8,4,8] }, lb: { weights: [10] } } })
  mount('equipment'); expect(row('Plates').textContent).toContain('20×2'); expect(row('Dumbbells').textContent).toContain('4 · 8')
  click(row('Plates')); click(row('Dumbbells'))
  expect(services.plateInventorySheet).toHaveBeenCalledOnce(); expect(services.dumbbellInventorySheet).toHaveBeenCalledOnce()
  act(() => useStore.getState().update(s => { s.unit = 'lb' }))
  expect(row('Plates').textContent).toContain('45×1'); expect(row('Dumbbells').textContent).toContain('10')
 })
 it('deleting an equipment profile waits for confirmation, picks a surviving active id, and preserves data', () => {
  useStore.getState().update(s => { s.equipProfiles = [{ id: 'home', name: 'Home', equipment: [] }, { id: 'gym', name: 'Gym', equipment: ['dumbbell'] }]; s.activeEquipId = 'home'; s.workouts = [{ id: 'kept' }] })
  mount('equipment'); click(row('Home').querySelector<HTMLButtonElement>('[aria-label=Delete]')!)
  expect(useStore.getState().S.equipProfiles).toHaveLength(2)
  expect(services.equipmentProfileSheet).not.toHaveBeenCalled()
  act(() => vi.mocked(services.confirmSheet).mock.calls[0]![0].onConfirm())
  expect(useStore.getState().S.activeEquipId).toBe('gym'); expect(useStore.getState().S.workouts).toEqual([{ id: 'kept' }])
  click(row('Add equipment profile')); expect(services.equipmentProfileSheet).toHaveBeenCalledWith(null)
 })
 it('starter plan and fine tuning delegate navigation through the injected services', () => {
  mount('plan'); click(row('Load starter plan')); expect(services.starterPlanSheet).toHaveBeenCalledOnce()
  mount('workout'); click(row('Fine-tuning')); expect(services.navigate).toHaveBeenCalledWith('/settings/advanced')
 })
 it('catalogue media controls follow and persist saved preferences', () => {
  useStore.getState().update(s => { s.gifSize = 'mini'; s.exFigure = 'female' })
  const before = structuredClone(useStore.getState().S)
  mount('workout'); expect(host.textContent).not.toContain('Exercise animations')
  mount('look'); expect(host.textContent).toContain('Exercise drawings')
  expect(useStore.getState().S).toEqual(before)
  pick('Exercise animations', 'Off'); expect(useStore.getState().S.gifSize).toBe('off')
  pick('Exercise drawings', 'Male'); expect(useStore.getState().S.exFigure).toBe('male')
 })
})
