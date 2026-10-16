import './workout-sheet-environment'
// @vitest-environment happy-dom
// Dumbbells on the workout screen: the weight column says what the number means when the exercise
// said (issue #474), and stays "Weight" for one-arm work and for everything as entered. With the
// dumbbells you own listed (#376), + and − walk from bell to bell.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './W17-harness'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { EXIDX } from '@opengym/core/exercises'

vi.mock('../src/lib/sound', () : any => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('../src/lib/api', () : any => ({ api: vi.fn(() : any => Promise.resolve({})) }))

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const clone = (value: any ) : any => JSON.parse(JSON.stringify(value))

const BENCH = '0289'   // dumbbell bench press
const ROW = '0292'     // dumbbell one arm bent-over row

const work = (w: any ) : any => ({ w, r: 8, done: false })
const entry = (id: any, sets: any, target: any = {}) : any => ({ id, target: { sets: sets.length, reps: 8, mode: 'reps', ...target }, sets })

let root: any, container: any
beforeEach(() : any => { useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null }) })
afterEach(() : any => {
  if (root) act(() : any => root.unmount())
  if (container) container.remove()
  root = container = null
})

function mount(entries: any, patch: any = {}) : any {
  const S = clone(DEF)
  S.unit = 'kg'
  S.workoutView = 'list'
  Object.assign(S, patch)
  S.active = { id: 'db-test', d: '2026-10-09', start: Date.now(), routineId: null, name: 'Dumbbells', bw: null, cur: 0, entries, workoutView: S.workoutView }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() : any => root.render(<Workout />))
}
const heads = () : any => [...container.querySelectorAll('.sethead .w-sp')].map((el: any ) : any => el.textContent)

describe('dumbbell weight column', () : any => {
  it('the exercises used here are what the test assumes', () : any => {
    expect(EXIDX[BENCH]!.eq).toBe('dumbbell')
    expect(EXIDX[ROW]!.n).toMatch(/one arm/)
  })

  it('names the meaning the session logs in', () : any => {
    mount([entry(BENCH, [work(20)], { dbLoad: 'each' }), entry(BENCH, [work(40)], { dbLoad: 'total' })])
    expect(heads()).toEqual(['Each (kg)', 'Both (kg)'])
  })

  it('stays Weight as entered and for one-arm work', () : any => {
    mount([entry(BENCH, [work(20)]), entry(ROW, [work(30)], { dbLoad: 'each' })])
    expect(heads()).toEqual(['Weight (kg)', 'Weight (kg)'])
  })
})

describe('stepper over owned dumbbells', () : any => {
  const RACK = [3, 6, 8, 9, 11, 13, 15, 17, 18, 19, 21, 24]
  const weightOf = () : any => container.querySelector('.stp input').value
  const tap = (label: any ) : any => act(() : any => container.querySelector('.stp [aria-label="' + label + '"]').click())

  it('walks the bells you own', () : any => {
    mount([entry('0294', [work(9)], { inc: 2 })], { dumbbells: { kg: { weights: RACK, _ts: 1 } } })
    tap('Increase')
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(11)
    tap('Increase')
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(13)
    tap('Decrease')
    tap('Decrease')
    tap('Decrease')
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(8)
    expect(weightOf()).toBe('8')
  })

  it('keeps the increment without a list', () : any => {
    mount([entry('0294', [work(9)], { inc: 2 })], {})
    tap('Increase')
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(11)
    tap('Increase')
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(13)
    tap('Decrease')
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(11)
    // From an even weight the grid takes over again: 10 + 2 = 12, which no rack above holds.
    act(() : any => useStore.setState((st: any ) : any => { const S = clone(st.S); S.active.entries[0].sets[0].w = 10; return { S } }))
    tap('Increase')
    expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(12)
  })
})
