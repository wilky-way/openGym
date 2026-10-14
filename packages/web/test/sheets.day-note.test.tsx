// @vitest-environment happy-dom
import { setupPlanHistoryTest } from './helpers/plan-history'

// #261: "I want to write a note why I missed today, and see it in the heatmap." The day sheet
// offers a note on today and past days with nothing logged, the note sheet saves a quick pick
// and a line of text (or takes it away), and the calendar, heatmap, week strip and History show it.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { dayOverrideSheet, dayNoteSheet, calendarSheet } from '../src/sheets-plan-history'
import Heatmap from '../src/components/Heatmap'
import { withDayNote, dayNoteOf } from '@opengym/core/day-notes'

beforeEach((): any => setupPlanHistoryTest())

const clone: any = (v: any): any => JSON.parse(JSON.stringify(v))
const S: any = (): any => useStore.getState().S
const mounted: any = []

function mount(el: any): any {
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act((): any => root.render(el))
  return host
}
const mountTopSheet: any = (): any => {
  const sheet: any = useUI.getState().sheets.at(-1)
  return mount(sheet.render((): any => useUI.getState().closeSheet(sheet.id)))
}
const button: any = (host: any, text: any): any => [...host.querySelectorAll('button')].find((b: any): any => b.textContent.trim() === text)
const type: any = (el: any, value: any): any => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function install(extra = {}): any {
  const st: any = clone(DEF)
  Object.assign(st, {
    routines: [{ id: 'A', name: 'Push', emoji: 'dumbbell', ex: [] }],
    week: { 1: ['A'], 5: ['A'] }, dayPlan: {}, active: null, workouts: [], weighIn: false,
  }, extra)
  useStore.setState({ S: st, user: null })
}

beforeEach((): any => {
  // Wednesday 16 September 2026, midday.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-16T12:00:00'))
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [],  })
  document.body.innerHTML = ''
  install()
})
afterEach((): any => {
  act((): any => { mounted.splice(0).forEach((root: any): any => root.unmount()) })
  vi.useRealTimers()
})

describe('the day sheet offers a note', (): any => {
  const offered: any = (iso: any): any => {
    useUI.setState({ sheets: [] })
    dayOverrideSheet(iso)
    return mountTopSheet().textContent.includes('Add a note for this day')
  }
  it('on today and past days with nothing logged, never on a future day or a trained one', (): any => {
    expect(offered('2026-09-14')).toBe(true)     // Monday, missed
    expect(offered('2026-09-15')).toBe(true)     // Tuesday, a rest day: any day can say why
    expect(offered('2026-09-16')).toBe(true)     // today
    expect(offered('2026-09-18')).toBe(false)    // Friday, still to come
    install({ workouts: [{ id: 'w', d: '2026-09-14', start: 1, end: 2, name: 'Push', entries: [], prs: [] }] })
    expect(offered('2026-09-14')).toBe(false)
  })

  it('shows a note that is there, and opens it for editing', (): any => {
    install({ dayNotes: withDayNote({}, '2026-09-14', { tag: 'sick', text: 'Flu' }, 5) })
    dayOverrideSheet('2026-09-14')
    const host: any = mountTopSheet()
    expect(host.textContent).toContain('Sick')
    expect(host.textContent).toContain('Flu')
    expect(host.textContent).not.toContain('Add a note for this day')
    act((): any => { host.querySelector('.day-note-row').click() })
    expect(useUI.getState().sheets).toHaveLength(2)
    const note: any = mountTopSheet()
    expect(note.querySelector('textarea').value).toBe('Flu')
    expect(button(note, 'Sick').getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the note sheet', (): any => {
  it('saves a quick pick with a line of text, stamped, and excuses the day', (): any => {
    dayNoteSheet('2026-09-14')
    const host: any = mountTopSheet()
    act((): any => { button(host, 'Travelling').click() })
    act((): any => { type(host.querySelector('textarea'), '  Lisbon, back Thursday ') })
    act((): any => { button(host, 'Save').click() })
    expect(dayNoteOf(S(), '2026-09-14')).toEqual({ tag: 'travel', text: 'Lisbon, back Thursday' })
    expect(S().dayNotes['2026-09-14']._ts).toBeGreaterThan(0)
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('a second tap on a pick takes it off again; text alone is a note', (): any => {
    dayNoteSheet('2026-09-14')
    const host: any = mountTopSheet()
    act((): any => { button(host, 'Sick').click() })
    act((): any => { button(host, 'Sick').click() })
    act((): any => { type(host.querySelector('textarea'), 'Wedding') })
    act((): any => { button(host, 'Save').click() })
    expect(dayNoteOf(S(), '2026-09-14')).toEqual({ tag: null, text: 'Wedding' })
  })

  it('saving nothing on a day without a note writes nothing', (): any => {
    dayNoteSheet('2026-09-14')
    const host: any = mountTopSheet()
    act((): any => { button(host, 'Save').click() })
    expect(S().dayNotes).toEqual({})
  })

  it('Remove takes the note away as a stamped clear, so the removal syncs', (): any => {
    install({ dayNotes: withDayNote({}, '2026-09-14', { tag: 'injured' }, 5) })
    dayNoteSheet('2026-09-14')
    const host: any = mountTopSheet()
    act((): any => { button(host, 'Remove note').click() })
    expect(dayNoteOf(S(), '2026-09-14')).toBeNull()
    expect(S().dayNotes['2026-09-14']._ts).toBeGreaterThan(5)
  })
})

describe('where a noted day shows', (): any => {
  const notes: any = withDayNote({}, '2026-09-14', { tag: 'sick', text: 'Flu' }, 5)

  it('the calendar marks it, with the note as its tooltip and a legend entry', (): any => {
    install({ dayNotes: notes })
    calendarSheet('2026-09-01')
    const host: any = mountTopSheet()
    const cell: any = [...host.querySelectorAll('.cal-d')].find((b: any): any => b.textContent === '14')
    expect(cell.className).toContain('noted')
    expect(cell.querySelector('i').className).toBe('noted')
    expect(cell.getAttribute('title')).toBe('Sick · Flu')
    expect(host.querySelector('.cal-legend').textContent).toContain('Day note')
    // a month without notes has no legend entry for them
    install()
    useUI.setState({ sheets: [] })
    calendarSheet('2026-09-01')
    expect(mountTopSheet().querySelector('.cal-legend').textContent).not.toContain('Day note')
  })

  it('the heatmap outlines it and lets you tap it', (): any => {
    install({ dayNotes: notes })
    const onDay: any = vi.fn()
    const host: any = mount(<Heatmap S={S()} onDay={onDay} />)
    const cell: any = [...host.querySelectorAll('.hm-c')].find((c: any): any => c.getAttribute('title')?.startsWith('2026-09-14'))
    expect(cell.className).toContain('noted')
    expect(cell.getAttribute('title')).toBe('2026-09-14 · Sick · Flu')
    act((): any => { cell.click() })
    expect(onDay).toHaveBeenCalledWith('2026-09-14')
  })

})
