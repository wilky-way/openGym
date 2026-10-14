// @vitest-environment happy-dom
import { setupPlanHistoryTest } from './helpers/plan-history'

// Plan → Schedule → a weekday (v1.3.11): one picker for the whole day. Tapping a routine puts it
// on the day or takes it off again, so two make a combined day (in the order tapped); "Rest day"
// clears the day and closes; the sheet stays open for a second pick until Done. The weekday key
// is dropped rather than left as an empty list.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { dayAssignSheet } from '../src/sheets-plan-history'

beforeEach((): any => setupPlanHistoryTest())

const clone: any = (v: any): any => JSON.parse(JSON.stringify(v))
let host: any, root: any

const renderTop: any = (): any => {
  const sheet: any = useUI.getState().sheets.at(-1)
  act((): any => root.render(sheet.render((): any => useUI.getState().closeSheet(sheet.id))))
}
const row: any = (name: any): any => [...host.querySelectorAll('.item')].find((el: any): any => el.querySelector('.tt')?.textContent === name)
const tap: any = (el: any): any => { act((): any => el.click()); if (useUI.getState().sheets.length) renderTop() }
const week: any = (): any => useStore.getState().S.week

beforeEach((): any => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  const S: any = clone(useStore.getState().S)
  S.routines = [
    { id: 'push', name: 'Push', emoji: null, ex: [{ id: '0025' }] },
    { id: 'core', name: 'Core', emoji: null, ex: [] },
  ]
  S.week = { 1: ['push'] }
  useStore.setState({ S, user: null })
})
afterEach((): any => { act((): any => root.unmount()); host.remove() })

describe('the weekday picker', (): any => {
  it('ticks what is on the day and adds a second routine for a combined day, staying open', (): any => {
    dayAssignSheet(1)
    renderTop()
    expect(host.querySelector('h3').textContent).toBe('Monday')
    expect(row('Push').getAttribute('aria-pressed')).toBe('true')
    expect(row('Core').getAttribute('aria-pressed')).toBe('false')
    tap(row('Core'))
    expect(week()[1]).toEqual(['push', 'core'])
    expect(useUI.getState().sheets.length).toBe(1)
    expect(row('Core').getAttribute('aria-pressed')).toBe('true')
  })

  it('takes a routine off again, and drops the day once nothing is left', (): any => {
    dayAssignSheet(1)
    renderTop()
    tap(row('Push'))
    expect(week()).not.toHaveProperty('1')
    expect(row('Rest day').querySelector('.menu-on').className).toContain('is-on')
  })

  it('Rest day clears a combined day and closes', (): any => {
    useStore.getState().update((s: any): any => { s.week[1] = ['push', 'core'] })
    dayAssignSheet(1)
    renderTop()
    tap(row('Rest day'))
    expect(week()).not.toHaveProperty('1')
    expect(useUI.getState().sheets.length).toBe(0)
  })

  it('plans an empty day and closes on Done', (): any => {
    dayAssignSheet(3)
    renderTop()
    tap(row('Core'))
    expect(week()[3]).toEqual(['core'])
    const done: any = [...host.querySelectorAll('button')].find((b: any): any => b.textContent.trim() === 'Done')
    act((): any => done.click())
    expect(useUI.getState().sheets.length).toBe(0)
  })
})
