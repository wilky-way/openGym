// @vitest-environment happy-dom
// Sheet target re-validation is a design safety exception to inherited legacy callbacks.
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { useStore, freshState } from '../src/store/useStore'
import { createSyncEngine } from '../src/store/sync-engine'
import { createBrowserPlatform } from '../src/platform/browser'
import { useUI } from '../src/store/useUI'
import { createExerciseIndex } from '@opengym/core/exercises'
import { prepareExerciseSheets } from './regression-test-support'
import { exConfigSheet, customExSheet, deleteCustomEx, addToRoutineSheet, equipmentProfileSheet, swapActiveWorkoutExercise, effortPickerSheet, exercisePicker, glyphPicker, exerciseDetailSheet, barWeightSheet, dumbbellInventorySheet, plateInventorySheet } from '../src/sheets'
const ex = { id: 'c-safe', n: 'Synthetic safety bar', bp: 'back', eq: 'barbell', custom: true }
const next = { id: 'c-next', n: 'Synthetic next bar', bp: 'back', eq: 'barbell', custom: true }
const entry = () => ({ id: ex.id, target: { sets: 1, reps: 8, weight: 20 }, sets: [{ w: 20, r: 8, done: true }] })
const session = (id = 'session-one', start = 100) => ({ id, start, d: '2026-01-15', routineIds: [], name: 'Synthetic', bw: null, cur: 0, entries: [entry()] })
const baseUpdate = useStore.getState().update
let roots: Root[] = []
const disposeEngines: (() => void)[] = []
function top() {
  const sheet = useUI.getState().sheets.at(-1)!, host = document.createElement('div'), root = createRoot(host)
  document.body.append(host); roots.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
function click(host: HTMLElement, label: string) {
  act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent!.trim() === label)!.click())
}
function change(fn: (s: any) => void) {
  const S = structuredClone(useStore.getState().S); fn(S)
  act(() => useStore.setState({ S, index: createExerciseIndex(S.customEx) }))
}
function aborted() { expect(useUI.getState().toastMsg).toContain('target changed') }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const S = { ...freshState(), customEx: [ex, next], routines: [{ id: 'routine-one', name: 'Synthetic routine', ex: [] }] }
  useStore.setState({ S, index: createExerciseIndex(S.customEx), user: null, update: baseUpdate })
  useUI.setState({ sheets: [], toastMsg: '' }); prepareExerciseSheets()
})
afterEach(() => { disposeEngines.splice(0).forEach(dispose => dispose()); useStore.setState({ update: baseUpdate }); act(() => roots.splice(0).forEach(root => root.unmount())); document.body.innerHTML = ''; vi.useRealTimers() })
describe('stale target safety', () => {
  it.each(['delete', 'swap', 'group-swap', 'custom', 'profile', 'add', 'bar', 'plates', 'bells', 'favourite', 'config-load', 'config-weight', 'config-nobar'].flatMap(kind => ['account', 'profile', 'draft-profile'].map(switchKind => [kind, switchKind])))('guards %s inside the actual updater after a %s switch', (kind, switchKind) => {
    if (kind === 'delete') deleteCustomEx(ex)
    else if (kind === 'swap' || kind === 'group-swap') {
      change(s => { s.active = session(); if (kind === 'group-swap') s.active.entries[0].sg = 'group-one' })
      swapActiveWorkoutExercise(0); const picker: any = useUI.getState().sheets.at(-1)!
      act(() => { const view: any = picker.render(() => useUI.getState().closeSheet(picker.id)); view.props.onPick(next, true) })
    } else if (kind === 'custom') customExSheet(ex)
    else if (kind === 'profile') {
      const profile = { id: 'p-safe', name: 'Synthetic profile', equipment: ['barbell'] }
      change(s => { s.equipProfiles = [profile] }); equipmentProfileSheet(profile)
    } else if (kind === 'add') {
      addToRoutineSheet(ex); const choice = top(); act(() => choice.querySelector<HTMLElement>('.item')!.click())
    } else if (kind === 'bar') barWeightSheet(ex.id)
    else if (kind === 'plates') plateInventorySheet()
    else if (kind === 'bells') dumbbellInventorySheet()
    else exerciseDetailSheet(ex)
    const host = top(), B = structuredClone(useStore.getState().S), publishedBytes = JSON.stringify(useStore.getState().S)
    B.savedBy = 'Synthetic account B'; if (switchKind !== 'account') B.activeEquipId = 'profile-B'
    const savedDocument = JSON.stringify(B), postProducer = vi.fn()
    const bytes = new Map([['gym_state_v1', savedDocument]])
    const writes = vi.fn((key: string, value: string) => { bytes.set(key, value) })
    const platform = { ...createBrowserPlatform(), kv: { get: (key: string) => bytes.get(key) ?? null, set: writes, remove: (key: string) => { bytes.delete(key) }, subscribe: () => () => {} } }
    const engine = createSyncEngine(useStore.setState, useStore.getState, { platform, api: vi.fn().mockResolvedValue({}), prompts: { askAddDeviceData: () => false, toast: message => useUI.getState().toast(message) } })
    disposeEngines.push(engine.dispose)
    let invoked = false
    useStore.setState({ update(mutate, push) {
      invoked = true
      // Switch at the write boundary, AFTER the action's pre-call validation passed.
      if (switchKind === 'draft-profile') {
        // A newer draft/storage copy can differ from the currently published store.
        engine.actions.update(draft => { Object.assign(draft, B); mutate(draft) }, push)
      } else {
        useStore.setState({ S: B, index: createExerciseIndex(B.customEx), ...(switchKind === 'account' ? { user: { id: 'account-B' } } : {}) })
        engine.actions.update(mutate, push)
      }
      // Sync store stamps/advances/persists after its producer. Rejection must abort before here.
      postProducer()
    } })
    if (kind === 'delete') click(host, 'Delete')
    else if (kind === 'swap') click(host, 'Continue')
    else if (kind === 'group-swap') click(host, 'Keep replacement in this group')
    else if (kind === 'custom' || kind === 'profile') click(host, 'Save')
    else if (kind === 'add') click(host, 'Add to routine')
    else if (kind === 'bar' || kind === 'config-load') click(host, 'Single stack')
    else if (kind === 'config-weight') act(() => [...host.querySelectorAll<HTMLElement>('.stp-w')].find(row => row.querySelector('.stp-l')!.textContent === 'Bar (kg)')!.querySelectorAll<HTMLButtonElement>('button')[1]!.click())
    else if (kind === 'config-nobar') act(() => host.querySelector<HTMLButtonElement>('.menu-list button[role="switch"]')!.click())
    else if (kind === 'plates') act(() => host.querySelector<HTMLButtonElement>('.stp-w button')!.click())
    else if (kind === 'bells') act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent!.startsWith('Fill in'))!.click())
    else act(() => host.querySelector<HTMLButtonElement>('.fav-btn')!.click())
    expect(invoked).toBe(true)
    expect(JSON.stringify(useStore.getState().S)).toBe(switchKind === 'draft-profile' ? publishedBytes : savedDocument)
    expect(bytes.get('gym_state_v1')).toBe(savedDocument)
    expect(writes).not.toHaveBeenCalled(); expect(postProducer).not.toHaveBeenCalled(); aborted()
  })

  it.each(['account', 'profile', 'closed-editor'])('does not create a child form from a stale %s picker', kind => {
    const picked = vi.fn(), picker = exercisePicker(picked), host = top()
    if (kind === 'account') act(() => useStore.setState({ user: { id: 'other-account' } }))
    if (kind === 'profile') change(s => { s.activeEquipId = 'other-profile' })
    if (kind === 'closed-editor') picker.close()
    const sheets = useUI.getState().sheets.length, before = structuredClone(useStore.getState().S)
    act(() => host.querySelector<HTMLElement>('.ex-new')!.click())
    expect(useUI.getState().sheets).toHaveLength(sheets)
    expect(useStore.getState().S).toEqual(before); expect(picked).not.toHaveBeenCalled(); aborted()
  })

  it.each(['detail-delete', 'detail-favourite', 'bar-load-kind', 'bell-inventory'])('rejects the %s action from the previous account', kind => {
    if (kind.startsWith('detail')) exerciseDetailSheet(ex)
    else if (kind === 'bar-load-kind') barWeightSheet(ex.id)
    else dumbbellInventorySheet()
    const host = top(); const sheetsBefore = useUI.getState().sheets.length
    act(() => useStore.setState({ user: { id: 'other-account' } }))
    const before = structuredClone(useStore.getState().S)
    if (kind === 'detail-delete') click(host, 'Delete')
    if (kind === 'detail-favourite') act(() => host.querySelector<HTMLButtonElement>('.fav-btn')!.click())
    if (kind === 'bar-load-kind') click(host, 'Single stack')
    if (kind === 'bell-inventory') act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent!.startsWith('Fill in'))!.click())
    expect(useStore.getState().S).toEqual(before); expect(useUI.getState().sheets).toHaveLength(sheetsBefore); aborted()
  })

  it.each(['delete', 'swap', 'group-swap'])('rejects %s confirmation after an account switch', kind => {
    if (kind === 'delete') deleteCustomEx(ex)
    else {
      change(s => { s.active = session(); if (kind === 'group-swap') s.active.entries[0].sg = 'group-one' })
      swapActiveWorkoutExercise(0)
      const picker: any = useUI.getState().sheets.at(-1)!
      act(() => { const view: any = picker.render(() => useUI.getState().closeSheet(picker.id)); view.props.onPick(next, true) })
    }
    const host = top()
    act(() => useStore.setState({ user: { id: 'other-account' } }))
    const before = structuredClone(useStore.getState().S)
    click(host, kind === 'delete' ? 'Delete' : kind === 'swap' ? 'Continue' : 'Keep replacement in this group')
    expect(useStore.getState().S).toEqual(before); aborted()
  })
  it.each(['delete', 'swap', 'group-swap'])('rejects %s confirmation after a profile switch', kind => {
    if (kind === 'delete') deleteCustomEx(ex)
    else {
      change(s => { s.active = session(); if (kind === 'group-swap') s.active.entries[0].sg = 'group-one' })
      swapActiveWorkoutExercise(0)
      const picker: any = useUI.getState().sheets.at(-1)!
      act(() => { const view: any = picker.render(() => useUI.getState().closeSheet(picker.id)); view.props.onPick(next, true) })
    }
    const host = top(); change(s => { s.activeEquipId = 'other-profile' })
    const before = structuredClone(useStore.getState().S)
    click(host, kind === 'delete' ? 'Delete' : kind === 'swap' ? 'Continue' : 'Insert after this group')
    expect(useStore.getState().S).toEqual(before); aborted()
  })

  it.each(['session-id', 'session-instance', 'account', 'profile', 'closed-editor'])('rejects config callbacks after %s changes', kind => {
    change(s => { s.active = session() })
    const saved = vi.fn(), deleted = vi.fn(), replaced = vi.fn()
    const sheet = exConfigSheet(ex, { sets: 3, reps: 8, weight: 20 }, saved, deleted, null, null, replaced)
    const host = top()
    if (kind === 'session-id') change(s => { s.active = session('session-two') })
    if (kind === 'session-instance') change(s => { s.active = session('session-one', 200) })
    if (kind === 'profile') change(s => { s.activeEquipId = 'other-profile' })
    if (kind === 'account') act(() => useStore.setState({ user: { id: 'other-account' } }))
    if (kind === 'closed-editor') sheet.close()
    const before = structuredClone(useStore.getState().S)
    click(host, 'Save'); click(host, 'Remove from routine'); click(host, 'Replace exercise')
    expect(saved).not.toHaveBeenCalled(); expect(deleted).not.toHaveBeenCalled(); expect(replaced).not.toHaveBeenCalled()
    expect(useStore.getState().S).toEqual(before); aborted()
  })
  it('rejects stale picker and icon callbacks', () => {
    const picked = vi.fn(), icon = vi.fn()
    const picker = exercisePicker(picked), host = top()
    picker.close()
    act(() => host.querySelector<HTMLButtonElement>('.list .item button.iconbtn')!.click())
    expect(picked).not.toHaveBeenCalled(); aborted()
    const glyph = glyphPicker(null, icon), glyphHost = top()
    glyph.close(); act(() => glyphHost.querySelector<HTMLButtonElement>('.glyph-cell')!.click())
    expect(icon).not.toHaveBeenCalled(); aborted()
  })
  it('does not add to a replaced routine after its config opens', () => {
    addToRoutineSheet(ex); const picker = top()
    act(() => picker.querySelector<HTMLElement>('.item')!.click()); const config = top()
    change(s => { s.routines = [{ id: 'routine-one', name: 'Replacement routine', ex: [] }] })
    click(config, 'Add to routine')
    expect(useStore.getState().S.routines[0].ex).toEqual([]); aborted()
  })
  it('does not rename a custom row that changed while the form was open', () => {
    customExSheet(ex); const host = top()
    change(s => { s.customEx[0].n = 'Newer author name' })
    click(host, 'Save')
    expect(useStore.getState().S.customEx[0].n).toBe('Newer author name'); aborted()
  })
  it('does not delete a custom row replaced after confirmation opened', () => {
    deleteCustomEx(ex); const host = top()
    change(s => { s.customEx[0].n = 'Newer author name' })
    click(host, 'Delete')
    expect(useStore.getState().S.customEx[0].n).toBe('Newer author name'); aborted()
  })
  it('does not overwrite an equipment profile replaced during edit', () => {
    const profile = { id: 'profile-one', name: 'Before', equipment: ['barbell'] }
    change(s => { s.equipProfiles = [profile] }); equipmentProfileSheet(profile); const host = top()
    change(s => { s.equipProfiles[0].name = 'Newer profile' })
    click(host, 'Save')
    expect(useStore.getState().S.equipProfiles[0].name).toBe('Newer profile'); aborted()
  })
  it.each(['session-id', 'session-instance', 'slot'])('does not apply a logged swap after %s changes', kind => {
    change(s => { s.active = session() }); swapActiveWorkoutExercise(0)
    const picker: any = useUI.getState().sheets.at(-1)!
    act(() => { const view: any = picker.render(() => useUI.getState().closeSheet(picker.id)); view.props.onPick(next, true) })
    const confirm = top()
    if (kind === 'session-id') change(s => { s.active = session('session-two') })
    if (kind === 'session-instance') change(s => { s.active = session('session-one', 200) })
    if (kind === 'slot') change(s => { s.active.entries.unshift({ ...entry(), id: next.id }) })
    const before = structuredClone(useStore.getState().S.active)
    click(confirm, 'Continue')
    expect(useStore.getState().S.active).toEqual(before); aborted()
  })
  it('does not commit a dismissed effort rating to a replacement session', () => {
    change(s => { s.active = session() }); const rated = vi.fn()
    effortPickerSheet('rpe', null, rated); const host = top()
    const input = host.querySelector<HTMLInputElement>('input')!
    act(() => { Object.getOwnPropertyDescriptor(input.constructor.prototype, 'value')!.set!.call(input, '8'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    change(s => { s.active = session('session-two') })
    act(() => roots.pop()!.unmount())
    expect(rated).not.toHaveBeenCalled(); aborted()
  })
})
