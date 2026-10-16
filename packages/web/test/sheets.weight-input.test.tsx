// Intentional GM safety exception: stale account/profile/session actions abort
// with a toast; real W07 account-switch regressions are in sheets-a-account-targets.
import { configureUx, createBrowserUx } from '../src/platform/ux'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { bwSheet, goalSheet } from '../src/sheets'

// The big weight read-out (body weight, goal, top weight after an exercise) used to be text:
// the only ways to a number were the slider, ±0.1 and the ±0.5/±1 chips, so 72.3 → 85.7 was a
// drag you then corrected tap by tap. It is a field now. These pin the two things that make
// typing into it usable — a half-typed value is not clamped back at you, and the controls
// around it carry on from what you typed — plus the ceiling: the slider stops at 300 kg, a
// typed weight does not.
const mounted: any= []

function type(el: any, value: any): any  {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function renderBw(): any  {
  bwSheet()
  const sheet: any= useUI.getState().sheets.at(-1)
  const host: any= document.createElement('div')
  document.body.appendChild(host)
  const root: any= createRoot(host)
  mounted.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  const input: any= host.querySelector('.bw-read input')
  const slider: any= host.querySelector('.sld')
  const button: any= (label: any): any => [...host.querySelectorAll('button')].find((b: any): any => (b.getAttribute('aria-label') || b.textContent.trim()) === label)
  return { host, input, slider, button }
}

describe('weight read-out is a typable field', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState((s: any): any => ({ S: { ...s.S, unit: 'kg', bodyweight: [], targetW: null } }))
    document.body.innerHTML = ''
  })

  afterEach(() : any => {
    act(() : any => { mounted.splice(0).forEach((root: any): any => root.unmount()) })
  })

  it('shows the current weight in a decimal field with the unit beside it', () : any => {
    const { input, host } = renderBw()
    expect(input).toBeTruthy()
    expect(input.value).toBe('70')
    expect(input.getAttribute('inputmode')).toBe('decimal')
    expect(input.getAttribute('aria-label')).toBe('Weight (kg)')
    expect(host.querySelector('.bw-read .u').textContent.trim()).toBe('kg')
  })

  it('keeps a half-typed value on screen instead of clamping it, and moves the slider with it', () : any => {
    const { input, slider } = renderBw()
    act(() : any => type(input, ''))
    expect(input.value).toBe('')

    act(() : any => type(input, '8'))
    expect(input.value).toBe('8')

    act(() : any => type(input, '82,5'))
    expect(input.value).toBe('82.5')
    expect(slider.getAttribute('aria-valuenow')).toBe('82.5')
  })

  it('steps on from the typed value and saves what ends up on screen', () : any => {
    const { input, button } = renderBw()
    act(() : any => type(input, '82.5'))
    act(() : any => button('Increase by 0.1').click())
    expect(input.value).toBe('82.6')

    act(() : any => button('Save').click())
    const bw: any= useStore.getState().S.bodyweight
    expect(bw).toHaveLength(1)
    expect(bw[0].w).toBe(82.6)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('lets a typed weight sit past the slider ceiling rather than cutting it off', () : any => {
    const { input, slider, button } = renderBw()
    act(() : any => type(input, '320'))
    expect(input.value).toBe('320')
    expect(slider.getAttribute('aria-valuenow')).toBe('300')

    act(() : any => button('Save').click())
    expect(useStore.getState().S.bodyweight[0].w).toBe(320)
  })

  // 9999 typed into the field saved, and the chart and goal lines read like it was real.
  it('refuses a typed weight no person has, says the limit, and keeps the sheet open', () : any => {
    const toast: any= vi.fn()
    useUI.setState({ toast })
    const { input, button } = renderBw()
    act(() : any => type(input, '9999'))
    act(() : any => button('Save').click())
    expect(useStore.getState().S.bodyweight).toHaveLength(0)
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(toast).toHaveBeenCalledWith('That looks too heavy. Keep it at 700 kg or less.')
  })

  it('the goal sheet refuses the same', () : any => {
    const toast: any= vi.fn()
    useUI.setState({ toast })
    goalSheet()
    const sheet: any= useUI.getState().sheets.at(-1)
    const host: any= document.createElement('div')
    document.body.appendChild(host)
    const root: any= createRoot(host)
    mounted.push(root)
    act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
    act(() : any => type(host.querySelector('.bw-read input'), '9999'))
    act(() : any => [...host.querySelectorAll('button')].find((b: any): any => b.textContent.trim() === 'Save goal').click())
    expect(useStore.getState().S.targetW ?? null).toBe(null)
    expect(toast).toHaveBeenCalledWith('That looks too heavy. Keep it at 700 kg or less.')
  })

  it('still refuses to save an empty field', () : any => {
    const { input, button } = renderBw()
    act(() : any => type(input, ''))
    act(() : any => button('Save').click())
    expect(useStore.getState().S.bodyweight).toHaveLength(0)
    expect(useUI.getState().sheets).toHaveLength(1)
  })
})

// Fixed synthetic date and injected DOM keep the twin independent of the host.
beforeEach(() : any => { configureUx(createBrowserUx()); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z')) })
afterEach(() : any => vi.useRealTimers())
