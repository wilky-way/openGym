import { prepareExerciseSheets } from './regression-test-support'
import { useStore } from '../src/store/useStore'
// @vitest-environment happy-dom
// The effort picker's "Exact" field used to write through on every change, and onPick concludes
// the set (issue #64): it ticks the set, beeps and starts the rest. So typing the `1` of `10`,
// or one tap of `+` (stepEffort returns the band minimum from null), logged a rating under the
// sheet you were still typing into — and on the last set of the last exercise, stacked the
// workout-complete dialog on top of it. Every earlier test mocked the sheet away and called
// onPick directly, so nothing rendered the real component. This does.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useUI } from '../src/store/useUI'
import { effortPickerSheet } from '../src/sheets'

const mounted: any = []

// Renders the real EffortPicker the way Modals does, and hands back the ways it can go away.
const openPicker: any = (kind: any, value: any, onPick: any) : any => {
  effortPickerSheet(kind, value, onPick)
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  let closedByComponent: any = false
  act(() : any => root.render(sheet.render(() : any => { closedByComponent = true })))
  return {
    host,
    closed: () : any => closedByComponent,
    // Backdrop, swipe and Escape all end the same way: the sheet unmounts.
    dismiss: () : any => act(() : any => root.unmount()),
  }
}
const presetRows: any = (host: any) : any => [...(host.querySelectorAll('.menu-item') as any)].filter((r: any) : any => !r.classList.contains('effpick-free'))
const buttonSaying: any = (host: any, text: any) : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === text)
const field: any = (host: any) : any => (host.querySelector('input') as any)
const tap: any = (el: any) : any => act(() : any => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
// React tracks the input's value through the prototype setter, so a bare el.value never reaches
// onChange. Same helper the weight-input and custom-target sheet tests use.
const type: any = (host: any, value: any) : any => act(() : any => {
  const el: any = field(host)
  ;(Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value') as any).set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

beforeEach(() : any => { globalThis.IS_REACT_ACT_ENVIRONMENT = true })

afterEach(() : any => {
  mounted.forEach((r: any) : any => { try { act(() : any => r.unmount()) } catch { /* already unmounted */ } })
  mounted.length = 0
  document.body.innerHTML = ''
  useUI.setState({ sheets: [] })
})

describe('the effort picker commits once', () : any => {
  it('a preset row still logs on the tap, and closes', () : any => {
    const onPick: any = vi.fn()
    const p: any = openPicker('rir', null, onPick)
    const rows: any = presetRows(p.host)
    expect(rows.length).toBeGreaterThan(1)
    tap(rows[1])
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(p.closed()).toBe(true)
    p.dismiss()
    expect(onPick).toHaveBeenCalledTimes(1)      // the unmount must not log a second time
  })

  it('typing an exact value logs nothing until the sheet goes away', () : any => {
    const onPick: any = vi.fn()
    const p: any = openPicker('rpe', null, onPick)
    type(p.host, '1')
    expect(onPick).not.toHaveBeenCalled()        // this is the bug: `1` used to be a rating
    type(p.host, '10')
    expect(onPick).not.toHaveBeenCalled()
    expect(p.closed()).toBe(false)
    p.dismiss()
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(10)
  })

  it('one tap of + logs nothing', () : any => {
    const onPick: any = vi.fn()
    const p: any = openPicker('rir', null, onPick)
    tap((p.host.querySelector('[aria-label="Increase"]') as any))
    expect(onPick).not.toHaveBeenCalled()
    expect(field(p.host).value).not.toBe('')     // the number moved on screen, though
  })

  it('Done logs the typed value once, and the unmount after it does not repeat', () : any => {
    const onPick: any = vi.fn()
    const p: any = openPicker('rir', null, onPick)
    type(p.host, '3')
    tap(buttonSaying(p.host, 'Done'))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(3)
    expect(p.closed()).toBe(true)
    p.dismiss()
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('opening and dismissing without touching anything logs nothing', () : any => {
    const onPick: any = vi.fn()
    openPicker('rir', null, onPick).dismiss()
    expect(onPick).not.toHaveBeenCalled()
    // Same for a set that already carries a rating: reopening it must not re-log and re-tick.
    const again: any = vi.fn()
    openPicker('rir', 2, again).dismiss()
    expect(again).not.toHaveBeenCalled()
  })

  it('Clear rating logs null once', () : any => {
    const onPick: any = vi.fn()
    const p: any = openPicker('rir', 2, onPick)
    tap(buttonSaying(p.host, 'Clear rating'))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(null)
    p.dismiss()
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('typing a value then clearing it back to empty logs nothing', () : any => {
    const onPick: any = vi.fn()
    const p: any = openPicker('rir', null, onPick)
    type(p.host, '4')
    type(p.host, '')
    p.dismiss()
    expect(onPick).not.toHaveBeenCalled()
  })
})

beforeEach(() : any => prepareExerciseSheets())
