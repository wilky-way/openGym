import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
// #378 / #358: a custom exercise stored without `custom: true` — what a plan import (a shared

// exercise sheet or in the routine's exercise settings, and its thumbnail went through the
// built-in renderer. Every one of those now asks where the exercise lives, not for the flag.
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { registerCustom as coreRegisterCustom } from '@opengym/core/exercises'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { _setLangState } from '@opengym/core/i18n-core'
import { bindUI } from '../src/components/ui'
import { customExSheet, exerciseDetailSheet, exConfigSheet } from '../src/sheets'

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
const buttons: any = (host: any) : any => [...(host.querySelectorAll('button') as any)].map((b: any) : any => b.textContent.trim())
const click: any = (host: any, sel: any, text: any) : any => {
  const el: any = [...(host.querySelectorAll(sel) as any)].find((e: any) : any => e.textContent.trim() === text)
  if (!el) throw new Error(`nothing with text "${text}"`)
  act(() : any => el.click())
}

// Exactly what a pre-1.3.8 plan import stored: no flag, no equipment.
const legacy: any = () : any => ({ id: 'cx1', n: 'My row', bp: 'back' })
function seed(ex: any, extra: any = {}) : any {
  useStore.setState((s: any) : any => ({ S: { ...s.S, customEx: [ex], ...extra } }))
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

describe('a custom exercise stored without the flag', () : any => {
  it('its sheet offers Edit and Delete', () : any => {
    const ex: any = legacy()
    seed(ex)
    exerciseDetailSheet(ex)
    const host: any = renderTop()
    expect(buttons(host)).toEqual(expect.arrayContaining(['Edit', 'Delete']))
  })

  it('Edit opens the form filled in with it', () : any => {
    const ex: any = legacy()
    seed(ex)
    exerciseDetailSheet(ex)
    click(renderTop(), 'button', 'Edit')
    const form: any = renderTop()
    expect(form.textContent).toContain('Edit custom exercise')
    expect((form.querySelector('input.input') as any).value).toBe('My row')
    expect((form.querySelector('.chip.on') as any).textContent).toBe('back')
  })

  it('Delete takes it out of the routines and keeps the name in history', () : any => {
    const ex: any = legacy()
    seed(ex, {
      routines: [{ id: 'r1', name: 'A', ex: [{ id: 'cx1', sets: 3, reps: 8, w: 40 }, { id: '0027', sets: 3, reps: 8, w: 40 }] }],
      workouts: [{ d: '2026-09-01', entries: [{ id: 'cx1', sets: [{ r: 8, w: 40, done: true }] }] }],
    })
    exerciseDetailSheet(ex)
    click(renderTop(), 'button', 'Delete')
    click(renderTop(), 'button', 'Delete')   // the confirmation
    expect(S().customEx).toEqual([])
    expect(S().routines[0].ex.map((e: any) : any => e.id)).toEqual(['0027'])
    expect(S().workouts[0].entries[0].n).toBe('My row')
  })

  it('the routine exercise settings offer "Edit or delete this exercise"', () : any => {
    const ex: any = legacy()
    seed(ex)
    exConfigSheet(ex, { id: 'cx1', sets: 3, reps: 8, w: 40 }, () : any => {})
    expect(buttons(renderTop())).toContain('Edit or delete this exercise')
  })

  

  it('equipment from an import that the list lacks counts as picked, so Save works', () : any => {
    const ex: any = { ...legacy(), eq: 'custom', custom: true }
    seed(ex)
    customExSheet(ex)
    const form: any = renderTop()
    expect([...(form.querySelectorAll('.chip.on') as any)].map((c: any) : any => c.textContent)).toContain('custom')
    act(() : any => {
      const el: any = (form.querySelector('input.input') as any)
      ;(Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value') as any).set.call(el, 'My cable row')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    click(form, 'button', 'Save')
    expect(S().customEx[0]).toMatchObject({ id: 'cx1', n: 'My cable row', eq: 'custom' })
  })
})

beforeEach(() : any => prepareExerciseSheets())

function registerCustom(list: unknown) { const index = coreRegisterCustom(list); useStore.setState({ index }); return index }
