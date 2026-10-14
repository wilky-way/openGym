import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
// Issue #521: the workout's "Add exercise" picker showed the Muscle and Equipment chip rows but not
// the Type row the Exercise browser has (strength, calisthenics, stretching...). Same row, same
// fallback: a type the muscle group narrows away is ignored for that view, not forgotten.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { EXDB } from '@opengym/core/exercises'
import { exerciseNameFor } from '../src/lib/i18n'
import { exercisePicker } from '../src/sheets'

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

const chipByText: any = (host: any, text: any) : any =>
  [...(host.querySelectorAll('.chips .chip') as any)].find((b: any) : any => b.textContent.trim() === text)
const isOn: any = (el: any) : any => el.className.split(/\s+/).includes('on')
// Every row's add button carries the exercise's name, so it tells which exercises are listed.
const listed: any = (host: any) : any => [...(host.querySelectorAll('.list .item button[aria-label]') as any)]
  .map((b: any) : any => b.getAttribute('aria-label'))

beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})

afterEach(() : any => {
  act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) })
})

describe('exercise picker type filter', () : any => {
  it('shows the Type row between the muscle groups and the equipment, like the Library', () : any => {
    exercisePicker(vi.fn())
    const host: any = renderTop()
    const strips: any = [...(host.querySelectorAll('.chips') as any)]
    expect(strips).toHaveLength(3)
    expect((strips[1].querySelector('.chip') as any).textContent.trim()).toBe('Any type')
    expect(isOn(chipByText(host, 'Any type'))).toBe(true)
    expect(chipByText(host, 'stretching')).toBeTruthy()
    expect((strips[2].querySelector('.chip') as any).textContent.trim()).toBe('Any equipment')
  })

  it('narrows the list to the picked type', () : any => {
    exercisePicker(vi.fn())
    const host: any = renderTop()
    act(() : any => chipByText(host, 'stretching').click())
    expect(isOn(chipByText(host, 'stretching'))).toBe(true)
    const names: any = listed(host)
    expect(names.length).toBeGreaterThan(0)
    const catOf: any = new Map(EXDB.map((e: any) : any => [`Add “${exerciseNameFor(e)}”`, e.cat]))
    expect(names.filter((n: any) : any => catOf.get(n) !== 'stretching')).toEqual([])
  })

  it('keeps the type across a muscle group that has none of it, and picks it back up', () : any => {
    exercisePicker(vi.fn())
    const host: any = renderTop()
    act(() : any => chipByText(host, 'yoga').click())
    // Lower arms have no yoga: the row drops the choice for this view instead of listing nothing.
    act(() : any => chipByText(host, 'lower arms').click())
    expect(chipByText(host, 'yoga')).toBeFalsy()
    expect(listed(host).length).toBeGreaterThan(0)
    act(() : any => chipByText(host, 'back').click())
    expect(isOn(chipByText(host, 'yoga'))).toBe(true)
  })
})

beforeEach(() : any => prepareExerciseSheets())
