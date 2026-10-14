// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { useStore, freshState } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { createExerciseIndex } from '@opengym/core/exercises'
import { prepareExerciseSheets } from './regression-test-support'
import { barWeightSheet, exerciseDetailSheet, exerciseHistorySheet, exConfigSheet, swapActiveWorkoutExercise, customExSheet, equipmentProfileSheet, addToRoutineSheet, deleteCustomEx, exercisePicker } from '../src/sheets'
const custom = [
  { id: 'cb', n: 'Synthetic lower bar', bp: 'back', eq: 'barbell', tg: 'upper-back' },
  { id: 'cw', n: 'Synthetic belt dip', bp: 'chest', eq: 'body weight', tg: 'chest' },
  { id: 'ca', n: 'Synthetic assisted dip', bp: 'chest', eq: 'leverage machine', assisted: true, tg: 'chest' },
  { id: 'cd', n: 'Synthetic single arm bell', bp: 'back', eq: 'dumbbell', tg: 'upper-back' },
  { id: 'cc', n: 'Synthetic run', bp: 'cardio', eq: 'body weight', tg: 'cardiovascular system' },
  { id: 'cl', n: 'Synthetic lower cable', bp: 'back', eq: 'cable', tg: 'upper-back' },
  { id: 'cr', n: 'Synthetic band', bp: 'chest', eq: 'band', tg: 'chest' },
]
let roots: Root[] = []
function seed(extra: Record<string, any> = {}) {
  const S = { ...freshState(), customEx: custom, ...extra }
  act(() => useStore.setState({ S, index: createExerciseIndex(S.customEx) }))
}
function top() {
  const sheet = useUI.getState().sheets.at(-1)!, host = document.createElement('div'), root = createRoot(host)
  document.body.append(host); roots.push(root); act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))); return host
}
function click(host: HTMLElement, text: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent!.trim() === text)!
  act(() => button.click())
}
const val = (host: HTMLElement, label: string) => {
  const row = [...host.querySelectorAll<HTMLElement>('.stp-w')].find(e => e.querySelector('.stp-l')!.textContent === label)
  expect(row, `rendered ${label} field`).toBeDefined()
  return row!.querySelector<HTMLInputElement>('input')!.value
}
const log = (id: string, target: any = {}) => [{ id: 's1', d: '2026-01-10', entries: [{ id, target, sets: [{ w: 30, r: 8, done: true }, { w: 10, r: 8, done: true }] }] }]
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; seed(); useUI.setState({ sheets: [], toastMsg: '' }); prepareExerciseSheets() })
afterEach(() => { act(() => roots.splice(0).forEach(r => r.unmount())); document.body.innerHTML = ''; vi.useRealTimers() })
describe('real custom exercise index outputs', () => {
  // design safety exception to legacy sheets.jsx:1687; known fields still match legacy.
  it.each([
    ['reps', 0, { mode: 'reps', sets: 3, reps: 9, weight: 0, prog: 'off', note: 'note' }],
    ['time', 0, { mode: 'time', sets: 3, sec: 46, weight: 0, prog: 'off', note: 'note' }],
    ['cardio', 4, { sets: 3, min: 3, speed: 0, note: 'note' }],
  ])('preserves opaque existing config keys while canonicalizing %s', (mode, ordinal, canonical) => {
    const opaque = { future: { keep: true }, media: [{ opaque: 'historic' }], url: 'https://example.com/historic', customNull: null }
    const existing = { ...opaque, id: 'old-slot', sg: 'old-group', mode, sets: 2.7, reps: 8.6, sec: 45.6, min: 2.7, speed: -2, weight: -2, prog: 'off', inc: 0,
      bodyweight: false, side: false, lastToFailure: false, backoff: false, warmupSets: 0, restSec: 0, note: '  note  ',
      pyramid: [], pyramidRest: [30], pyramidWeight: [50], setsMax: 0, repsMax: 0, deloadFactor: 0.9 }
    let saved: any
    exConfigSheet(custom[ordinal]!, existing, out => { saved = out })
    click(top(), 'Save')
    expect(saved).toEqual({ ...opaque, ...canonical })
    expect(existing.future).toEqual({ keep: true })
    expect(existing.pyramidRest).toEqual([30])
  })
  it('uses the legacy centered confirmation for custom deletion', () => {
    deleteCustomEx(custom[0]!)
    expect(useUI.getState().sheets.at(-1)!.kind).toBe('center')
    const host = top()
    expect(host.textContent).toContain('Delete “Synthetic lower bar”?')
    click(host, 'Cancel')
    expect(useStore.getState().S.customEx).toHaveLength(custom.length)
  })
  it('describes custom creation without promising deleted attachments', () => {
    exercisePicker(vi.fn())
    const host = top()
    expect(host.querySelector('.ex-new .ss')!.textContent).toBe('name + body part')
    expect(host.textContent).not.toMatch(/photo or video/)
  })
  it('renders a custom bar identity, derives plate kinds, and clears implied choices', () => {
    barWeightSheet('cb'); const host = top()
    expect(host.textContent).toContain('Synthetic lower bar'); expect(val(host, 'Bar (kg)')).toBe('20')
    expect(host.querySelector('.seg-inline .on')!.textContent).toBe('Per side')
    click(host, 'Single stack'); click(host, 'Per side')
    expect(useStore.getState().S.loadKind.cb.kind).toBeNull()
    for (const cfg of [undefined, { bodyweight: true }, { bodyweight: false }]) {
      barWeightSheet('cw', cfg); const belt = top()
      expect(belt.querySelector('.seg-inline .on')!.textContent).toBe(cfg?.bodyweight === false ? 'Off' : 'Single stack')
      click(belt, 'Single stack')
      expect(useStore.getState().S.loadKind.cw.kind).toBe(cfg?.bodyweight === true ? null : 'single')
      seed()
    }
  })
  it('uses a custom assisted best load and historic set labels', () => {
    seed({ workouts: log('ca') }); exerciseDetailSheet(custom[2]!); const host = top()
    expect(host.textContent).toContain('Best: 10 kg'); expect(host.textContent).not.toContain('Estimated 1RM')
    expect(host.textContent).toContain('Edit'); expect(host.querySelector('.exfix-link')).toBeNull()
    exerciseHistorySheet('ca'); const history = top()
    expect(history.textContent).toContain('Synthetic assisted dip'); expect(history.textContent).toContain('Best: 10 kg')
    expect(history.textContent).not.toContain('Est. 1RM')
  })
  it('uses custom bodyweight labels and default flags without inventing a load', () => {
    seed({ workouts: log('cw') }); exerciseDetailSheet(custom[1]!); const host = top()
    expect(host.textContent).toContain('+30 × 8'); expect(host.textContent).toContain('Plate loading')
    let cfg: any; exConfigSheet(custom[1]!, null, out => { cfg = out }); const config = top()
    expect(config.textContent).toContain('No weight to enter. Just log the reps.')
    click(config, 'Add to routine'); expect(cfg.bodyweight).toBeUndefined(); expect(cfg.weight).toBe(0)
    exConfigSheet(custom[1]!, { bodyweight: false, reps: 8, weight: 10, sets: 2 }, out => { cfg = out }); click(top(), 'Save')
    expect(cfg.bodyweight).toBe(false)
  })
  it('shows custom single-arm bell meaning and corrected estimates/volume', () => {
    seed({ dbLoad: { cd: { mode: 'each', _ts: 1 } }, workouts: log('cd', { dbLoad: 'total' }) })
    exerciseDetailSheet(custom[3]!); const host = top()
    expect(host.textContent).toContain('The weight of the one you hold. One arm, so it counts once.')
    expect(host.textContent).toContain('From your log: 38 kg')
    exerciseHistorySheet('cd'); const history = top()
    expect(history.textContent).toContain('Volume 320 kg'); expect(history.textContent).toContain('Est. 1RM 38 kg')
    exConfigSheet(custom[3]!, { sets: 3, reps: 8, weight: 30 }, vi.fn()); const config = top()
    expect(val(config, 'Step (kg)')).toBe('5'); expect(config.textContent).toContain('Each')
  })
  it('custom cardio defaults and mode changes preserve their intended form', () => {
    exerciseDetailSheet(custom[4]!); const detail = top(); expect(detail.textContent).not.toContain('Plate loading')
    let cfg: any; exConfigSheet(custom[4]!, null, out => { cfg = out }); const cardio = top()
    expect(cardio.textContent).toContain('Speed'); click(cardio, 'Add to routine'); expect(cfg).toMatchObject({ sets: 1, min: 20, speed: 8 })
    exConfigSheet(custom[1]!, null, out => { cfg = out }); const body = top(); click(body, 'Time'); click(body, 'Reps')
    click(body, 'Add to routine'); expect(cfg.bodyweight).toBeUndefined()
    exConfigSheet(custom[2]!, { sets: 3, reps: 8, weight: 30 }, vi.fn()); const assisted = top(); expect(assisted.textContent).not.toContain('Back-off sets')
  })
  it('cardio authoring retains hidden rep metadata without applying a reps rule', () => {
    let saved: any
    exConfigSheet(custom[4]!, { sets: 1, min: 20, speed: 8, reps: 8, repsMin: 7, side: true, prog: 'double', setTargets: [{ rir: 2 }] }, out => { saved = out })
    click(top(), 'Save')
    expect(saved.repsMin).toBe(7); expect(saved.setTargets).toEqual([{ rir: 2 }])
  })
  it('custom progression fields save inherited/default values and flags', () => {
    let cfg: any; exConfigSheet(custom[0]!, null, out => { cfg = out }); const host = top()
    expect(val(host, 'Step (kg)')).toBe('5'); click(host, 'Add to routine'); expect(cfg.inc).toBeUndefined()
    exConfigSheet(custom[1]!, { sets: 3, reps: 8, weight: 0, bodyweight: true, prog: 'double' }, out => { cfg = out }); const body = top()
    expect(body.textContent).not.toContain('Deload 1RM (%)'); expect(val(body, 'Reps from')).toBe('6')
    const perSide = [...body.querySelectorAll<HTMLElement>('.lrow')].find(r => r.textContent!.includes('Per side'))!
    act(() => perSide.querySelector<HTMLButtonElement>('button')!.click()); click(body, 'Save'); expect(cfg.side).toBe(true)
  })
  it.each(['cb', 'cw', 'ca', 'cd', 'cc'])('freestyle custom swap %s uses its gear and log', id => {
    const ex = custom.find(e => e.id === id)!
    seed({ workouts: log(id, id === 'cd' ? { dbLoad: 'total' } : {}), dumbbells: { kg: { weights: [5, 10, 20], _ts: 1 } }, dbLoad: { cd: { mode: 'each', _ts: 1 } },
      active: { id: 'active', d: '2026-01-15', entries: [{ id: '0025', sets: [] }] } })
    swapActiveWorkoutExercise(0); const picker = useUI.getState().sheets.at(-1)!; const view: any = picker.render(() => useUI.getState().closeSheet(picker.id))
    act(() => view.props.onPick(ex, true))
    const entry = useStore.getState().S.active.entries[0]
    expect(entry.id).toBe(id); expect(entry.sets.length).toBeGreaterThan(0)
    if (id === 'cd') { expect(entry.target.dbLoad).toBe('each'); expect(entry.sets[0].w).toBe(30) }
    if (id === 'cw') expect(entry.sets[0].w).toBe(30)
    if (id === 'cc') expect(entry.sets[0]).toHaveProperty('min')
  })
  it('planned custom swaps retain progression and lower assistance load', () => {
    seed({ workouts: log('ca'), routines: [{ id: 'r', name: 'Synthetic', prog: 'linear', ex: [{ id: 'ca', sets: 1, reps: 8, weight: 30 }] }], active: { id: 'a', d: '2026-01-15', entries: [{ id: '0025', rid: 'r', sets: [] }] } })
    swapActiveWorkoutExercise(0); const picker = useUI.getState().sheets.at(-1)!, view: any = picker.render(() => useUI.getState().closeSheet(picker.id))
    act(() => view.props.onPick(custom[2]!, true))
    expect(useStore.getState().S.active.entries[0].plan).not.toBeNull(); expect(useStore.getState().S.active.entries[0].rid).toBe('r')
    expect(useStore.getState().S.active.entries[0]).toMatchSnapshot()
  })
  it('custom bodyweight history labels and implicit flags reach both sheet call sites', () => {
    seed({ workouts: log('cw') }); exerciseHistorySheet('cw'); const history = top()
    expect(history.textContent).toContain('+30 × 8')
    exConfigSheet(custom[1]!, { sets: 3, reps: 8, weight: 30, prog: 'linear' }, vi.fn()); const host = top()
    expect(host.textContent).not.toContain('Deload 1RM (%)'); expect(host.textContent).toContain('For dips or pull-ups with a belt.')
  })
  it('custom bands default to no plate loading in both bodyweight readings', () => {
    barWeightSheet('cr'); const host = top(); click(host, 'Off')
    expect(useStore.getState().S.loadKind.cr.kind).toBeNull()
  })
  it('custom config plate default is cleared, and assisted lookup survives a stale detail object', () => {
    barWeightSheet('cb', { reps: 8 }); const host = top(); click(host, 'Single stack'); click(host, 'Per side')
    expect(useStore.getState().S.loadKind.cb.kind).toBeNull()
    exerciseDetailSheet({ id: 'ca', n: 'Synthetic renamed lift', eq: 'leverage machine', bp: 'chest' }); const detail = top()
    expect(detail.textContent).not.toContain('Estimated 1RM')
  })
  it.each([['cb', 'reps'], ['cb', 'time'], ['cd', 'reps'], ['cl', 'reps'], ['cl', 'time']])('custom warmup and drop swap %s %s uses load grids', (id, mode) => {
    seed({ dumbbells: { kg: { weights: [6, 12, 24], _ts: 1 } }, active: { id: 'a', d: '2026-01-15', entries: [{ id: '0025', sets: [] }] } })
    swapActiveWorkoutExercise(0); const picker = useUI.getState().sheets.at(-1)!, view: any = picker.render(() => useUI.getState().closeSheet(picker.id))
    act(() => view.props.onPick(custom.find(e => e.id === id)))
    const cfgSheet = useUI.getState().sheets.at(-1)!, cfgView: any = cfgSheet.render(() => useUI.getState().closeSheet(cfgSheet.id))
    act(() => cfgView.props.onSave({ mode, sets: 1, reps: 8, sec: 30, weight: 27, warmupSets: 1, intensifier: { type: 'dropset', count: 1, pct: 20 } }))
    const rows = useStore.getState().S.active.entries[0].sets
    expect(rows).toHaveLength(2)
    expect(rows).toMatchSnapshot()
  })
  it('equipment profile create/edit validates the name and persists the selection', () => {
    equipmentProfileSheet(); const host = top(); click(host, 'Save')
    expect(useStore.getState().S.equipProfiles).toEqual([])
    const input = host.querySelector<HTMLInputElement>('input')!
    act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Synthetic home'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    click(host, 'barbell'); click(host, 'Save')
    const profile = useStore.getState().S.equipProfiles[0]
    expect(profile).toMatchObject({ name: 'Synthetic home', equipment: ['barbell'], accV: 1 }); expect(useStore.getState().S.activeEquipId).toBe(profile.id)
    equipmentProfileSheet(profile); const edit = top(); click(edit, 'dumbbell'); click(edit, 'Save')
    expect(useStore.getState().S.equipProfiles[0].equipment).toEqual(['barbell', 'dumbbell'])
  })
  it('Add to routine saves a configured custom exercise into existing and new routines', () => {
    seed({ routines: [{ id: 'r', name: 'Synthetic routine', ex: [] }] })
    addToRoutineSheet(custom[0]!); const list = top()
    act(() => [...list.querySelectorAll<HTMLElement>('.item')].find(r => r.textContent!.includes('Synthetic routine'))!.click())
    click(top(), 'Add to routine')
    expect(useStore.getState().S.routines[0].ex[0]).toMatchObject({ id: 'cb', sets: 3, reps: 10 })
    seed(); addToRoutineSheet(custom[0]!); const empty = top()
    act(() => [...empty.querySelectorAll<HTMLElement>('.item')].find(r => r.textContent!.includes('New routine'))!.click()); click(top(), 'Add to routine')
    expect(useStore.getState().S.routines).toHaveLength(1); expect(useStore.getState().S.routines[0].ex[0].id).toBe('cb')
  })
  it('custom edit preserves unknown/media/url fields, validates duplicates, and returns the new indexed row', () => {
    const ex = { ...custom[0]!, media: { future: 'opaque' }, url: 'https://example.com', future: { keep: true } }; seed({ customEx: [ex] })
    const done = vi.fn(); customExSheet(ex, done); const host = top(); click(host, 'Save')
    expect(useStore.getState().S.customEx[0]).toMatchObject(ex); expect(done.mock.calls[0]![0]).toMatchObject(ex)
    expect(host.querySelector('input[type="file"]')).toBeNull()
    equipmentProfileSheet(); const profile = top(); expect(profile.textContent).toContain('New equipment profile')
    addToRoutineSheet(ex); const routines = top(); act(() => [...routines.querySelectorAll<HTMLElement>('.item')].find(r => r.textContent!.includes('New routine'))!.click()); expect(top().textContent).toContain('Add to routine')
  })
})
