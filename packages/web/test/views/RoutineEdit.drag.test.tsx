// @vitest-environment happy-dom
import '../helpers/plan-views'

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sheets: any = vi.hoisted(() => ({
  exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(),
}))
vi.mock('../../src/lib/api', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../../src/sheets', () => sheets)
vi.mock('../../src/components/BodyMap', () => ({ default: () => null }))

import RoutineEdit, { ROUTINE_DRAG_SLOP, ROUTINE_LONG_PRESS_MS, reorderRoutineUnit } from '../../src/views/RoutineEdit'
import { DEF, useStore } from '../../src/store/useStore'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone: any = (value: any) => JSON.parse(JSON.stringify(value))
const configured: any = (id: any, extra: any = {}) => ({ id, mode: 'reps', sets: 3, reps: 5, weight: 0, ...extra })
let root: any
let host: any

function stateFor(entries: any) {
  const S: any = clone(DEF)
  S.routines = [{ id: 'r1', name: 'Drag routine', emoji: 'dumbbell', prog: 'linear', ex: entries }]
  return S
}
function rect(top: any, height: any, left: any = 20, width: any = 340) {
  return { x: left, y: top, left, right: left + width, top, bottom: top + height, width, height }
}
const rows: any = () => [...host.querySelectorAll('[data-routine-row]')]
function geometry(heights: any = rows().map(() => 70)) {
  const list: any = host.querySelector('.routine-list')
  let top: any = 100
  const tops: any = [], bottoms: any = [], centers: any = []
  rows().forEach((row: any, i: any) => {
    const height: any = heights[i] ?? 70
    tops.push(top); bottoms.push(top + height); centers.push(top + height / 2)
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() => rect(tops[i], height))
    top += height + 10
  })
  const listRect: any = rect(80, top - 80)
  vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => listRect)
  return { list, tops, bottoms, centers, listRect }
}
function mount(entries: any) {
  useStore.setState({ S: stateFor(entries), user: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
  return geometry()
}
function remountCurrentState() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
  return geometry()
}
function pointer(target: any, type: any, { id = 7, kind = 'touch', primary = true, button = 0, x = 120, y = 120 }: any = {}) {
  const event: any = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries({ pointerId: id, pointerType: kind, isPrimary: primary, button, clientX: x, clientY: y })) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  act(() => target.dispatchEvent(event))
  return event
}
function lift(row: any, y: any, x: any = 120) {
  pointer(row.querySelector('.item'), 'pointerdown', { x, y })
  act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
}
const exercises: any = () => useStore.getState().S.routines[0].ex

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: any) => window.setTimeout(() => cb(Date.now()), 16))
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: any) => window.clearTimeout(id))
  localStorage.clear()
  Object.values(sheets).forEach((mock: any) => mock.mockReset())
  root = null; host = null
})
afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers()
})

describe('routine long-press reorder', () => {
  it('exports the frozen threshold/slop and keeps a short press as a normal click', () => {
    expect(ROUTINE_LONG_PRESS_MS).toBe(380)
    expect(ROUTINE_DRAG_SLOP).toBe(8)
    const layout: any = mount([configured('1001'), configured('1002')])
    const item: any = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { y: layout.centers[0] })
    act(() => vi.advanceTimersByTime(379))
    expect(host.querySelector('.is-dragging')).toBeNull()
    pointer(item, 'pointerup', { y: layout.centers[0] })
    act(() => item.click())
    expect(sheets.exConfigSheet).toHaveBeenCalledOnce()
    expect(exercises().map((e: any) => e.id)).toEqual(['1001', '1002'])
  })

  it('lifts at exactly 380 ms and yields pre-lift movement strictly over 8 px to scrolling', () => {
    let layout: any = mount([configured('1001'), configured('1002')])
    let item: any = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { x: 100, y: layout.centers[0] })
    const atEight: any = pointer(item, 'pointermove', { x: 108, y: layout.centers[0] })
    expect(atEight.defaultPrevented).toBe(false)
    act(() => vi.advanceTimersByTime(380))
    expect(rows()[0].classList.contains('is-dragging')).toBe(true)
    pointer(item, 'pointercancel', { x: 108, y: layout.centers[0] })

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = mount([configured('1001'), configured('1002')])
    item = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { x: 100, y: layout.centers[0] })
    const atNine: any = pointer(item, 'pointermove', { x: 109, y: layout.centers[0] })
    act(() => vi.advanceTimersByTime(380))
    expect(atNine.defaultPrevented).toBe(false)
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('owns active movement, renders an indicator, and suppresses the compatibility click after cancel', () => {
    const layout: any = mount([configured('1001'), configured('1002'), configured('1003')])
    const row: any = rows()[1], item: any = row.querySelector('.item')
    const capture: any = vi.fn(), release: any = vi.fn()
    item.setPointerCapture = capture; item.releasePointerCapture = release
    lift(row, layout.centers[1])
    expect(capture).toHaveBeenCalledWith(7)
    expect(row.classList.contains('is-dragging')).toBe(true)
    expect(host.querySelector('[data-testid="routine-drop-indicator"]')).toBeTruthy()
    const move: any = pointer(item, 'pointermove', { y: layout.centers[2] })
    expect(move.defaultPrevented).toBe(true)
    pointer(item, 'pointercancel', { y: layout.centers[2] })
    expect(release).toHaveBeenCalledWith(7)
    act(() => item.click())
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
    expect(exercises().map((e: any) => e.id)).toEqual(['1001', '1002', '1003'])
  })

  it('moves across measured slots and persists one complete changed order', () => {
    const layout: any = mount([configured('a'), configured('b'), configured('c'), configured('d')])
    const before: any = localStorage.getItem('gym_state_v1')
    const writes: any = vi.spyOn(Storage.prototype, 'setItem')
    const row: any = rows()[0], item: any = row.querySelector('.item')
    lift(row, layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    expect(exercises().map((e: any) => e.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(JSON.parse(localStorage.getItem('gym_state_v1')!).routines[0].ex.map((e: any) => e.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(localStorage.getItem('gym_state_v1')).not.toBe(before)
    // one save of the copy (beside it the write id other tabs read, useStore persist)
    expect(writes.mock.calls.filter(([k]: any) => k === 'gym_state_v1')).toHaveLength(1)
  })

  it('suppresses the compatibility click after a successful changed drop', () => {
    const layout: any = mount([configured('a'), configured('b'), configured('c')])
    const item: any = rows()[0].querySelector('.item')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    expect(exercises().map((e: any) => e.id)).toEqual(['b', 'c', 'a'])

    act(() => item.click())
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
  })

  it('lets a real tap shortly after a drop open the row again', () => {
    const layout: any = mount([configured('a'), configured('b'), configured('c')])
    const item: any = rows()[0].querySelector('.item')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    expect(exercises().map((e: any) => e.id)).toEqual(['b', 'c', 'a'])

    act(() => vi.advanceTimersByTime(200))
    const target: any = rows()[1].querySelector('.item')
    pointer(target, 'pointerdown', { y: layout.centers[1] })
    pointer(target, 'pointerup', { y: layout.centers[1] })
    act(() => target.click())
    expect(sheets.exConfigSheet).toHaveBeenCalledTimes(1)
  })

  it('never eats a tap that starts with its own pointerdown, even right after a drop', () => {
    const layout: any = mount([configured('a'), configured('b'), configured('c')])
    const item: any = rows()[0].querySelector('.item')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    pointer(item, 'pointerup', { y: layout.centers[2] + 1 })

    const target: any = rows()[1].querySelector('.item')
    pointer(target, 'pointerdown', { y: layout.centers[1] })
    pointer(target, 'pointerup', { y: layout.centers[1] })
    act(() => target.click())
    expect(sheets.exConfigSheet).toHaveBeenCalledTimes(1)
  })

  it('moves a whole grouped unit, never splits another group, and preserves every occurrence payload', () => {
    const pairA: any = configured('dup', { sg: 'pair', weight: 11, note: 'first', future: { a: 1 } })
    const pairB: any = configured('dup', { sg: 'pair', weight: 22, note: 'second', future: { b: 2 } })
    const layout: any = mount([pairA, pairB, configured('c'), configured('d')])
    const row: any = rows()[1], item: any = row.querySelector('.item')
    lift(row, layout.centers[1])
    expect(rows().slice(0, 2).every((node: any) => node.classList.contains('is-dragging'))).toBe(true)
    pointer(item, 'pointermove', { y: layout.listRect.bottom - 1 })
    pointer(item, 'pointerup', { y: layout.listRect.bottom - 1 })
    expect(exercises()).toEqual([configured('c'), configured('d'), pairA, pairB])

    act(() => root.unmount()); host.remove(); root = null; host = null
    const splitLayout: any = mount([configured('a'), configured('b', { sg: 'g' }), configured('c', { sg: 'g' }), configured('tail')])
    const tail: any = rows()[3], tailItem: any = tail.querySelector('.item')
    lift(tail, splitLayout.centers[3])
    const betweenMembers: any = (splitLayout.bottoms[1] + splitLayout.tops[2]) / 2
    pointer(tailItem, 'pointermove', { y: betweenMembers })
    pointer(tailItem, 'pointerup', { y: betweenMembers })
    expect(exercises().map((e: any) => e.id)).toEqual(['a', 'tail', 'b', 'c'])
  })

  it('moves the selected duplicate occurrence rather than finding by catalogue id', () => {
    const first: any = configured('dup', { weight: 10, reps: 3, note: 'first' })
    const second: any = configured('dup', { weight: 20, reps: 9, note: 'second' })
    const layout: any = mount([first, configured('middle'), second, configured('tail')])
    const row: any = rows()[2], item: any = row.querySelector('.item')
    lift(row, layout.centers[2])
    pointer(item, 'pointermove', { y: layout.tops[0] + 1 })
    pointer(item, 'pointerup', { y: layout.tops[0] + 1 })
    expect(exercises()).toEqual([second, first, configured('middle'), configured('tail')])
  })

  it('cancels without persistence on outside release, lost capture, Escape, blur, hidden document, or second pointer', () => {
    const cancelCases: any = ['outside', 'lost', 'escape', 'blur', 'hidden', 'second']
    for (const cancel of cancelCases) {
      if (root) { act(() => root.unmount()); host.remove(); root = null; host = null }
      const layout: any = mount([configured('a'), configured('b'), configured('c')])
      const row: any = rows()[0], item: any = row.querySelector('.item')
      const before: any = localStorage.getItem('gym_state_v1')
      lift(row, layout.centers[0])
      pointer(item, 'pointermove', { y: layout.centers[2] })
      if (cancel === 'outside') pointer(item, 'pointerup', { x: layout.listRect.right + 20, y: layout.centers[2] })
      if (cancel === 'lost') pointer(item, 'lostpointercapture', { y: layout.centers[2] })
      if (cancel === 'escape') act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
      if (cancel === 'blur') act(() => window.dispatchEvent(new Event('blur')))
      if (cancel === 'hidden') {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
        act(() => document.dispatchEvent(new Event('visibilitychange')))
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
      }
      if (cancel === 'second') pointer(rows()[1].querySelector('.item'), 'pointerdown', { id: 8, y: layout.centers[1] })
      expect(exercises().map((e: any) => e.id), cancel).toEqual(['a', 'b', 'c'])
      expect(localStorage.getItem('gym_state_v1'), cancel).toBe(before)
      expect(host.querySelector('.is-dragging'), cancel).toBeNull()
    }
  })

  it('ignores non-primary/control pointers and leaves accessible move buttons working', () => {
    const layout: any = mount([configured('a'), configured('b')])
    const down: any = host.querySelector('button[aria-label="Move down"]')
    pointer(down, 'pointerdown', { y: layout.centers[0] })
    act(() => vi.advanceTimersByTime(380))
    expect(host.querySelector('.is-dragging')).toBeNull()
    act(() => down.click())
    expect(exercises().map((e: any) => e.id)).toEqual(['b', 'a'])
    const item: any = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { primary: false, y: layout.centers[0] })
    act(() => vi.advanceTimersByTime(380))
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('autoscrolls only after lift and stops frames on cancel', () => {
    const layout: any = mount([configured('a'), configured('b'), configured('c'), configured('d')])
    host.style.overflowY = 'auto'
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 320 })
    Object.defineProperty(host, 'scrollHeight', { configurable: true, value: 900 })
    host.scrollTop = 100
    vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => rect(0, 320))
    const row: any = rows()[2], item: any = row.querySelector('.item')
    pointer(item, 'pointerdown', { y: 310 })
    act(() => vi.advanceTimersByTime(16))
    expect(host.scrollTop).toBe(100)
    act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS - 16 + 16))
    expect(host.scrollTop).toBeGreaterThan(100)
    pointer(item, 'pointercancel', { y: 310 })
    const stopped: any = host.scrollTop
    act(() => vi.advanceTimersByTime(64))
    expect(host.scrollTop).toBe(stopped)
  })

  it('fails closed when row geometry disappears during an active drag', () => {
    const layout: any = mount([configured('a'), configured('b'), configured('c')])
    const row: any = rows()[0], item: any = row.querySelector('.item')
    const before: any = localStorage.getItem('gym_state_v1')
    lift(row, layout.centers[0])
    rows()[1].getBoundingClientRect.mockReturnValue(undefined)
    pointer(item, 'pointermove', { y: layout.centers[2] })
    pointer(item, 'pointerup', { y: layout.centers[2] })
    expect(exercises().map((e: any) => e.id)).toEqual(['a', 'b', 'c'])
    expect(localStorage.getItem('gym_state_v1')).toBe(before)
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('cleans pending and active gestures on unmount without late writes', () => {
    const layout: any = mount([configured('a'), configured('b')])
    const item: any = rows()[0].querySelector('.item')
    const before: any = localStorage.getItem('gym_state_v1')
    pointer(item, 'pointerdown', { y: layout.centers[0] })
    act(() => root.unmount()); root = null
    act(() => vi.advanceTimersByTime(1000))
    expect(localStorage.getItem('gym_state_v1')).toBe(before)

    const activeLayout: any = mount([configured('a'), configured('b')])
    const activeItem: any = rows()[0].querySelector('.item')
    const release: any = vi.fn()
    activeItem.releasePointerCapture = release
    lift(rows()[0], activeLayout.centers[0])
    act(() => root.unmount()); root = null
    act(() => vi.advanceTimersByTime(1000))
    expect(release).toHaveBeenCalledWith(7)
    expect(localStorage.getItem('gym_state_v1')).toBe(before)
  })

  it('covers reverse measured slots and an unchanged original slot', () => {
    let layout: any = mount([configured('a'), configured('b'), configured('c'), configured('d')])
    let item: any = rows()[3].querySelector('.item')
    lift(rows()[3], layout.centers[3])
    pointer(item, 'pointermove', { y: layout.tops[1] + 1 })
    pointer(item, 'pointerup', { y: layout.tops[1] + 1 })
    expect(exercises().map((e: any) => e.id)).toEqual(['a', 'd', 'b', 'c'])

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = mount([configured('a'), configured('b'), configured('c')])
    const before: any = localStorage.getItem('gym_state_v1')
    item = rows()[1].querySelector('.item')
    lift(rows()[1], layout.centers[1])
    pointer(item, 'pointermove', { y: layout.centers[1] + ROUTINE_DRAG_SLOP + 1 })
    pointer(item, 'pointerup', { y: layout.centers[1] + ROUTINE_DRAG_SLOP + 1 })
    expect(exercises().map((e: any) => e.id)).toEqual(['a', 'b', 'c'])
    expect(localStorage.getItem('gym_state_v1')).toBe(before)
  })

  it('reads the persisted changed order back after a fresh remount', () => {
    const layout: any = mount([configured('a'), configured('b'), configured('c')])
    const item: any = rows()[0].querySelector('.item')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] + 1 })
    pointer(item, 'pointerup', { y: layout.centers[2] + 1 })
    const saved: any = JSON.parse(localStorage.getItem('gym_state_v1')!)
    act(() => root.unmount()); host.remove(); root = null; host = null
    useStore.setState({ S: saved, user: null })
    remountCurrentState()
    expect(exercises().map((e: any) => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('cancels active ownership for a second pointer outside the list and pending lost capture', () => {
    let layout: any = mount([configured('a'), configured('b'), configured('c')])
    let item: any = rows()[0].querySelector('.item')
    const before: any = localStorage.getItem('gym_state_v1')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] })
    pointer(document.body, 'pointerdown', { id: 8, y: 20 })
    pointer(item, 'pointerup', { y: layout.centers[2] })
    expect(exercises().map((e: any) => e.id)).toEqual(['a', 'b', 'c'])
    expect(localStorage.getItem('gym_state_v1')).toBe(before)
    expect(host.querySelector('.is-dragging')).toBeNull()

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = mount([configured('a'), configured('b')])
    item = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { y: layout.centers[0] })
    pointer(item, 'lostpointercapture', { y: layout.centers[0] })
    act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('cancels when equal serialized exercises acquire a new current routine/list identity', () => {
    let layout: any = mount([configured('a'), configured('b'), configured('c')])
    let item: any = rows()[0].querySelector('.item')
    lift(rows()[0], layout.centers[0])
    pointer(item, 'pointermove', { y: layout.centers[2] })
    act(() => useStore.getState().update((s: any) => {
      const current: any = s.routines[0]
      s.routines[0] = { ...current, ex: clone(current.ex) }
    }))
    pointer(item, 'pointerup', { y: layout.centers[2] })
    expect(exercises().map((e: any) => e.id)).toEqual(['a', 'b', 'c'])
    expect(host.querySelector('.is-dragging')).toBeNull()

    act(() => root.unmount()); host.remove(); root = null; host = null
    layout = mount([configured('a'), configured('b')])
    item = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { y: layout.centers[0] })
    act(() => useStore.getState().update((s: any) => {
      const current: any = s.routines[0]
      s.routines[0] = { ...current, ex: clone(current.ex) }
    }))
    act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
    expect(host.querySelector('.is-dragging')).toBeNull()
  })

  it('never owns nested link, Move up, or Move down controls', () => {
    const layout: any = mount([configured('a'), configured('b')])
    const controls: any = [
      rows()[1].querySelector('button[title]'),
      rows()[1].querySelector('button[aria-label="Move up"]'),
      rows()[1].querySelector('button[aria-label="Move down"]'),
    ]
    for (const control of controls) {
      pointer(control, 'pointerdown', { y: layout.centers[1] })
      act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
      expect(host.querySelector('.is-dragging')).toBeNull()
      pointer(control, 'pointerup', { y: layout.centers[1] })
    }
  })

  it('falls back to page/window autoscroll without a nested scroll host', () => {
    const layout: any = mount([configured('a'), configured('b'), configured('c')])
    const rootElement: any = document.documentElement
    Object.defineProperty(document, 'scrollingElement', { configurable: true, value: rootElement })
    Object.defineProperty(rootElement, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(rootElement, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 })
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 100 })
    const scrollBy: any = vi.spyOn(window, 'scrollBy').mockImplementation((_: any, delta: any) => { window.scrollY += delta })
    const item: any = rows()[2].querySelector('.item')
    lift(rows()[2], 295)
    act(() => vi.advanceTimersByTime(16))
    expect(scrollBy).toHaveBeenCalled()
    expect(window.scrollY).toBeGreaterThan(100)
    pointer(item, 'pointercancel', { y: 295 })
  })

  it('invalidates ownership before cleanup synchronously emits lost capture', () => {
    const layout: any = mount([configured('a'), configured('b')])
    const item: any = rows()[0].querySelector('.item')
    const release: any = vi.fn((pointerId: any) => pointer(document, 'lostpointercapture', { id: pointerId, y: layout.centers[0] }))
    item.releasePointerCapture = release
    lift(rows()[0], layout.centers[0])
    act(() => root.unmount()); root = null
    expect(release).toHaveBeenCalledTimes(1)
  })
})

describe('reorderRoutineUnit', () => {
  it('splices complete units at canonical slots and cleans true orphans', () => {
    const items: any = [configured('a', { sg: 'pair' }), configured('b', { sg: 'pair' }), configured('c', { sg: 'orphan' }), configured('d')]
    expect(reorderRoutineUnit(items, 3, 1)).toBe(true)
    expect(items.map((e: any) => e.id)).toEqual(['a', 'b', 'd', 'c'])
    expect(items[0].sg).toBe('pair'); expect(items[1].sg).toBe('pair'); expect(items[3].sg).toBeUndefined()
  })
})
