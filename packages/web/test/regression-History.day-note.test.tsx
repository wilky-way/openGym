// @vitest-environment happy-dom
import { setupPlanHistoryTest } from './helpers/plan-history'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, it, expect } from 'vitest'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import History, {historyRows} from '../src/views/History'
import {bindViewServices, type ViewServices} from '../src/views/view-services'
import {WorkoutRow, DayNoteRow, workoutDetailSheet} from '../src/sheets-plan-history'
import {logPastWorkoutSheet} from '../src/sheets-d'
import { withDayNote } from '@opengym/core/day-notes'
let root: ReturnType<typeof createRoot>, host: HTMLDivElement
beforeEach(()=>{setupPlanHistoryTest();useUI.setState({sheets:[]});bindViewServices({WorkoutRow,DayNoteRow,workoutDetailSheet,logPastWorkoutSheet} as ViewServices)})
afterEach(()=>{act(()=>root?.unmount());host?.remove()})
it('History lists it between the workouts, newest first; a trained day keeps only its workout',()=>{
  const w = (id: string, d: string) => ({id,d,start:Date.parse(d+'T10:00:00'),end:Date.parse(d+'T11:00:00'),name:'Push',entries:[],prs:[]})
  useStore.setState({S:{...structuredClone(DEF),workouts:[w('a','2026-09-11'),w('b','2026-09-15'),w('c','2026-09-15')],dayNotes:{...withDayNote({},'2026-09-14',{tag:'sick',text:'Flu'},5),...withDayNote({},'2026-09-15',{tag:'rest'},6),'2026-09-12':{_ts:7}}}})
  expect(historyRows(useStore.getState().S).map(r=>r.w?r.w.id:'note '+r.d)).toEqual(['c','b','note 2026-09-14','a'])
  host=document.createElement('div');document.body.append(host);root=createRoot(host);act(()=>root.render(<History/>))
  const row=host.querySelector<HTMLElement>('.day-note-row')!
  expect(row.textContent).toContain('Sick')
  expect(row.textContent).toContain('Flu')
  act(()=>row.click())
  expect(useUI.getState().sheets).toHaveLength(1)
})
