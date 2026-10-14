// Intentional design safety exception: stale account/profile/session actions abort
// With a toast; real sync store account-switch regressions are in sheets-a-account-targets.
import { configureUx, createBrowserUx } from '../src/platform/ux'
// @vitest-environment happy-dom
// Discord 'Weight': "click on the body weight log to see the weight history and weekly average".
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { bwSheet, weighInsSheet } from '../src/sheets'

const clone: any= (v: any): any => JSON.parse(JSON.stringify(v))
const mounted: any= []
function mountTopSheet(): any  {
  const sheet: any= useUI.getState().sheets.at(-1)
  const host: any= document.createElement('div')
  document.body.appendChild(host)
  const root: any= createRoot(host)
  mounted.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button: any= (host: any, text: any) : any => [...host.querySelectorAll('button')].find((b: any): any => b.textContent.trim() === text)

// Two Monday-started weeks: 31 Aug – 6 Sep and 7 – 13 Sep 2026.
const LOG: any= [
  { d: '2026-09-01', w: 81, t: 1 }, { d: '2026-09-03', w: 80, t: 2 },
  { d: '2026-09-07', w: 80.5, t: 3 }, { d: '2026-09-09', w: 79.5, t: 4 }, { d: '2026-09-13', w: 79, t: 5 },
]
function install(extra: any= {}): any  {
  const S: any= clone(DEF)
  Object.assign(S, { unit: 'kg', bodyweight: clone(LOG), weekStart: 1, targetW: null }, extra)
  useStore.setState({ S, user: null })
}

beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  document.body.innerHTML = ''
  install()
})
afterEach(() : any => { act(() : any => { mounted.splice(0).forEach((root: any): any => root.unmount()) }) })

describe('weigh-ins sheet', () : any => {
  it('lists every weigh-in under its week, newest first, with the week\'s average and change', () : any => {
    weighInsSheet()
    const host: any= mountTopSheet()
    expect(host.querySelector('h3').textContent).toBe('Weigh-ins')
    expect(host.textContent).toContain('5 weigh-ins')
    expect(host.querySelector('.chart svg')).toBeTruthy()
    const weeks: any= [...host.querySelectorAll('[data-week]')]
    expect(weeks.map((w: any): any => w.dataset.week)).toEqual(['2026-09-07', '2026-08-31'])
    expect(weeks[0].textContent).toContain('Average 79.7 kg')
    expect(weeks[0].textContent).toContain('0.8')             // down from 80.5 the week before
    expect(weeks[1].textContent).toContain('Average 80.5 kg')
    expect(weeks[0].querySelectorAll('button[aria-label="Delete weigh-in"]')).toHaveLength(3)
    expect(weeks[1].querySelectorAll('button[aria-label="Delete weigh-in"]')).toHaveLength(2)
  })

  it('follows a Sunday week start', () : any => {
    install({ weekStart: 0 })
    weighInsSheet()
    expect([...mountTopSheet().querySelectorAll('[data-week]')].map((w: any): any => w.dataset.week)).toEqual(['2026-09-13', '2026-09-06', '2026-08-30'])
  })

  // The list is months of history scrolled on a phone: a stray tap on a trash button there must
  // not take a past weigh-in with it, so the list asks first.
  it('deletes a weigh-in from the list once that is confirmed', () : any => {
    weighInsSheet()
    const host: any= mountTopSheet()
    act(() : any => { host.querySelector('[data-week="2026-08-31"] button[aria-label="Delete weigh-in"]').click() })
    expect(useStore.getState().S.bodyweight).toHaveLength(5)
    expect(useUI.getState().sheets).toHaveLength(2)
    const ask: any= mountTopSheet()
    expect(ask.querySelector('h3').textContent).toBe('Delete weigh-in?')
    expect(ask.textContent).toContain('80 kg')
    act(() : any => { button(ask, 'Delete').click() })
    expect(useStore.getState().S.bodyweight.map((b: any): any => b.d)).toEqual(['2026-09-01', '2026-09-07', '2026-09-09', '2026-09-13'])
    expect(host.textContent).toContain('4 weigh-ins')
  })

  it('keeps the weigh-in when the question is cancelled', () : any => {
    weighInsSheet()
    const host: any= mountTopSheet()
    act(() : any => { host.querySelector('[data-week="2026-08-31"] button[aria-label="Delete weigh-in"]').click() })
    const ask: any= mountTopSheet()
    act(() : any => { button(ask, 'Cancel').click() })
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useStore.getState().S.bodyweight).toHaveLength(5)
  })

  // The log sheet's recent three are the ones just typed: a typo there still goes in one tap.
  it('still deletes one of the log sheet\'s recent weigh-ins in one tap', () : any => {
    bwSheet()
    const log: any= mountTopSheet()
    act(() : any => { log.querySelector('button[aria-label="Delete weigh-in"]').click() })
    expect(useUI.getState().sheets).toHaveLength(1)
    expect(useStore.getState().S.bodyweight).toHaveLength(4)
  })

  it('has an empty state', () : any => {
    install({ bodyweight: [] })
    weighInsSheet()
    const host: any= mountTopSheet()
    expect(host.querySelector('.empty')).toBeTruthy()
    expect(host.querySelector('.chart')).toBeNull()
  })

  it('is reached from the log sheet once there are more weigh-ins than its recent three', () : any => {
    bwSheet()
    const log: any= mountTopSheet()
    expect(log.querySelectorAll('button[aria-label="Delete weigh-in"]')).toHaveLength(3)
    const all: any= button(log, 'All weigh-ins')
    expect(all).toBeTruthy()
    act(() : any => { all.click() })
    expect(mountTopSheet().querySelector('h3').textContent).toBe('Weigh-ins')

    useUI.setState({ sheets: [] })
    install({ bodyweight: clone(LOG).slice(0, 2) })
    bwSheet()
    expect(button(mountTopSheet(), 'All weigh-ins')).toBeUndefined()
  })
})

// Fixed synthetic date and injected DOM keep the twin independent of the host.
beforeEach(() : any => { configureUx(createBrowserUx()); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z')) })
afterEach(() : any => vi.useRealTimers())
