import './workout-sheet-environment'
// @vitest-environment happy-dom
// GM safety exception: frozen legacy callbacks can act on a replacement workout.
// These regressions use the real store, edit helpers, updater and durable Platform KV.
import React, { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore, KEY } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { workoutSheetPlatform } from './workout-sheet-environment'
import { editCompletedSession } from '@opengym/core/session-edit'
import { EXDB } from '@opengym/core/exercises'
import { setNav } from '../src/lib/nav'
import { beginWorkout, startFlow, logPastWorkoutSheet, saveWorkoutEdits, exitWorkoutEdit,
  finishWorkout, finishWorkoutSheet, workoutCompleteSheet, sessionNoteSheet, repeatWorkout, supersetSheet,
  exerciseNoteSheet, setNoteSheet, renameWorkoutSheet, addRoutineToSessionSheet } from '../src/sheets-d'

const exercise = EXDB.find(e => e.bp !== 'cardio')!.id
const saved = (id: string) => ({ id, d: '2026-10-10', start: 1, end: 2, name: id,
  entries: [{ id: exercise, sets: [{ w: 40, r: 5, done: true }] }], prs: [] })
const session = (id: string, done = true) => ({ ...saved(id), end: undefined, cur: 0, routineIds: [] as string[] })
const roots: ReturnType<typeof createRoot>[] = []
const state = () => useStore.getState().S
const durable = () => JSON.parse(workoutSheetPlatform.kv.get(KEY)!)
function install(active: any, workouts: any[] = []) {
  useStore.getState().update(s => { s.active = active; s.workouts = workouts; s.weighIn = true })
}
function top() {
  const sheet = useUI.getState().sheets.at(-1)!
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host); roots.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
function click(host: HTMLElement, text: string) {
  const el = [...host.querySelectorAll<HTMLElement>('button, .menu-item, .item')].find(b => b.textContent?.trim() === text)
  expect(el, text).toBeTruthy(); act(() => el!.click())
}
function editor(id: string, empty = false) {
  useStore.getState().discardHistoryEdit()
  useStore.getState().update(s => {
    editCompletedSession(s as any, id)
    s.active.entries[0].sets[0] = { w: 55, r: 5, done: !empty }
  })
}
// Old persisted editors can lack identity even though new persists now stamp it.
// Seed that legacy shape directly so these tests still exercise bootstrap races.
function legacyEditorIdentity() {
  delete state().active.editBase.sheetInstanceId
}
function refused(before: any, bytes?: string | null) {
  if (bytes != null) expect(workoutSheetPlatform.kv.get(KEY)).toBe(bytes)
  expect(state().active).toEqual(before)
  expect(durable().active).toEqual(before)
  expect(useUI.getState().toastMsg).toBe('The workout changed. Open this action again.')
}
afterEach(() => { act(() => roots.splice(0).forEach(r => r.unmount())); document.body.innerHTML = ''; setNav(() => {}); vi.restoreAllMocks() })

describe('sheet target safety with the real store', () => {
  it.each(['B', 'A'])('an empty A delete confirm cannot delete replacement editor %s (including reopen)', id => {
    install(null, [saved('A'), saved('B')]); editor('A', true)
    const leave = vi.fn(); saveWorkoutEdits(leave); const old = top()
    editor(id); const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    click(old, 'Delete workout'); refused(before, bytes)
    expect(state().workouts.map((w: any) => w.id)).toEqual(['A', 'B'])
    expect(durable().workouts.map((w: any) => w.id)).toEqual(['A', 'B'])
    expect(leave).not.toHaveBeenCalled()
  })

  it('a delayed weigh-in cannot overwrite a newly logged session', () => {
    install(null); startFlow([]); const old = top()
    install(session('B')); const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    click(old, 'Start without weighing in'); refused(before, bytes)
    expect(state().workouts).toEqual([])
  })

  it('direct start asks before replacing logged sets, then validates that confirm', () => {
    install(session('A')); beginWorkout([]); const old = top()
    expect(state().active.id).toBe('A'); expect(durable().active.id).toBe('A')
    install(session('B')); const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    click(old, 'Discard and start'); refused(before, bytes)
  })

  it('start replacement happens only after its own explicit confirm', () => {
    install(session('A')); beginWorkout([]); const old = top()
    expect(state().active.id).toBe('A')
    click(old, 'Discard and start')
    expect(state().active.id).not.toBe('A'); expect(durable().active.id).toBe(state().active.id)
  })

  it('logged sets added during the weigh-in require a replacement confirm', () => {
    const a = session('A'); a.entries[0]!.sets[0]!.done = false
    install(a); startFlow([]); const old = top()
    useStore.getState().update(s => { s.active.entries[0].sets[0].done = true })
    click(old, 'Start without weighing in')
    expect(state().active.id).toBe('A'); expect(top().textContent).toContain('Replace current workout?')
  })

  it.each(['Continue', 'Replace', 'Add as second workout'])('delayed backfill %s preserves a new logged active session', action => {
    install(null, [saved('old')]); logPastWorkoutSheet({ iso: '2026-10-10' }); const form = top()
    let old = form
    if (action !== 'Continue') { click(form, 'Continue'); old = top() }
    install(session('B'), [saved('old')]); const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    click(old, action); refused(before, bytes)
    expect(durable().workouts[0].id).toBe('old')
  })

  it.each(['Save changes', "Don't save"])('old exit %s cannot act on replacement editor', action => {
    install(null, [saved('A'), saved('B')]); editor('A')
    const leave = vi.fn(); exitWorkoutEdit(leave); const old = top()
    editor('B'); const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    click(old, action); refused(before, bytes)
    expect(durable().workouts[1].entries[0].sets[0].w).toBe(40)
    expect(leave).not.toHaveBeenCalled()
  })

  it('exit prompts join only within the same editor instance', () => {
    install(null, [saved('A'), saved('B')]); editor('A'); exitWorkoutEdit()
    editor('B'); exitWorkoutEdit()
    expect(useUI.getState().sheets).toHaveLength(2)
    click(top(), 'Save changes')
    expect(state().active).toBeNull(); expect(durable().workouts[1].entries[0].sets[0].w).toBe(55)
    expect(durable().workouts[1].editBase).toBeUndefined()
  })

  it.each(['empty', 'early', 'menu', 'complete', 'discard'])('old %s finish callback cannot act on replacement session', kind => {
    const a = session('A')
    if (kind === 'empty') a.entries[0]!.sets[0]!.done = false
    if (kind === 'early') a.entries[0]!.sets.push({ w: 40, r: 5, done: false })
    install(a)
    const discard = vi.fn(() => useStore.getState().discardHistoryEdit())
    if (kind === 'menu' || kind === 'discard') finishWorkoutSheet({ onDiscard: discard })
    else if (kind === 'complete') workoutCompleteSheet()
    else finishWorkout()
    const old = top()
    install(session('B')); const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    click(old, kind === 'empty' ? 'Finish anyway' : kind === 'menu' ? 'Finish and save' : kind === 'discard' ? 'Discard workout' : 'Finish workout')
    refused(before, bytes); expect(state().workouts).toEqual([]); expect(discard).not.toHaveBeenCalled()
  })

  it.each(['session', 'exercise', 'set', 'rename', 'routine'])('old %s sheet cannot edit a replacement session after rerender', kind => {
    install(session('A'))
    useStore.getState().update(s => { s.routines = [{ id: 'r', name: 'Extra', ex: [{ id: exercise, sets: 1, reps: 5 }] }] })
    if (kind === 'session') sessionNoteSheet()
    if (kind === 'exercise') exerciseNoteSheet(0)
    if (kind === 'set') setNoteSheet(0, 0)
    if (kind === 'rename') renameWorkoutSheet()
    if (kind === 'routine') addRoutineToSessionSheet()
    const old = top()
    act(() => install(session('B'))); const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    if (kind === 'routine') {
      const item = old.querySelector<HTMLElement>('.item')!; act(() => item.click())
    } else click(old, 'Save')
    refused(before, bytes); expect(durable().exNotes).toEqual({})
  })

  it('delete rechecks that the same editor is still empty', () => {
    install(null, [saved('A')]); editor('A', true); saveWorkoutEdits(); const old = top()
    act(() => useStore.getState().update(s => { s.active.entries[0].sets[0].done = true }))
    const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    click(old, 'Delete workout'); refused(before, bytes)
    expect(durable().workouts.map((w: any) => w.id)).toEqual(['A'])
  })

  it('finish opened for a live session cannot duplicate a saved editor', () => {
    install(session('A', false), [saved('B')])
    useStore.getState().update(s => { s.active.entries[0].sets[0].done = false })
    finishWorkout(); const old = top()
    useStore.getState().update(s => { s.active = null }); editor('B')
    const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    click(old, 'Finish anyway'); refused(before, bytes)
    expect(durable().workouts).toHaveLength(1)
  })

  it('the finish producer refuses an id already stored in history', () => {
    install(session('A'), [saved('A')])
    const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    finishWorkout(); refused(before, bytes)
    expect(durable().workouts).toHaveLength(1)
  })

  it.each(['exercise', 'set'])('%s notes follow the original row through reorder, with duplicate exercise ids', kind => {
    const a = session('A')
    a.entries.push({ id: exercise, sets: [{ w: 60, r: 6, done: true }] })
    a.entries[0]!.sets.push({ w: 70, r: 7, done: true })
    install(a)
    if (kind === 'exercise') exerciseNoteSheet(0); else setNoteSheet(0, 0)
    const old = top()
    act(() => {
      const el = old.querySelector('textarea')!
      Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')!.set!.call(el, 'Buffered A')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      useStore.getState().update(s => { s.active.entries.reverse(); s.active.entries[1].sets.reverse() })
    })
    click(old, 'Save')
    const a2 = durable().active
    expect(a2.entries[0].note).toBeUndefined()
    if (kind === 'exercise') expect(a2.entries[1].note).toBe('Buffered A')
    else {
      expect(a2.entries[1].sets[0].note).toBeUndefined()
      expect(a2.entries[1].sets[1].note).toBe('Buffered A')
    }
  })

  it.each(['exercise', 'set'])('a deleted %s note row cannot redirect buffered text', kind => {
    install(session('A'))
    if (kind === 'exercise') exerciseNoteSheet(0); else setNoteSheet(0, 0)
    const old = top()
    act(() => useStore.getState().update(s => {
      if (kind === 'exercise') s.active.entries[0] = saved('replacement').entries[0]
      else s.active.entries[0].sets[0] = { w: 99, r: 8, done: true }
    }))
    const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    click(old, 'Save'); refused(before, bytes)
  })

  const actions = ['delete', 'save exit', 'discard exit', 'finish empty', 'finish early', 'finish menu',
    'finish discard', 'complete', 'start', 'replace start', 'repeat', 'backfill', 'backfill replace',
    'backfill add', 'session note', 'exercise note', 'set note', 'rename', 'routine', 'superset'] as const
  function openAction(kind: typeof actions[number]) {
    install(null, [saved('A')])
    if (kind === 'delete' || kind.endsWith('exit')) {
      editor('A', kind === 'delete')
      if (kind === 'delete') saveWorkoutEdits(); else exitWorkoutEdit()
    } else if (kind.startsWith('finish') || kind === 'complete') {
      install(session('A'))
      useStore.getState().update(s => {
        if (kind === 'finish empty') s.active.entries[0].sets[0].done = false
        else s.active.entries[0].sets.push({ w: 40, r: 5, done: false })
      })
      if (kind === 'complete') workoutCompleteSheet()
      else if (kind === 'finish menu' || kind === 'finish discard') finishWorkoutSheet({ onDiscard: () => useStore.getState().update(s => { s.active = null }) })
      else finishWorkout()
    } else if (kind === 'start') startFlow([])
    else if (kind === 'replace start') { install(session('A')); beginWorkout([]) }
    else if (kind === 'repeat') repeatWorkout(saved('A'))
    else if (kind.startsWith('backfill')) {
      logPastWorkoutSheet({ iso: '2026-10-10' })
      if (kind !== 'backfill') click(top(), 'Continue')
    } else if (kind === 'superset') supersetSheet({ name: 'old' }, () => useStore.getState().update(s => { s.changed = true }))
    else {
      install(session('A'))
      useStore.getState().update(s => { s.routines = [{ id: 'r', name: 'Extra', ex: [{ id: exercise, sets: 1, reps: 5 }] }] })
      if (kind === 'session note') sessionNoteSheet()
      if (kind === 'exercise note') exerciseNoteSheet(0)
      if (kind === 'set note') setNoteSheet(0, 0)
      if (kind === 'rename') renameWorkoutSheet()
      if (kind === 'routine') addRoutineToSessionSheet()
    }
    return top()
  }
  function confirmAction(host: HTMLElement, kind: typeof actions[number]) {
    const labels: Partial<Record<typeof actions[number], string>> = {
      delete: 'Delete workout', 'save exit': 'Save changes', 'discard exit': "Don't save",
      'finish empty': 'Finish anyway', 'finish early': 'Finish workout', 'finish menu': 'Finish and save',
      'finish discard': 'Discard workout', complete: 'Finish workout', start: 'Start without weighing in',
      'replace start': 'Discard and start', repeat: 'Start without weighing in', backfill: 'Continue',
      'backfill replace': 'Replace', 'backfill add': 'Add as second workout',
    }
    if (kind === 'routine') act(() => host.querySelector<HTMLElement>('.item')!.click())
    else click(host, labels[kind] || 'Save')
  }

  it.each(actions)('%s refuses after account switch with the same workout identity and saved bytes', kind => {
    const old = openAction(kind)
    useStore.setState({ user: { id: 'new-account' } as any })
    const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    confirmAction(old, kind); refused(before, bytes)
  })

  it.each(['delete', 'save exit', 'discard exit', 'finish early', 'finish menu', 'start', 'replace start',
    'repeat', 'backfill add', 'backfill replace', 'session note', 'exercise note', 'set note', 'rename', 'routine'] as const)(
    '%s revalidates INSIDE the real updater against replacement B without stamping it', kind => {
      const old = openAction(kind)
      const realUpdate = useStore.getState().update
      let before: any; let bytes: string | null = null
      vi.spyOn(useStore.getState(), 'update').mockImplementationOnce((mut, push) => {
        // The request passed its pre-check; sync/account adoption now swaps the owner
        // immediately before the real updater clones its new document.
        useStore.setState({ user: { id: 'B-account' } as any })
        realUpdate(s => { s.marker = 'B'; s.active = session('B'); s.workouts = [saved('B')] })
        before = structuredClone(state().active); bytes = workoutSheetPlatform.kv.get(KEY)
        realUpdate(mut, push)
      })
      confirmAction(old, kind); refused(before, bytes)
      expect(durable().marker).toBe('B')
      expect(durable().workouts.map((w: any) => w.id)).toEqual(['B'])
    })

  // W14 D1 integration: identical sessions do not keep an earlier account/profile decision alive.
  it.each(['finish empty', 'finish early', 'finish menu', 'finish discard', 'save exit', 'discard exit'] as const)(
    '%s refuses a document profileId replacement', kind => {
      useStore.getState().setUser({ id: 'account-a', profileId: 'profile-a' })
      const old = openAction(kind)
      act(() => useStore.getState().update(s => { s.profileId = 'profile-b' }))
      const before = JSON.stringify(state()), bytes = workoutSheetPlatform.kv.get(KEY)
      confirmAction(old, kind)
      expect(JSON.stringify(state())).toBe(before); expect(workoutSheetPlatform.kv.get(KEY)).toBe(bytes)
      expect(useUI.getState().toastMsg).toContain('changed')
    })
  it.each(['finish menu', 'discard exit'] as const)('%s refuses a changed user profileId', kind => {
    useStore.getState().setUser({ id: 'account-a', profileId: 'profile-a' })
    const old = openAction(kind)
    act(() => useStore.getState().setUser({ id: 'account-a', profileId: 'profile-b' }))
    const before = JSON.stringify(state()), bytes = workoutSheetPlatform.kv.get(KEY)
    confirmAction(old, kind)
    expect(JSON.stringify(state())).toBe(before); expect(workoutSheetPlatform.kv.get(KEY)).toBe(bytes)
    expect(useUI.getState().toastMsg).toContain('changed')
  })
  it.each(['finish menu', 'discard exit'] as const)('%s refuses an A-to-B-to-A account transition with identical session data', kind => {
    useStore.getState().setUser({ id: 'account-a' })
    const old = openAction(kind)
    const original = structuredClone(state())
    act(() => {
      useStore.getState().setUser({ id: 'account-b' }, { adopt: true })
      useStore.getState().replaceState({ ...structuredClone(original), active: structuredClone(original.active) }, false)
      useStore.getState().setUser({ id: 'account-a' }, { adopt: true })
      useStore.getState().replaceState(original, false)
    })
    const before = JSON.stringify(state()), bytes = workoutSheetPlatform.kv.get(KEY)
    confirmAction(old, kind)
    expect(JSON.stringify(state())).toBe(before); expect(workoutSheetPlatform.kv.get(KEY)).toBe(bytes)
    expect(useUI.getState().toastMsg).toContain('changed')
  })
  it.each(['finish menu', 'discard exit'] as const)('%s rechecks profileId inside the real W07 producer without stamping replacement data', kind => {
    const old = openAction(kind), realUpdate = useStore.getState().update
    let before!: string, bytes: string | null = null
    vi.spyOn(useStore.getState(), 'update').mockImplementationOnce((mut, push) => {
      realUpdate(s => { s.profileId = 'profile-b' }); before = JSON.stringify(state()); bytes = workoutSheetPlatform.kv.get(KEY)
      realUpdate(mut, push)
    })
    confirmAction(old, kind)
    expect(before).toBeDefined(); expect(JSON.stringify(state())).toBe(before); expect(workoutSheetPlatform.kv.get(KEY)).toBe(bytes)
    expect(useUI.getState().toastMsg).toContain('changed')
  })

  it('a profile reset between open and confirm refuses even if the workout id is unchanged', () => {
    install(session('A')); finishWorkoutSheet(); const old = top()
    useStore.getState().update(s => { s.resetAt = 999 })
    const before = structuredClone(state().active); const bytes = workoutSheetPlatform.kv.get(KEY)
    click(old, 'Finish and save'); refused(before, bytes)
  })


  it.each(['exercise', 'set'])('opening an unchanged editor %s note creates no false exit decision or saved row ids', kind => {
    const original = saved('A'); Object.assign(original.entries[0]!, { target: null })
    install(null, [original])
    useStore.getState().update(s => { editCompletedSession(s as any, 'A') })
    if (kind === 'exercise') exerciseNoteSheet(0); else setNoteSheet(0, 0)
    click(top(), 'Save')
    exitWorkoutEdit()
    expect(state().active).toBeNull()
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(durable().workouts[0].entries[0].sheetInstanceId).toBeUndefined()
    expect(durable().workouts[0].entries[0].sets[0].sheetInstanceId).toBeUndefined()
  })

  it('finishing after note editing does not persist sheet row ids into history', () => {
    install(session('A')); setNoteSheet(0, 0); click(top(), 'Save'); finishWorkout()
    expect(state().active).toBeNull()
    expect(durable().workouts[0].entries[0].sheetInstanceId).toBeUndefined()
    expect(durable().workouts[0].entries[0].sets[0].sheetInstanceId).toBeUndefined()
  })

  it('a quota-refused explicit replacement keeps the logged session durable and the new one in memory', async () => {
    install(session('A')); beginWorkout([]); const old = top()
    const bytes = workoutSheetPlatform.kv.get(KEY)
    const originalSet = workoutSheetPlatform.kv.set.bind(workoutSheetPlatform.kv)
    vi.spyOn(workoutSheetPlatform.kv, 'set').mockImplementation((key, value) => {
      if (key === KEY) throw new Error('quota')
      originalSet(key, value)
    })
    click(old, 'Discard and start')
    await act(async () => { await Promise.resolve() })
    expect(workoutSheetPlatform.kv.get(KEY)).toBe(bytes)
    expect(durable().active.id).toBe('A')
    expect(durable().active.entries[0].sets[0].done).toBe(true)
    expect(state().active.id).not.toBe('A')
    expect(useUI.getState().toastMsg).toMatch(/storage/)
  })

  it('an unconfirmed start refuses if sets are logged just before the producer', () => {
    const a = session('A'); a.entries[0]!.sets[0]!.done = false
    install(a); startFlow([]); const old = top()
    const realUpdate = useStore.getState().update
    let before: any; let bytes: string | null = null
    vi.spyOn(useStore.getState(), 'update').mockImplementationOnce((mut, push) => {
      realUpdate(s => { s.active.entries[0].sets[0].done = true })
      before = structuredClone(state().active); bytes = workoutSheetPlatform.kv.get(KEY)
      realUpdate(mut, push)
    })
    click(old, 'Start without weighing in'); refused(before, bytes)
  })


  it.each(['delete', 'save exit', 'exercise note', 'set note'] as const)('%s identity bootstrap cannot stamp or bind replacement B', kind => {
    install(null, [saved('A'), saved('B')]); editor('A', kind === 'delete'); legacyEditorIdentity()
    const realUpdate = useStore.getState().update
    let before: any; let bytes: string | null = null
    vi.spyOn(useStore.getState(), 'update').mockImplementationOnce((mut, push) => {
      realUpdate(s => { s.active = null; editCompletedSession(s as any, 'B') })
      before = structuredClone(state().active); bytes = workoutSheetPlatform.kv.get(KEY)
      realUpdate(mut, push)
    })
    if (kind === 'delete') saveWorkoutEdits()
    if (kind === 'save exit') exitWorkoutEdit()
    if (kind === 'exercise note') exerciseNoteSheet(0)
    if (kind === 'set note') setNoteSheet(0, 0)
    refused(before, bytes); expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('editor bootstrap refuses a reopened instance of the same saved id', () => {
    install(null, [saved('A')]); editor('A', true); legacyEditorIdentity()
    const realUpdate = useStore.getState().update
    let before: any; let bytes: string | null = null
    vi.spyOn(useStore.getState(), 'update').mockImplementationOnce((mut, push) => {
      realUpdate(s => { s.active = null; editCompletedSession(s as any, 'A') })
      before = structuredClone(state().active); bytes = workoutSheetPlatform.kv.get(KEY)
      realUpdate(mut, push)
    })
    saveWorkoutEdits(); refused(before, bytes); expect(useUI.getState().sheets).toHaveLength(0)
  })

  it.each(['exercise', 'set'])('%s row identity bootstrap cannot stamp replacement B', kind => {
    install(session('A'))
    const realUpdate = useStore.getState().update
    let before: any; let bytes: string | null = null
    vi.spyOn(useStore.getState(), 'update').mockImplementationOnce((mut, push) => {
      realUpdate(s => { s.active = session('B') })
      before = structuredClone(state().active); bytes = workoutSheetPlatform.kv.get(KEY)
      realUpdate(mut, push)
    })
    if (kind === 'exercise') exerciseNoteSheet(0); else setNoteSheet(0, 0)
    refused(before, bytes); expect(useUI.getState().sheets).toHaveLength(0)
  })

  it.each(['exercise', 'set'])('%s note identity preserves preexisting unknown row keys through editor save', kind => {
    const original = saved('A')
    Object.assign(original.entries[0]!, { target: null, sheetInstanceId: 'unknown-entry-key', extraEntry: { a: 1 } })
    Object.assign(original.entries[0]!.sets[0]!, { sheetInstanceId: { unknownSet: 2 }, extraSet: 'keep' })
    install(null, [original])
    useStore.getState().update(s => { editCompletedSession(s as any, 'A'); s.active.entries[0].sets[0].w = 55 })
    if (kind === 'exercise') exerciseNoteSheet(0); else setNoteSheet(0, 0)
    click(top(), 'Save'); act(() => saveWorkoutEdits())
    const stored = durable().workouts[0].entries[0]
    expect(stored.sheetInstanceId).toBe('unknown-entry-key')
    expect(stored.extraEntry).toEqual({ a: 1 })
    expect(stored.sets[0].sheetInstanceId).toEqual({ unknownSet: 2 })
    expect(stored.sets[0].extraSet).toBe('keep')
    expect(stored.sets[0].w).toBe(55)
  })

  it('finish builds from the current guarded producer so newly logged work is saved', () => {
    install(session('A')); finishWorkoutSheet(); const old = top()
    const realUpdate = useStore.getState().update
    vi.spyOn(useStore.getState(), 'update').mockImplementationOnce((mut, push) => {
      realUpdate(s => { s.active.entries[0].sets[0].w = 99 })
      realUpdate(mut, push)
    })
    click(old, 'Finish and save')
    expect(durable().workouts[0].entries[0].sets[0].w).toBe(99)
    expect(state().active).toBeNull()
  })


  it.each(['none', 'set'] as const)('finish preserves pre-existing unknown set identity with %s note setup', kind => {
    const a = session('A')
    Object.assign(a.entries[0]!.sets[0]!, { sheetInstanceId: 'external-row-metadata', otherUnknown: { keep: true } })
    install(a)
    if (kind === 'set') { setNoteSheet(0, 0); click(top(), 'Save') }
    act(() => finishWorkout())
    expect(durable().workouts[0].entries[0].sets[0].sheetInstanceId).toBe('external-row-metadata')
    expect(durable().workouts[0].entries[0].sets[0].otherUnknown).toEqual({ keep: true })
  })

})

it('edit-save propagates an unrelated updater error and preserves the saved document', () => {
 install(null, [saved('A')]); editor('A'); exitWorkoutEdit(() => {})
 const bytes = workoutSheetPlatform.kv.get(KEY), failure = new Error('synthetic storage failure')
 const update = useStore.getState().update
 useStore.setState({update: () => {throw failure}})
 try {expect(() => saveWorkoutEdits()).toThrow(failure); expect(workoutSheetPlatform.kv.get(KEY)).toBe(bytes)}
 finally {useStore.setState({update})}
})
