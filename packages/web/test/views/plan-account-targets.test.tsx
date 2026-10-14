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
import { activate } from '@opengym/core/programme'
import Plan, { deleteRoutineWithUndo } from '../../src/views/Plan'
import RoutineEdit, { removeRoutineExercise } from '../../src/views/RoutineEdit'
const sheets = vi.hoisted(() => ({ confirmSheet: vi.fn(), menuSheet: vi.fn(), exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), supersetSheet: vi.fn(), starterPlanSheet: vi.fn(), dayAssignSheet: vi.fn(), planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn() }))
vi.mock('../../src/sheets', () => sheets)
vi.mock('../../src/components/BodyMap', () => ({ default: () => null }))
let platform: ReturnType<typeof createBrowserPlatform>, dispose: () => void, root: Root, host: HTMLDivElement
const slot = { id: '0025', sets: 3, reps: 5, weight: 60, opaque: { newer: true }, sg: 'g' }
const routine = () => ({ id: 'r', name: 'Synthetic', emoji: 'dumbbell', ex: [structuredClone(slot), { id: '0027', sets: 3, reps: 5, weight: 40, sg: 'g' }] })
const doc = () => ({ ...freshState(), routines: [routine()], rotation: { id: 'rot', sequence: ['r'], label: '' }, scheduleMode: 'rotation', queue: { ids: ['r'], since: 1, startsOn: '2026-09-28', rotationId: 'rot' } })
function replace(account: string) {
  act(() => { useStore.getState().setUser({ id: account, name: account }); useStore.getState().replaceState(doc(), false) })
}
const snapshot = () => ({ state: JSON.stringify(useStore.getState().S), bytes: platform.kv.get('gym_state_v1') })
function click(text: string) { act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!.click()) }
function mount(plan = false) {
  act(() => root.render(<MemoryRouter initialEntries={[plan ? '/plan' : '/plan/r/r']}><Routes><Route path='/plan' element={<Plan />} /><Route path='/plan/r/:id' element={<RoutineEdit />} /></Routes></MemoryRouter>))
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  configureUx(createBrowserUx()); platform = createBrowserPlatform(); platform.nav.reload = vi.fn(); const map = new Map<string, string>()
  platform.kv = { get: key => map.get(key) ?? null, set: (key, value) => { map.set(key, value) }, remove: key => { map.delete(key) }, subscribe: () => () => {} }
  initializeStore(platform); configureClientIO(platform)
  dispose = initializeSyncEngine({ platform, api: vi.fn().mockResolvedValue({ ok: true, rev: 1 }), prompts: { askAddDeviceData: async () => false, toast: message => useUI.getState().toast(message) } })
  replace('A'); useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  Object.values(sheets).forEach(fn => { if ('mockReset' in fn) fn.mockReset() })
  sheets.exercisePicker.mockReturnValue({ close: vi.fn() })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); dispose(); vi.useRealTimers(); vi.restoreAllMocks() })
function action(kind: string): () => void {
  if (kind === 'rotation' || kind === 'adopt') {
    if (kind === 'adopt') act(() => useStore.getState().replaceState({ ...doc(), queue: { ids: ['r'], since: 1, startsOn: '2026-09-28' } }, false))
    mount(true); click(kind === 'rotation' ? 'Fixed Week' : 'Use this rotation')
    return sheets.confirmSheet.mock.calls.at(-1)![0].onConfirm
  }
  if (kind === 'undo-routine' || kind === 'undo-exercise') {
    act(() => { if (kind === 'undo-routine') deleteRoutineWithUndo('r'); else removeRoutineExercise('r', 0) })
    return useUI.getState().toastAction!.run
  }
  if (kind === 'scope') {
    const S = doc()
    activate(S, { id: 'p', name: 'Synthetic', weeks: [1, 2].map(index => ({ index, days: [{ key: 'd', sessions: [{ routineSnapshot: routine() }] }] })) }, { cycleId: 'c' })
    const id = S.routines.find((r: any) => r.programme)!.id
    act(() => useStore.getState().replaceState(S, false))
    act(() => root.render(<MemoryRouter initialEntries={['/plan/r/' + id]}><Routes><Route path='/plan/r/:id' element={<RoutineEdit />} /></Routes></MemoryRouter>))
  } else mount()
  if (kind === 'delete') { click('Delete routine'); return sheets.confirmSheet.mock.calls.at(-1)![0].onConfirm }
  if (kind === 'glyph') { act(() => host.querySelector<HTMLButtonElement>('[aria-label="Pick an icon"]')!.click()); return () => sheets.glyphPicker.mock.calls.at(-1)![1]('fire') }
  if (kind === 'add') { click('Add exercise'); return () => sheets.exercisePicker.mock.calls.at(-1)![0]({ id: '0025' }, true) }
  if (kind === 'superset') { act(() => host.querySelector<HTMLButtonElement>('.ss-label-btn')!.click()); return () => sheets.supersetSheet.mock.calls.at(-1)![1]({ name: 'Pairs', rest: 75 }) }
  act(() => host.querySelector<HTMLElement>('[data-routine-row] .item')!.click())
  if (kind === 'remove') return sheets.exConfigSheet.mock.calls.at(-1)![3]
  if (kind === 'replace') { act(() => sheets.exConfigSheet.mock.calls.at(-1)![6]()); return () => sheets.exercisePicker.mock.calls.at(-1)![0]({ id: '0289' }, true) }
  if (kind === 'scope') {
    act(() => sheets.exConfigSheet.mock.calls.at(-1)![2]({ sets: 4, reps: 8, weight: 80 }))
    return sheets.menuSheet.mock.calls.at(-1)![0].items[1].onClick
  }
  return () => sheets.exConfigSheet.mock.calls.at(-1)![2]({ sets: 4, reps: 8, weight: 80 })
}
const kinds = ['delete', 'glyph', 'config', 'add', 'remove', 'replace', 'superset', 'scope', 'rotation', 'adopt', 'undo-routine', 'undo-exercise']
it.each(kinds)('real sync store refuses %s when A changes to B inside the updater, byte-identically', kind => {
  const run = action(kind), original = useStore.getState().update
  let before!: ReturnType<typeof snapshot>
  useStore.setState({ update: (mut, push) => { replace('B'); before = snapshot(); original(mut, push) } })
  act(run)
  expect(before).toBeDefined(); expect(snapshot()).toEqual(before); expect(useUI.getState().toastMsg).toContain('changed')
})
it.each(kinds)('real sync store permits same-account %s', kind => {
  const run = action(kind), before = snapshot(); act(run)
  expect(snapshot().state).not.toBe(before.state); expect(snapshot().bytes).not.toBe(before.bytes)
})
it.each(['config', 'glyph', 'add', 'replace', 'scope'])('a stale %s callback cannot write after parent editor unmount', kind => {
  const run = action(kind), before = snapshot(); act(() => root.render(<div />)); act(run)
  expect(snapshot()).toEqual(before); expect(useUI.getState().toastMsg).toContain('changed')
})
it('unknown slot keys survive Save while known cleared fields stay cleared', () => {
  const run = action('config'); act(run)
  const saved = useStore.getState().S.routines[0].ex[0]
  expect(saved.opaque).toEqual(slot.opaque); expect(saved).toMatchObject({ sets: 4, reps: 8, weight: 80 }); expect(saved.prog).toBeUndefined()
})
it('an A → B → A transition invalidates the earlier editor callback', () => {
  const run = action('config'); replace('B'); replace('A'); const before = snapshot(); act(run)
  expect(snapshot()).toEqual(before); expect(useUI.getState().toastMsg).toContain('changed')
})
it.each(['profile', 'routine', 'session'])('real sync store refuses a changed %s inside the producer', kind => {
  const run = action('config'), original = useStore.getState().update
  let before!: ReturnType<typeof snapshot>
  useStore.setState({ update: (mut, push) => {
    const next: any = doc()
    if (kind === 'profile') next.activeEquipId = 'another-profile'
    else if (kind === 'routine') next.routines[0]!.ex[0]!.id = '0027'
    else next.active = { id: 'new-session', start: 1, entries: [] }
    act(() => useStore.getState().replaceState(next, false)); before = snapshot(); original(mut, push)
  } })
  act(run); expect(snapshot()).toEqual(before); expect(useUI.getState().toastMsg).toContain('changed')
})
it('checks the producer draft even when the outer owner still names A', () => {
  const run = action('config'), before = snapshot(), draft = { ...doc(), unit: 'lb' }
  const draftBefore = JSON.stringify(draft)
  useStore.setState({ update: mut => { mut(draft) } }); act(run)
  expect(JSON.stringify(draft)).toBe(draftBefore); expect(snapshot()).toEqual(before)
})
it('a newer durable tab owner refuses the callback before sync store joins it', () => {
  const run = action('config')
  platform.kv.set('gym_owner', 'B'); platform.kv.set('gym_user', JSON.stringify({ id: 'B' })); platform.kv.set('gym_state_owner', 'B'); platform.kv.set('gym_state_v1', JSON.stringify(doc()))
  const before = snapshot(); act(run)
  expect(snapshot()).toEqual(before); expect(platform.kv.get('gym_owner')).toBe('B')
})
it('a newer same-account durable routine refuses an old editor callback', () => {
  const run = action('config'), next = doc(); next.routines[0]!.ex[0]!.id = '0027'
  platform.kv.set('gym_state_v1', JSON.stringify(next)); const before = snapshot(); act(run)
  expect(snapshot()).toEqual(before); expect(useUI.getState().toastMsg).toContain('changed')
})
it('same-account session renewal allows the original editor callback', () => {
  const run = action('config'); act(() => useStore.getState().setUser({ id: 'A', name: 'Renewed A' })); const before = snapshot(); act(run)
  expect(snapshot().state).not.toBe(before.state); expect(snapshot().bytes).not.toBe(before.bytes)
})

// Deliberate document replacements receive a concrete ephemeral identity.
it.each(['undo-routine', 'undo-exercise'])('document replacement refuses stale %s against the real sync store seam', kind => {
  const run = action(kind), next = structuredClone(useStore.getState().S)
  if (kind === 'undo-exercise') next.routines[0]!.ex = [{...structuredClone(slot),weight:99}]
  else next.routines = [{id:'replacement',name:'Replacement plan',ex:[]}]
  const instance = useStore.getState().documentInstance
  act(() => useStore.getState().replaceState(next,false))
  expect(useStore.getState().documentInstance).toBe(instance! + 1)
  const before = snapshot(), write = vi.spyOn(platform.kv,'set')
  act(run)
  expect(snapshot()).toEqual(before); expect(write).not.toHaveBeenCalled()
  expect(useUI.getState().toastMsg).toContain('changed')
})
it.each(['undo-routine', 'undo-exercise'])('identical document replacement also refuses stale %s', kind => {
  const run = action(kind), next = structuredClone(useStore.getState().S)
  act(() => useStore.getState().replaceState(next,false))
  const before = snapshot(), write = vi.spyOn(platform.kv,'set')
  act(run)
  expect(snapshot()).toEqual(before); expect(write).not.toHaveBeenCalled()
  expect(useUI.getState().toastMsg).toContain('changed')
})
it.each(['undo-routine', 'undo-exercise'])('ordinary local edits preserve valid %s and opaque fields', kind => {
  const run = action(kind), instance = useStore.getState().documentInstance
  act(() => useStore.getState().update(S => {
    S.routines.push({id:'local',name:'Local addition',ex:[],localExtension:'keep'})
  },false))
  expect(useStore.getState().documentInstance).toBe(instance)
  const before = snapshot(); act(run)
  expect(snapshot().state).not.toBe(before.state); expect(snapshot().bytes).not.toBe(before.bytes)
  const restored = useStore.getState().S.routines.find((r:any)=>r.id==='r')
  expect(restored.ex[0]).toEqual(slot)
  expect(useStore.getState().S.routines.find((r:any)=>r.id==='local')).toMatchObject({name:'Local addition',localExtension:'keep'})
})
