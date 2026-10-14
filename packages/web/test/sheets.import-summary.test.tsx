import { configureUx, createBrowserUx } from '../src/platform/ux'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { importFromApp } from '../src/sheets'
import { fmtDateRange } from '@opengym/core/format'

// The import summary's date range said "Sun, 3 Feb – Sun, 21 Dec" for a history that ran over
// two years: without the year, a span across a new year read as a few months.
// Intentional legacy safety exceptions: pre-read CSV/XML caps, streaming Health
// XML, and stale account/profile/session confirmations abort without a write.
const HEAD: any= 'Date,Exercise,Weight,Reps'
const csv: any= (...days: any[]) : any => [HEAD, ...days.map((d: any): any => `${d},Bench Press,60,5`)].join('\n')
let root: any, host: any

async function summaryFor(text: any): Promise<any>  {
  const file: any= new File([text], 'export.csv', { type: 'text/csv' })
  importFromApp(file)
  await vi.waitFor(() => expect(useUI.getState().sheets.length).toBeGreaterThan(0))
  const sheet: any= useUI.getState().sheets.at(-1)
  expect(sheet).toBeTruthy()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() : any => root.render(sheet.render(() : any => {})))
  return host.querySelector('.muted.small').textContent
}

describe('the import summary’s dates', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState((s: any): any => ({ S: { ...s.S, unit: 'kg', workouts: [], bodyweight: [] } }))
  })
  afterEach(() : any => { if (root) act(() : any => root.unmount()); root = null; document.body.innerHTML = '' })

  it('carry the year when the history spans two years', async () : Promise<any> => {
    const text: any= await summaryFor(csv('2025-02-03', '2026-01-21'))
    expect(text).toContain('2025')
    expect(text).toContain('2026')
  })

  it('carry the year for a range that is not this year', () : any => {
    const now: any= new Date('2026-09-28T12:00:00')
    expect(fmtDateRange('2024-03-01', '2024-05-01', false, now)).toContain('2024')
    expect(fmtDateRange('2026-03-01', '2026-05-01', false, now)).not.toContain('2026')
    expect(fmtDateRange('2026-03-01', '2026-03-01', false, now)).not.toContain('–')
  })
})

// QA 10-06: the summary never said how many rows it had left out, and every count read "1 workouts
// imported", "1 sets bring an RPE".
describe('the import summary’s counts', () : any => {
  beforeEach(() : any => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toastMsg: '' })
    useStore.setState((s: any): any => ({ S: { ...s.S, unit: 'kg', workouts: [], bodyweight: [], wc: { ...s.S.wc, effort: 'rpe' } } }))
  })
  afterEach(() : any => { if (root) act(() : any => root.unmount()); root = null; document.body.innerHTML = '' })
  const lines: any= () : any => [...host.querySelectorAll('.small.dim')].map((d: any): any => d.textContent)

  it('says how many rows were skipped, singular and plural, and nothing when none were', async () : Promise<any> => {
    await summaryFor([HEAD, '2026-01-02,Bench Press,60,5', 'not a date,Bench Press,60,5'].join('\n'))
    expect(lines()).toContain('1 row skipped (couldn’t read it)')
    act(() : any => root.unmount()); document.body.innerHTML = ''; useUI.setState({ sheets: [] })
    await summaryFor([HEAD, '2026-01-02,Bench Press,60,5', 'nope,Bench Press,60,5', '2026-01-03,,60,5'].join('\n'))
    expect(lines()).toContain('2 rows skipped (couldn’t read them)')
    act(() : any => root.unmount()); document.body.innerHTML = ''; useUI.setState({ sheets: [] })
    await summaryFor(csv('2026-01-02'))
    expect(lines().some((l: any): any => /skipped/.test(l))).toBe(false)
  })

  it('counts one workout and one rated set in the singular', async () : Promise<any> => {
    await summaryFor(['Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Seconds,RPE', '2026-01-02 10:00:00,Push,Bench Press (Barbell),1,60,5,0,8'].join('\n'))
    expect(lines().join(' ')).toMatch(/\b1 set brings an RPE with it\./)
    const importBtn: any= [...host.querySelectorAll('button')].find((b: any): any => b.textContent === 'Import')
    act(() : any => importBtn.click())
    expect(useUI.getState().toastMsg).toBe('1 workout imported')
  })
})

// Fixed synthetic date and injected DOM keep the twin independent of the host.
beforeEach(() : any => { configureUx(createBrowserUx()); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z')) })
afterEach(() : any => vi.useRealTimers())
