// @vitest-environment happy-dom
import './workout-sheet-environment'
import {configureUx, createBrowserUx} from '../src/platform/ux'
// @vitest-environment happy-dom
// Hardware keys on the workout screen (issue #133), against the real store and timers: what a
// key press does to the session, not only what lib/workout-keys.js decides.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from '../src/views/Workout'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'

vi.mock('../src/lib/sound', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../src/lib/api', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone: any = (value: any) => JSON.parse(JSON.stringify(value))
const entry: any = (id: any, done: any, extra: any = {}) => ({
  id,
  target: { sets: done.length, reps: 5, weight: 60 },
  sets: done.map((d: any) => ({ w: 60, r: 5, done: d })),
  ...extra,
})

let root: any
let container: any

function renderWorkout(entries: any, cur: any = 0, extra: any = {}) {
  const S: any = clone(DEF)
  S.active = { id: 'keys-test', d: '2026-09-23', start: Date.now(), routineId: null, name: 'Keys', bw: null, cur, entries, ...extra }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<><Workout /></>))
}

const press: any = (key: any, target: any = document.body) => {
  const event: any = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => { target.dispatchEvent(event) })
  return event
}
const active: any = () => useStore.getState().S.active
const doneOf: any = (idx: any) => active().entries[idx].sets.map((s: any) => s.done)

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  root = null
  container = null
})

afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('workout keys (issue #133)', () => {
  it('Space ticks the next open set of the current exercise and starts its rest', () => {
    renderWorkout([entry('1001', [true, false, false]), entry('1002', [false])])
    const event: any = press(' ')
    expect(event.defaultPrevented).toBe(true)   // the page does not scroll as well
    expect(doneOf(0)).toEqual([true, true, false])
    expect(useUI.getState().timer).not.toBeNull()
    press('Enter')
    expect(doneOf(0)).toEqual([true, true, true])
  })

  it('Space and Enter tick Focus sets through the same handler', () => {
    renderWorkout([entry('1001', [false, false])], 0, { workoutView: 'focus' })
    expect(container.querySelector('[data-testid="focus-view"]')).toBeTruthy()
    press(' ')
    press('Enter')
    expect(doneOf(0)).toEqual([true, true])
  })

  it('once the exercise on screen is finished, a press brings up the next one and the next press ticks it', () => {
    renderWorkout([entry('1001', [true]), entry('1002', [false, false])])
    press(' ')
    expect(active().cur).toBe(1)
    expect(doneOf(1)).toEqual([false, false])
    press(' ')
    expect(doneOf(1)).toEqual([true, false])
  })

  it('the arrows switch exercise', () => {
    renderWorkout([entry('1001', [false]), entry('1002', [false]), entry('1003', [false])])
    press('ArrowRight')
    expect(active().cur).toBe(1)
    press('ArrowRight')
    expect(active().cur).toBe(2)
    press('ArrowRight')
    expect(active().cur).toBe(2)
    press('ArrowLeft')
    expect(active().cur).toBe(1)
    expect(doneOf(0).concat(doneOf(1), doneOf(2))).toEqual([false, false, false])
  })

  it('in the list, an arrow that moves the current exercise brings it into view', () => {
    const scrolled: any = []
    const original: any = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: any) { scrolled.push(this) }
    try {
      renderWorkout([entry('1001', [false]), entry('1002', [false])], 0, { workoutView: 'list' })
      act(() => { vi.advanceTimersByTime(100) })
      scrolled.length = 0
      press('ArrowRight')
      act(() => { vi.advanceTimersByTime(100) })
      expect(active().cur).toBe(1)
      expect(scrolled).toHaveLength(1)
      expect(scrolled[0].classList.contains('cur')).toBe(true)
      expect(scrolled[0].getAttribute('data-exidx')).toBe('1')
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('keys typed into a set\'s field stay in the field', () => {
    renderWorkout([entry('1001', [false, false]), entry('1002', [false])])
    const input: any = container.querySelector('.setrow input')
    expect(input).toBeTruthy()
    input.focus()
    for (const key of [' ', 'Enter', 'ArrowRight']) expect(press(key, input).defaultPrevented).toBe(false)
    expect(doneOf(0)).toEqual([false, false])
    expect(active().cur).toBe(0)
  })

  it('does nothing while a sheet is open on top', () => {
    renderWorkout([entry('1001', [false]), entry('1002', [false])])
    useUI.getState().openSheet(() => null)
    press(' ')
    press('ArrowRight')
    expect(doneOf(0)).toEqual([false])
    expect(active().cur).toBe(0)
  })

  it('a timed set is started rather than ticked, and the next press is its Done', () => {
    const plank: any = { id: '1001', target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ sec: 45, w: 0, done: false }] }
    renderWorkout([plank])
    press(' ')
    expect(useUI.getState().work).not.toBeNull()
    expect(doneOf(0)).toEqual([false])
    act(() => { vi.advanceTimersByTime(10_000) })
    press(' ')
    expect(useUI.getState().work).toBeNull()
    expect(doneOf(0)).toEqual([true])
    expect(active().entries[0].sets[0].sec).toBe(10)
  })

  it('a second press right after it starts a hold does not log the hold at a second', () => {
    // A USB button that bounces, or a double press.
    const plank: any = { id: '1001', target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ sec: 45, w: 0, done: false }] }
    renderWorkout([plank])
    press(' ')
    act(() => { vi.advanceTimersByTime(200) })
    const second: any = press(' ')
    expect(second.defaultPrevented).toBe(true)   // still the workout's key, it just does nothing
    expect(useUI.getState().work).not.toBeNull()
    expect(doneOf(0)).toEqual([false])
    act(() => { vi.advanceTimersByTime(2_000) })
    press(' ')
    expect(useUI.getState().work).toBeNull()
    expect(doneOf(0)).toEqual([true])
    expect(active().entries[0].sets[0].sec).toBe(2)
  })

  it('stops listening when the workout screen goes away', () => {
    renderWorkout([entry('1001', [false])])
    act(() => root.unmount())
    root = null
    press(' ')
    expect(doneOf(0)).toEqual([false])
  })
})
