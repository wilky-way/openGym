// @vitest-environment happy-dom
import './workout-sheet-environment'
import {configureUx, createBrowserUx} from '../src/platform/ux'
// @vitest-environment happy-dom
// "Don't count for progression" from an exercise's ⋯ menu (Discord, asierlama: an injury day),
// against the real store, sheets and progression engine: the toggle, the marker and its undo,
// and what the next session is then built from.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from '../src/views/Workout'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { buildCompletedWorkout } from '@opengym/core/finish-workout'
import { nextPrescription } from '@opengym/core/progression'
import { lastEntryFor } from '@opengym/core/history'
import { buildSessionEntries } from '@opengym/core/session-start'
import { swapActiveWorkoutExercise } from '../src/sheets'
import { EXDB } from '@opengym/core/exercises'

vi.mock('../src/lib/sound', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../src/lib/api', () => ({ api: vi.fn(() => Promise.resolve({})), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone: any = (value: any) => JSON.parse(JSON.stringify(value))
const BENCH: any = '0025'
const ROW: any = '0027'
const routines: any = [
  { id: 'main', name: 'Main', ex: [{ id: BENCH, sets: 1, reps: 5, weight: 100 }] },
  { id: 'deload', name: 'Deload', excludeFromProgression: true, ex: [{ id: ROW, sets: 1, reps: 8, weight: 40 }] },
]
const history: any = [{
  id: 'w1', d: '2026-09-20', routineIds: ['main'],
  entries: [{ id: BENCH, rid: 'main', target: { sets: 1, reps: 5, weight: 100 }, sets: [{ w: 100, r: 5, done: true }] }],
}]
const entry: any = (id: any, rid: any, w: any, extra: any = {}) => ({ id, rid, target: { sets: 1, reps: 5, weight: w }, sets: [{ w, r: 5, done: false }], ...extra })

let root: any
let container: any
let sheetRoot: any
let sheetContainer: any

function renderWorkout(entries: any, { withRoutines = routines, withHistory = history }: any = {}) {
  const S: any = clone(DEF)
  S.routines = clone(withRoutines)
  S.workouts = clone(withHistory)
  S.active = { id: 'noprog-test', d: '2026-09-23', start: Date.now(), routineIds: ['main'], routineId: 'main', name: 'Main', bw: null, cur: 0, entries }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<><Workout /></>))
}

function renderTopSheet() {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  const sheet: any = useUI.getState().sheets.at(-1)
  expect(sheet).toBeTruthy()
  sheetContainer = document.createElement('div')
  document.body.appendChild(sheetContainer)
  sheetRoot = createRoot(sheetContainer)
  act(() => sheetRoot.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return sheetContainer
}

const openMenu: any = () => {
  const more: any = container.querySelector('button[aria-label="More"]')
  expect(more).toBeTruthy()
  act(() => more.click())
  return renderTopSheet()
}
const menuItem: any = (menu: any, label: any) => [...menu.querySelectorAll('.menu-item')].find((it: any) => it.querySelector('.tt')?.textContent === label)
const marker: any = () => container.querySelector('.noprog')
const active: any = () => useStore.getState().S.active

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null })
  root = null; container = null; sheetRoot = null; sheetContainer = null
})

afterEach(() => {
  if (sheetRoot) act(() => sheetRoot.unmount())
  if (sheetContainer) sheetContainer.remove()
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('don’t count this session for progression', () => {
  it('F1 real Workout Settings Save preserves authored effort, rule text and percentage prescriptions', () => {
    const cfg: any={id:BENCH,sets:3,reps:10,weight:100,prog:'off',pyramid:[5,10,10],setTargets:[{rpe:8,pct:75},{rir:2,pct:65},{rir:2,pct:65}],setRepsMin:[4,8,8],tm:{key:BENCH,percentages:[75,65,65]},instructions:'Synthetic rule',open:true,label:'Synthetic pick'}
    const r: any={id:'main',name:'Synthetic',ex:[cfg]}, S: any={...clone(DEF),routines:[r],workouts:[]}
    renderWorkout(buildSessionEntries(S,r).map((e: any)=>({...e,rid:'main'})),{withRoutines:[r],withHistory:[]})
    const menu: any=openMenu()
    expect(menu.textContent).toContain('Exercise settings')
    act(()=>menuItem(menu,'Exercise settings').click())
    const sheet: any=renderTopSheet()
    act(()=>[...sheet.querySelectorAll('button')].find((b: any)=>b.textContent.trim()==='Save').click())
    for(const key of ['setTargets','setRepsMin','tm','instructions','open','label']) expect(active().entries[0].target[key],key).toEqual(cfg[key])
    expect(active().entries[0].sets.map((s: any)=>s.target)).toEqual(cfg.setTargets)
  })
  it('the ⋯ menu stamps the entry, the card says so, and Undo takes it back', () => {
    renderWorkout([entry(BENCH, 'main', 80)])
    expect(marker()).toBeNull()

    const menu: any = openMenu()
    const item: any = menuItem(menu, 'Don’t count for progression')
    expect(item).toBeTruthy()
    expect(item.querySelector('.ss').textContent).toBe('This exercise, this session only')
    expect(item.querySelector('.menu-on.is-on')).toBeNull()
    act(() => item.click())

    expect(active().entries[0].noProg).toBe(true)
    expect(marker().textContent).toContain('Not counted for progression')
    // the routine is not touched
    expect(useStore.getState().S.routines.find((r: any) => r.id === 'main').excludeFromProgression).toBeUndefined()

    const undo: any = [...marker().querySelectorAll('button')].find((b: any) => b.textContent === 'Undo')
    act(() => undo.click())
    expect(active().entries[0].noProg).toBeUndefined()
    expect(marker()).toBeNull()
  })

  it('the menu item is a switch: it shows it is on, and a second tap turns it off', () => {
    renderWorkout([entry(BENCH, 'main', 80, { noProg: true })])
    const item: any = menuItem(openMenu(), 'Don’t count for progression')
    expect(item.querySelector('.menu-on.is-on')).toBeTruthy()
    act(() => item.click())
    expect(active().entries[0].noProg).toBeUndefined()
  })

  it('only that exercise: the others in the session still count', () => {
    renderWorkout([entry(BENCH, 'main', 80), entry(ROW, 'main', 50)])
    const item: any = menuItem(openMenu(), 'Don’t count for progression')
    act(() => item.click())
    expect(active().entries.map((e: any) => e.noProg === true)).toEqual([true, false])
  })

  it('the saved workout keeps it, and the next session progresses from the last one that counted', () => {
    renderWorkout([entry(BENCH, 'main', 80)])
    const item: any = menuItem(openMenu(), 'Don’t count for progression')
    act(() => item.click())
    useStore.getState().update((s: any) => { s.active.entries[0].sets[0].done = true })

    const saved: any = buildCompletedWorkout(active(), { end: Date.now() })
    expect(saved.entries[0].noProg).toBe(true)

    const S: any = { ...useStore.getState().S, active: null, workouts: [...history, saved] }
    const cfg: any = routines[0].ex[0]
    const plan: any = nextPrescription(S, cfg, routines[0])
    // 100 × 5 on the 20th was the last session that counted, not today's 80
    expect(plan.weight).toBe(102.5)
    expect(lastEntryFor(S, BENCH, 'main')!.d).toBe('2026-09-20')
  })

  // The flag set by hand only stops the session from counting; the rows stay at the
  // prescription. A rebuild that read it as "a deload routine's exercise" put them back at the
  // routine's own numbers with no prescription, and the Undo then let those numbers count.
  describe('a rebuild of an exercise kept out by hand keeps its prescription', () => {
    // Main plans 60; the last session that counted was 100 × 5, so today opens at 102.5.
    const planned: any = [{ id: 'main', name: 'Main', ex: [{ id: BENCH, sets: 1, reps: 5, weight: 60 }, { id: ROW, sets: 1, reps: 8, weight: 30 }] }]
    const logged: any = [{
      id: 'w1', d: '2026-09-20', routineIds: ['main'],
      entries: [
        { id: BENCH, rid: 'main', target: { sets: 1, reps: 5, weight: 100 }, sets: [{ w: 100, r: 5, done: true }] },
        { id: ROW, rid: 'main', target: { sets: 1, reps: 8, weight: 70 }, sets: [{ w: 70, r: 8, done: true }] },
      ],
    }]
    const start: any = () => {
      const S: any = { ...clone(DEF), routines: clone(planned), workouts: clone(logged) }
      const [bench] = buildSessionEntries(S, planned[0]).map((e: any) => ({ ...e, rid: 'main' }))
      renderWorkout([bench], { withRoutines: planned, withHistory: logged })
      expect(active().entries[0].sets.map((set: any) => set.w)).toEqual([102.5])
      const keepOut: any = menuItem(openMenu(), 'Don’t count for progression')
      act(() => keepOut.click())
      expect(active().entries[0].noProg).toBe(true)
    }
    const undoAndFinish: any = () => {
      const undo: any = [...marker().querySelectorAll('button')].find((b: any) => b.textContent === 'Undo')
      act(() => undo.click())
      expect(active().entries[0].noProg).toBeUndefined()
      useStore.getState().update((s: any) => { s.active.entries[0].sets.forEach((set: any) => { set.done = true }) })
      const saved: any = buildCompletedWorkout(active(), { end: Date.now() })
      return { ...useStore.getState().S, active: null, workouts: [...logged, saved] }
    }

    it('Exercise settings saved unchanged, then Undo: the session counts at 102.5 and the next one goes on from there', () => {
      start()
      const settings: any = menuItem(openMenu(), 'Exercise settings')
      act(() => settings.click())
      const sheet: any = renderTopSheet()
      const save: any = [...sheet.querySelectorAll('button')].find((b: any) => b.textContent.trim() === 'Save')
      act(() => save.click())

      const [bench] = active().entries
      expect(bench.noProg).toBe(true)
      expect(bench.sets.map((set: any) => set.w)).toEqual([102.5])
      expect(bench.target.weight).toBe(102.5)
      expect(bench.plan.kind).not.toBe('off')

      const S: any = undoAndFinish()
      expect(nextPrescription(S, planned[0].ex[0], planned[0]).weight).toBe(105)
    })

    it('a swap, then Undo: the replacement counts at its own prescription, not the routine’s numbers', () => {
      start()
      swapActiveWorkoutExercise(0)
      const picker: any = useUI.getState().sheets.at(-1)
      act(() => picker.render(picker.close).props.onPick(EXDB.find((e: any) => e.id === ROW)))
      const config: any = useUI.getState().sheets.at(-1)
      act(() => config.render(config.close).props.onSave({ ...planned[0].ex[1] }))

      const [row] = active().entries
      expect(row.id).toBe(ROW)
      // The mark stays on the slot, with its Undo on the card.
      expect(row.noProg).toBe(true)
      // 70 × 8 last time, and a row goes up in 5s: 75, the way the routine's own start builds it.
      const S0: any = { ...clone(DEF), routines: clone(planned), workouts: clone(logged) }
      expect(buildSessionEntries(S0, planned[0])[1].sets.map((set: any) => set.w)).toEqual([75])
      expect(row.sets.map((set: any) => set.w)).toEqual([75])
      expect(row.plan.kind).not.toBe('off')

      const S: any = undoAndFinish()
      expect(nextPrescription(S, planned[0].ex[1], planned[0]).weight).toBe(80)
    })
  })

  it('a deload routine’s exercise saved in Exercise settings stays at the routine’s own numbers', () => {
    // 70 × 8 in Main would put a counting row at 75; the deload keeps its 40.
    const rowInMain: any = { id: 'w0', d: '2026-09-18', routineIds: ['main'], entries: [{ id: ROW, rid: 'main', target: { sets: 1, reps: 8, weight: 70 }, sets: [{ w: 70, r: 8, done: true }] }] }
    renderWorkout([{ ...entry(ROW, 'deload', 40, { noProg: true }), target: { sets: 1, reps: 8, weight: 40 }, sets: [{ w: 40, r: 8, done: false }] }], { withHistory: [...history, rowInMain] })
    const settings: any = menuItem(openMenu(), 'Exercise settings')
    act(() => settings.click())
    const save: any = [...renderTopSheet().querySelectorAll('button')].find((b: any) => b.textContent.trim() === 'Save')
    act(() => save.click())
    const [row] = active().entries
    expect(row.noProg).toBe(true)
    expect(row.plan.kind).toBe('off')
    expect(row.sets.map((set: any) => set.w)).toEqual([40])
  })

  it('a deload routine’s exercise shows the marker but offers neither the switch nor an undo', () => {
    renderWorkout([entry(ROW, 'deload', 40, { noProg: true })])
    expect(marker().textContent).toContain('Not counted for progression')
    expect(marker().querySelector('button')).toBeNull()
    expect(menuItem(openMenu(), 'Don’t count for progression')).toBeUndefined()
  })
})
