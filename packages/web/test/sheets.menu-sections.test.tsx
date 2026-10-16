// Intentional GM safety exception: stale account/profile/session actions abort
// with a toast; real W07 account-switch regressions are in sheets-a-account-targets.
import { configureUx, createBrowserUx } from '../src/platform/ux'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useUI } from '../src/store/useUI'
import { menuSheet } from '../src/sheets'

// menuSheet's `sections` (v1.3.11): a long menu in groups with small headers; a group with
// nothing left in it after the falsy items are dropped goes, header and all.
let host: any, root: any
beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() : any => { act(() : any => root.unmount()); host.remove(); useUI.setState({ sheets: [] }) })

const show: any= () : any => {
  const sheet: any= useUI.getState().sheets.at(-1)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
}

describe('menuSheet sections', () : any => {
  it('renders each group with its header, skips empty ones, and runs the tapped action', () : any => {
    const swap: any= vi.fn()
    menuSheet({ title: 'Bench', sections: [
      { title: 'Today', items: [{ icon: 'swap', label: 'Swap exercise', onClick: swap }, false] },
      { title: 'Nothing here', items: [null, false] },
      { items: [{ icon: 'gear', label: 'Workout settings', accent: true, chevron: true }] },
      { items: [{ icon: 'trash', label: 'Remove exercise', danger: true }] },
    ] })
    show()
    const groups: any= [...host.querySelectorAll('.menu-group')]
    expect(groups.map((g: any): any => g.querySelector('.menu-sec')?.textContent ?? null)).toEqual(['Today', null, null])
    expect(groups.map((g: any): any => [...g.querySelectorAll('.menu-item .tt')].map((e: any): any => e.textContent))).toEqual([['Swap exercise'], ['Workout settings'], ['Remove exercise']])
    expect(host.querySelector('.menu-item.accent .menu-chev')).toBeTruthy()
    expect(host.querySelector('.menu-item.danger .tt').textContent).toBe('Remove exercise')
    act(() : any => host.querySelector('.menu-item').click())
    expect(swap).toHaveBeenCalledOnce()
    expect(useUI.getState().sheets).toEqual([])
  })

  it('still takes a flat `items` list', () : any => {
    menuSheet({ items: [{ label: 'One' }, null, { label: 'Two' }] })
    show()
    expect([...host.querySelectorAll('.menu-item .tt')].map((e: any): any => e.textContent)).toEqual(['One', 'Two'])
    expect(host.querySelector('.menu-sec')).toBeNull()
  })
})

// Fixed synthetic date and injected DOM keep the twin independent of the host.
beforeEach(() : any => { configureUx(createBrowserUx()); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z')) })
afterEach(() : any => vi.useRealTimers())
