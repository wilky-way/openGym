import { configureUx, createBrowserUx } from '../../src/platform/ux'
// @vitest-environment happy-dom
// Issue #511: the Exercise progress card gets the Body weight card's 1M / 3M / 1Y / All range.
// It cuts every chart mode to the range, starts on All, keeps "Best:" all-time, and says so when
// the range holds fewer than two workouts instead of drawing a lone dot.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Stats from '../../src/views/Stats'

const mocks: any = vi.hoisted(() => ({ charts: [], S: null }))
vi.mock('../../src/store/useStore', () => ({ useStore: (selector: any) => selector({ S: mocks.S }) }))
vi.mock('../../src/lib/nav', () => ({ nav: () => {} }))
vi.mock('../../src/views/view-services', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {}, exerciseHistorySheet: () => {},
  WorkoutRow: () => null, bwDeltaColor: () => 'inherit',
}))
vi.mock('../../src/components/LineChart', () => ({ default: (props: any) => { mocks.charts.push(props); return null } }))
vi.mock('../../src/components/Heatmap', () => ({ default: () => null }))
vi.mock('../../src/components/BodyMap', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const BENCH: any = '0025'
const DAY: any = 86400000
// A bench session `ago` days back, two working sets at weight w.
const session: any = (ago: any, w: any) => {
  const start: any = Date.now() - ago * DAY
  return {
    id: 'w' + ago, d: new Date(start).toISOString().slice(0, 10), start, end: start + 3600000, name: 'Push',
    entries: [{ id: BENCH, target: { id: BENCH, sets: 2, reps: 5 }, sets: [{ w, r: 5, done: true }, { w, r: 4, done: true }] }],
  }
}
let root: any, host: any
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.charts = [] })

function mount(workouts: any) {
  mocks.S = { body: 'male', effort: 'none', unit: 'kg', targetW: null, bodyweight: [], routines: [], exWeights: {}, workouts }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
}
// The exercise card's chart is the last one drawn; the body weight chart has no colour of its own.
const exChart: any = () => mocks.charts.filter((c: any) => c.color === 'var(--blue)' || c.series).at(-1)
const exCard: any = () => [...host.querySelectorAll('.card')].find((c: any) => c.querySelector('h2')?.textContent === 'Exercise progress')
const press: any = (scope: any, label: any) => act(() => [...scope.querySelectorAll('.seg button')].find((b: any) => b.textContent === label).click())

describe('Stats: exercise progress date range', () => {
  it('starts on All and cuts the top-set line to the picked range, Best staying all-time', () => {
    mount([session(400, 100), session(200, 90), session(60, 70), session(10, 75), session(3, 80)])
    const card: any = exCard()
    expect([...card.querySelectorAll('.seg button.on')].map((b: any) => b.textContent)).toEqual(['Top set', 'All'])
    expect(exChart().points.map((p: any) => p.y)).toEqual([100, 90, 70, 75, 80])

    press(card, '1M')
    expect(exChart().points.map((p: any) => p.y)).toEqual([75, 80])
    press(card, '3M')
    expect(exChart().points.map((p: any) => p.y)).toEqual([70, 75, 80])
    expect(card.textContent).toContain('Best: 100 kg')
  })

  it('applies to the other chart modes too', () => {
    mount([session(400, 100), session(200, 90), session(60, 70), session(10, 75), session(3, 80)])
    const card: any = exCard()
    press(card, 'Est. 1RM')
    const all: any = exChart().points.length
    press(card, '1M')
    expect(all).toBe(5)
    expect(exChart().points).toHaveLength(2)
    press(card, 'Per set')
    const chart: any = exChart()
    expect(chart.points).toHaveLength(2)
    expect(chart.series.every((s: any) => s.points.length === 2)).toBe(true)
  })

  it('shows a hint instead of the chart when the range holds fewer than two workouts', () => {
    mount([session(400, 100), session(200, 90), session(5, 80)])
    const card: any = exCard()
    press(card, '1M')
    expect(card.textContent).toContain('Fewer than two workouts in this period. Pick a longer one.')
    mocks.charts = []
    press(card, '1Y')
    expect(card.textContent).not.toContain('Fewer than two workouts')
    expect(exChart().points.map((p: any) => p.y)).toEqual([90, 80])
  })

  it('leaves the body weight range alone', () => {
    mount([session(400, 100), session(200, 90), session(5, 80)])
    const bwCard: any = [...host.querySelectorAll('.card')].find((c: any) => c.querySelector('h2')?.textContent === 'Body weight')
    press(exCard(), '1M')
    expect([...bwCard.querySelectorAll('.seg button.on')].map((b: any) => b.textContent)).toEqual(['3M'])
  })
})

beforeEach(() => { configureUx(createBrowserUx()); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-22T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
