// @vitest-environment happy-dom
import { setupPlanHistoryTest } from './helpers/plan-history'

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { workoutDetailSheet } from '../src/sheets-plan-history'
import { setNav } from '../src/lib/nav'

beforeEach((): any => setupPlanHistoryTest())

const mounted: any = []
const workout: any = (): any => ({
  id: 'w-routine', d: '2026-09-10', start: 1, end: 2, name: 'Push', prs: [],
  entries: [
    { id: 'bench', target: { mode: 'reps', reps: 5, weight: 40, side: true, sg: 'source' }, sets: [{ phase: 'warmup', w: 20, r: 5 }, { w: 45, r: 8, done: true }] },
    { id: 'row', target: { mode: 'reps', reps: 8, weight: 30, sg: 'source' }, sets: [{ w: 35, r: 9, done: true }] },
  ],
})

function renderTop(): any {
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act((): any => root.render(sheet.render((): any => useUI.getState().closeSheet(sheet.id))))
  return host
}

const button: any = (host: any, label: any): any => [...host.querySelectorAll('button')].find((b: any): any => b.textContent.trim() === label)

describe('WorkoutDetail — save as routine', (): any => {
  let navigated: any

  beforeEach((): any => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    navigated = null
    setNav((to: any): any => { navigated = to })
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState((s: any): any => ({ S: { ...s.S, workouts: [], routines: [], active: null } }))
    document.body.innerHTML = ''
  })

  afterEach((): any => { act((): any => { mounted.splice(0).forEach((root: any): any => root.unmount()) }) })

  it('requires an explicit confirmation, then creates a flat routine and keeps history unchanged', (): any => {
    const saved: any = workout()
    useStore.setState((s: any): any => ({ S: { ...s.S, workouts: [saved] } }))
    const host: any = (workoutDetailSheet(saved), renderTop())
    expect(button(host, 'Save as routine')).toBeTruthy()

    act((): any => { button(host, 'Save as routine').click() })
    const confirm: any = renderTop()
    expect(confirm.textContent).toContain('Create an independent routine')
    expect(useStore.getState().S.routines).toHaveLength(0)

    act((): any => { button(confirm, 'Save').click() })
    const routine: any = useStore.getState().S.routines[0]
    expect(routine).toMatchObject({ name: 'Push' })
    expect(routine.ex.map((e: any): any => e.id)).toEqual(['bench', 'row'])
    expect(routine.ex[0].side).toBe(true)
    expect(routine.ex[0].warmupSets).toBe(1)
    expect(useStore.getState().S.workouts[0]).toEqual(saved)
    expect(navigated).toBe('/plan/r/' + routine.id)
  })
})
