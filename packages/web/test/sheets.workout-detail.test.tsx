// @vitest-environment happy-dom
import { setupPlanHistoryTest } from './helpers/plan-history'

// A past workout's detail sheet. Discord (rubik_97): drop-set weights were counted in the volume
// but never listed, and supersets were not shown at all. Discord 'Improvement ideas': an exercise
// opens its own history from here, and the workout can be copied as text.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { workoutDetailSheet } from '../src/sheets-plan-history'
import { EXDB } from '@opengym/core/exercises-data'

beforeEach((): any => setupPlanHistoryTest())

const lifts: any = EXDB.filter((e: any): any => e.bp !== 'cardio' && e.eq === 'barbell').slice(0, 3).map((e: any): any => e.id)
const clone: any = (v: any): any => JSON.parse(JSON.stringify(v))
const mounted: any = []

function mountTopSheet(): any {
  const sheet: any = useUI.getState().sheets.at(-1)
  const host: any = document.createElement('div')
  document.body.appendChild(host)
  const root: any = createRoot(host)
  mounted.push(root)
  act((): any => root.render(sheet.render((): any => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button: any = (host: any, text: any): any => [...host.querySelectorAll('button')].find((b: any): any => b.textContent.trim() === text)

const workout: any = (entries: any, extra = {}): any => ({
  id: 'w1', d: '2026-09-15', start: Date.UTC(2026, 8, 15, 17), end: Date.UTC(2026, 8, 15, 18), name: 'Push',
  vol: 0, prs: [], routineIds: [], entries, ...extra,
})
const done: any = (w: any, r: any, more = {}): any => ({ w, r, done: true, ...more })

let toast: any
beforeEach((): any => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  toast = vi.fn()
  useUI.setState({ sheets: [], toast })
  const S: any = clone(DEF)
  Object.assign(S, { unit: 'kg', routines: [], workouts: [], active: null })
  useStore.setState({ S, user: null })
  document.body.innerHTML = ''
})
afterEach((): any => {
  act((): any => { mounted.splice(0).forEach((root: any): any => root.unmount()) })
  vi.unstubAllGlobals()
})

describe('workout detail', (): any => {
  it('lists a drop-set\'s drops and a rest-pause set\'s bursts', (): any => {
    workoutDetailSheet(workout([
      { id: lifts[0], target: { mode: 'reps' }, sets: [done(100, 8, { type: 'dropset', drops: [{ w: 80, r: 6 }, { w: 60, r: 5 }] })] },
      { id: lifts[1], target: { mode: 'reps' }, sets: [done(60, 16, { type: 'restpause', clusters: [{ r: 4, restSec: 15 }, { r: 2, restSec: 15 }] })] },
    ]))
    const rows: any = [...mountTopSheet().querySelectorAll('.wd-ex .ss')].map((el: any): any => el.textContent)
    expect(rows).toEqual(['100×8 ↘ 80×6 ↘ 60×5', '60×10+4+2'])
  })

  it('keeps a superset together under one label, in a flat and in a combined workout', (): any => {
    const entries: any = [
      { id: lifts[0], sg: 'sg1', target: { mode: 'reps' }, sets: [done(40, 10)] },
      { id: lifts[1], sg: 'sg1', target: { mode: 'reps' }, sets: [done(20, 12)] },
      { id: lifts[2], target: { mode: 'reps' }, sets: [done(60, 5)] },
    ]
    workoutDetailSheet(workout(entries))
    let host: any = mountTopSheet()
    let groups: any = host.querySelectorAll('.wd-ss')
    expect(groups).toHaveLength(1)
    expect(groups[0].querySelector('.ss-label').textContent).toBe('Superset')
    expect(groups[0].querySelectorAll('.wd-ex')).toHaveLength(2)
    expect(host.querySelectorAll('.wd-ex')).toHaveLength(3)

    useUI.setState({ sheets: [] })
    const combined: any = entries.map((e: any, i: any): any => ({ ...e, rid: i < 2 ? 'A' : 'B' }))
    workoutDetailSheet(workout(combined, { routineIds: ['A', 'B'] }))
    host = mountTopSheet()
    expect(host.textContent).toContain('Freestyle')           // routines since deleted
    expect(host.querySelectorAll('.wd-ss .wd-ex')).toHaveLength(2)
  })

  it('shows an unpaired exercise without a superset label', (): any => {
    workoutDetailSheet(workout([
      { id: lifts[0], sg: 'sg1', target: { mode: 'reps' }, sets: [done(40, 10)] },
      { id: lifts[1], target: { mode: 'reps' }, sets: [done(20, 12)] },
    ]))
    expect(mountTopSheet().querySelector('.wd-ss')).toBeNull()
  })

  it('opens the exercise\'s history from its row', (): any => {
    const w: any = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5)] }])
    useStore.setState((s: any): any => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const row: any = mountTopSheet().querySelector('.wd-ex')
    expect(row.getAttribute('role')).toBe('button')
    act((): any => { row.click() })
    expect(useUI.getState().sheets).toHaveLength(2)
    const history: any = mountTopSheet()
    expect(history.textContent).toContain('Exercise history')
    expect(history.textContent).toContain('60×5')
  })

  it('copies the workout as text, with the note as it stands in the box', async (): Promise<any> => {
    const writeText: any = vi.fn((): any => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const w: any = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5, { phase: 'warmup' }), done(80, 5)] }])
    useStore.setState((s: any): any => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host: any = mountTopSheet()
    const note: any = host.querySelector('textarea')
    act((): any => {
      Object.getOwnPropertyDescriptor(note.constructor.prototype, 'value')!.set!.call(note, 'Good day')
      note.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async (): Promise<any> => { button(host, 'Copy as text').click() })
    expect(writeText).toHaveBeenCalledTimes(1)
    const text: any = writeText.mock.calls[0][0]
    expect(text.split('\n')[0]).toMatch(/^Push · /)
    expect(text).toContain('\n80×5\n')
    expect(text).not.toContain('60×5')
    expect(text.endsWith('\n\nGood day')).toBe(true)
    expect(toast).toHaveBeenCalledWith('Copied')
  })

  // One rule for both: a superset paired across two routines of a combined session is shown apart
  // in the sheet, each under its own routine, and the copied text does not call it a superset.
  it('groups a combined session\'s supersets the same way in the sheet and in the copied text', async (): Promise<any> => {
    const writeText: any = vi.fn((): any => Promise.resolve())
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const w: any = workout([
      { id: lifts[0], rid: 'A', sg: 'x', target: { mode: 'reps' }, sets: [done(40, 10)] },
      { id: lifts[1], rid: 'B', sg: 'x', target: { mode: 'reps' }, sets: [done(20, 12)] },
      { id: lifts[2], rid: 'B', target: { mode: 'reps' }, sets: [done(60, 5)] },
    ], { routineIds: ['A', 'B'] })
    useStore.setState((s: any): any => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host: any = mountTopSheet()
    expect(host.querySelector('.wd-ss')).toBeNull()
    expect(host.querySelectorAll('.wd-ex')).toHaveLength(3)
    await act(async (): Promise<any> => { button(host, 'Copy as text').click() })
    expect(writeText.mock.calls[0][0]).not.toContain('Superset')
  })

  it('says so when the clipboard refuses', async (): Promise<any> => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: (): any => Promise.reject(new Error('denied')) } })
    document.execCommand = (): any => false
    // The guarded sheet must open on a record that actually exists.
    const w = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5)] }])
    useStore.setState((s: any) => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host: any = mountTopSheet()
    await act(async (): Promise<any> => { button(host, 'Copy as text').click() })
    expect(toast).toHaveBeenCalledWith('Could not copy')
    delete (document as any).execCommand
  })
})

// #447: the workout as a Garmin .fit activity, saved as a download in the browser.
describe('export as .fit', (): any => {
  it('saves the saved record as a .fit file named after its day and time', async (): Promise<any> => {
    const blobs: any = []
    const createObjectURL: any = vi.fn((blob: any): any => { blobs.push(blob); return 'blob:fit' })
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL: vi.fn() }))
    const clicked: any = []
    const click: any = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement): any { clicked.push(this.download) })
    const w: any = workout([{ id: lifts[0], target: { mode: 'reps' }, sets: [done(60, 5), done(60, 5)] }])
    useStore.setState((s: any): any => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host: any = mountTopSheet()
    await act(async (): Promise<any> => { button(host, 'Export as .fit file').click() })
    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toMatch(/^opengym-2026-09-15-\d{4}\.fit$/)
    const bytes: any = new Uint8Array(await blobs[0].arrayBuffer())
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('.FIT')
    expect(toast).toHaveBeenCalledWith('Saved. Garmin Connect can take it from here.')
    click.mockRestore()
  })

  it('says so when the workout cannot be written', async (): Promise<any> => {
    const w = { id: 'x', name: 'Nowhen', entries: [], prs: [] }
    useStore.setState((s: any) => ({ S: { ...s.S, workouts: [w] } }))
    workoutDetailSheet(w)
    const host: any = mountTopSheet()
    await act(async (): Promise<any> => { button(host, 'Export as .fit file').click() })
    expect(toast).toHaveBeenCalledWith('Could not create the file')
  })
})
