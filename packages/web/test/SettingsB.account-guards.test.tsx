import { clientPlatform, configureClientIO } from '../src/lib/client-io'
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsB, { configureSettingsB, RestSoundSheet, type SettingsBPage, type SettingsBServices } from '../src/views/SettingsB'
import { freshState, useStore, type StoreDocument } from '../src/store/useStore'
import { initializeSyncEngine } from '../src/store/sync-engine'
import { createBrowserPlatform } from '../src/platform/browser'
import { configureUx, createBrowserUx } from '../src/platform/ux'
import { bindUI } from '../src/components/ui'
import { useUI } from '../src/store/useUI'

const wheels = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('../src/components/DurationWheel', () => ({ durationSheet: wheels.open }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root, services: SettingsBServices, dispose: () => void
let saved: Map<string, string>, notifyOwner: (key: string | null) => void
let toast: ReturnType<typeof vi.spyOn>
let api: ReturnType<typeof vi.fn<(path: string, options?: RequestInit) => Promise<any>>>
let writes: ReturnType<typeof vi.fn<(key: string, value: string) => void>>
const documentFor = (owner: string): StoreDocument => ({
 ...freshState(), profileId: 'shared-profile-id', unknown: { owner },
 equipProfiles: [{ id: 'collision', name: 'Equipment', equipment: ['barbell'] }, { id: 'spare', name: 'Spare', equipment: [] }], activeEquipId: 'collision',
 routines: [{ id: 'routine', name: 'Synthetic', ex: [] }], rotation: { id: 'rotation', sequence: ['routine'], label: 'Synthetic loop' },
 queue: { ids: ['routine'], since: 100, startsOn: '2026-02-18', rotationId: 'rotation', label: 'Synthetic loop' },
 exWeights: { '0025': { w: 50 } }, bodyweight: [{ d: '2026-02-18', w: 80, t: 100 }],
})
function saveAccount(owner: string, doc = documentFor(owner)) {
 saved.set('gym_owner', owner); saved.set('gym_user', JSON.stringify({ id: owner }))
 saved.set('gym_state_owner', owner); saved.set('gym_state_wid', 'write-' + owner)
 saved.set('gym_state_v1', JSON.stringify(doc))
 saved.set('gym_sync', JSON.stringify({ rev: 1, ts: 100 }))
}
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-02-18T12:00:00Z'))
 configureUx(createBrowserUx()); bindUI(useUI); useUI.setState({ sheets: [] })
 toast = vi.spyOn(useUI.getState(), 'toast').mockImplementation(() => {})
 saved = new Map(); saveAccount('A'); api = vi.fn<(path: string, options?: RequestInit) => Promise<any>>().mockResolvedValue({ ok: true, rev: 2 })
 writes = vi.fn((key: string, value: string) => { saved.set(key, value) })
 const platform = { ...createBrowserPlatform(), kv: {
  get: (key: string) => saved.get(key) ?? null, set: writes,
  remove: (key: string) => { saved.delete(key) },
  subscribe: (listener: (key: string | null) => void) => { notifyOwner = listener; return () => {} },
 } }
 configureClientIO(platform)
 dispose = initializeSyncEngine({ platform, api, prompts: { askAddDeviceData: async () => false, toast: message => useUI.getState().toast(message) } })
 services = { navigate: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(), equipmentProfileSheet: vi.fn(), plateInventorySheet: vi.fn(), dumbbellInventorySheet: vi.fn() }
 configureSettingsB(services); wheels.open.mockClear()
 host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); dispose(); toast.mockRestore(); host.remove(); vi.useRealTimers() })
const mount = (page: SettingsBPage) => act(() => root.render(<SettingsB page={page} />))
const row = (title: string) => [...host.querySelectorAll<HTMLElement>('.lrow')].find(e => e.querySelector('.lrow-t')?.textContent === title)!
const click = (el: HTMLElement) => act(() => el.click())
const pick = (title: string, label: string) => click([...row(title).querySelectorAll<HTMLButtonElement>('button')].find(e => e.textContent === label)!)
type DelayedWrite = { name: string; open(): () => void; check(): void }
function selection(page: SettingsBPage, title: string, field: string, value: string): DelayedWrite {
 return { name: title + ' selection sheet', open() {
  mount(page); click(row(title))
  const element = useUI.getState().sheets.at(-1)!.render(() => {}) as React.ReactElement<{ onChange(v: string): void }>
  return () => element.props.onChange(value)
 }, check() { expect(useStore.getState().S[field]).toBe(value) } }
}
const paths: DelayedWrite[] = [
 { name: 'equipment delete with colliding ids', open() { mount('equipment'); click(row('Equipment').querySelector('[aria-label=Delete]')!); return vi.mocked(services.confirmSheet).mock.calls[0]![0].onConfirm }, check() { expect(useStore.getState().S.equipProfiles.map((p: any) => p.id)).toEqual(['spare']); expect(useStore.getState().S.activeEquipId).toBe('spare') } },
 { name: 'fixed-week confirm with colliding rotation ids', open() { mount('plan'); pick('How you train', 'Fixed Week'); return vi.mocked(services.confirmSheet).mock.calls[0]![0].onConfirm }, check() { expect(useStore.getState().S.queue).toBeNull(); expect(useStore.getState().S.rotation.id).toBe('rotation'); expect(useStore.getState().S.scheduleMode).toBe('week') } },
 { name: 'rest duration Done', open() { mount('workout'); click(row('Rest timer')); return () => wheels.open.mock.calls[0]![0].onDone(120) }, check() { expect(useStore.getState().S.restSec).toBe(120) } },
 { name: 'rest-pause duration Done', open() { mount('workout'); click(row('Rest-pause rest')); return () => wheels.open.mock.calls[0]![0].onDone(30) }, check() { expect(useStore.getState().S.restPauseSec).toBe(30) } },
 ...[0, 1].map(index => ({ name: index === 0 ? 'convert unit menu' : 'relabel unit menu', open() { mount('units'); pick('Weight unit', 'lb'); return vi.mocked(services.menuSheet).mock.calls[0]![0].items[index]!.onClick }, check() { expect(useStore.getState().S.unit).toBe('lb'); expect(useStore.getState().S.unitSet.convert).toBe(index === 0); expect(useStore.getState().S.bodyweight[0].w).toBe(index === 0 ? 176.4 : 80) } })),
 selection('workout', 'Shown under each exercise', 'logRef', 'best'),
 selection('advanced', 'Planned sessions start from', 'startFrom', 'last'),
 selection('units', '1RM formula', 'oneRmFormula', 'epley'),
 selection('equipment', 'Active profile', 'activeEquipId', 'spare'),
 { name: 'open sound sheet selection', open() { act(() => root.render(<RestSoundSheet close={() => {}} />)); const button = row('Bell'); return () => button.click() }, check() { expect(useStore.getState().S.restSound).toBe('bell') } },
]
describe('Settings B delayed writes on real W07 persistence', () => {
 it.each(paths)('$name aborts after A → B and leaves B’s saved bytes intact', path => {
  const commit = path.open()
  act(() => { saveAccount('B'); notifyOwner('gym_owner') })
  expect(useStore.getState().user?.id).toBe('B')
  const memory = structuredClone(useStore.getState().S), bytes = saved.get('gym_state_v1'), keys = [...saved]
  writes.mockClear(); toast.mockClear(); api.mockClear()
  act(commit)
  expect(useStore.getState().S).toEqual(memory); expect(saved.get('gym_state_v1')).toBe(bytes)
  expect([...saved]).toEqual(keys); expect(writes).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/i))
 })
 it.each(paths)('$name still commits for the same account', path => {
  const commit = path.open(); act(commit); path.check()
  expect(JSON.parse(saved.get('gym_state_v1')!)).toEqual(useStore.getState().S)
  expect(useStore.getState().S.unknown).toEqual({ owner: 'A' }); expect(toast).not.toHaveBeenCalled()
 })
 it.each(paths)('$name aborts a profile switch within the same account', path => {
  const commit = path.open()
  act(() => useStore.getState().update(s => { s.profileId = 'replacement-profile' }))
  const bytes = saved.get('gym_state_v1'), memory = structuredClone(useStore.getState().S)
  writes.mockClear(); toast.mockClear(); act(commit)
  expect(saved.get('gym_state_v1')).toBe(bytes); expect(useStore.getState().S).toEqual(memory)
  expect(writes).not.toHaveBeenCalled(); expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/i))
 })
 it.each([
  { path: paths[0]!, replace(s: StoreDocument) { s.equipProfiles[0].name = 'Replacement with the same id' } },
  { path: paths[1]!, replace(s: StoreDocument) { s.queue.since++ } },
  { path: paths[2]!, replace(s: StoreDocument) { s.restSec = 60 } },
  { path: paths[3]!, replace(s: StoreDocument) { s.restPauseSec = 10 } },
  { path: paths[4]!, replace(s: StoreDocument) { s.unitSet = { at: 200, convert: false } } },
  { path: paths[5]!, replace(s: StoreDocument) { s.unit = 'lb' } },
  { path: paths[6]!, replace(s: StoreDocument) { s.logRef = 'best' } },
  { path: paths[7]!, replace(s: StoreDocument) { s.startFrom = 'last' } },
  { path: paths[8]!, replace(s: StoreDocument) { s.oneRmFormula = 'brzycki' } },
  { path: paths[9]!, replace(s: StoreDocument) { s.activeEquipId = 'spare' } },
  { path: paths[9]!, replace(s: StoreDocument) { s.equipProfiles[1].name = 'Replacement selected profile' } },
 ])('$path.name aborts when its target changes in the same account', ({ path, replace }) => {
  const commit = path.open(); act(() => useStore.getState().update(replace))
  const bytes = saved.get('gym_state_v1'), memory = structuredClone(useStore.getState().S)
  writes.mockClear(); toast.mockClear(); act(commit)
  expect(saved.get('gym_state_v1')).toBe(bytes); expect(useStore.getState().S).toEqual(memory)
  expect(writes).not.toHaveBeenCalled(); expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/i))
 })
 it('propagates unrelated updater failures', () => {
  const failure = new Error('Synthetic storage failure')
  act(() => useStore.setState({ update() { throw failure } }))
  const commit = paths[0]!.open()
  expect(commit).toThrow(failure); expect(toast).not.toHaveBeenCalled()
 })
 it('captures the sound owner when opening, before the sheet factory is rendered', () => {
  mount('alerts'); click(row('Sound'))
  const factory = useUI.getState().sheets[0]!.render
  act(() => { saveAccount('B'); notifyOwner('gym_owner'); root.render(factory(() => {})) })
  const bytes = saved.get('gym_state_v1'); writes.mockClear(); toast.mockClear()
  click(row('Bell'))
  expect(saved.get('gym_state_v1')).toBe(bytes); expect(writes).not.toHaveBeenCalled()
  expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/i))
 })
 it('the converted document is saved once by setUnit, with no outer draft overwrite', () => {
  const commit = paths[4]!.open(); writes.mockClear(); act(commit)
  expect(writes.mock.calls.filter(([key]) => key === 'gym_state_v1')).toHaveLength(1)
  expect(JSON.parse(saved.get('gym_state_v1')!).bodyweight[0].w).toBe(176.4)
 })
 it.each(paths)('$name rechecks when B arrives inside the updater', path => {
  const update = useStore.getState().update
  let bytes: string | undefined, memory: StoreDocument
  act(() => useStore.setState({ update(mut, push) {
   saveAccount('B'); notifyOwner('gym_owner')
   bytes = saved.get('gym_state_v1'); memory = structuredClone(useStore.getState().S); writes.mockClear()
   update(mut, push)
  } }))
  const commit = path.open()
  act(commit)
  expect(saved.get('gym_state_v1')).toBe(bytes); expect(useStore.getState().S).toEqual(memory!)
  expect(writes).not.toHaveBeenCalled(); expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/i))
 })
})

it('a delayed setting callback is rejected after the server endpoint changes', () => {
 const commit = paths[2]!.open(); const before = saved.get('gym_state_v1')
 const baseUrl = vi.spyOn(clientPlatform().server, 'baseUrl').mockReturnValue('https://other.synthetic.example'); writes.mockClear(); act(commit); baseUrl.mockRestore()
 expect(saved.get('gym_state_v1')).toBe(before); expect(writes).not.toHaveBeenCalled(); expect(toast).toHaveBeenCalledWith(expect.stringMatching(/changed/i))
})
it('nested setUnit never runs a second stamped save when it re-enters the store updater', () => {
 const commit = paths[4]!.open(), original = useStore.getState().setUnit
 const reentry = vi.fn((unit: string, options?: {convert: boolean}) => {
   original(unit, options)
   useStore.getState().update(s => {s.reentryMarker = 'kept'}, false)
 })
 useStore.setState({setUnit: reentry}); act(commit)
 expect(reentry).toHaveBeenCalledOnce(); expect(useStore.getState().S.unit).toBe('lb')
 expect(useStore.getState().S.reentryMarker).toBe('kept'); expect(JSON.parse(saved.get('gym_state_v1')!).reentryMarker).toBe('kept')
})
