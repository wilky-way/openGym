import { prepareExerciseSheets } from './W12-test-support'
// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { exConfigSheet } from '../src/sheets'
import { EXIDX } from '@opengym/core/exercises'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { _setLangState } from '@opengym/core/i18n-core'
import { activate } from '@opengym/core/programme'
import { endProgramme, switchProgramme } from '@opengym/core/programme-lifecycle'
import { lastEntryFor } from '@opengym/core/history'

import { mergeStates, stampChange } from '@opengym/core/sync-merge'



const TODAY: any = '2026-10-12'
const cfg: any = () : any => ({ id: '0025', sets: 3, reps: 10, weight: 100, prog: 'off', open: true, label: 'Synthetic pick', instructions: 'Synthetic rule', generatedRules: [{until_rpe:8}], authoredInstructions: 'Synthetic rule', noteKind: 'planner', target: { rir: 2 }, pyramid: [5,10,10], setTargets: [{ rpe: 8, pct: 75 },{ rir: 2, pct: 65 },{ rir: 2, pct: 65 }], setRepsMin: [4,8,8], tm: { key: '0025', percentages: [75,65,65] } })
const definition: any = (id: any = 'synthetic') : any => ({ id, name: id, unit: 'lb', weeks: [1,2].map((index: any) : any => ({ index, days: [{ key: 'd1', sessions: [{ routineSnapshot: { name: 'Day 1', ex: [cfg()] } }] }] })) })
const state: any = () : any => ({ ...structuredClone(DEF), unit: 'lb', routines: [], workouts: [], sound: false, weighIn: false })
const stamp: any = (before: any, after: any, at: any) : any => { after._ts = stampChange(before, after, at); return after }
let roots: any = []
const renderTop: any = () : any => {
  const sheet: any = useUI.getState().sheets.at(-1), host: any = document.createElement('div'), root: any = createRoot(host)
  document.body.append(host); roots.push(root)
  act(() : any => root.render(sheet.render(() : any => useUI.getState().closeSheet(sheet.id))))
  return host
}
const click: any = (host: any, text: any) : any => act(() : any => [...(host.querySelectorAll('button') as any)].find((b: any) : any => b.textContent.trim() === text).click())
beforeEach(() : any => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00-05:00'))
  useStore.setState({ S: state(), user: null }); useUI.setState({ sheets: [], toastMsg: '' })
  _setLangState('en', null, null, null)
})
afterEach(() : any => { act(() : any => roots.splice(0).forEach((r: any) : any => r.unmount())); document.body.innerHTML = ''; vi.useRealTimers() })



it('F1 pyramid row removal and addition retain the matching effort, range and percentages', () : any => {
  let saved: any
  exConfigSheet(EXIDX['0025']!,cfg(),(out: any): any =>{saved=out},null,{prog:'off'})
  const host: any=renderTop()
  act((): any =>(host.querySelector('button[aria-label="Remove set"]') as any).click())
  click(host,'Add set'); click(host,'Save')
  expect(saved.pyramid).toEqual([10,10,10])
  expect(saved.setTargets).toEqual(Array(3).fill({rir:2,pct:65}))
  expect(saved.setRepsMin).toEqual([8,8,8]);expect(saved.tm.percentages).toEqual([65,65,65])
})















beforeEach(() : any => prepareExerciseSheets())
