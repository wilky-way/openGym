// GM safety divergence from legacy: callbacks bind owner/session/editor/row identity; stale targets abort.
import './workout-sheet-environment'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { addRoutineToSessionSheet } from '../src/sheets-d'
import { EXDB } from '@opengym/core/exercises'

const clone = (v: any) => JSON.parse(JSON.stringify(v))
const ids = EXDB.filter((e: any) => e.bp !== 'cardio').slice(0, 4).map((e: any) => e.id)
const mounted: any[] = []

function renderTop(): any {
  const sheet = useUI.getState().sheets.at(-1)!
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const rowFor = (host: any, name: any) => [...host.querySelectorAll('.item')].find((el: any) => el.querySelector('.tt')?.textContent === name)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach(() => { act(() => { mounted.splice(0).forEach((r: any) => r.unmount()) }) })

describe('Add routine mid-session sheet', () => {
  const setup = () => {
    const S = clone(useStore.getState().S)
    S.routines = [
      { id: 'strength', name: 'Strength', emoji: '🏋️', prog: 'off', ex: [{ id: ids[0], sets: 3, reps: 5, weight: 60 }] },
      { id: 'core', name: 'Core', emoji: '🧘', prog: 'off', ex: [{ id: ids[1], sets: 3, reps: 12, weight: 0 }, { id: ids[2], sets: 3, reps: 10, weight: 0 }] },
      { id: 'empty', name: 'Empty', emoji: '📝', ex: [] },
    ]
    S.workouts = []
    S.active = {
      id: 'a', d: '2026-09-06', start: 1, routineIds: ['strength'], name: 'Strength', cur: 0,
      entries: [{ id: ids[0], rid: 'strength', target: {}, sets: [{ w: 60, r: 5, done: true }] }],
      workoutView: 'cards',
    }
    useStore.setState({ S, user: null })
  }

  it('appends the picked routine’s entries with rid, updates routineIds + name, toasts', () => {
    setup()
    addRoutineToSessionSheet()
    const host = renderTop()
    act(() => { rowFor(host, 'Core').click() })

    const a = useStore.getState().S.active
    expect(a.routineIds).toEqual(['strength', 'core'])
    expect(a.name).toBe('Strength + Core')
    expect(a.entries.map((e: any) => e.rid)).toEqual(['strength', 'core', 'core'])
    expect(a.cur).toBe(0)                    // current unit is left where it was
    expect(useUI.getState().toastMsg).toContain('Core added')
  })

  it('disables a routine already in the session and one with no exercises', () => {
    setup()
    addRoutineToSessionSheet()
    const host = renderTop()
    expect(rowFor(host, 'Strength').className).toContain('disabled')
    expect(rowFor(host, 'Strength').textContent).toContain('already added')
    expect(rowFor(host, 'Empty').className).toContain('disabled')
    expect(rowFor(host, 'Empty').textContent).toContain('no exercises')
  })
})

