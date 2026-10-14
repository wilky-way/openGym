import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSyncEngine } from '../../src/store/sync-engine'
import { initialStoreState, DEF, KEY } from '../../src/store/useStore'
const clone = (v: any) => JSON.parse(JSON.stringify(v))
const custom = { id: 'synthetic-indirect-bell', n: 'Single arm press', eq: 'dumbbell', custom: true }
const workout = (id: string) => ({ id, d: '2026-10-13', start: 1, end: 2, vol: 999, entries: [{ id: custom.id, target: { dbLoad: 'each' }, sets: [{ w: 10, r: 8, done: true }] }] })
const doc = (unit = 'kg', extra: any = {}) => ({ ...clone(DEF), _ts: unit === 'kg' ? 100 : 200, unit, ...(unit === 'lb' ? { unitSet: { at: 200, convert: true } } : {}), resetAt: 100, customEx: [custom], programmes: { version: 1, definitions: [], cycles: [], offloaded: { obsolete: { versionId: 'old', at: 50 } } }, ...extra })
const stashKey = 'https://synthetic.example|A'
let disposes: (() => void)[] = []
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z')) })
afterEach(() => { for (const dispose of disposes) dispose(); disposes = []; vi.useRealTimers() })
function make(S: any, stash?: any, api: any = async () => ({ ok: true, rev: 3 }), signed = true) {
  const map = new Map<string, string>([[KEY, JSON.stringify(S)]])
  if (signed) { map.set('gym_owner', 'A'); map.set('gym_user', JSON.stringify({ id: 'A' })); map.set('gym_sync', JSON.stringify({ rev: 1, ts: S._ts })) }
  if (stash) map.set('gym_stash', JSON.stringify({ [stashKey]: { uid: 'A', server: 'https://synthetic.example', state: stash.state ?? stash, ...(stash.adopt ? { adopt: true } : {}) } }))
  const kv = { get: (key: string) => map.get(key) ?? null, set: (key: string, value: string) => { map.set(key, value) }, remove: (key: string) => { map.delete(key) }, subscribe: () => () => {} }
  const platform: any = { kv, server: { baseUrl: () => '' }, nav: { href: () => 'https://synthetic.example/' } }
  let state: any = { ...initialStoreState(kv), update() {} }
  const engine = createSyncEngine(patch => { state = { ...state, ...patch } }, () => state, { platform, api, prompts: { toast() {}, askAddDeviceData: async () => false } })
  state = { ...state, ...engine.actions, ready: true }; disposes.push(engine.dispose)
  return { get: () => state, map, kept: () => JSON.parse(map.get('gym_stash')!)[stashKey].state }
}
function converted(S: any, id: string, active = true) {
  expect(S.unit).toBe('lb')
  const record = S.workouts.find((w: any) => w.id === id)
  expect(record.entries[0].sets[0].w).toBe(22)
  expect(record.vol).toBe(176)
  if (active) { expect(S.active.entries[0].sets[0].w).toBe(22); expect(S.active.vol).toBe(176) }
  // Equal-Reset target on each real indirect client-merge path.
  expect(S.programmes.offloaded?.obsolete).toBeUndefined()
}
it.each(['current', 'previous'])('account switching converts custom history and the %s active source into the existing stash unit', source => {
  const local = source === 'current' ? doc('kg', { workouts: [workout('local')], active: workout('run') }) : doc('lb', { workouts: [{ id: 'owed', entries: [] }] })
  const kept = source === 'current' ? doc('lb') : doc('kg', { workouts: [workout('local')], active: workout('run') })
  const h = make(local, kept); h.get().update((s: any) => { s.restSec = 120 }, false)
  h.get().setUser({ id: 'B' }, { adopt: true })
  converted(h.kept(), 'local')
})
it.each(['current', 'previous'])('forced sign-out merges custom history and the %s active source into the existing stash', async source => {
  const local = source === 'current' ? doc('kg', { workouts: [workout('local')], active: workout('run') }) : doc('lb', { workouts: [{ id: 'owed', entries: [] }] })
  const kept = source === 'current' ? doc('lb') : doc('kg', { workouts: [workout('local')], active: workout('run') })
  const h = make(local, kept, async (path: string, options: any) => { if (options?.method === 'PUT') throw new TypeError('offline'); return {} }); h.map.set('gym_dirty', '1')
  expect((await h.get().signOut({ force: true })).stashed).toBe(true)
  converted(h.kept(), 'local')
})
it('a clean sign-out converts a custom active workout into an existing stash without owed history', async () => {
  const h = make(doc('kg', { active: workout('run') }), doc('lb'))
  expect(await h.get().signOut()).toEqual({ owed: false })
  expect(h.kept().active.entries[0].sets[0].w).toBe(22); expect(h.kept().active.vol).toBe(176)
})
it.each([false, true])('stash replay prefer-account=%s converts custom history and active, consuming equal-Reset offload markers', async adopt => {
  const server = doc('lb')
  const h = make(server, { state: doc('kg', { workouts: [workout('kept')], active: workout('run') }), adopt }, async (path: string, options: any) => path === '/api/config' ? {} : path === '/api/me' ? { user: { id: 'A' } } : options?.method === 'PUT' ? { ok: true, rev: 3 } : { state: clone(server), rev: 2 })
  await h.get().boot(); converted(h.get().S, 'kept'); expect(h.map.has('gym_stash')).toBe(false)
})
it('Add them adoption converts custom guest history and active into the account unit', async () => {
  const server = doc('lb')
  const h = make(doc('kg', { workouts: [workout('guest')], active: workout('run') }), undefined, async (path: string, options: any) => options?.method === 'PUT' ? { ok: true, rev: 3 } : { state: clone(server), rev: 2 }, false)
  h.get().setUser({ id: 'A' }, { adopt: true }); await h.get().adoptProfile(async () => true)
  converted(h.get().S, 'guest')
})
it('Keep profile as is converts the custom active and later account history, while retaining the guest copy', async () => {
  const server = doc('lb')
  const h = make(doc('kg', { workouts: [workout('guest')], active: workout('run') }), undefined, async (path: string, options: any) => options?.method === 'PUT' ? { ok: true, rev: 3 } : { state: clone(server), rev: 2 }, false)
  h.get().setUser({ id: 'A' }, { adopt: true })
  h.get().update((s: any) => { s.workouts.push(workout('later')) }, false)
  await h.get().adoptProfile(async () => false)
  converted(h.get().S, 'later'); expect(h.get().S.workouts.some((w: any) => w.id === 'guest')).toBe(false)
})
it.each([false, true])('backup import local-merge=%s converts custom history and preserves the custom running session', local => {
  const current = doc('kg', { workouts: [workout('local')], active: workout('run') })
  const remote = doc('kg', { workouts: [workout('remote')] })
  const h = make(current)
  h.get().importBackup(doc('lb'), { mergeWith: { state: remote, rev: 2, local } })
  converted(h.get().S, local ? 'local' : 'remote')
})
it('backup replace carries the custom running workout in the imported unit', () => {
  const h = make(doc('kg', { active: workout('run') }))
  h.get().importBackup(doc('lb'))
  expect(h.get().S.active.entries[0].sets[0].w).toBe(22); expect(h.get().S.active.vol).toBe(176)
})
it.each([false, true])('tab join touched-active=%s converts the custom source into the newer unit', touched => {
  const h = make(touched ? doc('kg', { workouts: [workout('local')] }) : doc('lb'))
  const saved = touched ? doc('lb') : doc('kg', { workouts: [workout('local')], active: workout('saved-run') })
  h.map.set('gym_state_owner', 'A'); h.map.set('gym_state_wid', 'other-tab'); h.map.set(KEY, JSON.stringify(saved))
  h.get().update((s: any) => { if (touched) s.active = workout('local-run'); else s.restSec = 120 }, false)
  converted(h.get().S, 'local')
})
it('a 409 merge converts the custom running session along with custom history', async () => {
  const remote = doc('lb'); let puts = 0
  const h = make(doc('kg', { workouts: [workout('local')], active: workout('run') }), undefined, async () => {
    if (++puts === 1) throw Object.assign(new Error('conflict'), { status: 409, data: { state: clone(remote), rev: 2 } })
    return { ok: true, rev: 3 }
  })
  await h.get().pushState(); expect(puts).toBe(2); converted(h.get().S, 'local')
})
