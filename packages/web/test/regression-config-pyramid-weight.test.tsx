import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from '@opengym/core/exercises'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exConfigSheet } from '../src/sheets'

// #445: with Pyramid sets on, the exercise settings had no weight field at all. Each set now has
// its own, next to its reps and rest.
const ex: any = EXDB.find((e: any) : any => e.id === '0009')   // a weighted machine exercise
const mounted: any = []

function renderConfig(cfg: any = {}, exercise: any = ex) : any {
  const onSave: any = vi.fn()
  exConfigSheet(exercise, { sets: 3, reps: 10, weight: 0, mode: 'reps', pyramid: [12, 10, 8], ...cfg }, onSave)
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return { host, onSave }
}
const weightFields: any = (host: any) : any => [...(host.querySelectorAll('.stp-w') as any)]
  .filter((w: any) : any => (w.querySelector('.stp-l') as any)?.textContent === 'Weight (kg)')
  .map((w: any) : any => (w.querySelector('input.num') as any))
function type(el: any, value: any) : any {
  ;(Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value') as any).set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const leave: any = (el: any) : any => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
const save: any = (host: any) : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === 'Save').click()

describe('exercise settings: weight per pyramid set (#445)', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) }) })

  it('shows one weight field per set and saves what was typed', () : any => {
    const { host, onSave }: any = renderConfig()
    const fields: any = weightFields(host)
    expect(fields).toHaveLength(3)
    act(() : any => { type(fields[0], '40'); leave(fields[0]) })
    act(() : any => { type(fields[2], '60'); leave(fields[2]) })
    act(() : any => save(host))
    expect(onSave.mock.calls[0][0].pyramid).toEqual([12, 10, 8])
    expect(onSave.mock.calls[0][0].pyramidWeight).toEqual([40, 0, 60])
  })

  it('opens on the saved weights and writes no field when every set is left at 0', () : any => {
    const { host, onSave }: any = renderConfig({ pyramidWeight: [40, 50, 60] })
    expect(weightFields(host).map((f: any) : any => f.value)).toEqual(['40', '50', '60'])
    const blank: any = renderConfig()
    act(() : any => save(blank.host))
    expect(blank.onSave.mock.calls[0][0]).not.toHaveProperty('pyramidWeight')
    act(() : any => save(host))
    expect(onSave.mock.calls[0][0].pyramidWeight).toEqual([40, 50, 60])
  })

  it('keeps bodyweight work on its one Added load', () : any => {
    const { host, onSave }: any = renderConfig({ bodyweight: true, pyramidWeight: [40, 50, 60] })
    expect(weightFields(host)).toHaveLength(0)
    act(() : any => save(host))
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('pyramidWeight')
  })
})

beforeEach(() : any => prepareExerciseSheets())
