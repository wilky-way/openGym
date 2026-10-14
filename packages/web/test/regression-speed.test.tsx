import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
// A cardio exercise's settings in mph (Discord "miles per hour"): the speed stepper reads and
// steps in the profile's unit, and the routine keeps km/h.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX } from '@opengym/core/exercises'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exConfigSheet } from '../src/sheets'

const mounted: any = []
function open(settings: any, existing: any) : any {
  useStore.setState({ S: { ...structuredClone(DEF), ...settings }, user: null })
  const onSave: any = vi.fn()
  exConfigSheet(EXIDX['2138']!, existing, onSave, null, null)
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  const speed: any = [...(host.querySelectorAll('.stp-w') as any)].find((w: any) : any => (w.querySelector('.stp-l') as any)?.textContent.startsWith('Speed'))
  const save: any = [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === 'Save')
  return { speed, save, onSave }
}

beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  document.body.innerHTML = ''
})
afterEach(() : any => { act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) }) })

describe('cardio settings speed', () : any => {
  it('reads and steps in mph for a profile in pounds, and saves km/h', () : any => {
    const { speed, save, onSave }: any = open({ unit: 'lb' }, { sets: 1, min: 20, speed: 8 })
    expect((speed.querySelector('.stp-l') as any).textContent).toBe('Speed (mph)')
    expect((speed.querySelector('input') as any).value).toBe('4.97')
    act(() : any => (speed.querySelector('button[aria-label="Increase"]') as any).click())
    expect((speed.querySelector('input') as any).value).toBe('5.47')
    act(() : any => save.click())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ min: 20, speed: 8.8 }))
  })

  it('is unchanged in km/h', () : any => {
    const { speed, save, onSave }: any = open({ unit: 'kg' }, { sets: 1, min: 20, speed: 8 })
    expect((speed.querySelector('.stp-l') as any).textContent).toBe('Speed (km/h)')
    expect((speed.querySelector('input') as any).value).toBe('8')
    act(() : any => (speed.querySelector('button[aria-label="Increase"]') as any).click())
    act(() : any => save.click())
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ speed: 8.5 }))
  })
})

beforeEach(() : any => prepareExerciseSheets())
