// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { exConfigSheet, beginWorkout } from './sheets.jsx'
import { EXIDX } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { activate, insertDeload } from './lib/programme.js'
import { endProgramme, startProgramme, switchProgramme } from './lib/programme-lifecycle.js'
import { lastEntryFor } from './lib/history.js'
import { buildSessionEntries } from './lib/session-start.js'
import { mergeStates, stampChange } from './lib/sync-merge.js'
import { stampPut } from '../../api/sync-stamps.js'
import { importProgramme } from './lib/programme-import.js'
import { chooseOpenSlot } from './lib/programme-open-slots.js'
import { programmeSessionSheet } from './components/ProgrammeSession.jsx'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import RoutineEdit from './views/RoutineEdit.jsx'

const TODAY = '2026-10-12'
const cfg = () => ({ id: '0025', sets: 3, reps: 10, weight: 100, prog: 'off', open: true, label: 'Synthetic pick', instructions: 'Synthetic rule', generatedRules: [{until_rpe:8}], authoredInstructions: 'Synthetic rule', noteKind: 'planner', target: { rir: 2 }, pyramid: [5,10,10], setTargets: [{ rpe: 8, pct: 75 },{ rir: 2, pct: 65 },{ rir: 2, pct: 65 }], setRepsMin: [4,8,8], tm: { key: '0025', percentages: [75,65,65] } })
const definition = (id = 'synthetic') => ({ id, name: id, unit: 'lb', weeks: [1,2].map(index => ({ index, days: [{ key: 'd1', sessions: [{ routineSnapshot: { name: 'Day 1', ex: [cfg()] } }] }] })) })
const state = () => ({ ...structuredClone(DEF), unit: 'lb', routines: [], workouts: [], sound: false, weighIn: false })
const stamp = (before, after, at) => { after._ts = stampChange(before, after, at); return after }
let roots = []
const renderTop = () => {
  const sheet = useUI.getState().sheets.at(-1), host = document.createElement('div'), root = createRoot(host)
  document.body.append(host); roots.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const click = (host, text) => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text).click())
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T12:00:00-05:00'))
  useStore.setState({ S: state(), user: null }); useUI.setState({ sheets: [], toastMsg: '' })
  _setLangState('en', null, null, null)
})
afterEach(() => { act(() => roots.splice(0).forEach(r => r.unmount())); document.body.innerHTML = ''; vi.useRealTimers() })

it('F1 mounted Settings Save retains authored fields in routine, scoped snapshot and stamped API roundtrip', () => {
  const S = state(); activate(S, definition(), { cycleId: 'old', today: TODAY }); useStore.setState({ S })
  const before = structuredClone(S), r = S.routines[0]
  const host=document.createElement('div'), root=createRoot(host); document.body.append(host); roots.push(root)
  act(()=>root.render(<MemoryRouter initialEntries={['/plan/r/'+r.id]}><Routes><Route path='/plan/r/:id' element={<RoutineEdit/>}/></Routes></MemoryRouter>))
  act(()=>host.querySelector('[data-routine-row] .item').click())
  click(renderTop(), 'Save')
  const scope=renderTop()
  act(()=>[...scope.querySelectorAll('.menu-item')].find(e=>e.textContent.includes('This and later weeks of this day')).click())
  const next = structuredClone(useStore.getState().S)
  for (const routine of next.routines) for (const key of ['setTargets','setRepsMin','tm','instructions','generatedRules','authoredInstructions','noteKind','target','open','label']) expect(routine.ex[0][key], key).toEqual(cfg()[key])
  expect(next.programmes.cycles[0].snapshot.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].setTargets).toEqual(cfg().setTargets)
  stampPut(before, next, { stamped: true, overRead: true, now: 200 })
  expect(next.routines[0].ex[0].setTargets).toEqual(cfg().setTargets)
})

it('F1 pyramid row removal and addition retain the matching effort, range and percentages', () => {
  let saved
  exConfigSheet(EXIDX['0025'],cfg(),out=>{saved=out},null,{prog:'off'})
  const host=renderTop()
  act(()=>host.querySelector('button[aria-label="Remove set"]').click())
  click(host,'Add set'); click(host,'Save')
  expect(saved.pyramid).toEqual([10,10,10])
  expect(saved.setTargets).toEqual(Array(3).fill({rir:2,pct:65}))
  expect(saved.setRepsMin).toEqual([8,8,8]);expect(saved.tm.percentages).toEqual([65,65,65])
})

it.each(['end','switch'])('F2 %s keeps adopted routine history connected to later series loads', action => {
  const S = state(); S.routines = [{ id: 'personal', name: 'Personal', ex: [cfg()] }]
  activate(S, definition(), { cycleId: 'old', today: TODAY, existingRoutineIds: { d1: 'personal' } })
  S.workouts = [{ id: 'legacy', d: '2026-10-01', routineId: 'personal', entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }] }] }, { id: 'later', d: '2026-10-10', routineId: 'old-w2d1', entries: [{ id: '0025', series: 'old:d1', sets: [{ w: 120, r: 5, done: true }] }] }]
  expect(lastEntryFor(S, '0025', 'personal').sets[0].w).toBe(120)
  if (action === 'end') endProgramme(S, 'old', { today: TODAY })
  else switchProgramme(S, 'old', definition('next'), { cycleId: 'new', today: TODAY })
  expect(S.routines.find(r => r.id === 'personal').programme).toBeUndefined()
  expect(lastEntryFor(S, '0025', 'personal').sets[0].w).toBe(120)
  S.workouts.pop()
  expect(lastEntryFor(S, '0025', 'old-w2d1').sets[0].w).toBe(100)
})

it.each(['end','switch','finished'])('F3 late offline finish cannot restore a %s queue on frontend or API in either direction', action => {
  const base = state(); activate(base, definition(), { cycleId: 'old', today: TODAY, now: 10 })
  const terminal = structuredClone(base), offline = structuredClone(base)
  if (action === 'switch') switchProgramme(terminal, 'old', definition('next'), { cycleId: 'new', today: TODAY, now: 20 })
  else if (action === 'end') endProgramme(terminal, 'old', { today: TODAY })
  else { terminal.programmes.cycles[0].status = 'finished'; terminal.queue = null }
  stamp(base, terminal, 100)
  const o = offline.programmes.cycles[0].occurrences[0]
  offline.workouts.push({ id: 'offline', d: TODAY, entries: [{ id: '0025', occurrenceId: o.instanceId, series: 'old:d1', sets: [{ w: 120, r: 5, done: true }] }] })
  offline.queue.ids = ['old-w2d1']; offline.queue.label = 'Offline W2'; stamp(base, offline, 200)
  for (const [a,b] of [[terminal,offline],[offline,terminal]]) {
    const api = structuredClone(b); stampPut(a, api, { stamped: true, overRead: true, now: 300 })
    // API accepts a complete submitted workout blob; include its merged logs for this path.
    for (const merged of [mergeStates(a,b), api]) {
      expect(merged.programmes.cycles.find(c => c.id === 'old').status).toBe(action === 'finished' ? 'finished' : 'archived')
      if (action === 'switch') expect(merged.queue).toMatchObject({ programmeCycleId: 'new', ids: ['new-w1d1'] })
      else expect(merged.queue).toBeNull()
    }
    expect(mergeStates(a,b).workouts.map(w => w.id)).toContain('offline')
  }
})

it('F4 beginWorkout rejects a future program even in a combined session and allows the start date', () => {
  const S = state(); startProgramme(S, definition(), { cycleId: 'future', today: TODAY, startsOn: '2026-10-19' }); S.routines.push({ id: 'ordinary', name: 'Ordinary', ex: [] }); useStore.setState({ S })
  const before = structuredClone(S)
  act(() => beginWorkout(['ordinary','future-w1d1'], null))
  expect(useStore.getState().S).toEqual(before)
  expect(useUI.getState().toastMsg).toContain('2026-10-19')
  vi.setSystemTime(new Date('2026-10-19T12:00:00-05:00'))
  act(() => beginWorkout(['future-w1d1'], null))
  expect(useStore.getState().S.active.routineIds).toEqual(['future-w1d1'])
})

it('F4 pending session button cannot start before the program bound', () => {
  const S = state(); startProgramme(S, definition(), { cycleId: 'future', today: TODAY, startsOn: '2026-10-19' }); useStore.setState({ S })
  programmeSessionSheet(S.programmes.cycles[0].occurrences[0]); click(renderTop(), 'Start')
  expect(useStore.getState().S.active).toBeNull()
  expect(useUI.getState().toastMsg).toContain('2026-10-19')
})

it('F4 start-date error has a date placeholder in all locale packs', () => {
  const packs=import.meta.glob('./locales/*.js',{eager:true,import:'default'})
  for(const pack of Object.values(packs)) expect(pack['Program starts on {0}.']).toContain('{0}')
})

it('F5 inserted deload overrides copied per-set effort while preserving percentages and source targets', () => {
  const S = state(); activate(S, definition(), { cycleId: 'old', today: TODAY }); const source = structuredClone(S.routines[0].ex)
  insertDeload(S, 'old', { key: 'easy' })
  const r = S.routines.find(r => r.programme.weekId === 'deload-easy'), entry = buildSessionEntries(S, r)[0]
  expect(entry.sets[0].target).toEqual({ rir: 8, pct: 75 })
  expect(r.ex[0].setTargets).toEqual([{rir:8,pct:75},{rir:8,pct:65},{rir:8,pct:65}])
  expect(S.routines[0].ex).toEqual(source)
})

it('F6 open import retains every row, effort and rep range through selection and reimport', () => {
  const raw = { id: 'synthetic-open', name: 'Synthetic open', unit: 'lb', weeks: [{ n: 1, days: [{ n: 1, exercises: [{ open: true, label: 'Your pick', sets: [{ count: 1, reps: 5, rpe: 8 },{ count: 2, reps: [8,10], rir: 2 }] }] }] }] }
  const p = importProgramme(raw), cfg = p.definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0]
  expect(cfg.sets).toBe(3); expect(cfg.pyramid).toEqual([5,10,10]); expect(cfg.setTargets).toEqual([{rpe:8},{rir:2},{rir:2}])
  expect(p.definition.rulesSupported).toBe(true); expect(importProgramme(JSON.stringify(p.definition)).definition).toEqual(p.definition)
  const S = state(); activate(S,p.definition,{cycleId:'open',today:TODAY}); S.active = { id: 'a', entries: buildSessionEntries(S,S.routines[0]).map(e=>({...e,rid:S.routines[0].id})) }
  expect(chooseOpenSlot(S,0,'0025','a',cfg.slotId)).toBe(true)
  expect(S.active.entries[0].sets.map(s=>[s.r,s.target,s.repTarget])).toEqual([[5,{rpe:8},undefined],[10,{rir:2},{min:8,max:10}],[10,{rir:2},{min:8,max:10}]])
})
