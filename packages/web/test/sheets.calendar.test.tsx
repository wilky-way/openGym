// @vitest-environment happy-dom
import { setupPlanHistoryTest } from './helpers/plan-history'

import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { todayISO } from '@opengym/core/format'
import { calendarSheet } from '../src/sheets-plan-history'

beforeEach((): any => setupPlanHistoryTest())

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

describe('Calendar canonical workout days', (): any => {
  let original: any

  beforeEach((): any => {
    ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
    original = useStore.getState().S
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
  })

  afterEach((): any => {
    act((): any => { mounted.splice(0).forEach((root: any): any => root.unmount()) })
    useStore.setState({ S: original })
  })

  it('keeps multiple legacy sessions on the heatmap fallback day clickable in Calendar', (): any => {
    const day: any = todayISO()
    const start: any = new Date(day + 'T09:00:00').getTime()
    useStore.setState({ S: {
      ...original,
      workouts: [
        { id: 'legacy-a', d: '', start, end: start + 15 * 60000, name: 'Legacy A', vol: 100, entries: [] },
        { id: 'legacy-b', d: 'not-a-day', start: start + 30 * 60000, end: start + 45 * 60000, name: 'Legacy B', vol: 200, entries: [] },
      ],
    } })

    calendarSheet(day)
    const host: any = renderTop()
    expect(host.textContent).toContain('2 workouts')
    const trainedDay: any = host.querySelector('button.cal-d.has')
    expect(trainedDay).toBeTruthy()

    act((): any => trainedDay.click())
    const sessions: any = renderTop()
    expect(sessions.textContent).toContain('Legacy A')
    expect(sessions.textContent).toContain('Legacy B')
  })
})
