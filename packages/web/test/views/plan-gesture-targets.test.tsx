// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { useStore, freshState, initializeStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import { initializeSyncEngine } from '../../src/store/sync-engine'
import { createBrowserPlatform } from '../../src/platform/browser'
import { configureClientIO } from '../../src/lib/client-io'
import { configureUx, createBrowserUx } from '../../src/platform/ux'
import { closeOpenRow } from '../../src/lib/use-swipe-row'
import Plan from '../../src/views/Plan'
import RoutineEdit from '../../src/views/RoutineEdit'
const sheets = vi.hoisted(() => ({ confirmSheet: vi.fn(), menuSheet: vi.fn(), exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), supersetSheet: vi.fn(), starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn() }))
vi.mock('../../src/sheets', () => sheets)
vi.mock('../../src/components/BodyMap', () => ({ default: () => null }))
let platform: ReturnType<typeof createBrowserPlatform>, dispose: () => void, root: Root, host: HTMLDivElement
const cardio = { id: 'custom-cardio', n: 'Synthetic cardio', bp: 'cardio', tg: 'cardiovascular system', eq: 'other', custom: true }
const slot = (occurrence: string) => ({ id: '0025', sets: 3, reps: 5, weight: 60, opaque: { occurrence } })
const doc = () => ({ ...freshState(), customEx: [cardio], routines: [
  { id: 'r', name: 'First', emoji: 'dumbbell', ex: [slot('first'), slot('second')] },
  { id: 's', name: 'Second', emoji: 'dumbbell', ex: [{ id: '0027' }] },
  { id: 't', name: 'Third', emoji: 'dumbbell', ex: [{ id: '0027' }] },
], rotation: { id: 'rot', sequence: ['r', 's', 't'], label: '', opaqueRotation: { newer: true } }, scheduleMode: 'rotation', queue: {
  ids: ['r', 's', 't'], since: 1, startsOn: '2026-09-28', rotationId: 'rot', strict: true, opaqueQueue: { newer: ['value'] },
} })
function replace(account: string) {
  act(() => { useStore.getState().setUser({ id: account, name: account }); useStore.getState().replaceState(doc(), false) })
}
const snapshot = () => ({ state: JSON.stringify(useStore.getState().S), bytes: platform.kv.get('gym_state_v1') })
function click(text: string) { act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!.click()) }
function mount(view: 'routines' | 'loop' | 'exercises') {
  platform.kv.set('gym_plan_view', view === 'routines' ? 'routines' : 'schedule')
  act(() => root.render(<MemoryRouter initialEntries={[view === 'exercises' ? '/plan/r/r' : '/plan']}><Routes><Route path='/plan' element={<Plan />} /><Route path='/plan/r/:id' element={<RoutineEdit />} /></Routes></MemoryRouter>))
}
function pointer(el: Element, type: string, x: number, y = 10) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, button: 0 })
  act(() => { el.dispatchEvent(event) })
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  configureUx(createBrowserUx()); platform = createBrowserPlatform(); const map = new Map<string, string>()
  platform.kv = { get: key => map.get(key) ?? null, set: (key, value) => { map.set(key, value) }, remove: key => { map.delete(key) }, subscribe: () => () => {} }
  initializeStore(platform); configureClientIO(platform)
  dispose = initializeSyncEngine({ platform, api: vi.fn().mockResolvedValue({ ok: true, rev: 1 }), prompts: { askAddDeviceData: async () => false, toast() {} } })
  replace('A'); useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  Object.values(sheets).forEach(fn => { if ('mockReset' in fn) fn.mockReset() })
  sheets.exercisePicker.mockReturnValue({ close: vi.fn() })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const i = [...(this.parentElement?.children ?? [])].indexOf(this)
    return { top: i * 60, height: 60 } as DOMRect
  })
  vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(() => {
    let timer: ReturnType<typeof setTimeout>
    return { set onfinish(fn: () => void) { timer = setTimeout(fn, 180) }, cancel() { clearTimeout(timer) } } as unknown as Animation
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { closeOpenRow(true); act(() => root.unmount()); host.remove(); dispose(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })
function beginDrag(view: 'routines' | 'loop') {
  mount(view); click('Edit')
  const handle = host.querySelector('.plan-handle')!
  pointer(handle, 'pointerdown', 100); pointer(handle, 'pointermove', 100, 90)
  return () => pointer(handle, 'pointerup', 100, 90)
}
function reorder(view: 'routines' | 'loop' | 'exercises') {
  act(() => useStore.getState().update(s => {
    if (view === 'routines') s.routines.reverse()
    else if (view === 'loop') { s.rotation.sequence.reverse(); s.queue.ids.reverse() }
    else s.routines[0].ex.reverse()
  }))
}
for (const view of ['routines', 'loop'] as const) {
  it(`real W07 cancels ${view} drag after A → B`, () => {
    const drop = beginDrag(view); replace('B'); const before = snapshot(); drop()
    expect(snapshot()).toEqual(before)
  })
  it(`real W07 cancels ${view} drag after a same-account reorder`, () => {
    const drop = beginDrag(view); reorder(view); const before = snapshot(); drop()
    expect(snapshot()).toEqual(before)
  })
  it(`real W07 guards ${view} drag against an account switch inside the producer`, () => {
    const drop = beginDrag(view), original = useStore.getState().update
    let before!: ReturnType<typeof snapshot>
    useStore.setState({ update: (mut, push) => { replace('B'); before = snapshot(); original(mut, push) } })
    drop(); expect(before).toBeDefined(); expect(snapshot()).toEqual(before)
  })
  it(`real W07 guards ${view} drag against a same-account reorder inside the producer`, () => {
    const drop = beginDrag(view), original = useStore.getState().update
    let before!: ReturnType<typeof snapshot>
    useStore.setState({ update: (mut, push) => {
      useStore.setState({ update: original }); reorder(view); before = snapshot(); original(mut, push)
    } })
    drop(); expect(before).toBeDefined(); expect(snapshot()).toEqual(before)
  })
  it(`real W07 allows ${view} drag without an identity change`, () => {
    const drop = beginDrag(view), before = snapshot(); drop()
    const s = useStore.getState().S
    expect(view === 'routines' ? s.routines.map((r: any) => r.id) : s.queue.ids).toEqual(['s', 'r', 't'])
    expect(snapshot().bytes).not.toBe(before.bytes)
    if (view === 'loop') {
      const saved = JSON.parse(snapshot().bytes!)
      expect(saved.rotation.opaqueRotation).toEqual(doc().rotation.opaqueRotation)
      expect(saved.queue.opaqueQueue).toEqual(doc().queue.opaqueQueue)
      expect(saved.queue).toMatchObject({ since: 1, startsOn: '2026-09-28', strict: true, rotationId: 'rot' })
    }
  })
}
const swipes = ['routine-delete', 'routine-copy', 'loop-remove', 'exercise-remove'] as const
type Swipe = typeof swipes[number]
const viewOf = (kind: Swipe) => kind.startsWith('routine') ? 'routines' : kind === 'loop-remove' ? 'loop' : 'exercises'
function beginSwipe(kind: Swipe) {
  mount(viewOf(kind)); const row = host.querySelector('.swrow')!, copy = kind === 'routine-copy'
  pointer(row, 'pointerdown', copy ? 60 : 330); pointer(row, 'pointermove', copy ? 330 : 60); pointer(row, 'pointerup', copy ? 330 : 60)
  // Identity can change either before collapse begins or while its animation is running.
  act(() => vi.advanceTimersByTime(180))
  return () => act(() => vi.advanceTimersByTime(800))
}
for (const kind of swipes) {
  it.each(['account', 'same-account reorder'])(`real W07 cancels ${kind} before release after %s change`, change => {
    mount(viewOf(kind)); const row = host.querySelector('.swrow')!, copy = kind === 'routine-copy'
    pointer(row, 'pointerdown', copy ? 60 : 330); pointer(row, 'pointermove', copy ? 330 : 60)
    if (change === 'account') replace('B')
    else reorder(viewOf(kind))
    const before = snapshot()
    pointer(row, 'pointerup', copy ? 330 : 60); act(() => vi.advanceTimersByTime(800))
    expect(snapshot()).toEqual(before)
  })
  it(`real W07 cancels pending ${kind} after A → B`, () => {
    const finish = beginSwipe(kind); replace('B'); const before = snapshot(); finish()
    expect(snapshot()).toEqual(before)
  })
  it(`real W07 cancels pending ${kind} after a same-account reorder`, () => {
    const finish = beginSwipe(kind); reorder(viewOf(kind)); const before = snapshot(); finish()
    expect(snapshot()).toEqual(before)
  })
  it(`real W07 guards pending ${kind} against an account switch inside the producer`, () => {
    const finish = beginSwipe(kind), original = useStore.getState().update
    let before!: ReturnType<typeof snapshot>
    useStore.setState({ update: (mut, push) => { replace('B'); before = snapshot(); original(mut, push) } })
    finish(); expect(before).toBeDefined(); expect(snapshot()).toEqual(before)
  })
  it(`real W07 guards pending ${kind} against a same-account reorder inside the producer`, () => {
    const finish = beginSwipe(kind), original = useStore.getState().update
    let before!: ReturnType<typeof snapshot>
    useStore.setState({ update: (mut, push) => {
      useStore.setState({ update: original }); reorder(viewOf(kind)); before = snapshot(); original(mut, push)
    } })
    finish(); expect(before).toBeDefined(); expect(snapshot()).toEqual(before)
  })
  it(`real W07 allows ${kind} without an identity change`, () => {
    const finish = beginSwipe(kind), before = snapshot(); finish()
    const s = useStore.getState().S
    if (kind === 'routine-delete') expect(s.routines.map((r: any) => r.id)).toEqual(['s', 't'])
    if (kind === 'routine-copy') expect(s.routines.map((r: any) => r.name)).toEqual(['First', 'First (Copy)', 'Second', 'Third'])
    if (kind === 'loop-remove') {
      expect(s.queue.ids).toEqual(['s', 't'])
      expect(s.rotation.opaqueRotation).toEqual(doc().rotation.opaqueRotation)
      expect(s.queue.opaqueQueue).toEqual(doc().queue.opaqueQueue)
    }
    if (kind === 'exercise-remove') expect(s.routines[0].ex).toEqual([slot('second')])
    expect(snapshot().bytes).not.toBe(before.bytes)
  })
}
it('duplicate exercise occurrences retain their DOM identity after a same-length reorder', () => {
  mount('exercises'); const rows = [...host.querySelectorAll('[data-routine-row]')]
  reorder('exercises'); const moved = [...host.querySelectorAll('[data-routine-row]')]
  expect(moved).toEqual([rows[1], rows[0]])
})
it('loop reorder preserves opaque fields while retaining the native skipped-field clearing', () => {
  act(() => useStore.getState().update(s => { s.queue.skipped = ['r'] }))
  beginDrag('loop')()
  const saved = JSON.parse(snapshot().bytes!)
  expect(saved.queue.skipped).toBeUndefined()
  expect(saved.queue.opaqueQueue).toEqual(doc().queue.opaqueQueue)
  expect(saved.rotation.opaqueRotation).toEqual(doc().rotation.opaqueRotation)
})
it('loop Undo after another same-pass edit also preserves opaque rotation and queue fields', () => {
  beginSwipe('loop-remove')()
  const undo = useUI.getState().toastAction!.run
  reorder('loop'); act(undo)
  const saved = JSON.parse(snapshot().bytes!)
  expect(saved.queue.ids).toEqual(['r', 't', 's'])
  expect(saved.queue.opaqueQueue).toEqual(doc().queue.opaqueQueue)
  expect(saved.rotation.opaqueRotation).toEqual(doc().rotation.opaqueRotation)
})
function quickReplace(next: { id: string }) {
  act(() => host.querySelector<HTMLElement>('[data-routine-row] .item')!.click())
  act(() => sheets.exConfigSheet.mock.calls.at(-1)![6]())
  return () => act(() => sheets.exercisePicker.mock.calls.at(-1)![0](next, true))
}
it.each(['to-cardio', 'to-lifting'])('real W07 quick Replace %s preserves unknown fields and canonical clears', direction => {
  if (direction === 'to-lifting') act(() => useStore.getState().update(s => { s.routines[0].ex[0] = { id: cardio.id, sets: 1, min: 20, speed: 8, opaque: slot('first').opaque } }))
  mount('exercises'); quickReplace(direction === 'to-cardio' ? cardio : { id: '0025' })()
  const saved = JSON.parse(snapshot().bytes!).routines[0].ex[0]
  expect(saved.opaque).toEqual(slot('first').opaque)
  if (direction === 'to-cardio') { expect(saved).toMatchObject({ id: cardio.id, min: 20, speed: 8 }); expect(saved.reps).toBeUndefined(); expect(saved.weight).toBeUndefined() }
  else { expect(saved.id).toBe('0025'); expect(saved.reps).toBeDefined(); expect(saved.min).toBeUndefined(); expect(saved.speed).toBeUndefined() }
})
it('real W07 refuses a quick Replace after account switch, retaining B bytes', () => {
  mount('exercises'); const run = quickReplace(cardio); replace('B'); const before = snapshot(); run()
  expect(snapshot()).toEqual(before)
})
it('quick Replace clears the old assisted override while keeping opaque keys', () => {
  act(() => useStore.getState().update(s => { s.routines[0].ex[0].assisted = true }))
  mount('exercises'); quickReplace({ id: '0027' })()
  const saved = JSON.parse(snapshot().bytes!).routines[0].ex[0]
  expect(saved.id).toBe('0027'); expect(saved.assisted).toBeUndefined()
  expect(saved.opaque).toEqual(slot('first').opaque)
})
