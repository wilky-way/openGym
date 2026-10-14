import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from '@opengym/core/exercises'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exConfigSheet } from '../src/sheets'
import { bindUI } from '../src/components/ui'

// Sets to failure: "Last set to failure" on the exercise's settings, written only when on.
const ex: any = EXDB.find((e: any) : any => e.id === '0009')
const mounted: any = []

function render(sheet: any) : any {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push([root, host])
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return host
}
const open: any = (cfg: any = {}, onSave: any) : any => {
  exConfigSheet(ex, { sets: 3, reps: 5, weight: 40, mode: 'reps', ...cfg }, onSave)
  return render(useUI.getState().sheets.at(-1))
}
const rowNamed: any = (host: any, title: any) : any => [...(host.querySelectorAll('.lrow') as any)].find((r: any) : any => (r.querySelector('.lrow-t') as any)?.textContent === title)
const save: any = (host: any) : any => act(() : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === 'Save').click())

describe('exercise settings: last set to failure', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [] })
    useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach(([root, host]: any) : any => { root.unmount(); host.remove() }) }) })

  it('is off by default and saves nothing then', () : any => {
    const onSave: any = vi.fn()
    const host: any = open({}, onSave)
    expect((rowNamed(host, 'Last set to failure').querySelector('[role="switch"]') as any).getAttribute('aria-checked')).toBe('false')
    save(host)
    expect('lastToFailure' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('switched on, it saves the flag and says what it does', () : any => {
    const onSave: any = vi.fn()
    const host: any = open({}, onSave)
    act(() : any => (rowNamed(host, 'Last set to failure').querySelector('[role="switch"]') as any).click())
    expect(host.textContent).toContain('counts as all-out effort unless you rate it')
    save(host)
    expect(onSave.mock.calls[0][0].lastToFailure).toBe(true)
  })

  it('comes on with Greyskull, whose last set is an AMRAP, unless it was already decided', () : any => {
    const onSave: any = vi.fn()
    const host: any = open({}, onSave)
    act(() : any => rowNamed(host, 'Rule').click())
    const picker: any = render(useUI.getState().sheets.at(-1))
    act(() : any => [...(picker.querySelectorAll('button.lrow') as any)].find((el: any) : any => (el.querySelector('.lrow-t') as any)?.textContent === 'Greyskull LP').click())
    expect((rowNamed(host, 'Last set to failure').querySelector('[role="switch"]') as any).getAttribute('aria-checked')).toBe('true')
    save(host)
    expect(onSave.mock.calls[0][0]).toMatchObject({ prog: 'greyskull', lastToFailure: true })
  })

  it('is not offered on a pyramid, which has its own Max set', () : any => {
    const host: any = open({ pyramid: [12, 8, 0] })
    expect(rowNamed(host, 'Last set to failure')).toBeUndefined()
  })

  
})

beforeEach(() : any => prepareExerciseSheets())
