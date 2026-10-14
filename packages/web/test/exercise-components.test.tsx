// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import MuscleExplorer, { type MuscleExplorerProps } from '../src/components/MuscleExplorer'
import ExerciseViewToggle from '../src/components/ExerciseViewToggle'
import { useStore, freshState, initializeStore, KEY } from '../src/store/useStore'
import { createExerciseIndex, type Exercise } from '@opengym/core/exercises'
import { configureUx, createBrowserUx } from '../src/platform/ux'

import { initializeSyncEngine } from '../src/store/sync-engine'
import { createBrowserPlatform } from '../src/platform/browser'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
const assisted: Exercise = { id: 'c-component-assisted', n: 'Synthetic assisted curl', custom: true, assisted: true, eq: 'assisted', bp: 'upper arms', tg: 'biceps' }
const dumbbell: Exercise = { id: 'c-component-dumbbell', n: 'Synthetic dumbbell curl', custom: true, eq: 'dumbbell', bp: 'upper arms', tg: 'biceps' }
function seed(customEx: Exercise[] = [assisted, dumbbell]) {
  const S = { ...freshState(), customEx }
  useStore.setState({ S, index: createExerciseIndex(customEx) })
  return S
}
function render(props: MuscleExplorerProps = {}) { act(() => root.render(<MuscleExplorer {...props} />)) }
function selectBiceps() { act(() => [...host.querySelectorAll<HTMLButtonElement>('.chips .chip')].find(el => el.textContent?.startsWith('Biceps'))!.click()) }
function row(name: string) { return [...host.querySelectorAll<HTMLElement>('.list .item')].find(el => el.textContent?.includes(name))! }
function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('.search input')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  configureUx({ ...createBrowserUx(), observeIntersection: () => null })
  seed(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })

describe('exercise components without media', () => {
  it('toggles and persists list/cards through the real store and explorer', () => {
    const platform = createBrowserPlatform()
    platform.kv.remove(KEY)
    initializeStore(platform)
    const originalUpdate = useStore.getState().update
    const dispose = initializeSyncEngine({ platform, api: vi.fn().mockResolvedValue({}),
      prompts: { toast() {}, askAddDeviceData: async () => false } })
    const updater = vi.spyOn(useStore.getState(), 'update')
    try {
      act(() => root.render(<ExerciseViewToggle />))
      const toggle = host.querySelector<HTMLButtonElement>('button')!
      expect(toggle.getAttribute('aria-label')).toBe('Cards')
      expect(toggle.getAttribute('aria-pressed')).toBe('false')
      act(() => toggle.click())
      expect(useStore.getState().S.exerciseView).toBe('cards')
      expect(toggle.getAttribute('aria-pressed')).toBe('true')
      expect(updater).toHaveBeenCalledOnce()
      expect(JSON.parse(platform.kv.get(KEY)!).exerciseView).toBe('cards')
      act(() => { useStore.setState({ S: freshState() }); initializeStore(platform) })
      expect(useStore.getState().S.exerciseView).toBe('cards')
      expect(toggle.getAttribute('aria-pressed')).toBe('true')
      act(() => toggle.click())
      expect(useStore.getState().S.exerciseView).toBe('list')
      expect(updater).toHaveBeenCalledTimes(2)
      expect(JSON.parse(platform.kv.get(KEY)!).exerciseView).toBe('list')
      act(() => { useStore.setState({ S: freshState() }); initializeStore(platform) })
      expect(useStore.getState().S.exerciseView).toBe('list')
      render(); selectBiceps()
      act(() => host.querySelector<HTMLButtonElement>('.ex-view-btn')!.click())
      expect(host.querySelector('.list')!.classList.contains('ex-grid')).toBe(true)
      expect(host.querySelector('img,video,.thumb')).toBeNull()
    } finally { updater.mockRestore(); dispose(); useStore.setState({ update: originalUpdate }); platform.kv.remove(KEY) }
  })
  it('uses the real custom assisted index for the best-load badge', () => {
    const S = useStore.getState().S
    S.workouts = [{ entries: [{ id: assisted.id, sets: [{ w: 30, r: 5, done: true }, { w: 10, r: 5, done: true }] }] },
      { entries: [{ id: assisted.id, sets: [{ w: 20, r: 5, done: true }] }] }]
    render(); selectBiceps()
    expect(row(assisted.n!).querySelector('.tag')!.textContent).toBe('10')
    expect(row(assisted.n!).textContent).toContain('Primary target')
  })
  it('floats favourites first, dispatches row detail and isolates the Plan button', () => {
    useStore.getState().S.favEx = [dumbbell.id]
    const onDetail = vi.fn(), onPlan = vi.fn()
    render({ onDetail, onPlan }); selectBiceps()
    expect(host.querySelector('.list .item')!.textContent).toContain(dumbbell.n)
    expect(row(dumbbell.n!).querySelector('.fav-star')).toBeTruthy()
    act(() => row(dumbbell.n!).click())
    expect(onDetail).toHaveBeenCalledWith(dumbbell)
    act(() => row(dumbbell.n!).querySelector<HTMLButtonElement>('button')!.click())
    expect(onPlan).toHaveBeenCalledWith(dumbbell)
    expect(onDetail).toHaveBeenCalledTimes(1)
  })
  it('selects with keyboard in picker mode and clears the muscle selection', () => {
    const onPick = vi.fn()
    render({ onPick })
    expect(host.textContent).toContain('Choose a muscle to see exercises that train it.')
    selectBiceps()
    act(() => row(assisted.n!).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onPick).toHaveBeenCalledWith(assisted)
    expect(row(assisted.n!).querySelector('button')).toBeNull()
    act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === 'Clear selection')!.click())
    expect(host.querySelector('.list')).toBeNull()
  })
  it('filters the muscle counts and results by active equipment and restores all equipment', () => {
    Object.assign(useStore.getState().S, { equipFilterOn: true, activeEquipId: 'home', equipProfiles: [{ id: 'home', name: 'Home', accV: 1, equipment: ['dumbbell'] }] })
    render(); selectBiceps(); search('Synthetic')
    expect(row(dumbbell.n!)).toBeTruthy()
    expect(row(assisted.n!)).toBeUndefined()
    expect(host.querySelector('.search-count')!.textContent).toBe('1')
    act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === 'Show all equipment')!.click())
    expect(row(assisted.n!)).toBeTruthy()
    expect(host.querySelector('.search-count')!.textContent).toBe('2')
    expect(useStore.getState().S.equipFilterOn).toBe(true)
  })
  it('pages forty at a time with the actual Button ref and resets the page on search', () => {
    seed(Array.from({ length: 85 }, (_, i) => ({ ...dumbbell, id: `c-component-${i}`, n: `Synthetic page curl ${i}` })))
    const observe = vi.fn(), disconnect = vi.fn()
    configureUx({ ...createBrowserUx(), observeIntersection: () => ({ observe, disconnect } as unknown as IntersectionObserver) })
    render(); selectBiceps(); search('Synthetic page')
    expect(host.querySelectorAll('.list .item')).toHaveLength(40)
    const more = [...host.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === 'Show more')!
    expect(observe).toHaveBeenCalledWith(more)
    act(() => more.click())
    expect(host.querySelectorAll('.list .item')).toHaveLength(80)
    search('Synthetic page curl 2')
    expect(host.querySelectorAll('.list .item').length).toBeLessThanOrEqual(40)
  })
})
