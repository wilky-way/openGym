// Intentional design safety exception: stale account/profile/session actions abort
// With a toast; real sync store account-switch regressions are in sheets-a-account-targets.
import { configureUx, createBrowserUx } from '../src/platform/ux'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from '@opengym/core/exercises'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { menuSheet } from '../src/sheets'

const mounted: any= []

// QA 1.3.9: "Convert To Lb?" — the menu title was title-cased whatever it said.
describe('menu sheet title', () : any => {
  afterEach(() : any => { act(() : any => { mounted.splice(0).forEach((root: any): any => root.unmount()) }) })
  const titleOf: any= (opts: any): any => {
    useUI.setState({ sheets: [] })
    menuSheet({ items: [], ...opts })
    const sheet: any= useUI.getState().sheets.at(-1)
    const host: any= document.createElement('div')
    document.body.appendChild(host)
    const root: any= createRoot(host)
    mounted.push(root)
    act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
    return host.querySelector('h3')
  }
  it('shows a sentence as written', () : any => {
    expect(titleOf({ title: 'Convert to lb?' }).className).toBe('')
  })
  it('still title-cases an exercise name when asked to', () : any => {
    expect(titleOf({ title: 'barbell curl', titleClass: 'capitalize' }).className).toBe('capitalize')
  })
})

// Fixed synthetic date and injected DOM keep the twin independent of the host.
beforeEach(() : any => { configureUx(createBrowserUx()); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z')) })
afterEach(() : any => vi.useRealTimers())
