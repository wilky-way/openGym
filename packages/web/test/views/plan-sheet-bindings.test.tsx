// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { useStore, freshState, initializeStore } from '../../src/store/useStore'
import { useUI } from '../../src/store/useUI'
import { initializeSyncEngine } from '../../src/store/sync-engine'
import { configurePlanSheetBindings } from '../../src/views/plan-services'
import { workoutDetailSheet } from '../../src/sheets-plan-history'
import { configureClientIO } from '../../src/lib/client-io'
import { configureUx, createBrowserUx } from '../../src/platform/ux'
import { createBrowserPlatform } from '../../src/platform/browser'
const roots: Root[] = []
let platform: ReturnType<typeof createBrowserPlatform>, dispose: () => void
const workout = (id: string, w: number) => ({ id, d: '2026-09-27', name: id, start: 100, end: 200, entries: [{ id: '0025', sets: [{ w, r: 5, done: true }] }] })
const doc = () => ({ ...freshState(), weighIn: false, workouts: [workout('first', 20), workout('second', 90)] })
function top() {
  const sheet = useUI.getState().sheets.at(-1)!, host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push(root); act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))); return host
}
function click(host: HTMLElement, text: string) { act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!.click()) }
const snapshot = () => ({ state: JSON.stringify(useStore.getState().S), bytes: platform.kv.get('gym_state_v1') })
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  configureUx(createBrowserUx()); platform = createBrowserPlatform(); const map = new Map<string, string>()
  platform.kv = { get: key => map.get(key) ?? null, set: (key, value) => { map.set(key, value) }, remove: key => { map.delete(key) }, subscribe: () => () => {} }
  initializeStore(platform); configureClientIO(platform)
  dispose = initializeSyncEngine({ platform, api: vi.fn().mockResolvedValue({ ok: true, rev: 1 }), prompts: { askAddDeviceData: async () => false, toast() {} } })
  useStore.getState().setUser({ id: 'A' }); useStore.getState().replaceState(doc(), false)
  configurePlanSheetBindings('synthetic-version'); useUI.setState({ sheets: [], toastMsg: '' })
})
afterEach(() => { act(() => roots.splice(0).forEach(root => root.unmount())); document.body.innerHTML = ''; dispose(); vi.useRealTimers() })
it.each(['edit', 'delete', 'repeat'])('real sheet bindings target the first history id on %s', kind => {
  workoutDetailSheet(useStore.getState().S.workouts[0]); const host = top(), history = JSON.stringify(useStore.getState().S.workouts)
  click(host, kind === 'edit' ? 'Edit workout' : kind === 'delete' ? 'Delete workout' : 'Repeat today')
  if (kind === 'delete') { click(top(), 'Delete'); expect(useStore.getState().S.workouts.map((w: any) => w.id)).toEqual(['second']) }
  else if (kind === 'edit') { expect(useStore.getState().S.active.editingWorkoutId).toBe('first'); expect(JSON.stringify(useStore.getState().S.workouts)).toBe(history) }
  else { expect(useStore.getState().S.active.entries[0].sets[0].w).toBe(20); expect(JSON.stringify(useStore.getState().S.workouts)).toBe(history) }
})
it.each(['edit', 'delete', 'repeat'])('composed %s refuses B’s colliding history ids', kind => {
  workoutDetailSheet(useStore.getState().S.workouts[0]); const host = top()
  if (kind === 'delete') click(host, 'Delete workout')
  act(() => { useStore.getState().setUser({ id: 'B' }); useStore.getState().replaceState(doc(), false) })
  const before = snapshot()
  click(kind === 'delete' ? top() : host, kind === 'edit' ? 'Edit workout' : kind === 'delete' ? 'Delete' : 'Repeat today')
  expect(snapshot()).toEqual(before); expect(useStore.getState().S.active).toBeNull()
})
