// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MuscleExplorer from '../src/components/MuscleExplorer'
import { useStore, freshState } from '../src/store/useStore'
import { createExerciseIndex } from '@opengym/core/exercises'
import { configureUx, createBrowserUx } from '../src/platform/ux'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  const customEx = [{ id: 'cqa1', n: 'QA Custom Thrust', bp: 'upper legs', eq: 'barbell', custom: true, desc: '', tg: 'gluteal', sm: ['forearm', 'hip-flexors'], primaries: ['gluteal'], secondaries: ['forearm', 'hip-flexors'], muscleGroups: ['gluteal', 'forearm', 'hip-flexors'] }]
  useStore.setState({ S: { ...freshState(), customEx }, index: createExerciseIndex(customEx) })
  configureUx({ ...createBrowserUx(), observeIntersection: () => null })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
describe('muscle names in the rows and tags (QA C9)', () => {
  it('Muscles explorer row names the target the same way', () => {
    act(() => root.render(<MuscleExplorer onDetail={vi.fn()} onPlan={vi.fn()} />))
    const chip = [...host.querySelectorAll<HTMLButtonElement>('.chip[aria-pressed]')].find(e => e.textContent!.startsWith('Glutes'))!
    act(() => chip.click())
    const input = host.querySelector<HTMLInputElement>('.search input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'QA Custom')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const row = [...host.querySelectorAll('.item')].find(e => e.textContent!.includes('QA Custom Thrust'))!
    expect(row.querySelector('.ss')!.textContent).toBe('Primary target · Glutes · barbell')
  })
})
