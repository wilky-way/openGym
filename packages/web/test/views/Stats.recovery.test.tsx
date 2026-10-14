import { configureUx, createBrowserUx } from '../../src/platform/ux'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXIDX } from '@opengym/core/exercises'
import { MUSCLES, levelsOf } from '@opengym/core/muscles'
import { FATIGUE_STATES, STRENGTH_FLOOR, fatigueHalfLifeOf, FATIGUE_SETS_PER_UNIT } from '@opengym/core/recovery'
import { fatigueStateOf } from '@opengym/core/recovery-view'
import Stats from '../../src/views/Stats'
import Modals from '../../src/components/Modals'
import { bindUI } from '../../src/components/ui'
import { useUI } from '../../src/store/useUI'

const DAY: any = 86400000
const HOUR: any = 3600000
const BASE_NOW: any = Date.UTC(2026, 0, 22, 12)
const LEGACY_SNAPSHOT_ID: any = 'legacy-snapshot-only'

const mocks: any = vi.hoisted(() => ({
  maps: [],
  charts: [],
  mapMounts: 0,
  exerciseHistorySheet: vi.fn(),
  S: {
    unit: 'kg', body: 'male', effort: 'rir', targetW: null,
    bodyweight: [], routines: [], workouts: [],
  },
}))

vi.mock('../../src/store/useStore', () => ({
  useStore: (selector: any) => selector({ S: mocks.S }),
}))
vi.mock('../../src/lib/nav', () => ({ nav: () => {} }))
vi.mock('../../src/views/view-services', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {},
  exerciseHistorySheet: mocks.exerciseHistorySheet,
  WorkoutRow: () => React.createElement('div'), bwDeltaColor: () => 'inherit', weighInsSheet: () => {},
}))
vi.mock('../../src/components/LineChart', () => ({ default: (props: any) => {
  mocks.charts.push(props)
  return React.createElement('div')
} }))
vi.mock('../../src/components/Heatmap', () => ({ default: () => React.createElement('div') }))
vi.mock('../../src/components/Icon', () => ({ default: (props: any) => React.createElement('span', props) }))
vi.mock('../../src/components/BodyMap', () => ({
  default: (props: any) => {
    mocks.maps.push(props)
    React.useEffect(() => {
      mocks.mapMounts += 1
      return () => {}
    }, [])
    return React.createElement(
      'div',
      { 'data-body-map': true, 'data-selected-muscle': props.selected || '' },
      React.createElement('button', {
        'data-muscle': 'chest',
        onClick: () => props.onMuscle?.('chest'),
      }, 'Chest'),
    )
  },
  BodyMapLegend: () => React.createElement('div', { 'data-balance-legend': true }),
}))

bindUI(useUI)

let dom: any
let root: any
let container: any

function iso(timestamp: any) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function set(done: any, extra: any = {}) {
  return { done, w: 80, r: 8, unit: 'kg', ...extra }
}

function workout(id: any, start: any, entries: any) {
  return { id, d: iso(start), start, unit: 'kg', entries }
}

function entry(id: any, sets: any) {
  return { id, sets }
}

function lifecycleWorkouts(now: any = BASE_NOW) {
  // Six same-load sets on the chest score 6/8 of a full session, amplified by the
  // acute:chronic gain of a lone recent session ((6+4)/(1.5+4)). Position that
  // stimulus 30 seconds before its .5 crossing so the real interval update flips it.
  // (The 30-day-old balance session sits outside the 28-day chronic window.)
  const loneGain: any = (6 + 4) / (6 / 4 + 4)
  const fatigueEdge: any = now - (
    fatigueHalfLifeOf('chest') * Math.log2(6 / FATIGUE_SETS_PER_UNIT * loneGain / Math.LN2) - 30000
  )
  const balanceEdge: any = now - (30 * DAY - 30000)
  const strengthEdge: any = now - (14 * DAY - 30000)
  return [
    workout('fatigue-edge', fatigueEdge, [entry('1254', Array.from({ length: 6 }, () => set(true, { rir: 0 })))]),
    workout('balance-edge', balanceEdge, [entry('1254', [set(true, { rir: 2 })])]),
    workout('strength-edge', strengthEdge, [entry('1001', [set(true, { rir: 2 })])]),
    workout('abs-completed', now - 20 * DAY, [entry('1002', [set(true, { rir: 2 })])]),
    workout('abs-undone', now - DAY, [entry('1002', [set(false, { rir: 0 })])]),
  ]
}

function allFatiguedWorkout(now: any = BASE_NOW) {
  const ids: any = [
    '1018', '1012', '1167', '1013', '3011', '1413', '1399', '1016', '1005',
    '1010', '1003', '1001', '1511', '1494', '1002', '1000', '1396',
  ]
  return workout(
    'all-fatigued',
    now,
    ids.map((id: any) => entry(id, Array.from({ length: 12 }, () => set(true)))),
  )
}

function allSubfullWorkout(now: any = BASE_NOW) {
  return workout('all-subfull', now - 15 * DAY, [entry('1254', [set(true)])])
}

function exercisePickerWorkouts(now: any = BASE_NOW) {
  return [
    workout('bench', now, [entry('0025', [set(true, { w: 80 })])]),
    workout('squat', now - DAY, [entry('0043', [set(true, { w: 60 })])]),
    workout('legacy', now - 2 * DAY, [
      {
        id: LEGACY_SNAPSHOT_ID,
        muscleSnapshot: {
          n: 'Legacy shoulder press',
          bp: 'shoulders',
          primaries: ['deltoids'],
          secondaries: ['triceps'],
          muscleGroups: ['deltoids', 'triceps'],
        },
        sets: [set(true, { w: 50 })],
      },
    ]),
  ]
}

function resetFixture(workouts: any = lifecycleWorkouts()) {
  mocks.S.unit = 'kg'
  mocks.S.bodyweight = []
  mocks.S.workouts = workouts
  mocks.maps.length = 0
  mocks.charts.length = 0
  mocks.mapMounts = 0
  mocks.exerciseHistorySheet.mockClear()
  useUI.setState({ sheets: [] })
}

function installDom() {
  dom = new Window({ url: 'http://localhost/' })
  dom.scrollTo = vi.fn()
  globalThis.window = dom
  globalThis.document = dom.document
  configureUx(createBrowserUx())
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.navigator })
  Object.defineProperty(globalThis, 'location', { configurable: true, value: dom.location })
  Object.defineProperty(globalThis, 'history', { configurable: true, value: dom.history })
  for (const key of ['HTMLElement', 'HTMLIFrameElement', 'Node', 'Element', 'Event', 'MouseEvent']) {
    (globalThis as any)[key] = dom[key]
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
}

async function mountStats() {
  installDom()
  await act(async () => { root.render(React.createElement(React.Fragment, null, React.createElement(Stats), React.createElement(Modals))) })
}

async function unmountStats() {
  if (!root) return
  await act(async () => { root.unmount() })
  root = null
  container = null
  dom.close()
  dom = null
}

function muscleCard() {
  return [...container.querySelectorAll('.card')].find((card: any) =>
    [...card.querySelectorAll('.seg button')].some((button: any) =>
      ['Muscle balance', 'Fatigue', 'Strength'].includes(button.textContent.trim())))
}

function buttonWithText(scope: any, text: any) {
  return [...scope.querySelectorAll('button')].find((button: any) => button.textContent.trim() === text)
}

function viewButton(text: any) {
  return buttonWithText(muscleCard(), text)
}

function balanceRangeButton(text: any) {
  return buttonWithText(muscleCard().querySelectorAll('.seg')[1], text)
}

async function click(button: any) {
  expect(button, `expected a button named ${button?.textContent || 'unknown'}`).toBeTruthy()
  await act(async () => { button.dispatchEvent(new dom.MouseEvent('click', { bubbles: true })) })
}

async function tick(milliseconds: any) {
  await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds) })
}

const lastMap: any = () => mocks.maps.at(-1)
const expectPressed: any = (button: any) => expect(button?.getAttribute('aria-pressed')).toBe('true')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE_NOW)
  resetFixture()
})

afterEach(async () => {
  await unmountStats()
  useUI.setState({ sheets: [] })
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Stats muscle recovery view runtime', () => {
  it('dispatches real clicks through Balance, Fatigue, and Strength and preserves selection', async () => {
    await mountStats()
    expectPressed(viewButton('Muscle balance'))
    expectPressed(balanceRangeButton('Week'))

    await click(balanceRangeButton('30d'))
    await click(buttonWithText(muscleCard(), 'All'))
    await click(muscleCard().querySelector('[data-muscle="chest"]'))
    expect(buttonWithText(muscleCard(), 'Hard')).toBeTruthy()

    await click(viewButton('Fatigue'))
    expectPressed(viewButton('Fatigue'))
    expect(lastMap().thresholds).toBeTruthy()
    expect(container.textContent).toContain('Fatigue shows how recently each muscle was trained. High means rest.')
    expect(container.querySelector('[data-selected-muscle="chest"]')).toBeTruthy()

    await click(viewButton('Strength'))
    expectPressed(viewButton('Strength'))
    expect(lastMap().thresholds.at(-1)).toEqual({ at: 1, level: 4 })
    expect(container.textContent).toContain('Strength shows retained muscle strength. Train again to reset it.')

    await click(viewButton('Muscle balance'))
    expectPressed(balanceRangeButton('30d'))
    expect(buttonWithText(muscleCard(), 'Hard')).toBeTruthy()
    expect(lastMap().selected).toBe('chest')
    expect(lastMap().load.chest).toBe(7)
  })

  it('updates the rendered Fatigue map and Balance window on the real 60-second interval', async () => {
    await mountStats()
    await click(balanceRangeButton('30d'))
    await click(viewButton('Fatigue'))
    await click(muscleCard().querySelector('[data-muscle="chest"]'))

    const mountsBeforeTick: any = mocks.mapMounts
    const beforeTick: any = lastMap().load.chest
    expect(fatigueStateOf(beforeTick)).toBe(FATIGUE_STATES.FATIGUED)
    expect(container.textContent).toContain('Fatigued')

    await tick(60000)

    const afterTick: any = lastMap().load.chest
    expect(mocks.mapMounts).toBe(mountsBeforeTick)
    expect(afterTick).toBeLessThan(beforeTick)
    expect(fatigueStateOf(afterTick)).toBe(FATIGUE_STATES.RECOVERING)
    expect(container.textContent).toContain('Recovering')

    await click(viewButton('Strength'))
    expect(lastMap().load.quadriceps).toBeLessThan(1)
    await click(viewButton('Muscle balance'))
    expect(lastMap().load.chest).toBe(6)
  })

  it('derives a pound-profile bodyweight in kg and passes it into the rendered Fatigue map', async () => {
    const bodyweightWorkout: any = workout('bodyweight', BASE_NOW, [
      entry('0001', [{ done: true, w: 0, r: 10 }]),
    ])
    resetFixture([bodyweightWorkout])
    mocks.S.unit = 'lb'
    mocks.S.bodyweight = [{ d: '2026-01-20', w: 180 }, { d: '2026-01-22', w: 220.462262 }]

    await mountStats()
    await click(viewButton('Fatigue'))

    // One unloaded set is one effective set whatever the profile unit or body mass:
    // intensity is session-local and relative, so the 220 lb bodyweight only travels
    // through opts while the score stays 1 - exp(-1/8 x novice gain of 5/4.25).
    expect(lastMap().load.abs).toBeCloseTo(1 - Math.exp(-5 / 34), 6)
    expect(lastMap().thresholds).toBeTruthy()
  })

  it('renders fixed absolute bands through the actual Fatigue and Strength views', async () => {
    // Two back-to-back full sessions: even 0.4-weighted secondary movers accumulate
    // 2 x 12 x 0.4 / 8 = 1.2 raw units, clearing the top band everywhere.
    resetFixture([allFatiguedWorkout(), allFatiguedWorkout()])
    await mountStats()
    await click(viewButton('Fatigue'))
    const fatigueMap: any = lastMap()
    expect(Object.keys(fatigueMap.load)).toEqual(MUSCLES)
    expect(Object.values(fatigueMap.load).every((value: any) => value > 0.5)).toBe(true)
    expect(Object.values(levelsOf(fatigueMap.load, fatigueMap.thresholds)).every((level: any) => level === 4)).toBe(true)

    await unmountStats()
    resetFixture([allSubfullWorkout()])
    await mountStats()
    await click(viewButton('Strength'))
    const strengthMap: any = lastMap()
    expect(Object.values(strengthMap.load).every((value: any) => value < 1)).toBe(true)
    expect(Math.min(...Object.values(strengthMap.load as Record<string, number>))).toBe(STRENGTH_FLOOR)
    expect(strengthMap.thresholds.at(-1)).toEqual({ at: 1, level: 4 })
  })

  it('keeps zero-weight snapshots out of recovery maps and last-trained recency', async () => {
    resetFixture([workout('zero-mapped', BASE_NOW, [{
      id: 'deleted-zero-mapped',
      muscleSnapshot: { n: 'Zero mapped', muscleWeights: { chest: 1, biceps: 0 } },
      sets: [set(true)],
    }])])
    await mountStats()

    expect(lastMap().load).toEqual({ chest: 1 })
    await click(viewButton('Fatigue'))
    expect(lastMap().load.chest).toBeGreaterThan(0)
    expect(lastMap().load.biceps).toBe(0)
    expect((levelsOf(lastMap().load, lastMap().thresholds) as Record<string, number>).biceps).toBe(0)

    await click(viewButton('Strength'))
    expect(lastMap().load.chest).toBe(1)
    expect(lastMap().load.biceps).toBe(STRENGTH_FLOOR)
    const bicepsRow: any = [...muscleCard().querySelectorAll('.mrow')]
      .find((row: any) => row.querySelector('.nm')?.textContent === 'Biceps')
    expect(bicepsRow.querySelector('.v').textContent).toContain('not trained')
  })
})

describe('Stats estimated effort', () => {
  const effortHead: any = () => [...container.querySelectorAll('.card h2')]
    .find((h: any) => h.textContent.trim().startsWith('Effort'))

  it('badges estimated numbers on unrated import history', async () => {
    resetFixture([workout('unrated', BASE_NOW, [
      entry('0025', Array.from({ length: 6 }, () => set(true, { w: 80, r: 8 }))),
    ])])
    await mountStats()
    const head: any = effortHead()
    expect(head, 'expected an Effort card for estimable history').toBeTruthy()
    // Six self-anchored sets estimate RIR 0: a real average with an honest badge.
    expect(head.textContent).toContain('estimated')
    expect(container.textContent).toContain('0 rated')
  })

  it('keeps the logged view badge-free on rated history', async () => {
    resetFixture([workout('rated', BASE_NOW, [
      entry('0025', Array.from({ length: 6 }, () => set(true, { w: 80, r: 8, rir: 2 }))),
    ])])
    await mountStats()
    const head: any = effortHead()
    expect(head, 'expected an Effort card for rated history').toBeTruthy()
    expect(head.textContent).not.toContain('estimated')
  })
})

describe('Stats strength exercise rows', () => {
  // The rows under "Exercises · <muscle>" are presented as buttons (role, tabIndex, pointer
  // cursor) but for a year called a handler that never existed, so every tap threw
  // "onExercise is not defined" and opened nothing (QA C13). A tap now opens the exercise's
  // history sheet — the one place that already draws the Est. 1RM curve the row quotes.
  it('opens the exercise history sheet when a row is tapped instead of throwing', async () => {
    resetFixture(exercisePickerWorkouts())
    await mountStats()
    const thrown: any = []
    dom.addEventListener('error', (e: any) => { thrown.push(e.error || e.message); e.preventDefault() })

    await click(viewButton('Strength'))
    await click(muscleCard().querySelector('[data-muscle="chest"]'))
    expect(muscleCard().textContent).toContain('Exercises · Chest')
    const row: any = [...muscleCard().querySelectorAll('.mrow[role="button"]')].find((el: any) => el.textContent.includes('Est. 1RM'))
    expect(row, 'expected a tappable exercise row for the chest').toBeTruthy()
    expect(row.textContent).toContain('barbell bench press')

    await click(row)
    expect(thrown).toEqual([])
    expect(mocks.exerciseHistorySheet).toHaveBeenCalledTimes(1)
    expect(mocks.exerciseHistorySheet).toHaveBeenCalledWith('0025')

    // The keyboard path of tappable() must land in the same place.
    await act(async () => { row.dispatchEvent(new dom.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(thrown).toEqual([])
    expect(mocks.exerciseHistorySheet).toHaveBeenCalledTimes(2)
  })

  // The retained-strength bar used a 'to right' gradient, which fills from the left in Arabic too.
  // A width fills from the inline start, the way the detrained rows' bars already did.
  it('fills the retained-strength bar by width, so it follows the text direction', async () => {
    resetFixture([workout('bench-old', BASE_NOW - 20 * DAY, [entry('0025', [set(true, { w: 80 })])])])
    await mountStats()
    await click(viewButton('Strength'))
    await click(muscleCard().querySelector('[data-muscle="chest"]'))
    const row: any = [...muscleCard().querySelectorAll('.mrow[role="button"]')].find((el: any) => el.textContent.includes('Est. 1RM'))
    expect(row).toBeTruthy()
    const pct: any = row.querySelector('.v').textContent.match(/(\d+)%/)[1]
    expect(Number(pct)).toBeLessThan(100)
    const fill: any = row.querySelector('.bar i')
    expect(fill.style.width).toBe(pct + '%')
    expect(fill.getAttribute('style')).not.toMatch(/to right|gradient/)
  })
})

describe('Stats exercise progress picker', () => {
  it('keeps a legacy reps record whose load is stored only in topW', async () => {
    resetFixture([workout('legacy-topw', BASE_NOW, [
      { id: '0025', target: { mode: 'reps' }, topW: 70, sets: [] },
    ])])
    await mountStats()

    const card: any = [...container.querySelectorAll('.card')].find((el: any) => el.querySelector('h2')?.textContent.trim() === 'Exercise progress')
    expect(card.textContent).toContain('70 kg')
    const progressChart: any = mocks.charts.find((chart: any) => chart.points?.some((point: any) => point.y === 70))
    expect(progressChart?.points).toHaveLength(1)
    expect(progressChart.points[0].y).toBe(70)
  })

  it('keeps the strongest topW across repeated legacy records', async () => {
    resetFixture([workout('legacy-topw-duplicates', BASE_NOW, [
      { id: '0025', target: { mode: 'reps' }, topW: 70, sets: [] },
      { id: '0025', target: { mode: 'reps' }, topW: 60, sets: [] },
    ])])
    await mountStats()

    const card: any = [...container.querySelectorAll('.card')].find((el: any) => el.querySelector('h2')?.textContent.trim() === 'Exercise progress')
    expect(card.textContent).toContain('70 kg')
    const progressChart: any = mocks.charts.find((chart: any) => chart.points?.some((point: any) => point.y === 70))
    expect(progressChart?.points).toHaveLength(1)
    expect(progressChart.points[0].y).toBe(70)
  })

  it('keeps a legacy topW when a modern occurrence shares the workout', async () => {
    resetFixture([workout('modern-and-legacy', BASE_NOW, [
      entry('0025', [set(true, { w: 50, r: 5 })]),
      { id: '0025', target: { mode: 'reps' }, topW: 70, sets: [] },
    ])])
    await mountStats()

    const card: any = [...container.querySelectorAll('.card')].find((el: any) => el.querySelector('h2')?.textContent.trim() === 'Exercise progress')
    expect(card.textContent).toContain('70 kg')
    const progressChart: any = mocks.charts.find((chart: any) => chart.points?.some((point: any) => point.y === 70))
    expect(progressChart?.points).toHaveLength(1)
    expect(progressChart.points[0].y).toBe(70)
  })

  it('aggregates duplicate exercise occurrences into one progress point', async () => {
    resetFixture([workout('duplicate', BASE_NOW, [
      entry('0025', [set(true, { w: 60, r: 5 })]),
      entry('0025', [set(true, { w: 80, r: 5 })]),
    ])])
    await mountStats()

    const card: any = [...container.querySelectorAll('.card')].find((el: any) => el.querySelector('h2')?.textContent.trim() === 'Exercise progress')
    expect(card.textContent).toContain('80 kg')
    const progressChart: any = mocks.charts.find((chart: any) => chart.points?.some((point: any) => point.y === 80))
    expect(progressChart?.points).toHaveLength(1)
    expect(progressChart.points[0].y).toBe(80)
    expect(card.textContent).toContain('60×5  80×5')
  })

  it('aggregates repeated assisted occurrences by the lightest load', async () => {
    resetFixture([workout('assisted-duplicate', BASE_NOW, [
      entry('0017', [set(true, { w: 30, r: 8 })]),
      entry('0017', [set(true, { w: 20, r: 8 })]),
    ])])
    await mountStats()

    const card: any = [...container.querySelectorAll('.card')].find((el: any) => el.querySelector('h2')?.textContent.trim() === 'Exercise progress')
    expect(card.textContent).toContain('20 kg')
    const progressChart: any = mocks.charts.find((chart: any) => chart.points?.some((point: any) => point.y === 20))
    expect(progressChart?.points).toHaveLength(1)
    expect(progressChart.points[0].y).toBe(20)
  })

  it('filters with the shared exercise matcher and still selects from the mounted sheet', async () => {
    resetFixture(exercisePickerWorkouts())
    await mountStats()
    expect(EXIDX[LEGACY_SNAPSHOT_ID]).toBeUndefined()

    const card: any = [...container.querySelectorAll('.card')].find((el: any) => el.querySelector('h2')?.textContent.trim() === 'Exercise progress')
    const selector: any = [...card.querySelectorAll('button')].find((button: any) => button.querySelector('.lrow-t')?.textContent.trim() === 'Exercise')
    await click(selector)

    const modal: any = document.querySelector('#modal-root')
    const input: any = modal.querySelector('input')
    expect(input).toBeTruthy()
    expect(input.getAttribute('aria-label')).toBe('Search…')
    expect(input.getAttribute('placeholder')).toBe('Search…')
    expect(modal.querySelector('.picker-search')).toBeTruthy()
    const optionButtons: any = () => [...modal.querySelectorAll('.sect-b button')]
    const initialOptionCount: any = optionButtons().length
    expect(initialOptionCount).toBe(3)
    expect(modal.textContent).toContain('Legacy shoulder press')
    expect(input.compareDocumentPosition(optionButtons()[0]) & globalThis.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const setter: any = Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')!.set
    const setSearch: any = async (value: any) => act(async () => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    // A focused search can leave a newly narrowed result below the visual viewport. The
    // correction must advance the sheet's own scroll position, not the page behind it.
    const sheet: any = modal.querySelector('.sheet')
    const firstOption: any = optionButtons()[0]
    Object.defineProperties(sheet, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1000 },
    })
    vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({ bottom: 600 })
    vi.spyOn(firstOption, 'getBoundingClientRect').mockReturnValue({ bottom: 500 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { height: 300 } })
    input.focus()
    expect(sheet.style.getPropertyValue('--picker-visual-height')).toBe('300px')
    expect(sheet.style.getPropertyValue('--picker-keyboard-bottom')).toBe(`${Math.max(0, window.innerHeight - 300)}px`)
    await setSearch('bench')
    await tick(100)
    expect(sheet.scrollTop).toBeGreaterThan(0)

    await setSearch('no such historical exercise')
    expect(modal.textContent).toContain('No match')
    expect(optionButtons()).toHaveLength(0)

    await click(modal.querySelector('button[aria-label="Clear"]'))
    expect(input.value).toBe('')
    expect(optionButtons()).toHaveLength(initialOptionCount)
    expect(modal.textContent).toContain('Legacy shoulder press')

    await setSearch('legacy shoulder press shoulders deltoids triceps')
    expect(optionButtons()).toHaveLength(1)
    expect(optionButtons()[0].textContent).toContain('Legacy shoulder press')

    await click(modal.querySelector('button[aria-label="Clear"]'))
    await setSearch('squat full bárbell')

    // A catalogue name is title-cased like it is in every list (exerciseNameText); the legacy
    // snapshot above keeps the name as it was typed.
    expect(modal.textContent).toContain('Barbell Full Squat')
    expect(modal.textContent).not.toContain('Barbell Bench Press')

    const matching: any = [...modal.querySelectorAll('button')].find((button: any) => button.textContent.includes('Barbell Full Squat'))
    await click(matching)

    expect(useUI.getState().sheets).toHaveLength(0)
    expect(card.querySelector('.lrow-v').textContent).toContain('Barbell Full Squat')
  })
})
