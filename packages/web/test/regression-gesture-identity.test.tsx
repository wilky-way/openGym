// @vitest-environment happy-dom
import './workout-sheet-environment'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Workout from './regression-harness'
import { clone, DEF, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { workoutSheetPlatform } from './workout-sheet-environment'

let root: Root, host: HTMLDivElement
function pointer(el: HTMLElement, type: string, x = 100) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 7, pointerType: 'touch', button: 0, clientX: x, clientY: 300 })
  act(() => el.dispatchEvent(event))
}
const entry = (w: number) => ({ id: '0043', marker: w, target: { sets: 2, reps: 5 }, sets: [{ w, r: 5, done: false }, { w: w + 20, r: 5, done: false }] })
function mount(focus = false) {
  act(() => {
    useStore.getState().setUser({ id: 'A', name: 'Synthetic A' }, { adopt: true })
    const S = { ...clone(DEF), sound: false, active: { id: 'session', start: 100, cur: 0, workoutView: focus ? 'focus' : 'list', entries: [entry(40), entry(80)] } }
    useStore.getState().replaceState(S)
    root.render(<Workout />)
  })
}
function replace(kind: string) {
  act(() => {
    const next = clone(useStore.getState().S)
    if (kind === 'adoption') {
      useStore.getState().setUser({ id: 'B', name: 'Synthetic B' }, { adopt: true })
      next.active.entries = [entry(99), entry(139)]
    } else if (kind === 'set-reorder') next.active.entries[0].sets.reverse()
    else if (kind === 'duplicate-exercise-reorder') next.active.entries.reverse()
    else if (kind === 'profile') next.activeEquipId = 'profile-B'
    else if (kind === 'session') next.active.start = 200 // deliberately reuse the workout id
    useStore.getState().replaceState(next)
  })
}
function bytes() { return { saved: workoutSheetPlatform.kv.get('gym_state_v1'), published: JSON.stringify(useStore.getState().S) } }
beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
  vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(() => {
    let timer: ReturnType<typeof setTimeout>
    return { cancel() { clearTimeout(timer) }, set onfinish(fn: () => void) { timer = setTimeout(fn, 180) } } as unknown as Animation
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.useRealTimers() })
const replacements = ['adoption', 'profile', 'set-reorder', 'duplicate-exercise-reorder', 'session']
it.each(['copy', 'delete'].flatMap(side => replacements.flatMap(kind => ['before-lock', 'mid-drag', 'animation'].map(phase => [side, kind, phase]))))(
  '%s begun on A cancels on %s during %s, with real sync store saved bytes unchanged', (side, kind, phase) => {
    mount()
    const row = host.querySelector<HTMLElement>('.swrow')!, from = side === 'copy' ? 100 : 330, to = side === 'copy' ? 330 : 60
    pointer(row, 'pointerdown', from)
    if (phase !== 'before-lock') pointer(row, 'pointermove', to)
    if (phase === 'animation') pointer(row, 'pointerup', to)
    replace(kind!)
    const before = bytes()
    if (phase === 'before-lock') pointer(row, 'pointermove', to)
    if (phase !== 'animation') pointer(row, 'pointerup', to)
    act(() => vi.advanceTimersByTime(1200))
    expect(bytes()).toEqual(before)
    expect(host.querySelector('.swfront')?.getAttribute('style')).not.toContain('translateX')
  })
it.each(['load', 'reps'].flatMap(field => replacements.flatMap(kind => ['delay', 'repeating'].map(phase => [field, kind, phase]))))(
  'held %s cannot edit %s after %s begins, with real sync store saved bytes unchanged', (field, kind, phase) => {
    mount(true)
    const toast = vi.spyOn(useUI.getState(), 'toast')
    const button = host.querySelector<HTMLElement>(`button[aria-label="Increase ${field}"]`)!
    pointer(button, 'pointerdown')
    if (phase === 'repeating') act(() => vi.advanceTimersByTime(480))
    replace(kind!)
    const before = bytes()
    act(() => vi.advanceTimersByTime(2400))
    pointer(button, 'pointerup'); act(() => button.click())
    expect(bytes()).toEqual(before)
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('workout changed'))
  })
it.each(['load', 'reps'])('same-account %s hold keeps repeating and swallows its release click', field => {
  mount(true)
  const button = host.querySelector<HTMLElement>(`button[aria-label="Increase ${field}"]`)!
  pointer(button, 'pointerdown')
  act(() => vi.advanceTimersByTime(480)); act(() => vi.advanceTimersByTime(80)); act(() => vi.advanceTimersByTime(80))
  const row = useStore.getState().S.active.entries[0].sets[0]
  expect(row[field === 'load' ? 'w' : 'r']).toBeGreaterThan(field === 'load' ? 40 : 7)
  const before = bytes()
  pointer(button, 'pointerup'); act(() => button.click()); act(() => vi.advanceTimersByTime(2400))
  expect(bytes()).toEqual(before)
})
it.each(['copy', 'delete'])('same-account %s survives an unrelated UI rerender', side => {
  mount()
  const row = host.querySelector<HTMLElement>('.swrow')!, from = side === 'copy' ? 100 : 330, to = side === 'copy' ? 330 : 60
  pointer(row, 'pointerdown', from)
  act(() => root.render(<Workout callbacks={{ busy: false }} />))
  pointer(row, 'pointermove', to); pointer(row, 'pointerup', to); act(() => vi.advanceTimersByTime(800))
  expect(useStore.getState().S.active.entries[0].sets).toHaveLength(side === 'copy' ? 3 : 1)
  expect(useStore.getState().S.active.entries[1].sets).toHaveLength(2)
})

it.each(['pointerleave', 'pointercancel', 'blur'].flatMap(event => replacements.map(kind => [event, kind])))(
  'a held press abandoned by %s cannot rebind its trailing click after %s', (event, kind) => {
    mount(true)
    const button=host.querySelector<HTMLElement>('button[aria-label="Increase load"]')!
    pointer(button, 'pointerdown')
    if (event === 'pointerleave') act(() => button.dispatchEvent(new Event('pointerout', {bubbles:true})))
    else if (event === 'blur') act(() => button.dispatchEvent(new Event('focusout', {bubbles:true})))
    else pointer(button, event!)
    replace(kind!)
    const before=bytes()
    pointer(button, 'pointerup');act(()=>button.click());act(()=>vi.advanceTimersByTime(1200))
    expect(bytes()).toEqual(before)
  })
