// @vitest-environment happy-dom
import './workout-sheet-environment'
import {configureUx, createBrowserUx} from '../src/platform/ux'
// @vitest-environment happy-dom
// Treadmill incline (Discord "Add incline level for treadmill"): a third column on the cardio
// rows that have a grade, stepped and typed in half percents up to 40, and stored on the set.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Workout from '../src/views/Workout'
import { DEF, useStore } from '../src/store/useStore'

vi.mock('../src/lib/sound', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../src/lib/api', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const TREADMILL: any = '2259'   // walking on treadmill
const BIKE: any = '2138'        // stationary bike, cardio
let root: any, container: any

function mount(id: any, sets: any, more: any = {}) {
  if (root) unmount()
  const S: any = JSON.parse(JSON.stringify(DEF))
  S.active = {
    id: 'incline-test', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Cardio', bw: null, cur: 0, ...more,
    entries: [{ id, target: { sets: 1, min: 20, speed: 5 }, sets }],
  }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<><Workout /></>))
}
function unmount() {
  act(() => root.unmount())
  container.remove()
  root = null
}
afterEach(() => { if (root) unmount() })

const cells: any = () => container.querySelector('.setrow').querySelectorAll('.stp')
const inclineCell: any = () => container.querySelector('.setrow .stp.inc')
const stored: any = () => useStore.getState().S.active.entries[0].sets[0]
const heads: any = () => [...container.querySelectorAll('.sethead span')].map((s: any) => s.textContent).filter(Boolean)
function type(input: any, value: any) {
  act(() => {
    Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('the incline column', () => {
  it('sits after the speed on a treadmill, steps in half percents and stores on the set', () => {
    mount(TREADMILL, [{ min: 20, speed: 5, done: false }])
    expect(cells()).toHaveLength(3)
    expect(heads()).toEqual(['Duration (min)', 'Speed (km/h)', 'Incline (%)'])
    // No grade logged yet: the field is empty, not a 0 nobody typed.
    expect(inclineCell().querySelector('input').value).toBe('')
    expect('incline' in stored()).toBe(false)
    act(() => inclineCell().querySelector('button[aria-label="Increase"]').click())
    expect(stored().incline).toBe(0.5)
    type(inclineCell().querySelector('input'), '12')
    expect(stored().incline).toBe(12)
    // A typo past what any treadmill does lands on the top, never on a grade nobody can walk.
    type(inclineCell().querySelector('input'), '60')
    expect(stored().incline).toBe(40)
    act(() => inclineCell().querySelector('button[aria-label="Increase"]').click())
    expect(stored().incline).toBe(40)
    // Cleared, the key goes, and the set is a flat one again.
    type(inclineCell().querySelector('input'), '')
    expect('incline' in stored()).toBe(false)
  })

  it('is not offered on a bike, unless its rows already carry a grade', () => {
    mount(BIKE, [{ min: 20, speed: 25, done: false }])
    expect(cells()).toHaveLength(2)
    expect(inclineCell()).toBe(null)
    mount(BIKE, [{ min: 20, speed: 25, incline: 3, done: false }])
    expect(inclineCell().querySelector('input').value).toBe('3')
  })

  it('copies the grade onto a set added below', () => {
    mount(TREADMILL, [{ min: 20, speed: 5, incline: 8, done: true }])
    const add: any = [...container.querySelectorAll('button')].find((b: any) => /Add set/.test(b.textContent))
    act(() => add.click())
    expect(useStore.getState().S.active.entries[0].sets[1]).toMatchObject({ min: 20, speed: 5, incline: 8, done: false })
  })

  it('has its own stepper in the focus view', () => {
    mount(TREADMILL, [{ min: 20, speed: 5, incline: 4, done: false }], { workoutView: 'focus' })
    const inc: any = container.querySelector('button[aria-label="Increase incline"]')
    expect(inc).not.toBe(null)
    act(() => inc.click())
    expect(stored().incline).toBe(4.5)
    mount(BIKE, [{ min: 20, speed: 25, done: false }], { workoutView: 'focus' })
    expect(container.querySelector('button[aria-label="Increase incline"]')).toBe(null)
  })
})
