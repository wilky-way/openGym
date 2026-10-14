// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it } from 'vitest'
import Measurements, { measurementLogSheet, manageMeasurementsSheet } from '../../src/views/Measurements'
import { DEF, useStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import { bindTestViewServices } from './StructuralBalance.services'
import { configureUx, createBrowserUx } from '../../src/platform/ux'
import { vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-22T12:00:00Z'))
  configureUx(createBrowserUx()); bindTestViewServices()
  useStore.setState({ S: structuredClone(DEF), user: null }); useUI.setState({ sheets: [] })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers() })
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!
function sheet(open: () => unknown) {
  act(() => { open(); const s = useUI.getState().sheets.at(-1)!; root.render(<>{s.render(() => useUI.getState().closeSheet(s.id))}</>) })
}
function type(input: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
it('renders empty tracking and historical fields disabled after logging', () => {
  act(() => root.render(<Measurements />)); expect(host.textContent).toContain('No measurements yet')
  act(() => useStore.getState().update(s => { s.measurementEnabled = []; s.measurements = [{ d: '2026-01-21', t: 1, waist: 100 }] }))
  expect(host.textContent).toContain('100 cm'); expect(host.textContent).toContain('Waist')
})
it('edits a populated disabled measurement, keeping measured values and normalizing the list', () => {
  useStore.getState().update(s => { s.measurementEnabled = []; s.measurements = [{ d: '2026-01-21', t: 1, waist: 100, other: [], opaque: { v: 7 } }] })
  sheet(() => measurementLogSheet('2026-01-21'))
  expect(host.textContent).toContain('Waist'); type(host.querySelector('.measure-input input')!, '101.5')
  act(() => button('Save').click()); const entry = useStore.getState().S.measurements[0]
  expect(entry.waist).toBe(101.5); expect(entry.opaque).toEqual({ v: 7 }); expect(entry.t).toBe(Date.now()); expect(useUI.getState().sheets).toHaveLength(0)
})
it('rejects duplicate dates, empty logs and invalid body-fat values', () => {
  useStore.getState().update(s => { s.measurementEnabled = ['bodyFat']; s.measurements = [{ d: '2026-01-22', t: 1, bodyFat: 20 }] })
  sheet(() => measurementLogSheet()); act(() => button('Save').click()); expect(useStore.getState().S.measurements).toHaveLength(1)
  useStore.getState().update(s => { s.measurements = [] }); sheet(() => measurementLogSheet())
  act(() => button('Save').click()); expect(useStore.getState().S.measurements).toHaveLength(0)
  type(host.querySelector('.measure-input input')!, '101'); act(() => button('Save').click()); expect(useStore.getState().S.measurements).toHaveLength(0)
})
it('stores lengths in cm when logging in inches and retains one entry per day', () => {
  useStore.getState().update(s => { s.unit = 'lb'; s.measurementEnabled = ['waist'] })
  sheet(() => measurementLogSheet()); type(host.querySelector('.measure-input input')!, '40')
  act(() => button('Save').click()); expect(useStore.getState().S.measurements[0].waist).toBe(101.6)
})
it('adds a custom field once and rejects a duplicate built-in name', () => {
  sheet(manageMeasurementsSheet); const input = host.querySelector('input[placeholder="Custom measurement"]') as HTMLInputElement
  type(input, 'Neck'); act(() => button('Add').click()); expect(useStore.getState().S.customMeasurements).toHaveLength(0)
  type(input, 'My length'); act(() => button('Add').click()); expect(useStore.getState().S.customMeasurements).toHaveLength(1)
  type(input, 'my length'); act(() => button('Add').click()); expect(useStore.getState().S.customMeasurements).toHaveLength(1)
})
