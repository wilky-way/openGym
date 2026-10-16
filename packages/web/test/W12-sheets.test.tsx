import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from '@opengym/core/exercises'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exConfigSheet } from '../src/sheets'

const ex: any = EXDB.find((e: any) : any => e.id === '0009')
const mounted: any = []

function type(el: any, value: any) : any {
  ;(Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value') as any).set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function renderConfig(onSave: any = vi.fn()) : any {
  exConfigSheet(ex, { sets: 3, reps: 10, weight: 0, mode: 'reps', prog: 'double' }, onSave)
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  const stepper: any = [...(host.querySelectorAll('.stp-w') as any)]
    .find((el: any) : any => (el.querySelector('.stp-l') as any)?.textContent.startsWith('Step'))
  return { host, step: (stepper.querySelector('input') as any), onSave }
}

describe('exercise configuration progression step', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })

  afterEach(() : any => {
    act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) })
  })

  it('keeps the draft empty while clearing the default so a sub-one comma decimal can be entered', () : any => {
    const { step }: any = renderConfig()
    expect(step.value).toBe('2.5')

    act(() : any => { type(step, '') })
    expect(step.value).toBe('')

    act(() : any => { type(step, '0,5') })
    expect(step.value).toBe('0.5')
  })

  it('blocks saving without a positive progression step but accepts a positive decimal', () : any => {
    const config: any = renderConfig()
    const save: any = [...(config.host.querySelectorAll('button') as any)]
      .find((b: any) : any => /^(save|add to routine)$/i.test(b.textContent.trim()))

    act(() : any => { type(config.step, '') })
    expect(config.step.value).toBe('')
    expect(config.step.getAttribute('aria-invalid')).toBe('true')
    expect(save.disabled).toBe(true)
    expect(config.host.textContent).toContain('Enter a positive step to use this progression rule.')

    act(() : any => { save.click() })
    expect(config.onSave).not.toHaveBeenCalled()
    expect(useUI.getState().sheets).toHaveLength(1)

    act(() : any => { type(config.step, '0') })
    expect(save.disabled).toBe(true)

    act(() : any => { type(config.step, '0,5') })
    expect(config.step.value).toBe('0.5')
    expect(config.step.getAttribute('aria-invalid')).not.toBe('true')
    expect(save.disabled).toBe(false)

    act(() : any => { save.click() })
    expect(config.onSave).toHaveBeenCalledWith(expect.objectContaining({ inc: 0.5 }))
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})

// QA 1.3.9: "Convert To Lb?" — the menu title was title-cased whatever it said.


beforeEach(() : any => prepareExerciseSheets())
