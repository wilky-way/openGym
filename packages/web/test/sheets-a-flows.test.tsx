// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { askAddDeviceData, bwSheet, bwDeltaColor, confirmSheet, goalSheet, importFromApp, importFromHevy, loadStarterPlan, menuSheet } from '../src/sheets'
import { freshState, useStore } from '../src/store/useStore'
import { useUI } from '../src/store/useUI'
import { createExerciseIndex } from '../../core/src/exercises'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { configureExportFileReader } from '../src/platform/export-file'
import * as hevy from '../src/lib/import-hevy'
import { configureClientIO } from '../src/lib/client-io'
import { createBrowserPlatform } from '../src/platform/browser'
import { setNav, setNavReaders } from '../src/lib/nav'

const roots: Root[] = []
const baseUpdate = useStore.getState().update
function top() {
  const sheet = useUI.getState().sheets.at(-1)!
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); roots.push(root)
  act(() => root.render(sheet.render(sheetClose)))
  function sheetClose() { useUI.getState().closeSheet(sheet.id) }
  return host
}
function button(host: HTMLElement, text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === text)!
}
function click(host: HTMLElement, text: string) { act(() => button(host, text).click()) }
function type(input: HTMLInputElement, value: string) {
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
async function settle(condition: () => boolean) {
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(condition()).toBe(true)
  }, { timeout: 5000, interval: 10 })
}
async function csv(text: string, onDone?: () => void) {
  const count = useUI.getState().sheets.length
  act(() => useUI.setState({ toastMsg: '' }))
  importFromApp(new File([text], 'synthetic.csv'), onDone)
  await settle(() => useUI.getState().sheets.length > count || !!useUI.getState().toastMsg)
}
const own = { id: 'cSynthetic', n: 'synthetic bench press', eq: 'clubbell', bp: 'chest', tg: 'pectorals', sm: ['triceps'], custom: true }
function install(customEx: any[] = [], extra: any = {}) {
  useStore.setState({ S: { ...freshState(), customEx, ...extra }, index: createExerciseIndex(customEx), user: null })
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  configureUx(createBrowserUx()); configureExportFileReader()
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  useStore.setState({ update: baseUpdate })
  useUI.setState({ sheets: [], toastMsg: '' }); install()
})
afterEach(() => {
  act(() => roots.splice(0).forEach(root => root.unmount()))
  document.body.innerHTML = ''; useUI.getState().closeAll(); configureExportFileReader(); vi.restoreAllMocks(); vi.useRealTimers()
})

describe('sheet dialogs and required weigh-in', () => {
  it.each(['Confirm', 'Cancel'])('refuses stale generic %s callbacks, including the same workout id with a new instance', (action) => {
    install([], { active: { id: 'synthetic-workout', start: 1, entries: [] } })
    const confirm = vi.fn(), cancel = vi.fn()
    confirmSheet({ onConfirm: confirm, onCancel: cancel }); const host = top()
    act(() => useStore.setState({ S: { ...useStore.getState().S, active: { ...useStore.getState().S.active, start: 2 } } }))
    click(host, action)
    expect(confirm).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled()
    expect(useUI.getState().toastMsg).toContain('changed')
  })
  it('settles a stale adoption question without applying either account decision', async () => {
    const answer = askAddDeviceData({ workouts: 1 }), host = top()
    act(() => useStore.setState({ user: { id: 'synthetic-other' } }))
    click(host, 'Add them')
    await expect(answer).resolves.toBe(false); expect(useUI.getState().toastMsg).toContain('changed')
  })
  it.each(['Save & start workout', 'Start without weighing in'])('refuses a stale required weigh-in %s action', (action) => {
    const done = vi.fn(); bwSheet({ required: true, onDone: done }); const host = top()
    act(() => useStore.setState({ S: { ...useStore.getState().S, active: { id: 'synthetic-new', start: 2, entries: [] } } }))
    const write = vi.spyOn(useStore.getState(), 'update'); click(host, action)
    expect(write).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled(); expect(useStore.getState().S.bodyweight).toEqual([])
    expect(useUI.getState().toastMsg).toContain('changed')
  })
  it('refuses a stale goal save after changing profile units', () => {
    goalSheet(); const host = top()
    act(() => useStore.setState({ S: { ...useStore.getState().S, unit: 'lb' } }))
    const write = vi.spyOn(useStore.getState(), 'update'); click(host, 'Save goal')
    expect(write).not.toHaveBeenCalled(); expect(useStore.getState().S.targetW).toBeNull(); expect(useUI.getState().toastMsg).toContain('changed')
  })
  it('closes the centered locked question before its callback and resolves both adoption choices', async () => {
    const seen = vi.fn(() => expect(useUI.getState().sheets).toEqual([]))
    confirmSheet({ title: 'Synthetic question', locked: true, onConfirm: seen })
    expect(useUI.getState().sheets[0]).toMatchObject({ kind: 'center', locked: true })
    click(top(), 'Confirm'); expect(seen).toHaveBeenCalledOnce()
    const add = askAddDeviceData({ workouts: 1, bodyweight: 1 })
    expect(top().textContent).toContain('1 workout and 1 weigh-in')
    click(top(), 'Add them'); await expect(add).resolves.toBe(true)
    const keep = askAddDeviceData({ routines: 1 })
    expect(top().textContent).toContain('1 routine was made')
    click(top(), 'Keep profile as is'); await expect(keep).resolves.toBe(false)
  })
  it('leaves disabled menu actions inert and closes a live row before acting', () => {
    const disabled = vi.fn(), live = vi.fn(() => expect(useUI.getState().sheets).toEqual([]))
    menuSheet({ items: [{ label: 'Disabled', disabled: true, onClick: disabled }, { label: 'Live', onClick: live, on: true }] })
    const host = top(); act(() => host.querySelector<HTMLElement>('[aria-disabled]')!.click())
    expect(disabled).not.toHaveBeenCalled(); expect(useUI.getState().sheets).toHaveLength(1)
    act(() => host.querySelectorAll<HTMLElement>('.menu-item')[1]!.click())
    expect(live).toHaveBeenCalledOnce(); expect(host.querySelector('.menu-on.is-on')).toBeTruthy()
  })
  it('required cancel is a no-op, skip returns null, and choosing another workout closes before navigation', () => {
    const done = vi.fn(), navigate = vi.fn(() => expect(useUI.getState().sheets).toEqual([]))
    setNav(navigate); setNavReaders({ sheetEntry: () => true, currentHash: () => '#/' })
    const before = JSON.stringify(useStore.getState().S)
    bwSheet({ required: true, onDone: done }); expect(useUI.getState().sheets[0]!.locked).toBe(true)
    const cancelHost = top(); act(() => cancelHost.querySelector<HTMLButtonElement>('[aria-label="Cancel"]')!.click())
    expect(done).not.toHaveBeenCalled(); expect(JSON.stringify(useStore.getState().S)).toBe(before)
    bwSheet({ required: true, onDone: done }); click(top(), 'Start without weighing in')
    expect(done).toHaveBeenCalledExactlyOnceWith(null,expect.any(Function))
    bwSheet({ required: true, onDone: done }); click(top(), 'Choose a different workout')
    expect(navigate).toHaveBeenCalledWith('/workout', { replace: true }); expect(done).toHaveBeenCalledTimes(1)
  })
  it('updates today once, stamps it and calls the required completion after closing', () => {
    install([], { bodyweight: [{ d: '2026-09-28', w: 80, t: 1 }, { d: '2026-09-25', w: 79, t: 2 }] })
    const done = vi.fn(() => expect(useUI.getState().sheets).toEqual([]))
    bwSheet({ required: true, onDone: done }); const host = top()
    type(host.querySelector<HTMLInputElement>('.bw-read input')!, '82.35'); click(host, 'Save & start workout')
    expect(useStore.getState().S.bodyweight).toEqual([{ d: '2026-09-25', w: 79, t: 2 }, { d: '2026-09-28', w: 82.4, t: Date.now() }])
    expect(done).toHaveBeenCalledExactlyOnceWith(82.4,expect.any(Function))
  })
  it('saves/removes the goal and colors movement toward it, including no goal and no change', () => {
    install([], { unit: 'lb', bodyweight: [{ d: '2026-09-27', w: 210, t: 1 }] })
    goalSheet(); const host = top(); type(host.querySelector<HTMLInputElement>('.bw-read input')!, '200.25'); click(host, 'Save goal')
    expect(useStore.getState().S.targetW).toBe(200.3); expect(useUI.getState().toastMsg).toContain('9.7 to go')
    expect(bwDeltaColor(-1, 210)).toBe('var(--acc)'); expect(bwDeltaColor(1, 210)).toBe('var(--red)')
    expect(bwDeltaColor(0, 210)).toBe('var(--label-2)')
    goalSheet(); click(top(), 'Remove goal'); expect(useStore.getState().S.targetW).toBeNull()
    expect(bwDeltaColor(1, 210)).toBe('var(--label)')
  })
  it('uses the pounds slider and pounds body-weight ceiling', () => {
    install([], { unit: 'lb' }); bwSheet(); const host = top()
    expect(host.querySelector('.sld')!.getAttribute('aria-valuemax')).toBe('660')
    type(host.querySelector<HTMLInputElement>('.bw-read input')!, '1500.1'); click(host, 'Save')
    expect(useUI.getState().toastMsg).toContain('1,500 lb'); expect(useStore.getState().S.bodyweight).toEqual([])
    type(host.querySelector<HTMLInputElement>('.bw-read input')!, '1500'); click(host, 'Save')
    expect(useStore.getState().S.bodyweight[0].w).toBe(1500)
  })
})

describe('import preview and flows', () => {
  it.each(['account', 'profile', 'away-and-back'])('aborts import confirmation after a %s switch without any write', async (change) => {
    useStore.setState({ user: { id: 'synthetic-a' } })
    await csv('Date,Exercise,Weight,Reps\n2026-09-28,Bench Press,65,5')
    const host = top(), write = vi.spyOn(useStore.getState(), 'update')
    act(() => {
      if (change === 'profile') useStore.setState({ S: { ...useStore.getState().S, unit: 'lb' } })
      else {
        useStore.setState({ user: { id: 'synthetic-b' } })
        if (change === 'away-and-back') useStore.setState({ user: { id: 'synthetic-a' } })
      }
    })
    const before = JSON.stringify(useStore.getState().S)
    click(host, 'Import')
    expect(write).not.toHaveBeenCalled(); expect(JSON.stringify(useStore.getState().S)).toBe(before)
    expect(useUI.getState().toastMsg).toContain('changed'); expect(useUI.getState().sheets).toEqual([])
  })
  it('aborts a pending file callback after an account switch', async () => {
    let finish!: (value: string) => void
    const readText = vi.fn(() => new Promise<string>(resolve => { finish = resolve }))
    configureExportFileReader({ readText })
    const done = vi.fn(); importFromApp(new File([], 'synthetic.csv'), done)
    act(() => useStore.setState({ user: { id: 'synthetic-other' } }))
    finish('Date,Exercise,Weight,Reps\n2026-09-28,Bench Press,65,5')
    await settle(() => readText.mock.calls.length === 2)
    // The sniff read and full CSV read are independent bounded reads.
    finish('Date,Exercise,Weight,Reps\n2026-09-28,Bench Press,65,5'); await settle(() => useUI.getState().toastMsg.includes('changed'))
    expect(done).not.toHaveBeenCalled(); expect(useUI.getState().sheets).toEqual([])
    expect(useStore.getState().S.workouts).toEqual([]); expect(useUI.getState().toastMsg).toContain('changed')
  })
  it.each([['synthetic.csv', 50 * 1024 ** 2, '50 MiB'], ['export.xml', 4 * 1024 ** 3, '4 GiB']])('toasts the %s size refusal without reading', async (name, limit, message) => {
    const readText = vi.fn(), readChunks = vi.fn(), done = vi.fn()
    configureExportFileReader({ readText, readChunks })
    const file = new File([], String(name)); Object.defineProperty(file, 'size', { value: Number(limit) + 1 })
    importFromApp(file, done); await settle(() => useUI.getState().toastMsg.includes(String(message)))
    expect(useUI.getState().toastMsg).toContain(message); expect(readText).not.toHaveBeenCalled(); expect(readChunks).not.toHaveBeenCalled()
    expect(done).not.toHaveBeenCalled(); expect(useUI.getState().sheets).toEqual([])
  })
  it('keeps state untouched on read failure, empty, unrecognized and valid-but-empty files', async () => {
    const before = JSON.stringify(useStore.getState().S), done = vi.fn()
    configureExportFileReader({ readText: async () => { throw new Error('synthetic read failure') } })
    await csv('anything', done); expect(useUI.getState().toastMsg).toBe('Could not read that file')
    configureExportFileReader()
    await csv('', done); expect(useUI.getState().toastMsg).toBe('That file is empty')
    await csv('A,B\n1,2', done); expect(useUI.getState().toastMsg).toContain("don't recognise")
    await csv('Date,Exercise,Weight,Reps\nnot-a-date,Bench Press,60,5', done)
    expect(useUI.getState().toastMsg).toBe('Nothing to import from that file')
    expect(useUI.getState().sheets).toEqual([]); expect(done).not.toHaveBeenCalled(); expect(JSON.stringify(useStore.getState().S)).toBe(before)
  })
  it('previews duplicate days without mutation and imports only the new workout', async () => {
    install([], { workouts: [{ id: 'old', d: '2026-09-25', entries: [], prs: [] }] })
    const done = vi.fn(); await csv('Date,Exercise,Weight,Reps\n2026-09-25,Bench Press,60,5\n2026-09-28,Bench Press,65,5', done)
    expect(done).toHaveBeenCalledOnce(); expect(useStore.getState().S.workouts).toHaveLength(1)
    const host = top(); expect(host.textContent).toContain('1 days already have data here and will be left alone.')
    click(host, 'Import'); expect(useStore.getState().S.workouts.map((w: any) => w.d)).toEqual(['2026-09-25', '2026-09-28'])
    expect(useUI.getState().toastMsg).toBe('1 workout imported')
    await csv('Date,Exercise,Weight,Reps\n2026-09-28,Bench Press,100,5')
    expect(button(top(), 'Nothing new to import').disabled).toBe(true)
  })
  it('previews and imports Apple Health weigh-ins, preserving existing days', async () => {
    install([], { bodyweight: [{ d: '2026-09-25', w: 77, t: 1 }] })
    await csv('<HealthData><Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="80" startDate="2026-09-25 08:00:00 +0000"/><Record type="HKQuantityTypeIdentifierBodyMass" unit="kg" value="81" startDate="2026-09-28 08:00:00 +0000"/></HealthData>')
    const host = top(); expect(host.textContent).toContain('Weigh-ins'); expect(host.textContent).toContain('New1')
    click(host, 'Import'); expect(useStore.getState().S.bodyweight.map((b: any) => b.w)).toEqual([77, 81]); expect(useUI.getState().toastMsg).toBe('1 weigh-in imported')
  })
  it('fitted starter uses the real custom index', () => {
    install([own]); expect(loadStarterPlan('full-body', { id: 'p', name: 'Synthetic gym', equipment: ['clubbell', 'bench'], accV: 1 })).toBe(true)
    expect(useStore.getState().S.routines.flatMap((r: any) => r.ex.map((e: any) => e.id))).toContain(own.id)
  })
  it('CSV parsing respects a caller custom cardio override of a catalogue id', async () => {
    // The explicit index permits custom definitions to shadow existing ids.
    const cardio = { ...own, id: '0025', n: 'synthetic ergometer', bp: 'cardio', eq: 'custom' }
    install([cardio]); await csv('Date,Workout Name,Exercise Name,Set Order,Weight,Reps,Seconds\n2026-09-28,Synthetic,Bench Press (Barbell),1,60,0,120')
    click(top(), 'Import')
    expect(useStore.getState().S.workouts[0].entries[0].sets[0]).toMatchObject({ min: 2 })
  })
})

function hevyPlatform(data: Record<string, unknown>, status = 200) {
  const platform = createBrowserPlatform()
  platform.transport.fetch = vi.fn(async (url: string) => new Response(JSON.stringify(data[new URL(url).pathname] || { page_count: 1 }), { status }))
  configureClientIO(platform); return platform.transport.fetch
}
async function fetchHevy() {
  importFromHevy(); const host = top(); type(host.querySelector<HTMLInputElement>('input')!, ' synthetic-key ')
  act(() => useUI.setState({ toastMsg: '' }))
  click(host, 'Fetch from Hevy')
  await settle(() => !!button(host, 'Import') || !!useUI.getState().toastMsg)
  return host
}
const hevyWorkout = { id: 'w', title: 'Synthetic', start_time: '2026-09-28T10:00:00Z', end_time: '2026-09-28T10:20:00Z', exercises: [{ exercise_template_id: 'synthetic-template', title: own.n, sets: [{ type: 'normal', reps: 5, weight_kg: 20 }] }] }

describe('Hevy import sheet', () => {
  it('aborts a Hevy preview after switching accounts', async () => {
    hevyPlatform({ '/v1/workouts': { workouts: [hevyWorkout], page_count: 1 } })
    const host = await fetchHevy(), write = vi.spyOn(useStore.getState(), 'update')
    act(() => useStore.setState({ user: { id: 'synthetic-other' } }))
    click(host, 'Import')
    expect(write).not.toHaveBeenCalled(); expect(useStore.getState().S.workouts).toEqual([])
    expect(useUI.getState().toastMsg).toContain('changed')
  })
  it('uses the real custom index during HTTP import, wipes the key, and imports selected history', async () => {
    install([own]); const imported = vi.spyOn(hevy, 'importHevyData'); const transport = hevyPlatform({ '/v1/workouts': { workouts: [hevyWorkout], page_count: 1 } })
    const host = await fetchHevy()
    expect([...host.querySelectorAll('.tile')].find(t => t.textContent?.startsWith('Exercises matched'))!.textContent).toBe('Exercises matched0')
    const result = await imported.mock.results[0]!.value
    expect(result.workouts.matchedSets).toBe(1)
    expect(useStore.getState().S.workouts).toEqual([]); expect(host.querySelector('input')).toBeNull()
    expect(JSON.stringify(useStore.getState().S)).not.toContain('synthetic-key')
    click(host, 'Import'); expect(useStore.getState().S.workouts[0].entries[0].id).toBe(own.id)
    expect(useUI.getState().toastMsg).toBe('1 workout imported'); expect(transport).toHaveBeenCalledTimes(4)
  })
  it('supports independent workout, routine and weigh-in selection and Back clears the key', async () => {
    install([own]); hevyPlatform({
      '/v1/workouts': { workouts: [hevyWorkout], page_count: 1 },
      '/v1/routines': { routines: [{ id: 'r', title: 'Synthetic routine', exercises: hevyWorkout.exercises }], page_count: 1 },
      '/v1/body_measurements': { body_measurements: [{ date: '2026-09-28', weight_kg: 81 }], page_count: 1 },
    })
    const host = await fetchHevy(); expect(host.querySelectorAll('[role="switch"]')).toHaveLength(3)
    act(() => host.querySelectorAll<HTMLElement>('[role="switch"]')[0]!.click())
    click(host, 'Import'); expect(useStore.getState().S.workouts).toEqual([]); expect(useStore.getState().S.routines).toHaveLength(1); expect(useStore.getState().S.bodyweight).toHaveLength(1)
    hevyPlatform({ '/v1/workouts': { workouts: [hevyWorkout], page_count: 1 } })
    const next = await fetchHevy(); click(next, 'Back'); expect(next.querySelector<HTMLInputElement>('input')!.value).toBe('')
  })
  it.each([[401, 'That Hevy API key was refused'], [500, 'Couldn’t reach Hevy. Check the key and try again']])('shows HTTP %s failures and leaves data alone', async (status, message) => {
    hevyPlatform({}, Number(status)); const host = await fetchHevy()
    expect(useUI.getState().toastMsg).toBe(message); expect(useStore.getState().S.workouts).toEqual([])
    expect(button(host, 'Fetch from Hevy').disabled).toBe(false)
  })
  it('reports empty accounts without opening a summary', async () => {
    hevyPlatform({}); const host = await fetchHevy()
    expect(useUI.getState().toastMsg).toBe('Nothing to import from Hevy'); expect(host.querySelector<HTMLInputElement>('input')!.value).toBe('')
  })
})
