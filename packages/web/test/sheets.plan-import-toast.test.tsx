// @vitest-environment happy-dom
import { setupPlanHistoryTest } from './helpers/plan-history'

// Importing a one-routine plan file toasted "Added 1 routines to your plan" (QA copy): the
// sheet's summary line already picked the singular, the toast after the merge did not.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { planImportSheet } from '../src/sheets-plan-history'
import { parsePlan } from '@opengym/core/plan-share'
import { EXDB } from '@opengym/core/exercises'

beforeEach((): any => setupPlanHistoryTest())

const clone: any = (v: any): any => JSON.parse(JSON.stringify(v))
const ids: any = EXDB.filter((e: any): any => e.bp !== 'cardio').slice(0, 2).map((e: any): any => e.id)
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
const buttonFor: any = (host: any, label: any): any => [...host.querySelectorAll('button')].find((b: any): any => b.textContent === label)
const bundleOf: any = (routines: any): any => parsePlan({ opengym_plan: 1, unit: 'kg', week: {}, routines, customEx: [] }, 'kg')
const routine: any = (id: any, name: any): any => ({ id, name, emoji: null, ex: [{ id: ids[0], sets: 3, reps: 8, weight: 40 }] })

beforeEach((): any => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
  const S: any = clone(useStore.getState().S)
  S.routines = []
  S.week = {}
  useStore.setState({ S, user: null })
})
afterEach((): any => { act((): any => { mounted.splice(0).forEach((r: any): any => r.unmount()) }) })

describe('Plan import sheet — the toast counts what it added', (): any => {
  it('says "1 routine" for a single routine', (): any => {
    planImportSheet(bundleOf([routine('a', 'Push')]))
    const host: any = renderTop()
    act((): any => { buttonFor(host, 'Add to my plan').click() })
    expect(useStore.getState().S.routines).toHaveLength(1)
    expect(useUI.getState().toastMsg).toBe('Added 1 routine to your plan')
  })

  it('keeps the plural for several', (): any => {
    planImportSheet(bundleOf([routine('a', 'Push'), routine('b', 'Pull')]))
    const host: any = renderTop()
    act((): any => { buttonFor(host, 'Add to my plan').click() })
    expect(useUI.getState().toastMsg).toBe('Added 2 routines to your plan')
  })
})
