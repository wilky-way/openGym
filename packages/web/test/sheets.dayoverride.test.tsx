// @vitest-environment happy-dom
import { setupPlanHistoryTest } from './helpers/plan-history'


// same per-date override), and one already pinned to another day shows that day.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { dayOverrideSheet } from '../src/sheets-plan-history'
import { todayISO, isoOf, fmtDate, exCount } from '@opengym/core/format'

beforeEach((): any => setupPlanHistoryTest())

const routines: any = [
  { id: 'd1', name: 'US W1 D1', emoji: null, ex: [{ id: '0025' }] },
  { id: 'd2', name: 'US W1 D2', emoji: null, ex: [{ id: '0025' }] },
  { id: 'own', name: 'Core', emoji: null, ex: [{ id: '0025' }] },
]
const SINCE: any = new Date('2026-09-16T12:00:00').getTime() - 2 * 86400000
const daysFromToday: any = (n: any): any => { const d: any = new Date(todayISO() + 'T12:00:00'); d.setDate(d.getDate() + n); return isoOf(d) }
const queue: any = { ids: ['d1', 'd2'], since: SINCE, startsOn: '2026-09-15', label: 'US W1' }
// A finished workout on `id`, started after the apply — the DONE RULE counts it for this week.
const logged: any = (id: any): any => {
  const start: any = SINCE + 3600000
  return { id: 'w-' + id, d: isoOf(new Date(start)), start, end: start + 3600000, routineIds: [id], routineId: id, name: routines.find((r: any): any => r.id === id).name, entries: [] }
}
const mounted: any = []

function renderTop(): any {
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act((): any => root.render(sheet.render((): any => useUI.getState().closeSheet(sheet.id))))
  return host
}
const header: any = (host: any): any => host.querySelector('.muted.small').textContent
const heading: any = (host: any): any => host.querySelector('h4.sec')?.textContent
const lists: any = (host: any): any => [...host.querySelectorAll('.list')].map((l: any): any => [...l.querySelectorAll('.item .tt')].map((e: any): any => e.textContent))
const rowOf: any = (host: any, name: any): any => [...host.querySelectorAll('.item')].find((el: any): any => el.querySelector('.tt')?.textContent === name)
const setS: any = (over = {}): any => useStore.setState((s: any): any => ({ S: { ...s.S, routines, week: {}, dayPlan: {}, workouts: [], active: null, queue, ...over }, user: null }))

beforeEach((): any => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
})
afterEach((): any => { act((): any => { mounted.splice(0).forEach((r: any): any => r.unmount()) }) })

describe('Day sheet header in a coach week', (): any => {
  it('names the queue session for today, with the weekday\'s own routine after it', (): any => {
    setS()
    dayOverrideSheet(todayISO())
    expect(header(renderTop())).toMatch(/^Weekly plan: US W1 D1/)
    setS({ week: { [new Date().getDay()]: ['own'] } })
    dayOverrideSheet(todayISO())
    expect(header(renderTop())).toMatch(/^Weekly plan: US W1 D1 \+ Core/)
  })

  it('a rest override for today still shows the plan it replaced, marked as changed', (): any => {
    setS({ dayPlan: { [todayISO()]: 'rest' } })
    dayOverrideSheet(todayISO())
    const h: any = header(renderTop())
    expect(h).toMatch(/^Weekly plan: US W1 D1/)
    expect(h).toContain('changed for this day')
  })

  it('another day has no queue session: the weekday alone, or Rest', (): any => {
    const tomorrow: any = daysFromToday(1)
    setS({ week: { [new Date(tomorrow + 'T12:00:00').getDay()]: ['own'] } })
    dayOverrideSheet(tomorrow)
    expect(header(renderTop())).toMatch(/^Weekly plan: Core/)
    setS()
    dayOverrideSheet(tomorrow)
    expect(header(renderTop())).toMatch(/^Weekly plan: Rest/)
  })
})

describe('Day sheet list in a coach week', (): any => {
  it('a fulfilled pin — the session pinned here already done — reads as no change; the clear row stays', (): any => {
    setS({ dayPlan: { [todayISO()]: 'd1' }, workouts: [logged('d1')] })
    dayOverrideSheet(todayISO())
    const host: any = renderTop()
    expect(header(host)).toMatch(/^Weekly plan: US W1 D2/)
    expect(header(host)).not.toContain('changed for this day')
    expect(rowOf(host, 'Back to weekly plan')).toBeTruthy()
  })

  it("the pinned day's own sheet shows the exercise count, not its own date again", (): any => {
    const friday: any = daysFromToday(2)
    setS({ dayPlan: { [friday]: 'd2' } })
    dayOverrideSheet(friday)
    const host: any = renderTop()
    expect(rowOf(host, 'US W1 D2').querySelector('.ss').textContent).toBe(exCount(1))
    // …while from today's sheet the same session wears Friday.
    dayOverrideSheet(todayISO())
    expect(rowOf(renderTop(), 'US W1 D2').querySelector('.ss').textContent).toBe(fmtDate(friday, true))
    // A session pinned to today wears today from another day's sheet, though the row lights it as next.
    setS({ dayPlan: { [todayISO()]: 'd2' } })
    dayOverrideSheet(friday)
    expect(rowOf(renderTop(), 'US W1 D2').querySelector('.ss').textContent).toBe(fmtDate(todayISO(), true))
  })

  it('lists the remaining sessions first under Coach week, a done session down in the plain list', (): any => {
    setS({ workouts: [logged('d1')] })
    dayOverrideSheet(todayISO())
    const host: any = renderTop()
    expect(heading(host)).toBe('Coach week')
    const [coach, plain] = lists(host)
    expect(coach).toEqual(['US W1 D2'])
    expect(plain).toEqual(['US W1 D1', 'Core', 'Rest / skip this day'])
  })

  it('your own loop is headed Your loop, not Coach week', (): any => {
    setS({ queue: { ...queue, rotationId: 'r1' }, rotation: { id: 'r1', sequence: ['d1', 'd2'], label: 'Rotation' } })
    try {
    dayOverrideSheet(todayISO())
    expect(heading(renderTop())).toBe('Your loop')
    } finally { useStore.setState((s: any): any => ({ S: { ...s.S, rotation: null } })) }
  })

  it('picking a coach row pins that session to the day', (): any => {
    const friday: any = daysFromToday(2)
    setS()
    dayOverrideSheet(friday)
    const host: any = renderTop()
    act((): any => rowOf(host, 'US W1 D2').click())
    expect(useStore.getState().S.dayPlan[friday]).toBe('d2')
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toBe(`US W1 D2 planned for ${fmtDate(friday, false)}`)
  })

  it('a session pinned to another day shows that day instead of its exercise count', (): any => {
    const friday: any = daysFromToday(2)
    setS({ dayPlan: { [friday]: 'd2' } })
    dayOverrideSheet(todayISO())
    const host: any = renderTop()
    expect(rowOf(host, 'US W1 D2').querySelector('.ss').textContent).toBe(fmtDate(friday, true))
    expect(rowOf(host, 'US W1 D1').querySelector('.ss').textContent).toBe(exCount(1))
  })

  it('without a queue there is no heading and one plain list', (): any => {
    setS({ queue: null })
    dayOverrideSheet(todayISO())
    const host: any = renderTop()
    expect(heading(host)).toBeUndefined()
    expect(lists(host)).toEqual([['US W1 D1', 'US W1 D2', 'Core', 'Rest / skip this day']])
  })
})
