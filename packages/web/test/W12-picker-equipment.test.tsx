import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
// Issue #71: choosing a body part after picking an equipment type used to reset the equipment
// filter to "all equipment", even when the new muscle group still had exercises for it. The
// per-body-part chips no longer clear the equipment selection; the eqOn fallback only drops it
// for the current view when the new body part has nothing under that equipment.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
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

// The two chip strips render in order: body parts first, then equipment. Grab a chip by its
// visible label out of the whole picker.
const chipByText: any = (host: any, text: any) : any =>
  [...(host.querySelectorAll('.chips .chip') as any)].find((b: any) : any => b.textContent.trim() === text)
const isOn: any = (el: any) : any => el.className.split(/\s+/).includes('on')

beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
})

afterEach(() : any => {
  act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) })
})

describe('exercise picker equipment filter', () : any => {
  // The exact reproduction from issue #71: "lower arms" + "dumbbell", then switch to "upper arms".
  // Both body parts have dumbbell exercises, so the filter must stay selected across the switch.
  it('keeps the dumbbell filter when switching from lower arms to upper arms', () : any => {
    exercisePicker(vi.fn())
    const host: any = renderTop()

    // lower arms → dumbbell
    act(() : any => chipByText(host, 'lower arms').click())
    const eqChip: any = chipByText(host, 'dumbbell')
    expect(eqChip, 'dumbbell chip should be offered under lower arms').toBeTruthy()
    act(() : any => eqChip.click())
    expect(isOn(chipByText(host, 'dumbbell'))).toBe(true)

    // switch to upper arms — dumbbell is still valid there, so it must remain selected
    act(() : any => chipByText(host, 'upper arms').click())
    expect(isOn(chipByText(host, 'upper arms'))).toBe(true)
    const eqAfter: any = chipByText(host, 'dumbbell')
    expect(eqAfter, 'dumbbell chip should still be present under upper arms').toBeTruthy()
    expect(isOn(eqAfter)).toBe(true)
    expect(isOn(chipByText(host, 'Any equipment'))).toBe(false)
  })
})

beforeEach(() : any => prepareExerciseSheets())
