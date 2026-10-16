import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
// What a dumbbell weight means (issue #474), where it is picked: the exercise's own default on its
// detail sheet (S.dbLoad, stamped), a routine slot's own choice on the exercise settings
// (cfg.dbLoad, written only when it differs from the exercise's default).
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX } from '@opengym/core/exercises'
import { useStore, DEF } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exConfigSheet, exerciseDetailSheet } from '../src/sheets'
import { withDbLoad } from '@opengym/core/dumbbells'

const BENCH: any = EXIDX['0289']!   // dumbbell bench press
const SQUAT: any = EXIDX['0043']!   // barbell
const mounted: any = []
function render(sheet: any) : any {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push([root, host])
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return host
}
const S: any = () : any => useStore.getState().S
const segButton: any = (host: any, text: any) : any => [...(host.querySelectorAll('.seg button') as any)].find((b: any) : any => b.textContent.trim() === text)
const button: any = (host: any, text: any) : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === text)

describe('weight means', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'kg' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach(([root, host]: any) : any => { root.unmount(); host.remove() }) }) })

  it('the detail sheet sets the exercise default, stamped, and shows As entered until then', () : any => {
    exerciseDetailSheet(BENCH)
    const host: any = render(useUI.getState().sheets.at(-1))
    expect(host.textContent).toContain('Weight means')
    expect(segButton(host, 'As entered').classList.contains('on')).toBe(true)
    expect(host.textContent).toContain('Counted as you type it, the way it always was.')
    act(() : any => segButton(host, 'Each').click())
    expect(S().dbLoad[BENCH.id]).toEqual({ mode: 'each', _ts: expect.any(Number) })
    expect(host.textContent).toContain('Volume counts both.')
    act(() : any => segButton(host, 'As entered').click())
    expect(S().dbLoad[BENCH.id]).toEqual({ mode: null, _ts: expect.any(Number) })
  })

  it('is not offered for a barbell', () : any => {
    exerciseDetailSheet(SQUAT)
    const host: any = render(useUI.getState().sheets.at(-1))
    expect(host.textContent).not.toContain('Weight means')
  })

  it('a routine slot saves its own pick and nothing when it follows the exercise', () : any => {
    const onSave: any = vi.fn()
    exConfigSheet(BENCH, { sets: 3, reps: 10, weight: 20, mode: 'reps' }, onSave)
    let host: any = render(useUI.getState().sheets.at(-1))
    act(() : any => button(host, 'Save').click())
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('dbLoad')

    exConfigSheet(BENCH, { sets: 3, reps: 10, weight: 20, mode: 'reps' }, onSave)
    host = render(useUI.getState().sheets.at(-1))
    act(() : any => segButton(host, 'Both').click())
    act(() : any => button(host, 'Save').click())
    expect(onSave.mock.calls[1][0].dbLoad).toBe('total')
  })

  it('a slot whose exercise means per bell can still say as entered, and repeating the default drops the key', () : any => {
    useStore.setState((s: any) : any => ({ S: { ...s.S, dbLoad: withDbLoad({}, BENCH.id, 'each', 1) } }))
    const onSave: any = vi.fn()
    // A session target stamped with the exercise's own meaning is not the slot's choice.
    exConfigSheet(BENCH, { sets: 3, reps: 10, weight: 20, mode: 'reps', dbLoad: 'each' }, onSave)
    let host: any = render(useUI.getState().sheets.at(-1))
    expect(segButton(host, 'Each').classList.contains('on')).toBe(true)
    act(() : any => button(host, 'Save').click())
    expect(onSave.mock.calls[0][0]).not.toHaveProperty('dbLoad')

    exConfigSheet(BENCH, { sets: 3, reps: 10, weight: 20, mode: 'reps' }, onSave)
    host = render(useUI.getState().sheets.at(-1))
    act(() : any => segButton(host, 'As entered').click())
    act(() : any => button(host, 'Save').click())
    expect(onSave.mock.calls[1][0].dbLoad).toBe('as')
  })
})

beforeEach(() : any => prepareExerciseSheets())
