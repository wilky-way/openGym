// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Measurements, { manageMeasurementsSheet, measurementLogSheet } from '../../src/views/Measurements'
import StructuralBalance from '../../src/views/StructuralBalance'
import { DEF, KEY, useStore, type StoreDocument } from '../../src/store/useStore'
import { createSyncEngine } from '../../src/store/sync-engine'
import { useUI } from '../../src/store/useUI'
import { createBrowserPlatform } from '../../src/platform/browser'
import { configureUx, createBrowserUx } from '../../src/platform/ux'
import * as services from '../../src/views/view-services'
import { bindTestViewServices } from './StructuralBalance.services'

// GM safety exception: reject stale callbacks that legacy lets mutate the new account.
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root, dispose: () => void
let saved: Map<string, string>, changed: (key: string | null) => void
let confirm: () => void, pick: (ex: any) => void
let write: ReturnType<typeof vi.fn<(key: string, value: string) => void>>, toast: ReturnType<typeof vi.spyOn>
const entry = { d: '2026-01-21', t: 1, waist: 100, other: [] }
const doc = (): StoreDocument => ({ ...structuredClone(DEF), measurements: [structuredClone(entry)], marker: 'synthetic-A' })
const button = (label: string) => [...host.querySelectorAll('button')].find(b => b.textContent === label)!
function renderSheet(open: () => unknown) {
  act(() => { open(); const sheet = useUI.getState().sheets.at(-1)!; root.render(<>{sheet.render(() => useUI.getState().closeSheet(sheet.id))}</>) })
}
function type(input: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
function adopt(id = 'B', S: StoreDocument = { ...doc(), marker: 'synthetic-B' }) {
  // Real W07 peer-tab ownership handover with same-date/timestamp collisions.
  saved.set('gym_owner', id); saved.set('gym_user', JSON.stringify({ id }))
  saved.set('gym_state_owner', id); saved.set('gym_state_wid', `${id}-saved`)
  saved.set('gym_sync', JSON.stringify({ rev: 7, ts: 200 })); saved.set(KEY, JSON.stringify(S))
  act(() => changed('gym_owner'))
  expect(useStore.getState().user?.id).toBe(id)
  expect(useStore.getState().S.marker).toBe(S.marker)
}
function unchanged(action: () => void) {
  const bytes = saved.get(KEY), S = useStore.getState().S
  write.mockClear(); toast.mockClear(); act(action)
  expect(saved.get(KEY)).toBe(bytes); expect(useStore.getState().S).toBe(S)
  expect(write).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith('This sheet is out of date. Open it again.')
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-22T12:00:00Z'))
  configureUx(createBrowserUx()); bindTestViewServices(); useUI.setState({ sheets: [] })
  saved = new Map([[KEY, JSON.stringify(doc())], ['gym_owner', 'A'], ['gym_state_owner', 'A'], ['gym_user', JSON.stringify({ id: 'A' })]])
  write = vi.fn((key: string, value: string) => { saved.set(key, value) })
  const browser = createBrowserPlatform()
  const platform = { ...browser, kv: { get: (key: string) => saved.get(key) ?? null, set: write,
    remove: (key: string) => { saved.delete(key) }, subscribe: (listener: typeof changed) => { changed = listener; return () => {} } } }
  const engine = createSyncEngine(patch => useStore.setState(patch), useStore.getState, { platform,
    api: vi.fn().mockResolvedValue({ ok: true, rev: 1 }), prompts: { askAddDeviceData: async () => false, toast() {} } })
  useStore.setState({ ...engine.actions, ready: true }); dispose = engine.dispose
  toast = vi.spyOn(useUI.getState(), 'toast')
  vi.spyOn(services, 'confirmSheet').mockImplementation(options => { confirm = options.onConfirm })
  vi.spyOn(services, 'exercisePicker').mockImplementation(callback => { pick = callback; return { close() {} } })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); dispose(); vi.restoreAllMocks(); vi.useRealTimers() })
function openDelete() {
  act(() => root.render(<Measurements />))
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="Delete"]')!.click())
}
it('delete after A → B preserves B’s same-day entry and every saved byte on W07', () => {
  openDelete(); adopt(); unchanged(confirm)
})
it('delete guards inside the updater even when handover happens after callback invocation', () => {
  openDelete(); const update = useStore.getState().update
  useStore.setState({ update(mut, push) { adopt(); write.mockClear(); update(mut, push) } })
  toast.mockClear(); act(confirm)
  expect(saved.get(KEY)).toBe(JSON.stringify({ ...doc(), marker: 'synthetic-B' }))
  expect(useStore.getState().S.measurements).toEqual([entry])
  expect(write).not.toHaveBeenCalled(); expect(toast).toHaveBeenCalledWith('This sheet is out of date. Open it again.')
})
it('same-account delete succeeds and persists without deleting other days', () => {
  useStore.getState().update(s => { s.measurements.unshift({ ...entry, d: '2026-01-20' }) })
  openDelete(); act(confirm)
  expect(JSON.parse(saved.get(KEY)!).measurements.map((e: any) => e.d)).toEqual(['2026-01-20'])
  expect(toast).toHaveBeenCalledWith('Measurements deleted')
})
it.each(['profile', 'replacement', 'round-trip'])('delete refuses a stale %s target without any persistence', mode => {
  openDelete()
  if (mode === 'profile') act(() => useStore.setState({ S: { ...useStore.getState().S, profileId: 'other-profile' } }))
  if (mode === 'replacement') act(() => useStore.getState().update(s => { s.measurements[0].waist = 101 }))
  if (mode === 'round-trip') { adopt(); adopt('A', doc()) }
  unchanged(confirm)
})
it.each([null, '2026-01-21'])('measurement save opened for %s refuses A → B', source => {
  renderSheet(() => measurementLogSheet(source)); type(host.querySelector('.measure-input input')!, '110')
  adopt(); unchanged(() => button('Save').click())
})
it('measurement edit refuses a replaced same-day row on the same account', () => {
  renderSheet(() => measurementLogSheet(entry.d)); type(host.querySelector('.measure-input input')!, '110')
  act(() => useStore.getState().update(s => { s.measurements[0].waist = 101 }))
  unchanged(() => button('Save').click())
})
it('same-account measurement edit persists the changed value', () => {
  renderSheet(() => measurementLogSheet(entry.d)); type(host.querySelector('.measure-input input')!, '110')
  act(() => button('Save').click()); expect(JSON.parse(saved.get(KEY)!).measurements[0].neck).toBe(110)
  expect(toast).toHaveBeenCalledWith('Measurements saved')
})
it.each(['Save', 'management toggle'])('%s preserves extension keys on the edited row, other dates and custom definitions', action => {
  act(() => useStore.getState().update(s => {
    s.measurements = [{ ...entry, id: 'edited', opaque: { edited: true }, other: [{ id: 'field', name: 'Synthetic length', value: 7, opaque: { nested: true } }] },
      { ...entry, d: '2026-01-20', id: 'untouched', opaque: { untouched: true }, other: [{ id: 'field', name: 'Synthetic length', value: 8, opaque: { untouchedNested: true } }] }]
    s.customMeasurements = [{ id: 'field', name: 'Synthetic length', enabled: true, opaque: { field: true } }]
  }))
  if (action === 'Save') {
    renderSheet(() => measurementLogSheet(entry.d)); type(host.querySelector('.measure-input input')!, '110')
    act(() => button('Save').click())
  } else {
    renderSheet(manageMeasurementsSheet)
    act(() => host.querySelector<HTMLButtonElement>('.measure-options button')!.click())
  }
  const S = JSON.parse(saved.get(KEY)!)
  expect(S.measurements.find((row: any) => row.id === 'edited').opaque).toEqual({ edited: true })
  expect(S.measurements.find((row: any) => row.id === 'untouched').opaque).toEqual({ untouched: true })
  expect(S.measurements.find((row: any) => row.id === 'edited').other[0].opaque).toEqual({ nested: true })
  expect(S.measurements.find((row: any) => row.id === 'untouched').other[0].opaque).toEqual({ untouchedNested: true })
  expect(S.customMeasurements[0].opaque).toEqual({ field: true })
})
it('a measurement editor captures A before its first render, even if B is adopted first', () => {
  measurementLogSheet(entry.d); adopt()
  act(() => { const sheet = useUI.getState().sheets.at(-1)!; root.render(<>{sheet.render(() => {})}</>) })
  type(host.querySelector('.measure-input input')!, '110')
  unchanged(() => button('Save').click())
})
it('management preserves nested extensions when duplicate dates fold an empty newer reading', () => {
  act(() => useStore.getState().update(s => {
    s.measurements = [
      { ...entry, other: [{ id: 'field', name: 'Synthetic length', value: 7, opaque: { retained: true } }] },
      { ...entry, t: 2, other: [{ id: 'field', name: 'Synthetic length', value: null }] },
    ]
  }))
  renderSheet(manageMeasurementsSheet)
  act(() => host.querySelector<HTMLButtonElement>('.measure-options button')!.click())
  const rows = JSON.parse(saved.get(KEY)!).measurements
  expect(rows).toHaveLength(1)
  expect(rows[0].other[0]).toEqual({ id: 'field', name: 'Synthetic length', value: 7, opaque: { retained: true } })
})
it('a new measurement cannot overwrite a date logged after the editor opened', () => {
  renderSheet(() => measurementLogSheet()); type(host.querySelector('.measure-input input')!, '110')
  act(() => useStore.getState().update(s => { s.measurements.push({ ...entry, d: '2026-01-22' }) }))
  unchanged(() => button('Save').click())
})
it('management add and toggle callbacks cannot change B after A → B', () => {
  renderSheet(manageMeasurementsSheet)
  type(host.querySelector('input[placeholder="Custom measurement"]')!, 'Synthetic length')
  adopt(); unchanged(() => button('Add').click())
  unchanged(() => host.querySelector<HTMLButtonElement>('.measure-options button')!.click())
})
it('same-account custom measurement add persists', () => {
  renderSheet(manageMeasurementsSheet); type(host.querySelector('input[placeholder="Custom measurement"]')!, 'Synthetic length')
  act(() => button('Add').click()); expect(JSON.parse(saved.get(KEY)!).customMeasurements[0].name).toBe('Synthetic length')
})
it('a management custom-field toggle refuses B’s colliding id', () => {
  useStore.getState().update(s => { s.customMeasurements = [{ id: 'collision', name: 'Synthetic length', enabled: true }] })
  renderSheet(manageMeasurementsSheet)
  adopt('B', { ...doc(), marker: 'synthetic-B', customMeasurements: [{ id: 'collision', name: 'Synthetic length', enabled: true }] })
  unchanged(() => [...host.querySelectorAll<HTMLElement>('.lrow')].find(row => row.textContent?.includes('Synthetic length'))!.querySelector<HTMLButtonElement>('button')!.click())
})
it('same-account custom-field toggle persists', () => {
  useStore.getState().update(s => { s.customMeasurements = [{ id: 'collision', name: 'Synthetic length', enabled: true }] })
  renderSheet(manageMeasurementsSheet)
  act(() => [...host.querySelectorAll<HTMLElement>('.lrow')].find(row => row.textContent?.includes('Synthetic length'))!.querySelector<HTMLButtonElement>('button')!.click())
  expect(JSON.parse(saved.get(KEY)!).customMeasurements[0].enabled).toBe(false)
})
function openPicker() {
  act(() => root.render(<StructuralBalance />)); act(() => button('Change exercise').click())
}
it('Structural Balance picker after A → B writes none of B’s document', () => {
  openPicker(); adopt(); unchanged(() => pick({ id: '0030' }))
})
it('Structural Balance picker refuses a template changed on the same account', () => {
  openPicker(); act(() => useStore.getState().update(s => { s.balanceTemplate = 'atg' }))
  unchanged(() => pick({ id: '0030' }))
})
it('Structural Balance picker refuses an override changed on the same account', () => {
  openPicker(); act(() => useStore.getState().update(s => { s.balanceOverrides['poliquin:narrowBench'] = { id: '0067', _ts: 1 } }))
  unchanged(() => pick({ id: '0030' }))
})
it('measurement Save refuses a unit changed while the editor is open', () => {
  renderSheet(() => measurementLogSheet(entry.d)); type(host.querySelector('.measure-input input')!, '110')
  act(() => useStore.getState().update(s => { s.unit = 'lb' }))
  unchanged(() => button('Save').click())
})
it('an unrelated updater failure propagates without a stale or success toast', () => {
  openDelete(); const failure = new Error('synthetic persistence failure')
  useStore.setState({ update() { throw failure } }); toast.mockClear()
  expect(confirm).toThrow(failure); expect(toast).not.toHaveBeenCalled()
})
it('same-account Structural Balance picker persists the chosen exercise', () => {
  openPicker(); act(() => pick({ id: '0030' }))
  expect(Object.values(JSON.parse(saved.get(KEY)!).balanceOverrides)).toContainEqual({ id: '0030', _ts: Date.now() })
})
