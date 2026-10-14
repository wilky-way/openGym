// @vitest-environment happy-dom
import { setupPlanHistoryTest } from './helpers/plan-history'

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { workoutDetailSheet } from '../src/sheets-plan-history'
import { EXDB } from '@opengym/core/exercises'

beforeEach((): any => setupPlanHistoryTest())

const clone: any = (v: any): any => JSON.parse(JSON.stringify(v))
const ids: any = EXDB.filter((e: any): any => e.bp !== 'cardio').slice(0, 4).map((e: any): any => e.id)
const mounted: any = []

function renderTop(): any {
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act((): any => root.render(sheet.render((): any => useUI.getState().closeSheet(sheet.id))))
  return host
}
const rowFor: any = (host: any, name: any): any => [...host.querySelectorAll('.item')].find((el: any): any => el.querySelector('.tt')?.textContent === name)

beforeEach((): any => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach((): any => { act((): any => { mounted.splice(0).forEach((r: any): any => r.unmount()) }) })

describe('WorkoutDetail — per-routine grouping', (): any => {
  const combined: any = {
    id: 'w', d: '2026-09-06', start: 1, end: 2, name: 'Strength + Core', vol: 500,
    routineIds: ['strength', 'core'], prs: [],
    entries: [
      { id: ids[0], rid: 'strength', target: { reps: 5 }, sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }] },
      { id: ids[1], rid: 'core', target: { reps: 12 }, sets: [{ w: 0, r: 12, done: true }] },
    ],
  }
  const legacy: any = {
    id: 'w2', d: '2026-09-06', start: 1, end: 2, name: 'Push', vol: 100, routineIds: ['strength'], prs: [],
    entries: [{ id: ids[0], target: { reps: 5 }, sets: [{ w: 100, r: 5, done: true }] }],
  }

  beforeEach((): any => {
    const S: any = clone(useStore.getState().S)
    S.routines = [
      { id: 'strength', name: 'Strength', emoji: '🏋️', ex: [] },
      { id: 'core', name: 'Core', emoji: '🧘', ex: [] },
    ]
    useStore.setState({ S, user: null })
  })

  it('groups a combined workout into per-routine sections with a sets/volume subheader', (): any => {
    const host: any = (workoutDetailSheet(combined), renderTop())
    expect(host.textContent).toContain('Strength')
    expect(host.textContent).toContain('Core')
    expect(host.textContent).toMatch(/2 sets/)
    expect(host.textContent).toMatch(/1 sets|1 set/)
  })

  it('renders a legacy single-routine workout flat — no routine subheader', (): any => {
    const host: any = (workoutDetailSheet(legacy), renderTop())
    // the only routine name that could appear is the header <h3> (w.name = "Push"); there is
    // no "Strength" subheader row
    expect(host.querySelectorAll('.row.between').length).toBe(0)
  })
})
