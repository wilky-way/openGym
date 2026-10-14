import { useUI } from '../src/store/useUI'
// @vitest-environment happy-dom
// QA round 2 (2026-10-06): on a busy phone the last moves of a fast swipe can be dropped, so the
// row stopped where the last move left it (84 of 310 px) and only opened. The release now counts
// where the finger lifted.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import SwipeRow from '../src/components/SwipeRow'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const pe = (type: string, x: number, t: number) => {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: 'touch' }, clientX: { value: x }, clientY: { value: 100 }, timeStamp: { value: t } })
  return e
}
let widthDesc: PropertyDescriptor | undefined
beforeEach(() => {
  configureUx(createBrowserUx())
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-15T12:00:00Z'))
  // Finish Web Animations on the fake clock; happy-dom's document timeline uses its own clock.
  const animate = HTMLElement.prototype.animate
  vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(function (this: HTMLElement, frames, options) {
    const animation = animate.call(this, frames, options)
    void animation.finished.catch(() => {})
    const delay = typeof options === 'number' ? options : Number(options?.duration) || 0
    setTimeout(() => animation.finish(), delay)
    return animation
  })
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
  widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 360 }, configurable: true })
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDesc); else Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth') })

async function swipe(moves: number[], upX: number) {
  const onDelete = vi.fn()
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => { root.render(<SwipeRow onDelete={onDelete}><span>row</span></SwipeRow>) })
  const row = host.querySelector<HTMLElement>('.swrow')!
  await act(async () => { row.dispatchEvent(pe('pointerdown', 340, 0)) })
  let t = 0
  for (const x of moves) await act(async () => { row.dispatchEvent(pe('pointermove', x, t += 20)) })
  await act(async () => { row.dispatchEvent(pe('pointerup', upX, 300)) })
  await act(async () => { await vi.advanceTimersByTimeAsync(900) })
  const out = { deleted: onDelete.mock.calls.length, transform: host.querySelector<HTMLElement>('.swfront')!.style.transform }
  act(() => root.unmount()); host.remove()
  return out
}

it('a swipe whose last moves were dropped still deletes: the finger lifted far past the line', async () => {
  const r = await swipe([316, 291, 274, 256], 30)
  expect(r.deleted).toBe(1)
})

it('every move delivered deletes as before', async () => {
  const r = await swipe([316, 291, 274, 256, 180, 100, 30], 30)
  expect(r.deleted).toBe(1)
})

it('a short swipe lifted where the last move was still only opens the row', async () => {
  const r = await swipe([316, 291, 274, 256], 256)
  expect(r.deleted).toBe(0)
})

it('cancelling a committed swipe on a replacement row reports it once and writes nothing', async () => {
 const onDelete = vi.fn(), toast = vi.spyOn(useUI.getState(), 'toast').mockImplementation(() => {})
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
 try {
  act(() => root.render(<SwipeRow closeKey="A" onDelete={onDelete}>row</SwipeRow>)); const row = host.querySelector<HTMLElement>('.swrow')!
  act(() => {row.dispatchEvent(pe('pointerdown', 340, 0)); row.dispatchEvent(pe('pointermove', 30, 100)); row.dispatchEvent(pe('pointerup', 30, 200))})
  act(() => root.render(<SwipeRow closeKey="B" onDelete={onDelete}>replacement</SwipeRow>))
  await act(async () => {await vi.advanceTimersByTimeAsync(900)})
  expect(onDelete).not.toHaveBeenCalled(); expect(toast).toHaveBeenCalledExactlyOnceWith('The row changed. Swipe it again.')
 } finally {act(() => root.unmount()); host.remove()}
})
