// @vitest-environment happy-dom
import '../helpers/plan-views'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { exConfigSheet } from '../../src/sheets'
import { DEF, useStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import { _setLangState } from '@opengym/core/i18n-core'
import { activate } from '@opengym/core/programme'
import { stampChange } from '@opengym/core/sync-merge'
import { stampPut } from '@opengym/core/server-stamp'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RoutineEdit from '../../src/views/RoutineEdit'
const TODAY: any = '2026-10-12'
const cfg: any = () => ({ id: '0025', sets: 3, reps: 10, weight: 100, prog: 'off', open: true, label: 'Synthetic pick', instructions: 'Synthetic rule', generatedRules: [{until_rpe:8}], authoredInstructions: 'Synthetic rule', noteKind: 'planner', target: { rir: 2 }, pyramid: [5,10,10], setTargets: [{ rpe: 8, pct: 75 },{ rir: 2, pct: 65 },{ rir: 2, pct: 65 }], setRepsMin: [4,8,8], tm: { key: '0025', percentages: [75,65,65] } })
const definition: any = (id: any = 'synthetic') => ({ id, name: id, unit: 'lb', weeks: [1,2].map((index: any) => ({ index, days: [{ key: 'd1', sessions: [{ routineSnapshot: { name: 'Day 1', ex: [cfg()] } }] }] })) })
const state: any = () => ({ ...structuredClone(DEF), unit: 'lb', routines: [], workouts: [], sound: false, weighIn: false })
const stamp: any = (before: any, after: any, at: any) => { after._ts = stampChange(before, after, at); return after }
let roots: any = []
const renderTop: any = () => {
  const sheet: any = useUI.getState().sheets.at(-1), host: any = document.createElement('div'), root: any = createRoot(host)
  document.body.append(host); roots.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const click: any = (host: any, text: any) => act(() => [...host.querySelectorAll('button')].find((b: any) => b.textContent.trim() === text).click())
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00-05:00'))
  useStore.setState({ S: state(), user: null }); useUI.setState({ sheets: [], toastMsg: '' })
  _setLangState('en', null, null, null)
})
afterEach(() => { act(() => roots.splice(0).forEach((r: any) => r.unmount())); document.body.innerHTML = ''; vi.useRealTimers() })

it('mounted Settings Save retains authored fields in routine, scoped snapshot and stamped API roundtrip', () => {
  const S: any = state(); activate(S, definition(), { cycleId: 'old', today: TODAY }); useStore.setState({ S })
  const before: any = structuredClone(S), r: any = S.routines[0]
  const host: any=document.createElement('div'), root: any=createRoot(host); document.body.append(host); roots.push(root)
  act(()=>root.render(<MemoryRouter initialEntries={['/plan/r/'+r.id]}><Routes><Route path='/plan/r/:id' element={<RoutineEdit/>}/></Routes></MemoryRouter>))
  act(()=>host.querySelector('[data-routine-row] .item').click())
  click(renderTop(), 'Save')
  const scope: any=renderTop()
  act(()=>[...scope.querySelectorAll('.menu-item')].find((e: any)=>e.textContent.includes('This and later weeks of this day')).click())
  const next: any = structuredClone(useStore.getState().S)
  for (const routine of next.routines) for (const key of ['setTargets','setRepsMin','tm','instructions','generatedRules','authoredInstructions','noteKind','target','open','label']) expect(routine.ex[0][key], key).toEqual(cfg()[key])
  expect(next.programmes.cycles[0].snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].setTargets).toEqual(cfg().setTargets)
  stampPut(before, next, { stamped: true, overRead: true, now: 200 })
  expect(next.routines[0].ex[0].setTargets).toEqual(cfg().setTargets)
})

