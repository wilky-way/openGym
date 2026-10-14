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
let callback: IntersectionObserverCallback
let watched: Element | null
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  const S = freshState(); useStore.setState({ S, index: createExerciseIndex(S.customEx) })
  watched = null
  configureUx({ ...createBrowserUx(), observeIntersection: cb => {
    callback = cb
    return { observe: (el: Element) => { watched = el }, disconnect: () => { watched = null } } as unknown as IntersectionObserver
  } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
describe('lists load their next page as you scroll', () => {
  it('muscle explorer: the results of a muscle load on too', () => {
    act(() => root.render(<MuscleExplorer onDetail={vi.fn()} onPlan={vi.fn()} />))
    const chips = [...host.querySelectorAll<HTMLButtonElement>('.chip[aria-pressed]')]
    const biggest = chips.reduce((a, b) => (Number(b.querySelector('.dim')!.textContent) > Number(a.querySelector('.dim')!.textContent) ? b : a))
    act(() => biggest.click())
    const before = host.querySelectorAll('.list > .item').length
    expect(before).toBe(40)
    act(() => callback([{ target: watched!, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(host.querySelectorAll('.list > .item').length).toBeGreaterThan(before)
  })
})
