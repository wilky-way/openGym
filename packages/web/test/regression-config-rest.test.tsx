import { prepareExerciseSheets } from './regression-test-support'
// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from '@opengym/core/exercises'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exConfigSheet } from '../src/sheets'

// v1.3.11: an exercise's own rest is set on the same wheel as the default rest timer, where 0:00
// means "no rest of its own" and the row says which default applies then.
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
const restRow: any = (host: any) : any => [...(host.querySelectorAll('.lrow') as any)].find((r: any) : any => (r.querySelector('.lrow-t') as any)?.textContent === 'Rest for this exercise')
const save: any = (host: any) : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === 'Save').click()

describe('exercise settings: rest on the wheel', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'kg', restSec: 120 } }))
    document.body.innerHTML = ''
  })
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach(([root, host]: any) : any => { root.unmount(); host.remove() }) }) })

  it('reads Default with the default rest when the exercise has none, and saves what the wheel picks', () : any => {
    const onSave: any = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', restSec: 0 }, onSave)
    const host: any = render(useUI.getState().sheets.at(-1))
    expect((restRow(host).querySelector('.lrow-v') as any).textContent).toBe('Default (2:00)')
    act(() : any => restRow(host).click())
    const wheel: any = render(useUI.getState().sheets.at(-1))
    expect((wheel.querySelector('h3') as any).textContent).toBe('Rest for this exercise')
    expect((wheel.querySelector('.dw-read') as any).textContent).toBe('Default (2:00)')
    // The copy names the wheel's 0:00, not a "0" the row never shows (QA 10-05).
    expect(host.textContent).toContain('0:00 means your default rest.')
    expect(host.textContent).not.toMatch(/Leave at 0/)
    // Done keeps 0:00, the default; the value shown stays the default's.
    act(() : any => [...(wheel.querySelectorAll('button') as any)].find((b: any) : any => b.textContent === 'Done').click())
    act(() : any => save(host))
    expect(onSave.mock.calls[0][0].restSec || 0).toBe(0)
  })

  it('shows an exercise’s own rest as a time, and the wheel opens on it', () : any => {
    const onSave: any = vi.fn()
    exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', restSec: 75 }, onSave)
    const host: any = render(useUI.getState().sheets.at(-1))
    expect((restRow(host).querySelector('.lrow-v') as any).textContent).toBe('1:15')
    act(() : any => restRow(host).click())
    const wheel: any = render(useUI.getState().sheets.at(-1))
    expect((wheel.querySelector('.dw-read') as any).textContent).toBe('1:15')
    act(() : any => [...(wheel.querySelectorAll('button') as any)].find((b: any) : any => b.textContent === 'Done').click())
    act(() : any => save(host))
    expect(onSave.mock.calls[0][0].restSec).toBe(75)
  })
})

beforeEach(() : any => prepareExerciseSheets())
