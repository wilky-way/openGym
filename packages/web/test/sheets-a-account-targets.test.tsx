// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bwSheet, confirmSheet, goalSheet, importFromApp, importFromHevy, menuSheet, starterPlanSheet, weighInsSheet } from '../src/sheets'
import { freshState, initializeStore, useStore } from '../src/store/useStore'
import { initializeSyncEngine } from '../src/store/sync-engine'
import { useUI } from '../src/store/useUI'
import { createBrowserPlatform } from '../src/platform/browser'
import { configureClientIO } from '../src/lib/client-io'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { configureExportFileReader } from '../src/platform/export-file'

// The binding safety exception is exercised through real sync store account/persistence
// actions, with a synthetic, memory-only KV. No app data or server is accessed.
let dispose: () => void, platform: ReturnType<typeof createBrowserPlatform>
const roots: Root[] = []
function top() {
  const sheet = useUI.getState().sheets.at(-1)!, host = document.createElement('div')
  document.body.append(host); const root = createRoot(host); roots.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
function click(host: HTMLElement, text: string) {
  act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!.click())
}
async function settle(condition = () => useUI.getState().sheets.length > 0) {
  await vi.waitFor(async () => { await act(async () => {}); expect(condition()).toBe(true) }, {timeout:5000,interval:10})
}
function switchAccount() {
  act(() => {
    useStore.getState().setUser({ id: 'synthetic-b', name: 'B' })
    useStore.getState().replaceState({ ...freshState(), unit: 'lb', targetW: 190, bodyweight: [{ d: '2026-09-28', w: 185, t: 2 }] }, false)
  })
  expect(useStore.getState().user?.id).toBe('synthetic-b')
}
function snapshot() { return { state: JSON.stringify(useStore.getState().S), saved: platform.kv.get('gym_state_v1') } }
function unchanged(before: ReturnType<typeof snapshot>) {
  expect(snapshot()).toEqual(before); expect(useUI.getState().toastMsg).toContain('changed')
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  configureUx(createBrowserUx()); configureExportFileReader()
  platform = createBrowserPlatform()
  const saved = new Map<string, string>()
  platform.kv = { get: key => saved.get(key) ?? null, set: (key, value) => { saved.set(key, value) }, remove: key => { saved.delete(key) }, subscribe: () => () => {} }
  initializeStore(platform)
  configureClientIO(platform)
  dispose = initializeSyncEngine({ platform, api: vi.fn().mockResolvedValue({ ok: true, rev: 1 }), prompts: { askAddDeviceData: async () => false, toast() {} } })
  useStore.getState().setUser({ id: 'synthetic-a', name: 'A' })
  useStore.getState().replaceState({ ...freshState(), targetW: 75, bodyweight: [{ d: '2026-09-28', w: 80, t: 1 }] }, false)
  useUI.setState({ sheets: [], toastMsg: '' })
})
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount())); dispose()
  document.body.innerHTML = ''; configureExportFileReader(); vi.restoreAllMocks(); vi.useRealTimers()
})
describe('confirmations after a real account switch', () => {
  it.each(['body-weight', 'goal-save', 'goal-remove', 'starter', 'delete', 'import'])('revalidates %s inside the updater before persistence', async kind => {
    if (kind === 'body-weight') bwSheet()
    else if (kind === 'starter') starterPlanSheet()
    else if (kind === 'delete') bwSheet()
    else if (kind === 'import') {
      importFromApp(new File(['Date,Exercise,Weight,Reps\n2026-09-29,Bench Press,60,5'], 'synthetic.csv')); await settle()
    } else goalSheet()
    const host = top(), original = useStore.getState().update
    let before!: ReturnType<typeof snapshot>
    useStore.setState({ update: (mut, push) => {
      switchAccount(); before = snapshot()
      original(mut, push)
    } })
    if (kind === 'starter') act(() => host.querySelector<HTMLElement>('.item')!.click())
    else if (kind === 'delete') act(() => host.querySelector<HTMLButtonElement>('[aria-label="Delete weigh-in"]')!.click())
    else click(host, kind === 'body-weight' ? 'Save' : kind === 'goal-save' ? 'Save goal' : kind === 'goal-remove' ? 'Remove goal' : 'Import')
    expect(before).toBeDefined(); unchanged(before)
  })
  it('checks the updater draft identity even when the outer store still names A', async () => {
    importFromApp(new File(['Date,Exercise,Weight,Reps\n2026-09-29,Bench Press,60,5'], 'synthetic.csv')); await settle()
    const host = top(), before = snapshot()
    const draft: ReturnType<typeof freshState> = { ...freshState(), unit: 'lb' }
    useStore.setState({ update: mut => { mut(draft) } })
    click(host, 'Import')
    expect(draft.workouts).toEqual([]); unchanged(before)
  })
  it.each(['csv', 'xml'])('refuses the %s import preview', async extension => {
    const content = extension === 'csv' ? 'Date,Exercise,Weight,Reps\n2026-09-28,Bench Press,60,5' : '<HealthData><Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="81" startDate="2026-09-29 08:00:00 +0000"/></HealthData>'
    importFromApp(new File([content], `synthetic.${extension}`)); await settle()
    const host = top(); switchAccount(); const before = snapshot(); click(host, 'Import'); unchanged(before)
  })
  it.each(['before-confirm', 'inside-updater'])('refuses all three selected Hevy imports (%s)', async timing => {
    const exercise = { exercise_template_id: 'synthetic', title: 'Synthetic curl', sets: [{ type: 'normal', reps: 5, weight_kg: 20 }] }
    const data: Record<string, unknown> = {
      '/v1/workouts': { workouts: [{ id: 'w', title: 'Synthetic', start_time: '2026-09-29T10:00:00Z', end_time: '2026-09-29T10:20:00Z', exercises: [exercise] }], page_count: 1 },
      '/v1/routines': { routines: [{ id: 'r', title: 'Synthetic routine', exercises: [exercise] }], page_count: 1 },
      '/v1/body_measurements': { body_measurements: [{ date: '2026-09-29', weight_kg: 81 }], page_count: 1 },
    }
    platform.transport.fetch = vi.fn(async url => new Response(JSON.stringify(data[new URL(String(url)).pathname] ?? { page_count: 1 })))
    importFromHevy(); const host = top(), input = host.querySelector<HTMLInputElement>('input')!
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'synthetic-key'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    click(host, 'Fetch from Hevy'); await settle(() => [...host.querySelectorAll<HTMLButtonElement>('button')].some(button => button.textContent?.trim() === 'Import'))
    expect(host.querySelectorAll('[role="switch"]')).toHaveLength(3)
    let before!: ReturnType<typeof snapshot>
    if (timing === 'before-confirm') { switchAccount(); before = snapshot() }
    else {
      const original = useStore.getState().update
      useStore.setState({ update: (mut, push) => { switchAccount(); before = snapshot(); original(mut, push) } })
    }
    click(host, 'Import'); expect(before).toBeDefined(); unchanged(before)
  })
  it.each(['recent', 'confirmed'])('preserves B’s same-day weigh-in on a stale %s delete', mode => {
    if (mode === 'recent') bwSheet(); else weighInsSheet()
    const host = top()
    if (mode === 'confirmed') act(() => host.querySelector<HTMLButtonElement>('[aria-label="Delete weigh-in"]')!.click())
    const confirmation = mode === 'confirmed' ? top() : null
    switchAccount(); const before = snapshot()
    if (confirmation) click(confirmation, 'Delete')
    else act(() => host.querySelector<HTMLButtonElement>('[aria-label="Delete weigh-in"]')!.click())
    unchanged(before)
  })
  it.each(['body-weight', 'goal-save', 'goal-remove', 'starter'])('refuses %s under B', kind => {
    if (kind === 'body-weight') bwSheet()
    else if (kind === 'starter') starterPlanSheet()
    else goalSheet()
    const host = top(); switchAccount(); const before = snapshot()
    if (kind === 'starter') act(() => host.querySelector<HTMLElement>('.item')!.click())
    else click(host, kind === 'body-weight' ? 'Save' : kind === 'goal-save' ? 'Save goal' : 'Remove goal')
    unchanged(before)
  })
  it('refuses the starter overwrite confirmation after switching to B', () => {
    useStore.getState().update((s: any) => { s.routines = [{ id: 'synthetic-r', name: 'Existing', ex: [] }]; s.week = Array(7).fill(['synthetic-r']) }, false)
    starterPlanSheet(); const host = top()
    act(() => host.querySelector<HTMLElement>('.item')!.click())
    const confirmation = top(); switchAccount(); const before = snapshot(); click(confirmation, 'Load plan'); unchanged(before)
  })
  it.each(['confirm', 'menu'])('refuses a stale %s callback targeting a replacement editor', kind => {
    const callback = vi.fn(() => useStore.getState().update(s => { s.active = null }))
    if (kind === 'confirm') confirmSheet({ onConfirm: callback })
    else menuSheet({ items: [{ label: 'Discard editor', onClick: callback }] })
    const host = top(); switchAccount()
    useStore.getState().update((s: any) => { s.active = { id: 'synthetic-editor-b', editingWorkoutId: 'synthetic-b', start: 2, entries: [] } }, false)
    const before = snapshot()
    if (kind === 'confirm') click(host, 'Confirm')
    else act(() => host.querySelector<HTMLElement>('.menu-item')!.click())
    expect(callback).not.toHaveBeenCalled(); unchanged(before)
  })
})
