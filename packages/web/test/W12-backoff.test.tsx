import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from '@opengym/core/exercises'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exConfigSheet } from '../src/sheets'
import { exLine } from '@opengym/core/history'

// Back-off sets (lib/backoff.js): a switch under the progression Step, saved as `backoff: true`.
const ex: any = EXDB.find((e: any) : any => e.id === '0025')          // barbell bench press
const assisted: any = EXDB.find((e: any) : any => e.id === '0009')    // assisted chest dip: less load is harder
const mounted: any = []

function render(sheet: any) : any {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push([root, host])
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return host
}
const backoffRow: any = (host: any) : any => [...(host.querySelectorAll('.lrow') as any)].find((r: any) : any => (r.querySelector('.lrow-t') as any)?.textContent === 'Back-off sets')
const toggle: any = (host: any) : any => (backoffRow(host).querySelector('button, [role=switch], input[type=checkbox]') as any).click()
const save: any = (host: any) : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === 'Save').click()
const open: any = (cfg: any = {}, onSave: any) : any => {
  exConfigSheet(ex, { sets: 3, reps: 6, weight: 26, mode: 'reps', inc: 2, ...cfg }, onSave)
  return render(useUI.getState().sheets.at(-1))
}

describe('exercise settings: back-off sets', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach(([root, host]: any) : any => { root.unmount(); host.remove() }) }) })

  it('is off by default and saves no field, so the plan keeps its shape', () : any => {
    const onSave: any = vi.fn()
    const host: any = open({}, onSave)
    expect(backoffRow(host)).toBeTruthy()
    expect(host.textContent).toContain('All sets at the same weight.')
    act(() : any => save(host))
    expect('backoff' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('switched on, previews the sets and saves the flag', () : any => {
    const onSave: any = vi.fn()
    const host: any = open({}, onSave)
    act(() : any => toggle(host))
    expect(host.textContent).toContain('Sets open at 26 → 24 → 22 kg.')
    act(() : any => save(host))
    const saved: any = onSave.mock.calls[0][0]
    expect(saved.backoff).toBe(true)
    expect(saved.inc).toBe(2)
    expect(exLine({ id: ex.id, ...saved }, 'kg')).toBe('3 × 6 · 26 → 24 → 22 kg')
  })

  it('switched off again, drops the flag', () : any => {
    const onSave: any = vi.fn()
    const host: any = open({ backoff: true }, onSave)
    act(() : any => toggle(host))
    act(() : any => save(host))
    expect('backoff' in onSave.mock.calls[0][0]).toBe(false)
  })

  it('is not offered on an assistance machine', () : any => {
    exConfigSheet(assisted, { sets: 3, reps: 6, weight: 30, mode: 'reps' }, vi.fn())
    expect(backoffRow(render(useUI.getState().sheets.at(-1)))).toBeUndefined()
  })

  it('is not offered for pyramid sets', () : any => {
    const host: any = open({ pyramid: [12, 10, 8] }, vi.fn())
    expect(backoffRow(host)).toBeUndefined()
  })
})

beforeEach(() : any => prepareExerciseSheets())
