// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { useListReorder } from '../src/lib/use-list-reorder'
import SwipeRow from '../src/components/SwipeRow'

let host: HTMLDivElement, root: Root
function pointer(el: Element, type: string, x: number, y = 10) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, button: 0 })
  act(() => { el.dispatchEvent(event) })
}
function List({ onMove, identity = 'A' }: { onMove: (from: number, to: number) => void; identity?: string }) {
  const reorder = useListReorder(2, onMove, identity)
  return <div ref={reorder.listRef}>{[0, 1].map(i => <div key={i} data-reorder-row><button {...reorder.handle(i)}>Move</button></div>)}</div>
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers(); configureUx(createBrowserUx())
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const i = [...(this.parentElement?.children ?? [])].indexOf(this)
    return { top: i * 60, height: 60 } as DOMRect
  })
  vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(() => {
    let timer: ReturnType<typeof setTimeout>
    return { set onfinish(fn: () => void) { timer = setTimeout(fn, 180) }, cancel() { clearTimeout(timer) } } as unknown as Animation
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
it('a drag retains the pointer-down move callback across a rerender', () => {
  const a = vi.fn(), b = vi.fn()
  act(() => root.render(<List onMove={a} />))
  const handle = host.querySelector('button')!
  pointer(handle, 'pointerdown', 100); pointer(handle, 'pointermove', 100, 90)
  act(() => root.render(<List onMove={b} />)); pointer(handle, 'pointerup', 100, 90)
  expect(a).toHaveBeenCalledWith(0, 1); expect(b).not.toHaveBeenCalled()
})
it('a changed list identity cancels the pending drag', () => {
  const move = vi.fn()
  act(() => root.render(<List onMove={move} />))
  const handle = host.querySelector('button')!
  pointer(handle, 'pointerdown', 100); pointer(handle, 'pointermove', 100, 90)
  act(() => root.render(<List onMove={move} identity='B' />)); pointer(handle, 'pointerup', 100, 90)
  expect(move).not.toHaveBeenCalled()
})
it.each(['delete', 'copy'] as const)('a pending %s keeps the commit-start callback across a rerender', side => {
  const a = vi.fn(), b = vi.fn()
  act(() => root.render(<SwipeRow onDelete={a} onCopy={a}>Row</SwipeRow>))
  const row = host.querySelector('.swrow')!, start = side === 'delete' ? 330 : 60, end = side === 'delete' ? 60 : 330
  pointer(row, 'pointerdown', start); pointer(row, 'pointermove', end); pointer(row, 'pointerup', end)
  act(() => root.render(<SwipeRow onDelete={b} onCopy={b}>Row</SwipeRow>))
  act(() => vi.advanceTimersByTime(800))
  expect(a).toHaveBeenCalledOnce(); expect(b).not.toHaveBeenCalled()
})
it.each(['delete', 'copy'] as const)('a changed closeKey cancels a pending %s', side => {
  const commit = vi.fn()
  act(() => root.render(<SwipeRow closeKey='A' onDelete={commit} onCopy={commit}>Row</SwipeRow>))
  const row = host.querySelector('.swrow')!, start = side === 'delete' ? 330 : 60, end = side === 'delete' ? 60 : 330
  pointer(row, 'pointerdown', start); pointer(row, 'pointermove', end); pointer(row, 'pointerup', end)
  act(() => root.render(<SwipeRow closeKey='B' onDelete={commit} onCopy={commit}>Row</SwipeRow>))
  act(() => vi.advanceTimersByTime(800)); expect(commit).not.toHaveBeenCalled()
})

it.each(['delete', 'copy'] as const)('a %s snapshots at pointer-down before any move, across a callback rerender', side => {
  const a = vi.fn(), b = vi.fn()
  act(() => root.render(<SwipeRow onDelete={a} onCopy={a}>Row</SwipeRow>))
  const row = host.querySelector('.swrow')!, start = side === 'delete' ? 330 : 60, end = side === 'delete' ? 60 : 330
  pointer(row, 'pointerdown', start)
  act(() => root.render(<SwipeRow onDelete={b} onCopy={b}>Row</SwipeRow>))
  pointer(row, 'pointermove', end); pointer(row, 'pointerup', end)
  act(() => vi.advanceTimersByTime(800))
  expect(a).toHaveBeenCalledOnce(); expect(b).not.toHaveBeenCalled()
})
it.each(['delete', 'copy'] as const)('a changed closeKey cancels %s before release', side => {
  const a = vi.fn(), b = vi.fn()
  act(() => root.render(<SwipeRow closeKey='A' onDelete={a} onCopy={a}>Row</SwipeRow>))
  const row = host.querySelector('.swrow')!, start = side === 'delete' ? 330 : 60, end = side === 'delete' ? 60 : 330
  pointer(row, 'pointerdown', start); pointer(row, 'pointermove', end)
  act(() => root.render(<SwipeRow closeKey='B' onDelete={b} onCopy={b}>Row</SwipeRow>))
  pointer(row, 'pointerup', end); act(() => vi.advanceTimersByTime(800))
  expect(a).not.toHaveBeenCalled(); expect(b).not.toHaveBeenCalled()
  expect(host.querySelector('.swfront')?.getAttribute('style')).not.toContain('translateX')
})
it('pointer cancellation never commits an armed row', () => {
  const commit = vi.fn()
  act(() => root.render(<SwipeRow onDelete={commit} onCopy={commit}>Row</SwipeRow>))
  const row = host.querySelector('.swrow')!
  pointer(row, 'pointerdown', 330); pointer(row, 'pointermove', 60); pointer(row, 'pointercancel', 60)
  act(() => vi.advanceTimersByTime(800)); expect(commit).not.toHaveBeenCalled()
})
