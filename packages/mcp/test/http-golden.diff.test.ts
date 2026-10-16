import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TOOLS, PROFILE_TOOLS, createTools } from '../src/tools'
import { mutateProgramme } from '../src/programme-tools'
import { withRemoteState } from '../src/state'
import { target } from './http-helpers'
// Frozen oracle imports are confined to this differential test.
import { TOOLS as legacyTools } from '../../../packages/parity/fixtures/oracle/mcp/src/tools.js'
import { _seedStateForTests as legacySeed } from '../../../packages/parity/fixtures/oracle/mcp/src/state.js'
import { buildDemoState } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/demoSeed.js'
import { mutateProgramme as legacyMutate } from '../../../packages/parity/fixtures/oracle/mcp/src/programme-tools.js'
import { applyProgrammeAgentAction as legacyAction } from '../../../packages/parity/fixtures/oracle/frontend/src/lib/programme-agent.js'
const TODAY = '2026-07-27'
const definition: any = { id: 'synthetic', name: 'Synthetic', unit: 'kg', weeks: [1, 2].map(index => ({ index, days: ['d1', 'd2'].map(key => ({ key, sessions: [{ routineSnapshot: { ex: [{ id: '0025', sets: 3, reps: 8, weight: 100 }] } }] })) })) }
let server: Awaited<ReturnType<typeof target>> | undefined
beforeEach(() => vi.useFakeTimers({ now: new Date(TODAY + 'T12:00:00Z'), toFake: ['Date'] }))
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); if (server) { await server.close(); server = undefined } })
function configure(env: Record<string, string>) { for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value) }
function base(): any { return { _rev: 7, _wid: 'epoch', unit: 'kg', routines: [], workouts: [], programmes: { definitions: [structuredClone(definition)], cycles: [] } } }
test('all eleven read-tool golden JSON outputs match the legacy synthetic fixture over HTTP', async () => {
  const S: any = buildDemoState(); S._rev = 7; S._wid = 'epoch'; S.programmes = { definitions: [definition], cycles: [] }
  server = await target(S); configure(server.env); const tools = createTools({ env: server.env, fetcher: server.fetcher }); legacySeed(structuredClone(S))
  const params: Record<string, any> = { get_routine: { routine_id: S.routines[0].id }, preview_session: { routine_id: S.routines[0].id, date: TODAY },
    get_workout: { workout_id: S.workouts[0].id }, muscle_balance: { period: 'all' }, programme_position: { today: TODAY }, get_programme: { programme_id: definition.id } }
  const names = tools.filter(t => legacyTools.some((legacy:any)=>legacy.name===t.name)).filter(t => !['activate_programme', 'shift_programme', 'skip_programme_session'].includes(t.name)).map(t => t.name)
  expect(names).toHaveLength(11)
  for (const name of names) {
    const old = await legacyTools.find((t: any) => t.name === name)!.handler(params[name] || {})
    const fresh = await tools.find(t => t.name === name)!.handler(params[name] || {})
    expect(fresh, name).toEqual(old); expect(JSON.stringify(fresh), name).toBe(JSON.stringify(old))
  }
})
test.each(['activate', 'shift', 'skip'])('%s write body matches legacy and replays against S04', async action => {
  const S = base(), params: any = { programmeId: 'synthetic', cycleId: 'fixed-cycle', expectedRev: 7, expectedWid: 'epoch', today: TODAY }
  if (action !== 'activate') { legacyAction(S, 'activate', params, TODAY); params.cycleId = S.programmes.cycles[0].id; params.instanceId = S.programmes.cycles[0].occurrences[0].instanceId }
  server = await target(S)
  const expected = structuredClone(S)
  vi.spyOn(Math, 'random').mockReturnValue(0.123456789)
  legacyAction(expected, action, params, TODAY)
  const result = await mutateProgramme(action, params, { env: server.env, fetcher: server.fetcher })
  const put = server.calls.find(c => c.method === 'PUT')!
  expect(put.body.baseRev).toBe(7); expect(put.body.baseWid).toBe('epoch'); expect(put.body.state).toEqual(expected)
  expect(JSON.stringify(put.body.state)).toBe(JSON.stringify(expected))
  expect(result.ok).toBe(true); expect(result.appliedRev).toBeGreaterThan(7)
  const stored = await server.request('GET', '/api/data')
  legacySeed(structuredClone(S)); let first = true
  const legacyResult = await legacyMutate(action, params, { env: server.env, fetcher: async (url: string, init: RequestInit) => ({ ok: true, status: 200, json: async () => {
    if (url.endsWith('/me')) return { user: { id: 'test-uid' } }
    if (init.method === 'PUT') return { rev: result.appliedRev }
    if (first) { first = false; return { state: structuredClone(S), rev: 7 } }
    return stored.body
  } }) })
  expect(result).toEqual(legacyResult); expect(JSON.stringify(result)).toBe(JSON.stringify(legacyResult))
  expect(stored.body.rev).toBe(result.rev); expect(stored.body.rev).toBeGreaterThanOrEqual(result.appliedRev); expect(stored.body.state.programmes.cycles[0].status).toBe('active')
  if (action === 'skip') expect(stored.body.state.programmes.cycles[0].occurrences[0].status).toBe('skipped')
  if (action === 'shift') expect(result.position?.next?.date).toBe('2026-07-28')
  vi.restoreAllMocks()
})
test('activation installs the library original with a causal installed marker before its conditional PUT', async () => {
  const S = base(); S.programmes.definitions = []; S.programmes.offloaded = { synthetic: { versionId: 'old-version', at: Date.now() + 100 } }
  server = await target(S, [definition]); configure(server.env)
  const result = await TOOLS.find(t => t.name === 'activate_programme')!.handler({ programme_id: 'synthetic', expected_rev: 7, expected_wid: 'epoch', today: TODAY })
  const stored = (await server.request('GET', '/api/data')).body.state
  expect(result.ok).toBe(true); expect(stored.programmes.definitions[0].id).toBe('synthetic')
  expect(stored.programmes.installed.synthetic.at).toBeGreaterThan(S.programmes.offloaded.synthetic.at)
  expect(stored.programmes.installed.synthetic.versionId).toMatch(/^sha256:/)
  expect(stored.programmes.cycles[0].programmeId).toBe('synthetic')
})
test('read caching polls once per call, notices phone writes, and retains unknown fields', async () => {
  const S = base(); S.future = { retain: ['a', 'b'] }; server = await target(S)
  await withRemoteState(() => PROFILE_TOOLS[0]!.handler({}), { env: server.env, fetcher: server.fetcher })
  await withRemoteState(() => PROFILE_TOOLS[0]!.handler({}), { env: server.env, fetcher: server.fetcher })
  expect(server.calls.filter(c => c.path.endsWith('/rev'))).toHaveLength(2)
  expect(server.calls.filter(c => c.path === '/api/data')).toHaveLength(1)
  await server.request('PUT', '/api/data', { state: { ...S, routines: [{ id: 'phone', name: 'Phone', ex: [] }] }, baseRev: 7, baseWid: 'epoch' })
  const read = await withRemoteState(() => PROFILE_TOOLS[0]!.handler({}), { env: server.env, fetcher: server.fetcher })
  expect(read.routines[0].id).toBe('phone'); expect((await server.request('GET', '/api/data')).body.state.future).toEqual(S.future)
})
test('stale expected wid, mismatched profile and writes-disabled calls cannot change S04 data', async () => {
  server = await target(base()); configure(server.env)
  const params = { programme_id: 'synthetic', expected_rev: 7, expected_wid: 'other-epoch', today: TODAY }
  await expect(TOOLS.find(t => t.name === 'activate_programme')!.handler(params)).rejects.toMatchObject({ code: 'REV_CONFLICT' })
  vi.stubEnv('OPENGYM_UID', 'other-profile')
  await expect(TOOLS[0]!.handler({})).rejects.toMatchObject({ code: 'PROFILE_MISMATCH' })
  vi.stubEnv('OPENGYM_ENABLE_PROGRAMME_WRITES', '0')
  await expect(TOOLS.find(t => t.name === 'activate_programme')!.handler(params)).rejects.toMatchObject({ code: 'WRITES_DISABLED' })
  expect((await server.request('GET', '/api/data')).body.rev).toBe(7)
})
