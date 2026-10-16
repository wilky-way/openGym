import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
// #110: an exercise's settings sheet in the routine editor offers Replace, and the picker it opens
// says what the pick is for.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX } from '@opengym/core/exercises'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exConfigSheet, exercisePicker } from '../src/sheets'

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
const button: any = (host: any, label: any) : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === label)

beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'kg' } }))
  document.body.innerHTML = ''
})
afterEach(() : any => {
  act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) })
})

describe('Replace exercise', () : any => {
  it('sits on the settings sheet of a routine exercise and closes it before handing over', () : any => {
    const onReplace: any = vi.fn()
    exConfigSheet(EXIDX['0025']!, { sets: 3, mode: 'reps', reps: 10, weight: 60 }, vi.fn(), vi.fn(), null, null, onReplace)
    const host: any = renderTop()
    const replace: any = button(host, 'Replace exercise')
    expect(replace).toBeTruthy()
    act(() : any => replace.click())
    expect(onReplace).toHaveBeenCalledOnce()
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('names its save button after what saving does, when the caller says', () : any => {
    exConfigSheet(EXIDX['0289']!, { sets: 3, mode: 'reps', reps: 10, weight: 30 }, vi.fn(), null, null, null, null, 'Replace')
    const host: any = renderTop()
    expect(button(host, 'Replace')).toBeTruthy()
    expect(button(host, 'Save')).toBeUndefined()
    exConfigSheet(EXIDX['0289']!, { sets: 3, mode: 'reps', reps: 10, weight: 30 }, vi.fn(), null, null)
    expect(button(renderTop(), 'Save')).toBeTruthy()
  })

  it('is not offered where there is no slot to replace', () : any => {
    exConfigSheet(EXIDX['0025']!, null, vi.fn(), null, null)
    expect(button(renderTop(), 'Replace exercise')).toBeUndefined()
  })

  it('titles the picker for what the pick is for', () : any => {
    exercisePicker(vi.fn(), { title: 'Replace exercise' })
    expect((renderTop().querySelector('h3') as any).textContent).toBe('Replace exercise')
    exercisePicker(vi.fn())
    expect((renderTop().querySelector('h3') as any).textContent).toBe('Add exercise')
  })
})

beforeEach(() : any => prepareExerciseSheets())
