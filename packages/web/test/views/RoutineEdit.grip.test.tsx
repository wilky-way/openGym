// @vitest-environment happy-dom
import '../helpers/plan-views'

// The drag handle on pointer devices (#277, #114): a visible grip with a grab cursor, and a mouse
// press on it picks the row up at once. The long press everywhere else is unchanged.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

import RoutineEdit, { ROUTINE_LONG_PRESS_MS } from '../../src/views/RoutineEdit'
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
function pointer(target: any, type: any, { id = 7, kind = 'touch', primary = true, button = 0, x = 120, y = 120 }: any = {}) {
  const event: any = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries({ pointerId: id, pointerType: kind, isPrimary: primary, button, clientX: x, clientY: y })) {
    Object.defineProperty(event, key, { configurable: true, value })
  }
  act(() => target.dispatchEvent(event))
  return event
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

const grip: any = (i: any) => rows()[i].querySelector('[data-drag-handle]')
const cssSource: any = readFileSync(process.cwd() + '/src/views/plan.css', 'utf8')

describe('routine drag handle', () => {
  it('puts a grip on every row, out of the accessibility tree, named for what it does', () => {
    mount([configured('1001'), configured('1002')])
    expect(rows().map((row: any) => !!row.querySelector('.item [data-drag-handle] svg'))).toEqual([true, true])
    expect(grip(0).getAttribute('aria-hidden')).toBe('true')
    expect(grip(0).getAttribute('title')).toBe('Reorder exercises')
  })

  it('shows the grip, with a grab cursor, only where there is a mouse or trackpad', () => {
    const base: any = cssSource.match(/\.routine-grip\{[^}]*\}/)?.[0] || ''
    expect(base).toMatch(/display:none/)
    expect(base).toMatch(/cursor:grab/)
    const fine: any = cssSource.match(/@media \(hover:hover\) and \(pointer:fine\)\{\s*\.routine-grip\{display:flex\}/)
    expect(fine).toBeTruthy()
    expect(cssSource).toMatch(/\.routine-list\.is-reordering,\.routine-list\.is-reordering \*\{cursor:grabbing\}/)
  })

  it('keeps the list one column on a computer, where #app lists otherwise go two-up', () => {
    // The reorder reads rows top to bottom; in two columns a drop landed in the wrong place.
    expect(cssSource).toMatch(/@media \(min-width:1000px\)\{[\s\S]*#app \.list\{display:grid/)
    expect(cssSource).toMatch(/#app \.list\.routine-list\{display:flex;flex-direction:column\}/)
  })

  it('picks the row up at once under a mouse and drops it where it is let go', () => {
    const layout: any = mount([configured('a'), configured('b'), configured('c'), configured('d')])
    const down: any = pointer(grip(0), 'pointerdown', { kind: 'mouse', y: layout.centers[0] })
    // No hold: lifted on the press itself, and the press does not go on to select text.
    expect(rows()[0].classList.contains('is-dragging')).toBe(true)
    expect(down.defaultPrevented).toBe(true)
    pointer(grip(0), 'pointermove', { kind: 'mouse', y: layout.centers[2] + 1 })
    pointer(grip(0), 'pointerup', { kind: 'mouse', y: layout.centers[2] + 1 })
    expect(exercises().map((e: any) => e.id)).toEqual(['b', 'c', 'a', 'd'])
    // The click that follows the drop does not open the exercise's settings.
    act(() => grip(2).click())
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
  })

  it('leaves a click on the grip without a move as nothing at all', () => {
    const layout: any = mount([configured('a'), configured('b')])
    pointer(grip(1), 'pointerdown', { kind: 'mouse', y: layout.centers[1] })
    pointer(grip(1), 'pointerup', { kind: 'mouse', y: layout.centers[1] })
    act(() => grip(1).click())
    expect(exercises().map((e: any) => e.id)).toEqual(['a', 'b'])
    expect(sheets.exConfigSheet).not.toHaveBeenCalled()
  })

  it('keeps the long press for a mouse on the rest of the row, and for a finger on the grip', () => {
    const layout: any = mount([configured('a'), configured('b')])
    const item: any = rows()[0].querySelector('.item')
    pointer(item, 'pointerdown', { kind: 'mouse', y: layout.centers[0] })
    expect(rows()[0].classList.contains('is-dragging')).toBe(false)
    act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
    expect(rows()[0].classList.contains('is-dragging')).toBe(true)
    pointer(item, 'pointercancel', { kind: 'mouse', y: layout.centers[0] })

    act(() => vi.advanceTimersByTime(200))
    const touch: any = pointer(grip(1), 'pointerdown', { kind: 'touch', y: layout.centers[1] })
    expect(touch.defaultPrevented).toBe(false)
    expect(rows()[1].classList.contains('is-dragging')).toBe(false)
    act(() => vi.advanceTimersByTime(ROUTINE_LONG_PRESS_MS))
    expect(rows()[1].classList.contains('is-dragging')).toBe(true)
  })

  it('ignores a right-click on the grip', () => {
    const layout: any = mount([configured('a'), configured('b')])
    pointer(grip(0), 'pointerdown', { kind: 'mouse', button: 2, y: layout.centers[0] })
    expect(rows()[0].classList.contains('is-dragging')).toBe(false)
  })
})
