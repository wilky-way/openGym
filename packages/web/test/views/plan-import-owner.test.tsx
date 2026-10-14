// @vitest-environment happy-dom
import '../helpers/plan-views'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import Plan from '../../src/views/Plan'
import { buildPlanBundle } from '@opengym/core/plan-share'
const deferred = vi.hoisted(() => ({ read: vi.fn(), finish: undefined as undefined | ((s: string) => void) }))
vi.mock('../../src/platform/plan-history', async original => ({ ...await original<object>(), readPlanFile: deferred.read }))
let root: Root, host: HTMLElement, imported: string
function top() {
  const sheet = useUI.getState().sheets.at(-1)!, el = document.createElement('div'); host.append(el)
  const child = createRoot(el); children.push(child)
  act(() => child.render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))); return el
}
const children: Root[] = []
const snapshot = () => ({ state: JSON.stringify(useStore.getState().S), bytes: localStorage.getItem('gym_state_v1') })
function open() {
  act(() => root.render(<MemoryRouter><Plan /></MemoryRouter>))
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Plan options"]')!.click())
  const menu = top()
  act(() => [...menu.querySelectorAll<HTMLElement>('.menu-item')].find(el => el.textContent!.includes('Import a plan file'))!.click())
}
function choose() {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(input, 'files', { configurable: true, value: [new File([imported], 'synthetic-plan.json')] })
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })))
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); useUI.setState({ sheets: [], toastMsg: '' })
  const S = { ...structuredClone(DEF), routines: [{ id: 'r', name: 'Synthetic', ex: [{ id: '0025', sets: 3, reps: 5 }] }] }
  useStore.setState({ S, user: null }); imported = JSON.stringify(buildPlanBundle(S, ''))
  deferred.finish = undefined; deferred.read.mockImplementation(() => new Promise<string>(resolve => { deferred.finish = resolve }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => { children.splice(0).forEach(child => child.unmount()); root.unmount() }); host.remove() })
it('a file selected after an owner switch does not start the import', () => {
  open(); act(() => useStore.setState({ user: { id: 'B', name: 'Synthetic B' } })); const before = snapshot(); deferred.read.mockClear(); choose()
  expect(deferred.read).not.toHaveBeenCalled(); expect(snapshot()).toEqual(before)
})
it('a delayed Plan file read is dropped after its parent unmounts', async () => {
  open(); choose(); const before = snapshot(); act(() => root.render(<div />)); const sheets = useUI.getState().sheets.length
  await act(async () => { deferred.finish!(imported) })
  expect(useUI.getState().sheets).toHaveLength(sheets); expect(snapshot()).toEqual(before)
})
it('the current mounted Plan receives the import confirmation', async () => {
  open(); choose(); await act(async () => { deferred.finish!(imported) })
  expect(useUI.getState().sheets.length).toBeGreaterThan(0); expect(top().textContent).toContain('Import')
})
it('a superseding file selection invalidates the earlier pending read', async () => {
  let first!: (s: string) => void, second!: (s: string) => void
  deferred.read.mockImplementationOnce(() => new Promise<string>(resolve => { first = resolve })).mockImplementationOnce(() => new Promise<string>(resolve => { second = resolve }))
  open(); choose(); open(); choose(); const before = snapshot(), count = useUI.getState().sheets.length
  await act(async () => { first(imported) })
  expect(useUI.getState().sheets).toHaveLength(count); expect(snapshot()).toEqual(before)
  await act(async () => { second(imported) })
  expect(useUI.getState().sheets.length).toBeGreaterThan(count)
})
