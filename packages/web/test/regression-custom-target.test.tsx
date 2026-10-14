import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
// QA C10. Since the muscles of a custom exercise are stored in the map's order (the compatibility baseline), the
// one-word target `tg` was silently taken from the sorted list: a hip thrust with Traps as an
// extra primary became a "Traps" exercise in the library, the picker and the Muscles view, and
// tap order no longer let the user correct it. The target is the primary picked first; an edit
// keeps the old target while it is still a primary.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX, registerCustom as coreRegisterCustom } from '@opengym/core/exercises'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { _setLangState } from '@opengym/core/i18n-core'
import { bindUI } from '../src/components/ui'
import { customExSheet } from '../src/sheets'

bindUI(useUI)   // the multi-select rows open their sheet through the shared controls

const mounted: any = []
const S: any = () : any => useStore.getState().S

// Renders whatever sheet is on top and returns its host element.
function renderTop() : any {
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return host
}
function type(el: any, value: any) : any {
  ;(Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value') as any).set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const byText: any = (host: any, sel: any, text: any) : any => [...(host.querySelectorAll(sel) as any)].find((e: any) : any => e.textContent.trim() === text)
const click: any = (host: any, sel: any, text: any) : any => {
  const el: any = byText(host, sel, text)
  if (!el) throw new Error(`nothing with text "${text}"`)
  act(() : any => el.click())
}
// The form's multi-select rows open a nested sheet; tap the given labels there, in order, then Done.
function pickMuscles(form: any, rowTitle: any, labels: any) : any {
  const row: any = [...(form.querySelectorAll('.lrow') as any)].find((e: any) : any => e.textContent.includes(rowTitle))
  act(() : any => row.click())
  const sub: any = renderTop()
  for (const l of labels) click(sub, 'button', l)
  click(sub, 'button', 'Done')
}
const custom: any = (over: any = {}) : any => ({
  id: 'cqa1', n: 'QA Custom Thrust', bp: 'upper legs', eq: 'barbell', custom: true, desc: '',
  tg: 'gluteal', sm: ['forearm', 'hip-flexors'], primaries: ['gluteal'], secondaries: ['forearm', 'hip-flexors'],
  muscleGroups: ['gluteal', 'forearm', 'hip-flexors'], ...over,
})
function seed(ex: any) : any {
  useStore.setState((s: any) : any => ({ S: { ...s.S, customEx: [ex] } }))
  registerCustom([ex])
}

beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  registerCustom([])
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
})

afterEach(() : any => {
  act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) })
  _setLangState('en', null, null, null)
  registerCustom([])
})

describe('custom exercise target (QA C10)', () : any => {
  it('is the primary tapped first, while the stored list keeps the map order', () : any => {
    customExSheet(null)
    const form: any = renderTop()
    act(() : any => type((form.querySelector('input.input') as any), 'QA Hip Thrust Pull'))
    click(form, '.chip', 'upper legs')
    click(form, '.chip', 'barbell')
    pickMuscles(form, 'Primary muscle groups', ['Hamstrings', 'Glutes', 'Traps'])
    click(form, 'button', 'Create exercise')
    const c: any = S().customEx.find((x: any) : any => x.n === 'QA Hip Thrust Pull')
    expect(c.primaries).toEqual(['trapezius', 'gluteal', 'hamstring'])
    expect(c.tg).toBe('hamstring')
    expect(c.muscleGroups).toEqual(['trapezius', 'gluteal', 'hamstring'])
  })

  it('survives an edit that adds a primary higher up the body', () : any => {
    const ex: any = custom({ tg: 'hamstring', primaries: ['gluteal', 'hamstring'], secondaries: [], sm: [], muscleGroups: ['gluteal', 'hamstring'] })
    seed(ex)
    customExSheet(useStore.getState().index[ex.id]!)
    const form: any = renderTop()
    pickMuscles(form, 'Primary muscle groups', ['Traps'])
    click(form, 'button', 'Save')
    const c: any = S().customEx[0]
    expect(c.primaries).toEqual(['trapezius', 'gluteal', 'hamstring'])
    expect(c.tg).toBe('hamstring')
  })

  it('moves to another primary only when the old target is dropped', () : any => {
    const ex: any = custom({ tg: 'hamstring', primaries: ['gluteal', 'hamstring'], secondaries: [], sm: [], muscleGroups: ['gluteal', 'hamstring'] })
    seed(ex)
    customExSheet(useStore.getState().index[ex.id]!)
    const form: any = renderTop()
    pickMuscles(form, 'Primary muscle groups', ['Hamstrings'])   // untick it
    click(form, 'button', 'Save')
    const c: any = S().customEx[0]
    expect(c.primaries).toEqual(['gluteal'])
    expect(c.tg).toBe('gluteal')
  })

  // Dropping the target used to hand it to the head of the map-sorted list, which is where C10
  // started: an upper-legs exercise read "Traps · barbell" again the moment its target went away.
  it('hands a dropped target to the primary tapped in this sheet, not to the topmost muscle', () : any => {
    const ex: any = custom({ tg: 'hamstring', primaries: ['trapezius', 'gluteal', 'hamstring'], secondaries: ['forearm'], sm: ['forearm'],
      muscleGroups: ['trapezius', 'gluteal', 'hamstring', 'forearm'] })
    seed(ex)
    customExSheet(useStore.getState().index[ex.id]!)
    const form: any = renderTop()
    pickMuscles(form, 'Primary muscle groups', ['Hamstrings', 'Quads'])   // untick the target, tap another
    click(form, 'button', 'Save')
    const c: any = S().customEx[0]
    expect(c.primaries).toEqual(['trapezius', 'gluteal', 'quadriceps'])
    expect(c.tg).toBe('quadriceps')
  })

  // Tapping the same chip twice leaves the selection as it was, so it says nothing about what the
  // user wants the target to be — the muscle actually added does.
  it('ignores a primary that was tapped on and off again', () : any => {
    const ex: any = custom({ tg: 'hamstring', primaries: ['trapezius', 'hamstring'], secondaries: [], sm: [], muscleGroups: ['trapezius', 'hamstring'] })
    seed(ex)
    customExSheet(useStore.getState().index[ex.id]!)
    const form: any = renderTop()
    pickMuscles(form, 'Primary muscle groups', ['Hamstrings', 'Chest', 'Chest', 'Glutes'])
    click(form, 'button', 'Save')
    const c: any = S().customEx[0]
    expect(c.primaries).toEqual(['trapezius', 'gluteal'])
    expect(c.tg).toBe('gluteal')
  })
})

beforeEach(() : any => prepareExerciseSheets())

function registerCustom(list: unknown) { const index = coreRegisterCustom(list); useStore.setState({ index }); return index }
