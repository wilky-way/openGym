// @vitest-environment happy-dom
// GM safety exceptions: retain completed limbs/opaque fields and reject invalid input.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createExerciseIndex } from '@opengym/core/exercises'
import { freshState, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { createSyncEngine } from '../src/store/sync-engine'
import { createBrowserPlatform } from '../src/platform/browser'
import { barWeightSheet, plateInventorySheet, dumbbellInventorySheet, exerciseDetailSheet, swapActiveWorkoutExercise } from '../src/sheets'
import { prepareExerciseSheets } from './W12-test-support'

const bar = { id: 'c-r1-bar', n: 'Synthetic bar', bp: 'back', eq: 'barbell', custom: true }
const bell = { id: 'c-r1-bell', n: 'Synthetic single arm bell', bp: 'back', eq: 'dumbbell', custom: true }
const machine = { id: 'c-r1-machine', n: 'Synthetic sled', bp: 'legs', eq: 'sled machine', custom: true }
const opaque = { future: { nested: ['opaque', null] }, media: 'historic-reference', url: 'historic-url', nullable: null }
const originalUpdate = useStore.getState().update
const roots: Root[] = []
const disposers: (() => void)[] = []
function top() {
  const sheet = useUI.getState().sheets.at(-1)!, host = document.createElement('div'), root = createRoot(host)
  document.body.append(host); roots.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
function click(host: HTMLElement, label: string) {
  act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent!.trim() === label)!.click())
}
function type(host: HTMLElement, label: string, value: string) {
  const row = [...host.querySelectorAll<HTMLElement>('.stp-w')].find(r => r.querySelector('.stp-l')?.textContent === label)!
  const input = row.querySelector<HTMLInputElement>('input')!
  act(() => {
    Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function durable() {
  const bytes = new Map([['gym_state_v1', JSON.stringify(useStore.getState().S)]])
  const writes = vi.fn((key: string, value: string) => { bytes.set(key, value) })
  const platform = { ...createBrowserPlatform(), kv: { get: (key: string) => bytes.get(key) ?? null, set: writes, remove: (key: string) => { bytes.delete(key) }, subscribe: () => () => {} } }
  const engine = createSyncEngine(useStore.setState, useStore.getState, { platform, api: vi.fn().mockResolvedValue({}), prompts: { askAddDeviceData: () => false, toast: message => useUI.getState().toast(message) } })
  disposers.push(engine.dispose); useStore.setState({ update: engine.actions.update })
  return { bytes, writes, saved: () => JSON.parse(bytes.get('gym_state_v1')!) }
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const S = { ...freshState(), customEx: [bar, bell, machine], unit: 'kg' }
  useStore.setState({ S, user: null, update: originalUpdate, index: createExerciseIndex(S.customEx) })
  useUI.setState({ sheets: [], toastMsg: '' }); prepareExerciseSheets()
})
afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose()); useStore.setState({ update: originalUpdate })
  act(() => roots.splice(0).forEach(root => root.unmount())); document.body.innerHTML = ''; vi.useRealTimers()
})

describe('W12 r1 opaque equipment records', () => {
  it.each(['kg', 'lb'])('preserves unknown plate keys through count edits and reset (%s)', unit => {
    const size = unit === 'kg' ? 20 : 45, other = unit === 'kg' ? 'lb' : 'kg'
    useStore.getState().S.unit = unit
    useStore.getState().S.plates = { [unit]: { ...opaque, [size]: 1, _ts: 5 }, [other]: { 10: 2, untouched: true } }
    const store = durable(); plateInventorySheet(); const host = top()
    type(host, `${size} ${unit}`, '3')
    expect(store.saved().plates[unit]).toEqual({ ...opaque, [size]: 3, _ts: expect.any(Number) })
    click(host, 'Back to the standard set')
    expect(store.saved().plates).toEqual({ [unit]: { ...opaque, _ts: expect.any(Number) }, [other]: { 10: 2, untouched: true } })
    // The reset's opaque-only record must still derive the standard inventory next time.
    type(host, `${size} ${unit}`, '2')
    expect(store.saved().plates[unit]).toMatchObject({ ...opaque, [size]: 2, [unit === 'kg' ? 25 : 35]: 6 })
    expect(store.saved().plates[unit]._ts).toBeGreaterThan(5)
  })
  it.each(['kg', 'lb'])('preserves unknown bell keys through fill, removal, add and clear (%s)', unit => {
    const other = unit === 'kg' ? 'lb' : 'kg'
    useStore.getState().S.unit = unit
    useStore.getState().S.dumbbells = { [unit]: { ...opaque, weights: [10], _ts: 5 }, [other]: { weights: [15], untouched: true } }
    const store = durable(); dumbbellInventorySheet(); const host = top()
    act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent!.startsWith('Fill in'))!.click())
    const weights = store.saved().dumbbells[unit].weights
    expect(weights.length).toBeGreaterThan(1)
    act(() => host.querySelector<HTMLButtonElement>('.chips button')!.click())
    expect(store.saved().dumbbells[unit]).toEqual({ ...opaque, weights: weights.slice(1), _ts: expect.any(Number) })
    const input = host.querySelector<HTMLInputElement>('input')!
    act(() => { Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')!.set!.call(input, '99'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    click(host, 'Add')
    expect(store.saved().dumbbells[unit]).toMatchObject({ ...opaque, weights: [...weights.slice(1), 99].sort((a, b) => a - b) })
    click(host, 'Clear the list')
    expect(store.saved().dumbbells).toEqual({ [unit]: { ...opaque, weights: [], _ts: expect.any(Number) }, [other]: { weights: [15], untouched: true } })
  })
  it('preserves load-kind and dumbbell-meaning extension fields even when returning to defaults', () => {
    useStore.getState().S.loadKind = { [bar.id]: { ...opaque, kind: 'pairs', _ts: 5 }, other: { untouched: true } }
    useStore.getState().S.dbLoad = { [bell.id]: { ...opaque, mode: 'each', _ts: 5 }, other: { untouched: true } }
    const store = durable(); barWeightSheet(bar.id); const host = top()
    click(host, 'Single stack')
    expect(store.saved().loadKind[bar.id]).toEqual({ ...opaque, kind: 'single', _ts: expect.any(Number) })
    click(host, 'Per side')
    expect(store.saved().loadKind).toEqual({ [bar.id]: { ...opaque, kind: null, _ts: expect.any(Number) }, other: { untouched: true } })
    exerciseDetailSheet(bell); const detail = top(); click(detail, 'Both')
    expect(store.saved().dbLoad[bell.id]).toEqual({ ...opaque, mode: 'total', _ts: expect.any(Number) })
    click(detail, 'As entered')
    expect(store.saved().dbLoad).toEqual({ [bell.id]: { ...opaque, mode: null, _ts: expect.any(Number) }, other: { untouched: true } })
  })
})

describe('W12 r1 numeric input safety', () => {
  it.each(['plates', 'bar', 'base'].flatMap(kind => ['9'.repeat(400), '10000', '9'.repeat(100), '-2', 'Infinity', 'NaN'].map(value => [kind, value])))('rejects %s paste %s without any persistence', (kind, value) => {
    const store = durable()
    if (kind === 'plates') plateInventorySheet(); else barWeightSheet(kind === 'bar' ? bar.id : machine.id)
    const host = top(), before = JSON.stringify(useStore.getState().S), saved = store.bytes.get('gym_state_v1')
    const producer = vi.fn(useStore.getState().update); useStore.setState({ update: producer })
    type(host, kind === 'plates' ? '20 kg' : kind === 'bar' ? 'Bar (kg)' : 'Base weight (kg)', value)
    expect(useUI.getState().toastMsg).toContain('from 0 to 9999')
    expect(JSON.stringify(useStore.getState().S)).toBe(before)
    expect(store.bytes.get('gym_state_v1')).toBe(saved); expect(store.writes).not.toHaveBeenCalled()
    expect(producer).not.toHaveBeenCalled()
    // A rejected paste must not prevent a subsequent valid edit.
    type(host, kind === 'plates' ? '20 kg' : kind === 'bar' ? 'Bar (kg)' : 'Base weight (kg)', '2')
    expect(kind === 'plates' ? store.saved().plates.kg[20] : store.saved().barWeights[kind === 'bar' ? bar.id : machine.id]).toBe(2)
  })
})

describe('W12 r1 partially logged unilateral swap', () => {
  it.each(['L', 'R'].flatMap(side => ['single', 'keep', 'detach'].map(disposition => [side, disposition])))('retains completed %s limb through %s confirmation and durable save', (side, disposition) => {
    const original = { id: bell.id, target: { mode: 'reps', sets: 1, reps: 8, weight: 20, side: true }, note: 'Opaque entry note', future: opaque, ...(disposition !== 'single' ? { sg: 'group-one' } : {}), sets: [{ w: 20, r: 8, done: false, sides: { L: { w: 20, r: 8, done: side === 'L' }, R: { w: 20, r: 8, done: side === 'R' } } }] }
    useStore.getState().S.active = { id: 'r1-session', start: Date.now(), d: '2026-01-15', cur: 0, entries: [structuredClone(original), ...(disposition !== 'single' ? [{ id: machine.id, sg: 'group-one', target: { sets: 1, reps: 8 }, sets: [{ done: false }] }] : [])] }
    const store = durable(), before = store.bytes.get('gym_state_v1')
    swapActiveWorkoutExercise(0)
    const picker: any = useUI.getState().sheets.at(-1)!
    act(() => picker.render(() => useUI.getState().closeSheet(picker.id)).props.onPick(bar, true))
    const confirm = top()
    expect(confirm.textContent).toContain('Logged sets stay with the original exercise')
    expect(store.bytes.get('gym_state_v1')).toBe(before); expect(store.writes).not.toHaveBeenCalled()
    click(confirm, disposition === 'single' ? 'Continue' : disposition === 'keep' ? 'Keep replacement in this group' : 'Insert after this group')
    const active = store.saved().active, inserted = disposition === 'detach' ? 2 : 1
    expect(active.entries[0]).toEqual(original)
    expect(active.entries[inserted].id).toBe(bar.id)
    expect(active.entries[inserted].sg).toBe(disposition === 'keep' ? 'group-one' : undefined)
    expect(active.cur).toBe(inserted)
    expect(useStore.getState().S.active).toEqual(active)
  })
})
