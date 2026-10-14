// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Heatmap from '../src/components/Heatmap'
import WorkoutChips from '../src/components/WorkoutChips'
import { useStore } from '../src/store/useStore'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { createExerciseIndex } from '@opengym/core/exercises'

let host: HTMLDivElement, root: Root
const original = useStore.getState()
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  configureUx(createBrowserUx())
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useStore.setState(original); vi.useRealTimers() })
it('Heatmap forwards the real custom single-arm index through volumeOf and workoutVolume', () => {
  const customEx = [{ id: 'custom_single', n: 'Single Arm Synthetic Press', eq: 'dumbbell', bp: 'upper arms', tm: 'triceps', custom: true }]
  const S = { unit: 'kg', customEx, workouts: [{ d: '2026-01-14', start: 0, end: 60_000,
    entries: [{ id: 'custom_single', target: { dbLoad: 'each' }, sets: [{ w: 10, r: 3, done: true }] }] }] }
  act(() => root.render(<Heatmap S={S} metric="vol" />))
  const day = host.querySelector<HTMLElement>('[title^="2026-01-14"]')!
  expect(day.title).toContain('30 kg')
  expect(day.title).not.toContain('60 kg')
})
it('WorkoutChips resolves custom exercise names through the store index', () => {
  const index = createExerciseIndex([{ id: 'custom_assisted', n: 'Synthetic Assisted Lift', eq: 'assisted machine', bp: 'back', tm: 'lats', custom: true }])
  useStore.setState({ index })
  act(() => root.render(<WorkoutChips entries={[{ id: 'custom_assisted', sets: [{ w: 10, r: 3, done: true }] }]} cur={0} onPick={() => {}} />))
  const chip = host.querySelector('button')!
  expect(chip.title).toBe('Synthetic Assisted Lift')
  expect(chip.getAttribute('aria-label')).toBe('Exercise 1: Synthetic Assisted Lift (Finished)')
})
