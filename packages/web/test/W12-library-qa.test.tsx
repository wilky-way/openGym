import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
// QA 1.3.11, Library: an imported custom exercise named like a catalogue one could not be saved
// unchanged, the detail sheet tagged muscles the catalogue credits with nothing (#359), and a long
// name could push the favourite star off a 320 px screen.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'

import { EXIDX, registerCustom as coreRegisterCustom } from '@opengym/core/exercises'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { _setLangState } from '@opengym/core/i18n-core'
import { bindUI } from '../src/components/ui'
import { customExSheet, exerciseDetailSheet } from '../src/sheets'

bindUI(useUI)

const mounted: any = []
const S: any = () : any => useStore.getState().S

function render(el: any) : any {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() : any => root.render(el))
  return host
}
const renderTop: any = () : any => {
  const sheet: any = useUI.getState().sheets.at(-1)
  return render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id)))
}
const click: any = (host: any, sel: any, text: any) : any => {
  const el: any = [...(host.querySelectorAll(sel) as any)].find((e: any) : any => e.textContent.trim() === text)
  if (!el) throw new Error(`nothing with text "${text}"`)
  act(() : any => el.click())
}
const type: any = (input: any, value: any) : any => act(() : any => {
  ;(Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value') as any).set.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
function seed(ex: any) : any {
  useStore.setState((s: any) : any => ({ S: { ...s.S, customEx: [ex] } }))
  registerCustom([ex])
}

beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null, config: null })
  registerCustom([])
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
})
afterEach(() : any => {
  act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) })
  registerCustom([])
})

describe('editing a custom exercise named like a catalogue one', () : any => {
  const trap: any = () : any => ({ id: 'cx9', n: 'trap bar deadlift', bp: 'upper legs', eq: 'custom', custom: true, desc: '' })

  it('saves it unchanged', () : any => {
    expect(Object.values(EXIDX).some((e: any) : any => e.id !== 'cx9' && e.n.toLowerCase() === 'trap bar deadlift')).toBe(true)
    seed(trap())
    customExSheet(trap())
    const form: any = renderTop()
    type((form.querySelector('textarea') as any), 'Hex bar')
    click(form, 'button', 'Save')
    expect(useUI.getState().toastMsg).toBe('Saved')
    expect(S().customEx[0]).toMatchObject({ n: 'trap bar deadlift', desc: 'Hex bar' })
  })

  it('still refuses a rename onto another exercise', () : any => {
    const own: any = { id: 'cx8', n: 'My row', bp: 'back', eq: 'barbell', custom: true }
    seed(own)
    customExSheet(own)
    const form: any = renderTop()
    type((form.querySelector('input.input') as any), 'Trap Bar Deadlift')
    click(form, 'button', 'Save')
    expect(useUI.getState().toastMsg).toMatch(/already exists/)
    expect(S().customEx[0].n).toBe('My row')
  })

  it('caps the name at 80 characters', () : any => {
    customExSheet(null)
    expect((renderTop().querySelector('input.input') as any).maxLength).toBe(80)
  })
})

describe('the exercise detail sheet', () : any => {
  it('does not tag a muscle the exercise gets no credit for', () : any => {
    const bench: any = useStore.getState().index['0025']!
    expect(bench.muscleWeights.biceps).toBe(0)
    exerciseDetailSheet(bench)
    const tags: any = [...(renderTop().querySelectorAll('.tag') as any)].map((t: any) : any => t.textContent.trim())
    expect(tags).toEqual(expect.arrayContaining(['Triceps']))
    expect(tags).not.toContain('Biceps')
  })

  it('lets a long name wrap instead of pushing the star out', () : any => {
    exerciseDetailSheet(useStore.getState().index['0025']!)
    expect((renderTop().querySelector('h3') as any).classList.contains('exdetail-name')).toBe(true)
  })
})

beforeEach(() : any => prepareExerciseSheets())

function registerCustom(list: unknown) { const index = coreRegisterCustom(list); useStore.setState({ index }); return index }
