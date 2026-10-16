import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
// #473: a swap opens on what trains the same muscle. Mid-workout (Swap exercise) and in the
// routine editor (Replace exercise) the picker starts on the exercises sharing the swapped one's
// target muscle, same equipment first, and "All" is one tap back to the whole list.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { EXDB } from '@opengym/core/exercises'
import { exercisePicker, swapActiveWorkoutExercise } from '../src/sheets'
import { sameMuscleFirst } from '@opengym/core/similar-exercises'

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
const chips: any = (host: any) : any => [...(host.querySelectorAll('.chips .chip') as any)]
const chipByText: any = (host: any, text: any) : any => chips(host).find((b: any) : any => b.textContent.trim() === text)
const sameChip: any = (host: any) : any => chips(host).find((b: any) : any => b.textContent.trim().startsWith('Same muscle'))
const isOn: any = (el: any) : any => el.className.split(/\s+/).includes('on')
const rows: any = (host: any) : any => [...(host.querySelectorAll('.list .item:not(.ex-new)') as any)].map((r: any) : any => (r.querySelector('.ss') as any).textContent)

// A cable triceps exercise: the catalogue has plenty of other triceps work, on cables and off.
const CABLE_TRI: any = EXDB.find((e: any) : any => e.tg === 'triceps' && e.eq === 'cable')

beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})
afterEach(() : any => {
  act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) })
})

describe('sameMuscleFirst', () : any => {
  it('keeps the same target muscle, drops the exercise itself, same equipment first, order kept otherwise', () : any => {
    const ex: any = { id: 'x', tg: 'triceps', eq: 'cable' }
    const list: any = [
      { id: 'a', tg: 'triceps', eq: 'dumbbell' },
      { id: 'x', tg: 'triceps', eq: 'cable' },
      { id: 'b', tg: 'biceps', eq: 'cable' },
      { id: 'c', tg: 'triceps', eq: 'cable' },
      { id: 'd', tg: 'triceps', eq: 'barbell' },
      { id: 'e', tg: 'triceps', eq: 'cable' }
    ]
    expect(sameMuscleFirst(list, ex).map((e: any) : any => e.id)).toEqual(['c', 'e', 'a', 'd'])
    expect(sameMuscleFirst(list, { id: 'y' })).toEqual([])
  })
})

describe('swap picker opens on the same muscle', () : any => {
  it('mid-workout: Swap exercise starts on the target muscle, same equipment first, All goes back', () : any => {
    expect(CABLE_TRI).toBeTruthy()
    const S: any = structuredClone(DEF)
    S.active = {
      id: 'w', d: '2026-10-08', start: Date.now(), routineId: null, name: 'Push', bw: null, cur: 0,
      entries: [{ id: CABLE_TRI.id, target: { mode: 'reps', sets: 3, reps: 10, weight: 20 }, sets: [{ w: 20, r: 10, done: false }] }]
    }
    useStore.setState({ S, user: null })
    swapActiveWorkoutExercise(0)
    const host: any = renderTop()

    const chip: any = sameChip(host)
    expect(chip.textContent).toContain('Triceps')
    expect(isOn(chip)).toBe(true)
    expect(isOn(chipByText(host, 'All'))).toBe(false)

    const listed: any = rows(host)
    expect(listed.length).toBeGreaterThan(1)
    expect(listed.every((s: any) : any => s.startsWith('Triceps'))).toBe(true)
    // Cable first: once something else shows up, no cable exercise follows it.
    const firstOther: any = listed.findIndex((s: any) : any => !s.endsWith('cable'))
    expect(listed[0].endsWith('cable')).toBe(true)
    if (firstOther > 0) expect(listed.slice(firstOther).some((s: any) : any => s.endsWith('cable'))).toBe(false)
    // The exercise being swapped away is not offered as its own replacement.
    expect([...(host.querySelectorAll('.list .item .tt') as any)].map((x: any) : any => x.textContent)).not.toContain(CABLE_TRI.n)

    act(() : any => chipByText(host, 'All').click())
    expect(isOn(chipByText(host, 'All'))).toBe(true)
    expect(rows(host).some((s: any) : any => !s.startsWith('Triceps'))).toBe(true)
    // …and back again.
    act(() : any => sameChip(host).click())
    expect(rows(host).every((s: any) : any => s.startsWith('Triceps'))).toBe(true)
  })

  // The routine editor hands its slot's exercise in (views/RoutineEdit.replace.test.jsx).
  it('routine editor: a picker told what it replaces opens on that muscle', () : any => {
    const pick: any = vi.fn()
    exercisePicker(pick, { title: 'Replace exercise', like: CABLE_TRI.id })
    const host: any = renderTop()
    expect(isOn(sameChip(host))).toBe(true)
    expect(rows(host).every((s: any) : any => s.startsWith('Triceps'))).toBe(true)
  })

  it('an add opens on the whole list, with no same-muscle chip', () : any => {
    exercisePicker(vi.fn())
    const host: any = renderTop()
    expect(sameChip(host)).toBeUndefined()
    expect(isOn(chipByText(host, 'All'))).toBe(true)
  })

  it('opens on All when nothing else trains that muscle, so a swap never starts on an empty list', () : any => {
    const S: any = structuredClone(DEF)
    // Every catalogue muscle has body-weight work, which no equipment profile hides, so the empty
    // case is one of your own exercises on a muscle nothing else names.
    S.customEx = [{ id: 'cOnly', n: 'My odd lift', bp: 'neck', tg: 'nothing-else', eq: 'body weight', custom: true }]
    useStore.setState({ S, user: null })
    exercisePicker(vi.fn(), { like: 'cOnly' })
    const host: any = renderTop()
    expect(isOn(chipByText(host, 'All'))).toBe(true)
    expect(sameChip(host)).toBeUndefined()
  })
})

beforeEach(() : any => prepareExerciseSheets())
