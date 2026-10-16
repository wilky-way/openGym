import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from '@opengym/core/exercises'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { exConfigSheet } from '../src/sheets'

// The exercise settings' number fields with a floor (a drop-set's drops and weight drop, a
// rest-pause's reps and rest) or a range (the Epley deload) were clamped on every keystroke, like
// the workout duration was: an emptied field snapped back to its minimum and the digits typed next
// landed after it, so a weight drop retyped as 20 read 520 and a deload typed as 80 read 95.
const ex: any = EXDB.find((e: any) : any => e.id === '0009')   // a weighted machine exercise: Epley deload applies
const mounted: any = []

function renderConfig(cfg: any = {}) : any {
  const onSave: any = vi.fn()
  exConfigSheet(ex, { sets: 3, reps: 10, weight: 40, mode: 'reps', ...cfg }, onSave)
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return { host, onSave }
}
// The last field so labelled: "Rest (s)" is also the exercise's own rest, further up the sheet.
const field: any = (host: any, label: any) : any => ([...(host.querySelectorAll('.stp-w') as any)].filter((w: any) : any => (w.querySelector('.stp-l') as any)?.textContent === label).at(-1).querySelector('input.num') as any)
function type(el: any, value: any) : any {
  ;(Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value') as any).set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const leave: any = (el: any) : any => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
const save: any = (host: any) : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === 'Save').click()

describe('exercise settings: typing into a field with a minimum', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) }) })

  it('lets a drop-set field be emptied and retyped, and saves what was typed', () : any => {
    const { host, onSave }: any = renderConfig({ intensifier: { type: 'dropset', count: 2, pct: 10 } })
    const pct: any = field(host, 'Weight drop (%)')
    act(() : any => type(pct, ''))
    expect(pct.value).toBe('')
    act(() : any => type(pct, '20'))
    expect(pct.value).toBe('20')
    const drops: any = field(host, 'Drops')
    act(() : any => type(drops, ''))
    act(() : any => type(drops, '3'))
    expect(drops.value).toBe('3')
    act(() : any => save(host))
    expect(onSave.mock.calls[0][0].intensifier).toEqual({ type: 'dropset', count: 3, pct: 20 })
  })

  it('holds a field left below its minimum to it, on leaving it or on saving straight from it', () : any => {
    const { host, onSave }: any = renderConfig({ intensifier: { type: 'restpause', totalReps: 8, restSec: 15 } })
    const rest: any = field(host, 'Rest (s)')
    act(() : any => type(rest, '2'))
    expect(rest.value).toBe('2')
    act(() : any => leave(rest))
    expect(rest.value).toBe('5')
    act(() : any => type(field(host, 'Rest-pause reps'), ''))   // saved without leaving the field
    act(() : any => save(host))
    expect(onSave.mock.calls[0][0].intensifier).toEqual({ type: 'restpause', totalReps: 1, restSec: 5 })
  })

  it('lets the deload percentage be retyped, held to 50–95 on leaving the field', () : any => {
    const { host, onSave }: any = renderConfig({ prog: 'linear' })
    const deload: any = field(host, 'Deload 1RM (%)')
    expect(deload.value).toBe('90')
    act(() : any => type(deload, ''))
    expect(deload.value).toBe('')
    act(() : any => type(deload, '8'))
    expect(deload.value).toBe('8')
    act(() : any => type(deload, '80'))
    expect(deload.value).toBe('80')
    act(() : any => leave(deload))
    expect(deload.value).toBe('80')
    act(() : any => type(deload, '99'))
    act(() : any => leave(deload))
    expect(deload.value).toBe('95')
    act(() : any => type(deload, '85'))
    act(() : any => save(host))
    expect(onSave.mock.calls[0][0].deloadFactor).toBe(0.85)
  })
})

// QA 1.3.9: a timed bodyweight hold showed "Weight (kg)" and "Added (kg)", two fields bound to
// the same value, under a Bodyweight row that said to "just log the reps".
describe('exercise settings: a timed bodyweight hold', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState((s: any) : any => ({ S: { ...s.S, unit: 'kg' } }))
    document.body.innerHTML = ''
  })
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach((root: any) : any => root.unmount()) }) })
  const labels: any = (host: any) : any => [...(host.querySelectorAll('.stp-l') as any)].map((l: any) : any => l.textContent)

  it('has one weight field, the added load, and talks about the hold', () : any => {
    const { host }: any = renderConfig({ mode: 'time', sec: 45, weight: 0, bodyweight: true })
    expect(labels(host)).not.toContain('Weight (kg)')
    expect(labels(host).filter((l: any) : any => l === 'Added (kg)')).toHaveLength(1)
    expect(host.textContent).toContain('No weight to enter. Just time the hold.')
    expect(host.textContent).not.toContain('just log the reps')
  })

  it('keeps the one weight field on a loaded hold', () : any => {
    const { host }: any = renderConfig({ mode: 'time', sec: 45, weight: 10, bodyweight: false })
    expect(labels(host)).toContain('Weight (kg)')
    expect(labels(host)).not.toContain('Added (kg)')
  })
})

beforeEach(() : any => prepareExerciseSheets())
