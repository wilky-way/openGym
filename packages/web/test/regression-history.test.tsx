import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
// The history sheet (issue #43) is the one place the workout screen answers "what did I do
// on this last time, and the time before" — worth pinning that it reads the log newest
// first, labels sets the way the rest of the app does, and does not pretend an exercise
// with no sessions has a curve.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exerciseHistorySheet, exerciseDetailSheet } from '../src/sheets'
import { EXIDX } from '@opengym/core/exercises'

const mounted: any = []

function renderTop() : any {
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return host
}

const EX: any = Object.keys(EXIDX).find((id: any) : any => (EXIDX[id]!.bp || '') !== 'cardio' && !EXIDX[id]!.custom)
const DAY: any = 86400000
const T0: any = Date.UTC(2026, 2, 2, 9)
const iso: any = (i: any) : any => new Date(T0 + i * DAY).toISOString().slice(0, 10)
const session: any = (i: any, rows: any) : any => ({
  id: 'w' + i, d: iso(i), start: T0 + i * DAY, end: T0 + i * DAY + 3600000, name: 'Push', vol: 0,
  entries: [{ id: EX, target: { mode: 'reps', bodyweight: false }, sets: rows }],
})

beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'kg', workouts: [], active: null } }))
  document.body.innerHTML = ''
})

afterEach(() : any => {
  act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) })
})

describe('exercise history sheet', () : any => {
  it('shows an empty state instead of a chart when nothing was logged', () : any => {
    exerciseHistorySheet(EX)
    const host: any = renderTop()
    expect((host.querySelector('.empty') as any).textContent).toContain('No sessions logged yet')
    expect((host.querySelector('.chart') as any)).toBeNull()
  })

  it('lists sessions newest first with labelled sets, volume and one PR marker', () : any => {
    useStore.setState((s: any) : any => ({ S: { ...s.S, workouts: [
      session(0, [{ w: 40, r: 8, done: true, phase: 'warmup' }, { w: 60, r: 5, done: true }, { w: 60, r: 5, done: true }]),
      session(2, [{ w: 70, r: 5, done: true }]),
      session(4, [{ w: 70, r: 3, done: true }, { w: 90, r: 1, done: false }]),
    ] } }))
    exerciseHistorySheet(EX)
    const host: any = renderTop()
    const rows: any = [...(host.querySelectorAll('.list .item') as any)]
    expect(rows).toHaveLength(3)
    // newest first, oldest last; the warm-up and the unfinished set never show up
    expect((rows[0].querySelector('.ss') as any).textContent).toBe('70×3')
    expect((rows[2].querySelector('.ss') as any).textContent).toBe('60×5  ·  60×5')
    expect(rows[2].textContent).toContain('Volume 600 kg')
    // the record was set in the middle session and only that one carries the badge
    expect(rows.map((r: any) : any => !!(r.querySelector('.pr') as any))).toEqual([false, true, false])
    expect((host.querySelector('.chart svg') as any)).toBeTruthy()
    expect(host.textContent).toContain('Best:')
    expect(host.textContent).toContain('70 kg')
  })

  it('is reachable from the exercise detail sheet once there is history', () : any => {
    exerciseDetailSheet(EXIDX[EX]!)
    const before: any = renderTop()
    expect([...(before.querySelectorAll('button') as any)].some((b: any) : any => b.textContent === 'History')).toBe(false)

    useStore.setState((s: any) : any => ({ S: { ...s.S, workouts: [session(0, [{ w: 60, r: 5, done: true }])] } }))
    useUI.setState({ sheets: [] })
    exerciseDetailSheet(EXIDX[EX]!)
    const host: any = renderTop()
    const btn: any = [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent === 'History')
    expect(btn).toBeTruthy()
    act(() : any => { btn.click() })
    expect(useUI.getState().sheets).toHaveLength(2)
    const top: any = renderTop()
    expect((top.querySelectorAll('.list .item') as any)).toHaveLength(1)
  })
})

beforeEach(() : any => prepareExerciseSheets())
