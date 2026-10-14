// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { Slider } from '../src/components/ui'
import SwipeCards from '../src/components/SwipeCards'

let host: HTMLDivElement, root: Root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  const shellDocument = document.implementation.createHTMLDocument()
  shellDocument.documentElement.dir = 'rtl'
  document.documentElement.dir = 'ltr'
  configureUx({ ...createBrowserUx(), document: shellDocument, reducedMotion: () => true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.documentElement.dir = ''; vi.useRealTimers() })

it('reads slider direction from the injected document', () => {
  const change = vi.fn()
  act(() => root.render(<Slider value={50} onChange={change} />))
  const slider = host.querySelector<HTMLElement>('[role="slider"]')!
  act(() => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
  expect(change).toHaveBeenCalledWith(51)
  act(() => slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(change).toHaveBeenLastCalledWith(49)
})

it('reads card direction and reduced motion from the injected UX adapter', () => {
  const navigate = vi.fn()
  act(() => root.render(<SwipeCards index={0} count={2} renderPreview={() => 'Next'} onNavigate={navigate}>Current</SwipeCards>))
  const card = host.querySelector<HTMLElement>('.workout-swipe-surface')!
  const pointer = (type: string, x: number, timeStamp: number) => {
    const event = new Event(type, { bubbles: true })
    Object.assign(event, { pointerId: 1, pointerType: 'touch', clientX: x, clientY: 20 })
    Object.defineProperty(event, 'timeStamp', { value: timeStamp })
    act(() => card.dispatchEvent(event))
  }
  pointer('pointerdown', 100, 1000); pointer('pointermove', 250, 1100); pointer('pointerup', 250, 1200)
  expect(navigate).toHaveBeenCalledExactlyOnceWith(1)
  expect(host.querySelector('.workout-swipe-preview')).toBeNull()
})
