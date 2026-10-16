import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../server/src/app'
import { openStore, putUser, commitStateDoc } from '../../server/src/storage'
import { putLibraryEntry } from '../../server/src/storage/library'
import { createAuth } from '../../server/src/auth'
import { DataService } from '../../server/src/data'
import { loadConfig } from '../../server/src/config'
import { createTools } from '../src/tools'
import { createMcpServer } from '../src/index'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { Fetcher } from '../src/http-client'
import { syntheticProgramme, syntheticSlot } from '../../core/test/fixtures/synthetic-programme'

const cleanups: (() => void)[] = []
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close() })
const at = { week: 2, day: 'd1', session: 'main', slot: 'bench' }
function fixture() {
  const d = syntheticProgramme(); d.lengthWeeks = 2; d.weeks.push({ ...structuredClone(d.weeks[0]), index: 2 })
  d.tmSeeds = { bench: { value: 100, unit: 'lb' } }
  d.progressionRules = [{ id: 'pct', kind: 'percentage', ref: { lift: 'bench', basis: 'tm' }, rounding: { increment: 5, mode: 'nearest', usePlates: false }, weeks: { '1': [{ pct: 0.8, reps: 5 }, { pct: 0.9, reps: 5 }], '2': [{ pct: 0.8, reps: 5 }, { pct: 0.9, reps: 5 }] } }]
  for (const w of d.weeks) { const s = syntheticSlot({ weeks: [w] }); s.pyramid = [5,5]; s.tm = { key: 'bench', percentages: [80, 90], reference: 'tm' }; s.progression.rules = ['pct'] }
  return { unit: 'lb', effortScale: 'rir', _rev: 4, _wid: 'read1', workouts: [], customEx: [], routines: d.weeks.map((w: any) => ({ id: `r${w.index}`, programme: { cycleId: 'c', instanceId: `o${w.index}`, weekIndex: w.index }, ex: structuredClone(w.days[0].sessions[0].routineSnapshot.ex).map((e: any) => ({ ...e, pyramid: [5,5] })) })), programmes: { version: 1, definitions: [d], cycles: [{ id: 'c', programmeId: d.id, status: 'active', snapshot: d, tmSeed: { bench: 100 }, cadence: { perWeek: 1 }, startsOn: '2026-01-05', notBefore: null, weekIndex: 1, week1StartDate: '2026-01-05', since: 10, occurrences: d.weeks.map((w: any) => ({ instanceId: `o${w.index}`, routineId: `r${w.index}`, weekIndex: w.index, dayKey: 'd1', sessionTemplateId: 'main', date: w.index === 1 ? '2026-01-05' : '2026-01-12', status: 'pending' })) }] } }
}
function target(state: any = fixture(), library: any[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'p6-inprocess-')), store = openStore(join(root, 'server'))
  const now = () => Date.parse('2026-01-05T12:00:00Z')
  const user = { id: 'test-uid', name: 'Synthetic', created: '2026-01-01', admin: 0, disabled: 0, sv: 0, invited_by: null, last_pull: null, last_reminder: null, last_nudge: null, ord: 0, x: '{}' }
  putUser(store.db, user); commitStateDoc(store.db, user.id, JSON.stringify(state), now(), 20)
  for (const definition of library) putLibraryEntry(store.db, user.id, definition.id, { definition, expectedVersionId: null, now: now() })
  const config = loadConfig({ DATA_DIR: store.dataDir, DEVICE_TOKENS: '1', ORIGIN: 'http://localhost:8080' })
  const auth = createAuth(store.db, config, { now, address: () => '127.0.0.1' }), data = new DataService(store.db, store.dataDir, { now, log: () => {} })
  const live = { active: false }
  const app = createApp(config, { auth, data, now, log: () => {}, progression: { today: () => '2026-01-05', livePresence: () => live.active ? { active: true } : null } })
  const env: Record<string,string> = { OPENGYM_URL: 'http://127.0.0.1:1', OPENGYM_TOKEN: auth.mint(user, 'agent'), OPENGYM_UID: user.id, OPENGYM_AUTHORING_DIR: join(root, 'drafts'), OPENGYM_ENABLE_PROGRAMME_AUTHORING: '1', OPENGYM_ENABLE_PROGRAMME_WRITES: '1' }
  const calls: { method: string; path: string; body?: any }[] = []
  // Requests are routed directly into the real S04/P5 Hono app, never to a listener.
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ method: init.method!, path: new URL(url).pathname, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) })
    return app.request(new Request(url, init))
  }
  const tools = createTools({ env, fetcher })
  const call = async (name: string, p: any = {}) => tools.find(t => t.name === name)!.handler(p)
  const saved = () => data.get(user.id)
  const apply = (p: any = {}) => call('apply_progression', { cycle_id: 'c', weeks: [2], expected_rev: saved().rev, expected_wid: saved().state!._wid, confirmNoActiveSession: true, ...p })
  const preview = (p: any = {}) => call('preview_progression', { source: { definitionId: 'synthetic' }, cycle_id: 'c', weeks: [2], ...p })
  cleanups.push(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  return { env, tools, calls, call, apply, preview, saved, live, state, fetcher }
}

test('default and confirm-only apply are dry runs with unchanged revision, wid and stored bytes', async () => {
  const h = target(), before = JSON.stringify(h.saved())
  for (const p of [{}, { confirm: true }, { dry_run: true, confirm: true }]) {
    const result = await h.apply(p)
    expect(result.dry_run).toBe(true); expect(result.changed.some((c: any) => c.ref.week === 2 && c.field === 'weight' && c.after === 80)).toBe(true)
    expect(JSON.stringify(h.saved())).toBe(before)
    expect(h.calls.filter(c => c.path === '/api/progression/apply').at(-1)!.body.dryRun).toBe(true)
  }
  expect(h.calls.filter(c => c.path === '/api/data/rev')).toHaveLength(3)
})
test('each write gate, explicit consent, active-session consent and undeclared keys refuse before any HTTP', async () => {
  const h = target()
  await expect(h.apply({ dry_run: false })).rejects.toMatchObject({ code: 'EINVAL' })
  for (const gate of ['OPENGYM_ENABLE_PROGRAMME_AUTHORING', 'OPENGYM_ENABLE_PROGRAMME_WRITES']) {
    h.env[gate] = '0'; await expect(h.apply({ dry_run: false, confirm: true })).rejects.toMatchObject({ code: 'WRITES_DISABLED' }); h.env[gate] = '1'
  }
  for (const p of [{ confirmNoActiveSession: false }, { confirmNoActiveSession: undefined }, { confirm_no_active_session: true }, { as_of: '2026-01-01' }]) await expect(h.apply(p)).rejects.toMatchObject({ code: 'EINVAL' })
  expect(h.calls).toEqual([])
})
test('confirmed apply writes only future prescriptions; second apply is a no-op and never estimates a TM seed', async () => {
  const h = target(), before: any = h.saved(), result = await h.apply({ dry_run: false, confirm: true })
  expect(result.stateRev).toBe(before.rev + 1); expect(result.warnings).toEqual([])
  const after: any = h.saved().state
  expect(after.routines[1].ex[0].weight).toBe(80); expect(after.routines[0]).toEqual(before.state!.routines[0])
  expect(after.workouts).toEqual(before.state!.workouts); expect(after.programmes.cycles[0].tmSeed).toEqual({ bench: 100 })
  const again = await h.apply({ dry_run: false, confirm: true }); expect(again.changed).toEqual([]); expect(again.stateRev).toBe(result.stateRev)
})
test('large confirmed apply always returns the committed revision with explicitly truncated change details', async () => {
  const state: any = fixture(), d = state.programmes.cycles[0].snapshot
  for (const w of d.weeks) { const base = syntheticSlot({ weeks: [w] }); w.days[0].sessions[0].routineSnapshot.ex = Array.from({ length: 60 },(_,i) => ({ ...structuredClone(base), slotId: 'bench-' + i })) }
  for (const [i,r] of state.routines.entries()) r.ex = structuredClone(d.weeks[i].days[0].sessions[0].routineSnapshot.ex)
  const h = target(state), before = h.saved().rev, out = await h.apply({ dry_run: false, confirm: true })
  expect(out.stateRev).toBe(before + 1); expect(h.saved().rev).toBe(out.stateRev); expect(out.changedTruncated).toBe(true)
  expect(out.totalChanges).toBeGreaterThan(out.changed.length); expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(128 * 1024)
  expect((h.saved().state!.routines as any[])[1]!.ex.every((e: any) => e.weight === 80)).toBe(true)
})
test('preview summaries retain each load and Why; full includes inputs and timeline; snake_case inputs map to HTTP', async () => {
  const h = target(), before = JSON.stringify(h.saved())
  const out = await h.preview({ as_of: '2026-01-05', hypothetical_logs: [] }), set = out.weeks[0].slots[0].sets[0]
  expect(set.load).toBe(80); expect(set.why[0]).toMatchObject({ ruleId: 'pct', kind: 'percentage' }); expect(set.why.every((w: any) => typeof w.text === 'string' && w.text.length)).toBe(true)
  expect(set.why[0].inputs).toBeUndefined(); expect(out.tm).toBeUndefined()
  const full = await h.preview({ full: true }); expect(full.weeks[0].slots[0].sets[0].why[0].inputs).toMatchObject({ reference: 100, pct: 0.8 }); expect(full.tm.bench[0].value).toBe(100)
  expect(h.calls.find(c => c.path.endsWith('/preview'))!.body).toMatchObject({ cycleId: 'c', asOf: '2026-01-05', hypotheticalLogs: [] })
  expect(JSON.stringify(h.saved())).toBe(before)
})
test('revision/wid conflicts, past-week 422 and active training pass through without retries or writes', async () => {
  const h = target(), before = JSON.stringify(h.saved())
  for (const p of [{ expected_rev: 1 }, { expected_wid: 'stale' }]) await expect(h.apply({ ...p, dry_run: false, confirm: true })).rejects.toMatchObject({ status: 409, code: 'REV_CONFLICT' })
  await expect(h.apply({ weeks: [64] })).rejects.toMatchObject({ status: 422, code: 'INVALID_RULES', issues: [{ path: 'weeks' }] })
  h.live.active = true; await expect(h.apply({ dry_run: false, confirm: true })).rejects.toMatchObject({ status: 423, code: 'TRAINING_NOW' })
  expect(h.calls.filter(c => c.path.endsWith('/apply'))).toHaveLength(4); expect(JSON.stringify(h.saved())).toBe(before)
})
test('inventory warning 422 is surfaced and never auto-confirmed; explicit inventory consent returns warnings', async () => {
  const state: any = fixture(), d = state.programmes.cycles[0].snapshot
  state.customEx = [{ id: 'bar', name: 'Synthetic custom bar', eq: 'barbell' }]; state.plates = { lb: { 45: 1, 5: 1 } }
  for (const w of d.weeks) { syntheticSlot({ weeks: [w] }).id = 'bar' }
  d.progressionRules[0].rounding.usePlates = true; const h = target(state), before = JSON.stringify(h.saved())
  const preview = await h.preview(); expect(preview.warnings.some((w: any) => w.code === 'rounding.large-adjustment')).toBe(true)
  for (const p of [{}, { confirmInventoryAdjustment: false }]) {
    await expect(h.apply({ ...p, dry_run: false, confirm: true })).rejects.toMatchObject({ status: 422, code: 'INVALID_RULES', warnings: expect.arrayContaining([expect.objectContaining({ code: 'rounding.large-adjustment' })]) })
    expect(JSON.stringify(h.saved())).toBe(before)
  }
  expect(h.calls.filter(c => c.path.endsWith('/apply')).every(c => c.body.confirmInventoryAdjustment !== true)).toBe(true)
  const result = await h.apply({ dry_run: false, confirm: true, confirmInventoryAdjustment: true })
  expect(result.warnings.some((w: any) => w.code === 'rounding.large-adjustment')).toBe(true)
  expect(h.calls.filter(c => c.path.endsWith('/apply'))).toHaveLength(3)
})
test('profile mismatch and unauthenticated HTTP refuse; tokens are absent from outputs and error messages', async () => {
  const h = target(), good = h.env.OPENGYM_TOKEN!
  expect(JSON.stringify(await h.preview())).not.toContain(good)
  h.env.OPENGYM_UID = 'other'; await expect(h.preview()).rejects.toMatchObject({ code: 'PROFILE_MISMATCH' })
  h.env.OPENGYM_UID = 'test-uid'; h.env.OPENGYM_TOKEN = 'synthetic-invalid-token'
  const e = await h.preview().catch(e => e); expect(e.code).toBe('API_REFUSED'); expect(e.message).not.toContain(h.env.OPENGYM_TOKEN)
})
test('validate installed and library definitions through HTTP with the current custom catalogue', async () => {
  const d = overlappingRamps(), state: any = fixture(); state.customEx = compound; state.programmes.definitions = [d]
  const h = target(state), before = JSON.stringify(h.saved())
  const installed = await h.call('validate_progression', { programme_id: d.id }); expect(installed.issues.some((i: any) => i.code === 'rule.two-volume-ramps')).toBe(true)
  const lib: any = fixture(); lib.customEx = compound; lib.programmes.definitions = []; lib.programmes.cycles = []
  const library = target(lib, [d]); const result = await library.call('validate_progression', { programme_id: d.id })
  expect(result.issues.some((i: any) => i.code === 'rule.two-volume-ramps')).toBe(true)
  expect(h.calls.every(c => c.method === 'GET')).toBe(true); expect(JSON.stringify(h.saved())).toBe(before)
})
const compound = [{ id: 'compound', name: 'Synthetic compound', eq: 'barbell', primaries: ['chest', 'triceps'] }]
function overlappingRamps() {
  const d = syntheticProgramme(), s = syntheticSlot(d); s.id = 'compound'; s.progression.rules = ['chest', 'triceps']
  d.progressionRules = ['chest', 'triceps'].map(m => ({ id: m, kind: 'volume-ramp', scope: { muscles: [m] }, startSets: 2, addPerWeek: 1, maxSets: 4, weeks: [1], distribute: 'round-robin-by-slot-order', holdIfMissedReps: false }))
  return d
}
test('local drafts validate against their own catalogue; rule sugar rolls back both rule and attachment on semantic failure', async () => {
  const h = target(), d = overlappingRamps()
  const draft = await h.call('create_program_draft', { from: 'scratch', definition: d })
  // Synthetic stored catalogue, equivalent to an HTTP clone; no profile data files.
  const { DraftStore } = await import('../src/draft-store'); const s = new DraftStore(h.env.OPENGYM_AUTHORING_DIR!)
  const changed = s.edit(draft.draft_id, draft.rev, d => { d.customEx = compound }); s.close()
  const result = await h.call('validate_progression', { draft_id: draft.draft_id }); expect(result.issues.some((i: any) => i.code === 'rule.two-volume-ramps')).toBe(true)
  const before = await h.call('get_program_draft', { draft_id: draft.draft_id, full: true })
  await expect(h.call('set_progression_rule', { draft_id: draft.draft_id, expected_rev: changed.rev, rule: { id: 'third', kind: 'linear', increment: 5, unit: 'lb', every: { sessions: 1 }, success: 'all-sets-all-reps', rounding: { increment: 5, mode: 'nearest', usePlates: false } }, at })).rejects.toMatchObject({ code: 'INVALID_RULES' })
  expect(await h.call('get_program_draft', { draft_id: draft.draft_id, full: true })).toEqual(before); expect(h.calls).toEqual([])
})
test('draft preview crosses only the HTTP preview boundary and cannot mutate its revision or account state', async () => {
  const h = target(), d = await h.call('create_program_draft', { from: 'scratch', definition: h.state.programmes.definitions[0] }), before = JSON.stringify(h.saved())
  const result = await h.preview({ source: { draft_id: d.draft_id } }); expect(result.weeks[0].slots[0].sets[0].load).toBe(80)
  expect((await h.call('get_program_draft', { draft_id: d.draft_id })).rev).toBe(d.rev); expect(JSON.stringify(h.saved())).toBe(before)
  expect(h.calls.filter(c => c.method !== 'GET').map(c => c.path)).toEqual(['/api/progression/preview'])
})
test('library and historical preview sources resolve through HTTP without relying on an unmounted P5 library seam', async () => {
  const state: any = fixture(), library = structuredClone(state.programmes.definitions[0]); library.id = 'library-progress'
  const h = target(state,[library]), before = JSON.stringify(h.saved())
  const response = await h.fetcher(h.env.OPENGYM_URL + '/api/programmes/library/library-progress',{ method: 'GET', headers: { Authorization: 'Bearer ' + h.env.OPENGYM_TOKEN } })
  const version = (await response.json() as any).versionId
  for (const source of [{ definitionId: library.id },{ definitionId: library.id, versionId: version }]) {
    const result = await h.preview({ source }); expect(result.weeks[0].slots[0].sets[0].load).toBe(80)
    expect(h.calls.filter(c => c.path.endsWith('/preview')).at(-1)!.body.source.definition.id).toBe(library.id)
  }
  await expect(h.preview({ source: { definitionId: library.id, versionId: 'missing' } })).rejects.toMatchObject({ status: 404 })
  expect(JSON.stringify(h.saved())).toBe(before)
})
test('draft rule semantic validation forwards custom muscles and kills an overlapping attachment atomically', async () => {
  const h = target(), def = overlappingRamps(); def.progressionRules.pop(); syntheticSlot(def).progression.rules = ['chest']
  const d = await h.call('create_program_draft', { from: 'scratch', definition: def })
  const { DraftStore } = await import('../src/draft-store'); const s = new DraftStore(h.env.OPENGYM_AUTHORING_DIR!)
  const stored = s.edit(d.draft_id,d.rev,d => { d.customEx = compound }); s.close()
  const before = await h.call('get_program_draft',{ draft_id: d.draft_id, full: true })
  await expect(h.call('set_progression_rule',{ draft_id: d.draft_id, expected_rev: stored.rev, rule: overlappingRamps().progressionRules[1], at: { ...at, week: 1 } })).rejects.toMatchObject({ code: 'INVALID_RULES' })
  expect(await h.call('get_program_draft',{ draft_id: d.draft_id, full: true })).toEqual(before)
})
test('actual MCP transport surfaces safe 422 diagnostics including inventory warning to the client', async () => {
  // Exercise the public error wrapper, with no HTTP listener or client credential output.
  const h = target(), tools = createTools({ env: h.env, fetcher: async (url, init) => {
    if (url.endsWith('/api/progression/apply')) return new Response(JSON.stringify({ code: 'INVALID_RULES', error: h.env.OPENGYM_TOKEN, state: { token: h.env.OPENGYM_TOKEN }, warnings: [{ code: 'rounding.large-adjustment', message: 'Synthetic inventory warning ' + h.env.OPENGYM_TOKEN, token: h.env.OPENGYM_TOKEN }], issues: [{ code: 'rule.range', path: '/rules', fix: 'Review inventory' }] }), { status: 422 })
    return h.fetcher(url, init)
  } })
  const server = createMcpServer(tools), client = new Client({ name: 'synthetic-p6', version: '1' }), [a, b] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(a); await client.connect(b)
    const result: any = await client.callTool({ name: 'apply_progression', arguments: { cycle_id: 'c', weeks: [2], expected_rev: 4, expected_wid: 'read1', confirmNoActiveSession: true } })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('INVALID_RULES:'); expect(result.content[0].text).toContain('422')
    expect(result.content[0].text).toContain('rounding.large-adjustment'); expect(result.content[0].text).toContain('/rules')
    expect(result.content[0].text).not.toContain(h.env.OPENGYM_TOKEN); expect(result.content[0].text).not.toContain('"token"'); expect(result.content[0].text).not.toContain('"state"')
  } finally { await client.close(); await server.close() }
})
test('authenticated validation redacts initial and renewed tokens echoed as malformed rule IDs through MCP', async () => {
  const h = target(), initial = h.env.OPENGYM_TOKEN!, renewed = 'synthetic-renewed-validation-secret', state = fixture()
  state.programmes.definitions[0].progressionRules = [initial,renewed].map(id => ({ id, kind: 'unsupported' }))
  const tools = createTools({ env: h.env, fetcher: async (url,init) => {
    if (url.endsWith('/api/me')) return Response.json({ user: { id: 'test-uid', name: 'Synthetic' }, token: renewed })
    if (url.endsWith('/api/data')) return Response.json({ rev: 4, state })
    if (url.endsWith('/api/data/rev')) return Response.json({ rev: 4, wid: 'read1' })
    return h.fetcher(url,init)
  } })
  const server = createMcpServer(tools), client = new Client({ name: 'synthetic-p6-validation', version: '1' }), [a,b] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(a); await client.connect(b)
    const result: any = await client.callTool({ name: 'validate_progression', arguments: { programme_id: 'synthetic' } })
    expect(result.isError).not.toBe(true); expect(result.content[0].text).not.toContain(initial); expect(result.content[0].text).not.toContain(renewed)
    const body = JSON.parse(result.content[0].text); expect(body.ok).toBe(false); expect(body.issues.map((i: any) => i.ruleId)).toContain('[redacted]')
  } finally { await client.close(); await server.close() }
})

test('SDK local clone outputs and rejected rule edits redact retained tokens, bearer and cookie values without HTTP', async () => {
  const h = target(), initial = h.env.OPENGYM_TOKEN!, renewed = 'synthetic-renewed-local-secret'
  const bearer = 'synthetic-bearer-local-secret', cookie = 'synthetic-cookie-local-secret', state = fixture()
  const labels = [initial, renewed, 'Bearer ' + bearer, 'Cookie: gymsid=' + cookie]
  state.programmes.definitions[0].name = labels.join(' / ')
  state.programmes.definitions[0].progressionRules = labels.map(id => ({ id, kind: 'unsupported' }))
  let requests = 0
  const tools = createTools({ env: h.env, fetcher: async (url,init) => {
    requests++
    if (url.endsWith('/api/me')) return Response.json({ user: { id: 'test-uid', name: 'Synthetic' }, token: renewed })
    if (url.endsWith('/api/data')) return Response.json({ rev: 4, state })
    if (url.endsWith('/api/data/rev')) return Response.json({ rev: 4, wid: 'read1' })
    return h.fetcher(url,init)
  } })
  const server = createMcpServer(tools), client = new Client({ name: 'synthetic-p6-local-redaction', version: '1' }), [a,b] = InMemoryTransport.createLinkedPair()
  const safe = (result: any) => {
    const text = JSON.stringify(result)
    for (const secret of [initial, renewed, bearer, cookie]) expect(text).not.toContain(secret)
    return result
  }
  const call = async (name: string, args: any) => safe(await client.callTool({ name, arguments: args }))
  try {
    await server.connect(a); await client.connect(b)
    const cloned: any = await call('create_program_draft', { from: 'clone', programme_id: 'synthetic' })
    expect(cloned.isError).not.toBe(true); expect(cloned.content[0].text).toContain('[redacted]')
    const { draft_id, rev } = JSON.parse(cloned.content[0].text), afterClone = requests
    // Redaction is an output view only: stored JSON retains the full cloned definition.
    const { DraftStore } = await import('../src/draft-store'), store = new DraftStore(h.env.OPENGYM_AUTHORING_DIR!)
    const before = store.db.query('SELECT rev,body FROM drafts WHERE id=?').get(draft_id)
    expect(JSON.stringify(store.get(draft_id).definition)).toContain(renewed)
    store.close()
    const validation: any = await call('validate_progression', { draft_id })
    expect(validation.isError).not.toBe(true); expect(JSON.parse(validation.content[0].text).ok).toBe(false)
    expect(validation.content[0].text).toContain('[redacted]')
    await call('validate_progression', { definition: state.programmes.definitions[0] })
    await call('validate_program', { draft_id })
    await call('get_program_draft', { draft_id, full: true })
    await call('list_program_drafts', {})
    const clean: any = await call('create_program_draft', { from: 'scratch', definition: fixture().programmes.definitions[0] })
    const other = JSON.parse(clean.content[0].text).draft_id
    for (const full of [false,true]) await call('diff_programs', { from: 'draft:' + draft_id, to: 'draft:' + other, full })
    const rule = { id: 'linear', kind: 'linear', increment: 5, unit: 'lb', every: { sessions: 1 }, success: 'all-sets-all-reps', rounding: { increment: 5, mode: 'nearest', usePlates: false } }
    for (const [name,args] of [
      ['set_progression_rule', { draft_id, expected_rev: rev, rule }],
      ['patch_program_draft', { draft_id, expected_rev: rev, ops: [{ op: 'setProgressionRules', rules: state.programmes.definitions[0].progressionRules }] }],
    ] as const) {
      const rejected: any = await call(name,args)
      expect(rejected.isError).toBe(true); expect(rejected.content[0].text).toContain('INVALID_RULES:')
      expect(rejected.content[0].text).toContain('[redacted]')
    }
    // These fail schema validation before the business handler runs.
    for (const label of labels) {
      const nested: any = await call('set_progression_rule', { draft_id, expected_rev: rev, rule, at: { ...at, [label]: true } })
      const enumValue: any = await call('create_program_draft', { from: label })
      for (const rejected of [nested, enumValue]) {
        expect(rejected.isError).toBe(true); expect(rejected.content[0].text).toContain('EINVAL:')
        expect(rejected.content[0].text).toContain('[redacted]')
      }
    }
    const capped: any = await call('set_progression_rule', { draft_id, expected_rev: rev, rule,
      at: { ...at, ['x'.repeat(1950) + renewed]: true } })
    expect(capped.isError).toBe(true); expect(capped.content[0].text).not.toContain(renewed.slice(0,12))
    const after = new DraftStore(h.env.OPENGYM_AUTHORING_DIR!)
    try { expect(after.db.query('SELECT rev,body FROM drafts WHERE id=?').get(draft_id)).toEqual(before) } finally { after.close() }
    expect(requests).toBe(afterClone)
  } finally { await client.close(); await server.close() }
})

test('SDK HTTP diagnostics redact separate credential segments in every allow-listed text field before capping', async () => {
  const h = target(), initial = 'syntheticPayloadPart.syntheticSignaturePart', renewed = 'renewedPayloadPart.renewedSignaturePart'
  h.env.OPENGYM_TOKEN = initial
  const segments = [...initial.split('.'), ...renewed.split('.')]
  const tools = createTools({ env: h.env, fetcher: async (url,init) => {
    if (url.endsWith('/api/me')) return Response.json({ user: { id: 'test-uid', name: 'Synthetic' }, token: renewed })
    if (url.endsWith('/api/data')) return Response.json({ rev: 4, state: fixture() })
    if (url.endsWith('/api/data/rev')) return Response.json({ rev: 4, wid: 'read1' })
    if (url.endsWith('/api/progression/apply')) return Response.json({ code: 'INVALID_RULES', issues: segments.map(segment => ({
      code: segment, path: '/rules/' + segment, fix: 'x'.repeat(1990) + segment, message: 'Review ' + segment,
    })) }, { status: 422 })
    return h.fetcher(url,init)
  } })
  const server = createMcpServer(tools), client = new Client({ name: 'synthetic-p6-segment-redaction', version: '1' }), [a,b] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(a); await client.connect(b)
    const result: any = await client.callTool({ name: 'apply_progression', arguments: { cycle_id: 'c', weeks: [2], expected_rev: 4, expected_wid: 'read1', confirmNoActiveSession: true } })
    expect(result.isError).toBe(true); expect(result.content[0].text).toContain('INVALID_RULES:')
    for (const segment of segments) {
      expect(JSON.stringify(result)).not.toContain(segment)
      expect(JSON.stringify(result)).not.toContain(segment.slice(0,10))
    }
    expect(result.content[0].text).toContain('[redacted]')
  } finally { await client.close(); await server.close() }
})

test('SDK local rule errors redact credentials spanning the 8000-character cap before truncating', async () => {
  const h = target(), secret = 'synthetic-boundary-secret-' + 's'.repeat(300)
  h.env.OPENGYM_TOKEN = secret
  const definition = fixture().programmes.definitions[0]
  // The raw issue's ruleId begins at character 43, crossing the 8000 cap.
  definition.progressionRules = [{ id: 'x'.repeat(7920) + secret, kind: 'unsupported' }]
  const { DraftStore } = await import('../src/draft-store'), store = new DraftStore(h.env.OPENGYM_AUTHORING_DIR!)
  const draft = store.create({ definition, origin: { kind: 'scratch' } }); store.close()
  const server = createMcpServer(createTools({ env: h.env, fetcher: async () => { throw new Error('Local validation must not do HTTP') } })), client = new Client({ name: 'synthetic-p6-cap-redaction', version: '1' }), [a,b] = InMemoryTransport.createLinkedPair()
  try {
    await server.connect(a); await client.connect(b)
    const result: any = await client.callTool({ name: 'set_progression_rule', arguments: { draft_id: draft.draftId, expected_rev: draft.rev,
      rule: { id: 'linear', kind: 'linear', increment: 5, unit: 'lb', every: { sessions: 1 }, success: 'all-sets-all-reps', rounding: { increment: 5, mode: 'nearest', usePlates: false } } } })
    expect(result.isError).toBe(true); expect(result.content[0].text).toContain('INVALID_RULES:')
    expect(result.content[0].text).toContain('[redacted]')
    expect(result.content[0].text).not.toContain(secret.slice(0,20))
  } finally { await client.close(); await server.close() }
})
