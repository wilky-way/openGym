// @vitest-environment happy-dom
import { configureUx, createBrowserUx } from '../../src/platform/ux'
import { bindViewServices } from '../../src/views/view-services'
import { dayNoteLine } from '@opengym/core/day-notes'
// #261: "I want to write a note why I missed today, and see it in the heatmap." The day sheet
// offers a note on today and past days with nothing logged, the note sheet saves a quick pick
// and a line of text (or takes it away), and the calendar, heatmap, week strip and History show it.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import History, { historyRows } from '../../src/views/History'
import { withDayNote, dayNoteOf } from '@opengym/core/day-notes'

const clone: any = (v: any) => JSON.parse(JSON.stringify(v))
const S: any = () => useStore.getState().S
const mounted: any = []

function mount(el: any) {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}

function install(extra: any = {}) {
  const st: any = clone(DEF)
  Object.assign(st, {
    routines: [{ id: 'A', name: 'Push', emoji: 'dumbbell', ex: [] }],
    week: { 1: ['A'], 5: ['A'] }, dayPlan: {}, active: null, workouts: [], weighIn: false,
  }, extra)
  useStore.setState({ S: st, user: null })
}

beforeEach(() => {
  configureUx(createBrowserUx())
  // Wednesday 16 September 2026, midday.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-16T12:00:00'))
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
  install()
  bindViewServices({
    WorkoutRow: ({w}: any) => <div>{w.id}</div>,
    DayNoteRow: ({iso,note}: any) => <button className="day-note-row" onClick={() => useUI.getState().openSheet(() => null)}>{dayNoteLine(note)}</button>,
  } as any)
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach((root: any) => root.unmount()) })
  vi.useRealTimers()
})

describe('where a noted day shows', () => {
  const notes: any = withDayNote({}, '2026-09-14', { tag: 'sick', text: 'Flu' }, 5)





  it('History lists it between the workouts, newest first; a trained day keeps only its workout', () => {
    const w: any = (id: any, d: any) => ({ id, d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T11:00:00'), name: 'Push', entries: [], prs: [] })
    install({
      workouts: [w('a', '2026-09-11'), w('b', '2026-09-15'), w('c', '2026-09-15')],
      dayNotes: { ...notes, ...withDayNote({}, '2026-09-15', { tag: 'rest' }, 6), '2026-09-12': { _ts: 7 } },
    })
    expect(historyRows(S()).map((r: any) => r.w ? r.w.id : 'note ' + r.d)).toEqual(['c', 'b', 'note 2026-09-14', 'a'])
    const host: any = mount(<History />)
    const row: any = host.querySelector('.day-note-row')
    expect(row.textContent).toContain('Sick')
    expect(row.textContent).toContain('Flu')
    act(() => { row.click() })
    expect(useUI.getState().sheets).toHaveLength(1)
  })
})
