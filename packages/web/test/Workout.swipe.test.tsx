import './workout-sheet-environment'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './regression-harness'
import { deleteActiveSet, undoDeleteSet, copyActiveSet, removeActiveExercise } from '../src/views/Workout'
import { DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { closeOpenRow } from '../src/lib/use-swipe-row'

// Swipe on sets (v1.3.11): swipe toward the start removes a set with an Undo, toward the end
// copies it. These cover the store paths the swipe, the set menu and the Undo share, the guards
// (last set, timers), and the gesture on a real rendered row.

vi.mock('../src/lib/sound', () : any => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../src/lib/api', () : any => ({ api: vi.fn(() : any => Promise.resolve({})), beacon: vi.fn(), appBase: () : any => '/' }))

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const clone = (value: any ) : any => JSON.parse(JSON.stringify(value))
const row = (w: any, done: any = false, extra: any = {}) : any => ({ w, r: 8, done, ...extra })
const entry = (id: any, sets: any, extra: any = {}) : any => ({ id, target: { sets: sets.length, reps: 8 }, sets, ...extra })

const animationDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate')
let root: any
let container: any

function setActive(entries: any, { cur = 0, wc, hints = { swipeSets: true }, editing = false }: any = {}) : any {
  const S = clone(DEF)
  if (wc) S.wc = { ...S.wc, ...wc }
  S.hints = hints
  S.active = {
    id: 'swipe-test', d: '2026-10-06', start: Date.now(), routineId: null,
    name: 'Swipe test', bw: null, cur, entries,
    ...(editing ? { editingWorkoutId: 'w1' } : {}),
  }
  useStore.setState({ S, user: null })
}
const sets = (k: any = 0) : any => useStore.getState().S.active.entries[k].sets
const toast = () : any => useUI.getState().toastMsg

function render() : any {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() : any => root.render(<Workout />))
}

function pointer(target: any, type: any, x: any, y: any = 300, pointerType: any = 'touch') : any {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 7, pointerType, clientX: x, clientY: y })
  act(() : any => { target.dispatchEvent(event) })
}
const click = (target: any ) : any => act(() : any => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
// A swipe from x0 to x1 on `target`, ended with the click a browser may send after a touch.
function swipe(target: any, x0: any, x1: any, { dy = 0, pointerType = 'touch', clickAfter = true }: any = {}) : any {
  pointer(target, 'pointerdown', x0, 300, pointerType)
  pointer(target, 'pointermove', x0 + (x1 - x0) / 2, 300 + dy / 2, pointerType)
  pointer(target, 'pointermove', x1, 300 + dy, pointerType)
  pointer(target, 'pointerup', x1, 300 + dy, pointerType)
  if (clickAfter) click(target)
}

beforeEach(() : any => {
  vi.useFakeTimers()
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: undefined })
  localStorage.clear()
  document.documentElement.dir = 'ltr'
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null, timer: null, work: null, swipeHint: null, setFlash: null })
  useStore.setState({ S: clone(DEF), user: null })
  root = null
  container = null
})

afterEach(() : any => {
  if (animationDescriptor) Object.defineProperty(HTMLElement.prototype, 'animate', animationDescriptor)
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate')
  vi.restoreAllMocks()
  closeOpenRow(true)
  if (root) act(() : any => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
  document.documentElement.dir = 'ltr'
})

describe('removing a set, and Undo', () : any => {
  it('removes the set, says which, and Undo puts the exact row back in its place', () : any => {
    const drop = row(80, true, { type: 'dropset', drops: [{ w: 60, r: 6 }], at: 5 })
    setActive([entry('1001', [row(80, true), drop, row(80)])])
    expect(deleteActiveSet(0, 1)).toBe(true)
    expect(sets()).toHaveLength(2)
    expect(toast()).toBe('Set 2 gone.')
    expect(useUI.getState().toastAction!.label).toBe('Undo')

    act(() : any => useUI.getState().runToastAction())
    expect(sets()).toEqual([row(80, true), drop, row(80)])
    expect(useUI.getState().setFlash).toMatchObject({ idx: 0, i: 1 })
  })

  it('numbers a warm-up as a warm-up', () : any => {
    setActive([entry('1001', [row(40, false, { phase: 'warmup', warmup: true }), row(80), row(80)])])
    deleteActiveSet(0, 0)
    expect(toast()).toBe('Warm-up gone.')
  })

  it('keeps the last set of a live session, and lets the editor of a saved workout take it', () : any => {
    setActive([entry('1001', [row(80)])])
    expect(deleteActiveSet(0, 0)).toBe(false)
    expect(sets()).toHaveLength(1)
    expect(toast()).toBe('Keep at least one set, champ')

    setActive([entry('1001', [row(80, true)])], { editing: true })
    expect(deleteActiveSet(0, 0, { editing: true })).toBe(true)
    expect(sets()).toHaveLength(0)
  })

  it('stops the rest the removed set started, and Undo does not start it again', () : any => {
    setActive([entry('1001', [row(80, true), row(80, true), row(80)])])
    useUI.getState().startRest(90, 0, { forSet: 1 })
    deleteActiveSet(0, 1)
    expect(useUI.getState().timer).toBeNull()
    expect(toast()).toBe('Set 2 gone. Its timer stopped too.')
    act(() : any => useUI.getState().runToastAction())
    expect(sets()[1].done).toBe(true)
    expect(useUI.getState().timer).toBeNull()
  })

  it('keeps a rest another set started, pointed at where that set moved', () : any => {
    setActive([entry('1001', [row(80, true), row(80, true), row(80)])])
    useUI.getState().startRest(90, 0, { forSet: 1 })
    deleteActiveSet(0, 0)
    expect(useUI.getState().timer?.forSet).toBe(0)
    expect(toast()).toBe('Set 1 gone.')
    act(() : any => useUI.getState().runToastAction())
    expect(useUI.getState().timer?.forSet).toBe(1)
  })

  it('is too late once the exercise is gone, and finds an exercise that moved', () : any => {
    setActive([entry('1001', [row(80), row(80)]), entry('1002', [row(50), row(50)])])
    deleteActiveSet(1, 0)
    const undo: any = useUI.getState().toastAction!.run
    removeActiveExercise(0)   // 1002 is now at 0
    expect(undo()).toBe(true)
    expect(sets(0)).toEqual([row(50), row(50)])

    removeActiveExercise(0)
    expect(undo()).toBe(false)
    expect(toast()).toContain('workout changed')
  })

  it('a newer toast takes the old Undo with it, and the removal stays', () : any => {
    setActive([entry('1001', [row(80), row(81), row(82)])])
    deleteActiveSet(0, 0)
    copyActiveSet(0, 0)
    expect(useUI.getState().toastAction).toBeNull()
    expect(sets().map((s: any ) : any => s.w)).toEqual([81, 81, 82])
  })
})

describe('copying a set', () : any => {
  it('puts an unticked copy right below, flashes it and says so', () : any => {
    setActive([entry('1001', [row(80, true, { rir: 2 }), row(80)])])
    expect(copyActiveSet(0, 0)).toBe(true)
    expect(sets()).toEqual([row(80, true, { rir: 2 }), row(80, false, { rir: 2 }), row(80)])
    expect(useUI.getState().setFlash).toMatchObject({ idx: 0, i: 1 })
    expect(toast()).toBe('Copied. One more like that one.')
    expect(useUI.getState().toastAction).toBeNull()
  })
})



describe('a timed per-side hold (an L row and an R row)', () : any => {
  const pair = (sec: any ) : any => [{ sec, w: 0, done: false, side: 'L' }, { sec, w: 0, done: false, side: 'R' }]
  const sided = (rows: any ) : any => entry('1002', rows, { target: { sets: rows.length / 2, sec: 30, mode: 'time', side: true } })

  it('removes both halves as one set, and Undo puts both back', () : any => {
    const rows = [...pair(30), ...pair(40)]
    setActive([sided(rows)])
    deleteActiveSet(0, 1)
    expect(sets()).toEqual(pair(40))
    expect(toast()).toBe('Set 1 gone.')
    act(() : any => useUI.getState().runToastAction())
    expect(sets()).toEqual(rows)
  })

  it('keeps the last pair of a live session', () : any => {
    setActive([sided(pair(30))])
    expect(deleteActiveSet(0, 0)).toBe(false)
    expect(sets()).toEqual(pair(30))
    expect(toast()).toBe('Keep at least one set, champ')
  })
})

describe('the swipe on a rendered set row', () : any => {
  const swrows = () : any => [...container.querySelectorAll('.swrow')]
  // happy-dom lays nothing out: give rows a phone's width so the thresholds mean what they do there.
  let widthSpy: any
  beforeEach(() : any => { widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360) })
  afterEach(() : any => widthSpy.mockRestore())
  const repsPlus = (k: any ) : any => swrows()[k].querySelectorAll('button[aria-label="Increase"]')[1]

  it('wraps every set row when on, and none when off', () : any => {
    setActive([entry('1001', [row(80), row(80)])])
    render()
    expect(swrows()).toHaveLength(2)
    expect(swrows()[0].hasAttribute('data-swipe-ignore')).toBe(true)
    // the two buttons behind the row are out of reach while it is shut
    for (const pane of swrows()[0].querySelectorAll('.swpane')) {
      expect(pane.getAttribute('aria-hidden')).toBe('true')
      expect(pane.hasAttribute('inert')).toBe(true)
      expect(pane.querySelector('button').tabIndex).toBe(-1)
    }
    act(() : any => root.unmount()); container.remove()

    setActive([entry('1001', [row(80), row(80)])], { wc: { swipeSets: false } })
    render()
    expect(swrows()).toHaveLength(0)
    expect(container.querySelector('[data-swipe-ignore]')).toBeNull()
    expect(container.querySelectorAll('.setrow')).toHaveLength(2)
  })

  it('a tap on + is a tap, a swipe that starts on + does not press it', () : any => {
    setActive([entry('1001', [row(80), row(80)])])
    render()
    pointer(repsPlus(0), 'pointerdown', 200)
    pointer(repsPlus(0), 'pointerup', 200)
    click(repsPlus(0))
    expect(sets()[0].r).toBe(9)

    swipe(repsPlus(0), 200, 250)    // short: opens on Copy, nothing pressed
    expect(sets()[0].r).toBe(9)
    expect(sets()).toHaveLength(2)
  })

  it('a long swipe toward the end copies, toward the start removes with Undo', () : any => {
    setActive([entry('1001', [row(80, true), row(70)])])
    render()
    swipe(swrows()[0], 100, 330)
    act(() : any => vi.advanceTimersByTime(400))
    expect(sets().map((s: any ) : any => [s.w, s.done])).toEqual([[80, true], [80, false], [70, false]])

    swipe(swrows()[2], 330, 60)
    act(() : any => vi.advanceTimersByTime(800))
    expect(sets().map((s: any ) : any => s.w)).toEqual([80, 80])
    expect(toast()).toBe('Set 3 gone.')
    act(() : any => useUI.getState().runToastAction())
    expect(sets().map((s: any ) : any => s.w)).toEqual([80, 80, 70])
  })

  it('mirrors in Arabic: a swipe to the right removes', () : any => {
    document.documentElement.dir = 'rtl'
    setActive([entry('1001', [row(80), row(70)])])
    render()
    swipe(swrows()[1], 60, 330)
    act(() : any => vi.advanceTimersByTime(800))
    expect(sets().map((s: any ) : any => s.w)).toEqual([80])
  })

  it('rubber-bands the last set back and says why', () : any => {
    setActive([entry('1001', [row(80)])])
    render()
    expect(swrows()[0].querySelector('.swpane.del').classList.contains('dis')).toBe(true)
    swipe(swrows()[0], 330, 60)
    act(() : any => vi.advanceTimersByTime(800))
    expect(sets()).toHaveLength(1)
    expect(toast()).toBe('Keep at least one set, champ')
  })

  it('leaves vertical moves, mouse drags and the screen edges alone', () : any => {
    setActive([entry('1001', [row(80), row(70)])])
    render()
    swipe(swrows()[1], 200, 120, { dy: 200 })        // mostly down: a scroll
    swipe(swrows()[1], 330, 60, { pointerType: 'mouse' })
    swipe(swrows()[1], 10, 300)                      // from the left edge: iOS back
    act(() : any => vi.advanceTimersByTime(800))
    expect(sets().map((s: any ) : any => s.w)).toEqual([80, 70])
  })

  it('a short swipe opens the row on a real button, and that button acts', () : any => {
    setActive([entry('1001', [row(80), row(70)])])
    render()
    swipe(swrows()[1], 300, 240)
    const del = swrows()[1].querySelector('.swpane.del')
    expect(del.hasAttribute('inert')).toBe(false)
    expect(del.querySelector('button').tabIndex).toBe(0)
    click(del.querySelector('button'))
    act(() : any => vi.advanceTimersByTime(800))
    expect(sets().map((s: any ) : any => s.w)).toEqual([80])
  })

})

describe('the swipe on a timed per-side pair', () : any => {
  const pair = (sec: any ) : any => [{ sec, w: 0, done: false, side: 'L' }, { sec, w: 0, done: false, side: 'R' }]
  const sided = (rows: any ) : any => entry('1002', rows, { target: { sets: rows.length / 2, sec: 30, mode: 'time', side: true } })
  const swrows = () : any => [...container.querySelectorAll('.swrow')]
  let widthSpy: any
  beforeEach(() : any => { widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360) })
  afterEach(() : any => widthSpy.mockRestore())

  it('slides the L and R rows together, as the one set it deletes', () : any => {
    setActive([sided([...pair(30), ...pair(40)])])
    render()
    // one swipe per pair, each holding both of its rows
    expect(swrows()).toHaveLength(2)
    for (const sw of swrows()) expect(sw.querySelector('.swfront').querySelectorAll('.setrow')).toHaveLength(2)
    expect(container.querySelectorAll('.setrow')).toHaveLength(4)
    swipe(swrows()[0].querySelector('.swfront'), 330, 60)
    act(() : any => vi.advanceTimersByTime(800))
    expect(sets()).toEqual(pair(40))
  })

  it('copies the pair from either row, and draws both rows without swiping', () : any => {
    setActive([sided(pair(30))])
    render()
    const right = swrows()[0].querySelectorAll('.setrow')[1]
    swipe(right, 100, 330)
    act(() : any => vi.advanceTimersByTime(400))
    expect(sets()).toEqual([...pair(30), ...pair(30)])
    act(() : any => root.unmount()); container.remove()

    setActive([sided(pair(30))], { wc: { swipeSets: false } })
    render()
    expect(swrows()).toHaveLength(0)
    expect(container.querySelectorAll('.setrow')).toHaveLength(2)
  })
})

describe('the swipe panes’ words', () : any => {
  // QA 10-06: the Copy pane used the noun a copied routine is named with ("Kopie", "Copie").
  it('renders the copy pane with that key', () : any => {
    setActive([entry('1001', [row(80), row(80)])])
    render()
    expect(container.querySelector('.swpane.cp b').textContent).toBe('Copy set')
  })
})

