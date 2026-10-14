import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
// QA C9. Custom exercises and the newer exercise metadata name muscles by the map's ids. The
// picker row, the routine config sheet and the Muscles rows printed those ids ("gluteal",
// "forearm", "hip-flexors") where the detail sheet already said Glutes / Forearms / Hip flexors —
// and in German "forearm" stayed English, because only the display names have translations.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXIDX, registerCustom as coreRegisterCustom } from '@opengym/core/exercises'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { _setLangState } from '@opengym/core/i18n-core'
import { exercisePicker, exConfigSheet } from '../src/sheets'


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
function render(node: any) : any {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() : any => root.render(node))
  return host
}
function type(el: any, value: any) : any {
  ;(Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value') as any).set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const rowFor: any = (host: any, name: any) : any => [...(host.querySelectorAll('.item') as any)].find((e: any) : any => e.textContent.includes(name))
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

describe('muscle names in the rows and tags (QA C9)', () : any => {
  it('picker row shows the display name, not the map id', () : any => {
    seed(custom())
    exercisePicker(vi.fn())
    const host: any = renderTop()
    act(() : any => type((host.querySelector('input.input') as any), 'QA Custom'))
    expect((rowFor(host, 'QA Custom Thrust').querySelector('.ss') as any).textContent).toBe('Glutes · barbell')
  })

  it('config sheet tags read like the detail sheet, for a custom exercise and for power clean', () : any => {
    seed(custom())
    exConfigSheet(useStore.getState().index.cqa1!, null, vi.fn())
    const tags: any = (h: any) : any => [...(h.querySelectorAll('.tag') as any)].map((e: any) : any => e.textContent.trim())
    expect(tags(renderTop())).toEqual(['Glutes', 'barbell', 'Forearms', 'Hip flexors'])
    // #207 Olympic lifts list their secondaries as map ids ('forearm', 'deltoids').
    exConfigSheet(useStore.getState().index['0648']!, null, vi.fn())
    expect(tags(renderTop())).toEqual(['hamstrings', 'barbell', 'Calves', 'Forearms', 'Shoulders'])
  })

  

  // The dataset's cardio target "cardiovascular system" is both a map id and a translated key
  // of its own. Routing it through MUSCLE_NAME must not cost it its translation: the 29
  // built-in cardio exercises read "Herz-Kreislauf" in German, never "Cardiovascular system".
  

  
})

beforeEach(() : any => prepareExerciseSheets())

function registerCustom(list: unknown) { const index = coreRegisterCustom(list); useStore.setState({ index }); return index }
