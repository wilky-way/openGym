import './workout-sheet-environment'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { beginWorkout, logPastWorkoutSheet } from '../src/sheets-d'
import { todayISO } from '@opengym/core/format'

// beginWorkout / beginBackfill snapshot S.workoutView onto s.active so the header ⋮ can
// re-lay-out the running session without touching the saved default.

const mounted: any[] = []
function type(el: any, value: any) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function mountTopSheet(): any {
  const sheet = useUI.getState().sheets.at(-1)!
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host: any, text: any) => [...host.querySelectorAll('button')].find((b: any) => b.textContent.trim() === text)

describe('workout view is snapshot onto the active session', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState((s: any) => ({ S: { ...s.S, active: null, routines: [], workouts: [], workoutView: 'cards' } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach((root: any) => root.unmount()) }) })

  it('beginWorkout copies the current default onto s.active', () => {
    useStore.setState((s: any) => ({ S: { ...s.S, workoutView: 'focus' } }))
    act(() => beginWorkout(null, null))
    expect(useStore.getState().S.active.workoutView).toBe('focus')
  })

  it('beginWorkout falls back to cards when the default is unset', () => {
    useStore.setState((s: any) => { const S = { ...s.S }; delete S.workoutView; return { S } })
    act(() => beginWorkout(null, null))
    expect(useStore.getState().S.active.workoutView).toBe('cards')
  })

  it('later changes to the default leave the running session alone', () => {
    act(() => beginWorkout(null, null))
    expect(useStore.getState().S.active.workoutView).toBe('cards')
    useStore.setState((s: any) => ({ S: { ...s.S, workoutView: 'list' } }))
    expect(useStore.getState().S.active.workoutView).toBe('cards')
  })

  it('a backfilled session snapshots it too', () => {
    useStore.setState((s: any) => ({ S: { ...s.S, workoutView: 'focus' } }))
    logPastWorkoutSheet()
    const host = mountTopSheet()
    act(() => { type(host.querySelector('input[type=date]'), '2020-01-02') })
    act(() => { button(host, 'Continue').click() })
    expect(useStore.getState().S.active.workoutView).toBe('focus')
  })
})
