import { afterEach, expect, test, vi } from 'vitest'
import * as exercises from '@opengym/core/exercises'
import { _seedStateForTests, getState, withRemoteState } from '../src/state'
import { PROFILE_TOOLS } from '../src/tools'
import { mutateProgramme } from '../src/programme-tools'
import type { Fetcher } from '../src/http-client'

afterEach(() => vi.restoreAllMocks())
const env = { OPENGYM_URL: 'http://127.0.0.1:1234', OPENGYM_TOKEN: 'synthetic-review', OPENGYM_UID: 'test-uid', OPENGYM_ENABLE_PROGRAMME_WRITES: '1' }
const definition = { id: 'synthetic', name: 'Synthetic', unit: 'kg', weeks: [{ index: 1, days: [{ key: 'd1', sessions: [{ routineSnapshot: { ex: [{ id: '0025', sets: 3, reps: 8, weight: 100 }] } }] }] }] }
const state = () => ({ _rev: 7, _wid: 'epoch', unit: 'kg', routines: [], workouts: [], programmes: { definitions: [definition], cycles: [] } })

test('cached absence is revalidated when S04 still reports zero revision but data becomes corrupt', async () => {
  let corrupt = false, pulls = 0
  const fetcher: Fetcher = async url => {
    if (url.endsWith('/me')) return { ok: true, status: 200, json: async () => ({ user: { id: 'test-uid' } }) }
    if (url.endsWith('/rev')) return { ok: true, status: 200, json: async () => ({ rev: 0 }) }
    pulls++
    return { ok: !corrupt, status: corrupt ? 503 : 200, json: async () => ({ rev: 0, state: null }) }
  }
  expect(await withRemoteState(getState, { env, fetcher })).toBeNull()
  corrupt = true
  await expect(withRemoteState(getState, { env, fetcher })).rejects.toMatchObject({ code: 'API_REFUSED' })
  expect(pulls).toBe(2)
})

test('large PR reads build one real index per invocation and refresh changed custom exercises on the next call', () => {
  const S = { ...state(), customEx: [{ id: 'custom', n: 'Custom', bp: 'chest', eq: 'barbell' }],
    workouts: Array.from({ length: 200 }, (_, i) => ({ id: `w${i}`, d: '2026-07-26', entries: Array.from({ length: 10 }, () => ({ id: 'custom', target: { mode: 'reps' }, sets: [{ done: true, w: 100, r: 5 }] })) })) }
  _seedStateForTests(S)
  // Spy observes the real builder; no predicates or exercise data are stubbed.
  const build = vi.spyOn(exercises, 'createExerciseIndex')
  const tool = PROFILE_TOOLS.find(t => t.name === 'estimate_1rm')!
  const first: any = tool.handler({})
  expect(first.pr_table).toHaveLength(1); expect(first.pr_table[0].exName).toBe('Custom'); expect(first.pr_table[0].est).toBeGreaterThan(100)
  expect(build).toHaveBeenCalledTimes(1)
  Object.assign(S.customEx[0]!, { assisted: true })
  expect((tool.handler({}) as any).pr_table).toEqual([])
  expect(build).toHaveBeenCalledTimes(2)
})

function writeApi(ack: unknown, readback?: unknown) {
  let puts = 0, saved: any
  const fetcher: Fetcher = async (url, init) => {
    let body: unknown
    if (url.endsWith('/me')) body = { user: { id: 'test-uid' } }
    else if (init.method === 'PUT') { puts++; saved = { ...JSON.parse(String(init.body)).state, _wid: 'new-epoch' }; body = ack }
    else body = puts ? readback ?? { rev: 8, state: saved } : { rev: 7, state: state() }
    return { ok: true, status: 200, json: async () => body }
  }
  return { fetcher, puts: () => puts }
}
const params = { programmeId: 'synthetic', expectedRev: 7, expectedWid: 'epoch', today: '2026-07-27' }
test.each([null, { ok: false }, { rev: 8, wid: 'w' }, { ok: true, rev: '8', wid: 'w' }, { ok: true, rev: 7, wid: 'w' }, { ok: true, rev: 8 }])('invalid write acknowledgement is an error and never retried: %j', async ack => {
  const api = writeApi(ack)
  await expect(mutateProgramme('activate', params, { env, fetcher: api.fetcher })).rejects.toMatchObject({ code: 'API_UNAVAILABLE' })
  expect(api.puts()).toBe(1)
})
test.each([{ rev: 'invalid-revision', state: null }, { rev: 7, state: state() }, { rev: 8, state: [] }, { rev: 8, state: {} }])('invalid readback retains the committed acknowledgement and reports readbackError: %j', async readback => {
  const api = writeApi({ ok: true, rev: 8, wid: 'new-epoch' }, readback)
  expect(await mutateProgramme('activate', params, { env, fetcher: api.fetcher })).toEqual({ ok: true, appliedRev: 8, position: null, readbackError: 'API_UNAVAILABLE' })
  expect(api.puts()).toBe(1)
})
