import { afterEach, beforeEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTools } from '../src/tools'
import { DraftStore } from '../src/draft-store'
import { diffDefinitions } from '../src/program-diff'
import { conformanceDelta } from '../src/program-diff'
import { validation } from '../src/authoring-tools'
import { target } from './http-helpers'
import { syntheticProgramme } from '../../core/test/fixtures/synthetic-programme'

let root: string, env: Record<string, string>, tools: ReturnType<typeof createTools>, api: Awaited<ReturnType<typeof target>> | undefined
const state = (extra: any = {}) => ({ _rev: 7, _wid: 'synthetic-epoch', routines: [], workouts: [], customEx: [], programmes: { definitions: [], cycles: [] }, ...extra })
const call = (name: string, p: any = {}): any => tools.find(t => t.name === name)!.handler(p)
const draft = (definition = syntheticProgramme()) => call('create_program_draft', { from: 'scratch', definition })
const params = (d: any, extra: any = {}) => ({ draft_id: d.draft_id, expected_rev: d.rev, expected_parent_version_id: null, ...extra })
const connect = async (s = state(), library: any[] = []) => {
  api = await target(s, library); env = { ...env, ...api.env }; tools = createTools({ env, fetcher: api.fetcher }); return api
}
const editStored = (id: string, change: (d: any) => void) => { const store = new DraftStore(env.OPENGYM_AUTHORING_DIR!); try { return store.edit(id, 1, change) } finally { store.close() } }
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'm03-synthetic-')); env = { OPENGYM_AUTHORING_DIR: join(root, 'authoring'), OPENGYM_ENABLE_PROGRAMME_AUTHORING: '1', OPENGYM_ENABLE_PROGRAMME_WRITES: '1' }; tools = createTools({ env }) })
afterEach(async () => { await api?.close(); api = undefined; rmSync(root, { recursive: true, force: true }) })

test('library list returns summary heads and active/privacy flags through authenticated direct HTTP', async () => {
  const definition = syntheticProgramme(); definition.source.private = true
  const api = await connect(state(), [definition])
  const before = await api.request('GET', '/api/data')
  await api.request('PUT', '/api/data', { baseRev: before.body.rev, baseWid: before.body.state._wid, state: { ...before.body.state, programmes: { definitions: [definition], cycles: [{ id: 'c', status: 'paused', programmeId: definition.id }] } } })
  api.calls.length = 0
  const result = await call('list_programmes')
  expect(result.items).toHaveLength(1); expect(result.items[0]).toMatchObject({ id: 'synthetic', level: 'Ready', private: true, inUse: true, versionN: 1 })
  expect(result.etag).toMatch(/^sha256:/); expect(result.items[0].definition).toBeUndefined()
  expect(api.calls.some(c => c.path === '/api/me')).toBe(true); expect(api.calls.every(c => c.method === 'GET')).toBe(true)
  env.OPENGYM_UID = 'wrong'; await expect(call('list_programmes')).rejects.toMatchObject({ code: 'PROFILE_MISMATCH' })
})
test('default publish and confirm alone only preview, without write gates or changes to drafts/state/library', async () => {
  const api = await connect(), d = await draft(), before = await api.request('GET', '/api/data')
  env.OPENGYM_ENABLE_PROGRAMME_AUTHORING = '0'; env.OPENGYM_ENABLE_PROGRAMME_WRITES = '0'
  expect(await call('publish_program_draft', params(d))).toMatchObject({ dry_run: true, published: false, definitionId: 'synthetic', level: 'Ready', private: true })
  expect(await call('publish_program_draft', params(d, { confirm: true }))).toMatchObject({ dry_run: true, published: false })
  expect((await call('list_programmes')).items).toEqual([]); expect((await api.request('GET', '/api/data')).body).toEqual(before.body)
  expect(call('get_program_draft', { draft_id: d.draft_id }).rev).toBe(1); expect(api.calls.every(c => c.method === 'GET')).toBe(true)
})

test('library summaries cap metadata and paginate without hiding privacy or version identity', async () => {
  const library = Array.from({ length: 3 }, (_, i) => ({ ...syntheticProgramme(), id: 'synthetic-' + i, name: 'Synthetic '.repeat(1000) }))
  await connect(state(), library)
  const first = await call('list_programmes', { limit: 2 })
  expect(first.items).toHaveLength(2); expect(first.items[0].name).toHaveLength(512); expect(first).toMatchObject({ truncated: true, totalItems: 3, nextOffset: 2 })
  const second = await call('list_programmes', { offset: first.nextOffset }); expect(second.items.map((i: any) => i.id)).toEqual(['synthetic-2']); expect(second.nextOffset).toBeNull(); expect(second.etag).toBe(first.etag)
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(64 * 1024)
})
test('explicit confirmed publish writes Ready to library only, keeps private draft and state bytes/revision', async () => {
  const api = await connect(), d = await draft(), before = await api.request('GET', '/api/data')
  const result = await call('publish_program_draft', params(d, { dry_run: false, confirm: true }))
  expect(result).toMatchObject({ published: true, dry_run: false, n: 1, level: 'Ready' }); expect(result.versionId).toMatch(/^sha256:/)
  const writes = api.calls.filter(c => c.method === 'PUT'); expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ path: '/api/programmes/library/synthetic', body: { minLevel: 'Ready', expectedVersionId: null, definition: { source: { private: true } } } })
  expect((await api.request('GET', '/api/data')).body).toEqual(before.body); expect(call('get_program_draft', { draft_id: d.draft_id }).rev).toBe(1)
  expect((await call('list_programmes')).items[0].private).toBe(true)
})
test('write requires confirmation and each independent gate, and fails before HTTP', async () => {
  const api = await connect(), d = await draft()
  await expect(call('publish_program_draft', params(d, { dry_run: false }))).rejects.toMatchObject({ code: 'EINVAL' })
  for (const gate of ['OPENGYM_ENABLE_PROGRAMME_AUTHORING', 'OPENGYM_ENABLE_PROGRAMME_WRITES']) {
    env[gate] = '0'; await expect(call('publish_program_draft', params(d, { dry_run: false, confirm: true }))).rejects.toMatchObject({ code: 'WRITES_DISABLED' }); env[gate] = '1'
  }
  expect(api.calls).toEqual([])
})
test('non-Ready drafts refuse dry run and confirmed writes with conformance', async () => {
  const api = await connect(), definition = syntheticProgramme(); delete definition.endPlan; const d = await draft(definition)
  for (const extra of [{}, { dry_run: false, confirm: true }]) await expect(call('publish_program_draft', params(d, extra))).rejects.toMatchObject({ code: 'NOT_READY', conformance: { level: 'Complete' } })
  expect(api.calls.every(c => c.method === 'GET')).toBe(true); expect((await call('list_programmes')).items).toEqual([])
})
test.each(['active', 'paused'])('publishing refuses %s cycles by programme id or frozen snapshot id', async status => {
  for (const reference of [{ programmeId: 'synthetic' }, { programmeId: 'different', snapshot: { id: 'synthetic' } }]) {
    const api = await connect(state({ programmes: { definitions: [], cycles: [{ id: 'cycle', status, ...reference }] } })), d = await draft()
    await expect(call('publish_program_draft', params(d, { dry_run: false, confirm: true }))).rejects.toMatchObject({ code: 'ACTIVE_DEFINITION' })
    expect(api.calls.every(c => c.method === 'GET')).toBe(true); await api.close()
  }
})
test('private downgrade through a damaged local record is refused even with a private library head', async () => {
  const definition = syntheticProgramme(); definition.source.private = true
  const api = await connect(state(), [definition]), d = await draft(), head = (await call('list_programmes')).items[0]
  const changed = editStored(d.draft_id, d => d.definition.source.private = false)
  await expect(call('publish_program_draft', params({ ...d, rev: changed.rev }, { expected_parent_version_id: head.versionId, replace: true, dry_run: false, confirm: true }))).rejects.toMatchObject({ code: 'PRIVATE_DOWNGRADE' })
  expect(api.calls.every(c => c.method === 'GET')).toBe(true)
})
test.each(['../bad', '.', '..', '...', 'bad/id', 'bad%2fid', 'x'.repeat(129), 'é'])('publish refuses definition id outside S08 allowlist: %s', async id => {
  const api = await connect(), definition = syntheticProgramme(); definition.id = id; const d = await draft(definition)
  await expect(call('publish_program_draft', params(d, { dry_run: false, confirm: true }))).rejects.toMatchObject({ code: 'EINVAL' }); expect(api.calls).toEqual([])
})
test('draft CAS, parent CAS and explicit replacement are required, without auto-rebase', async () => {
  const api = await connect(state(), [syntheticProgramme()]), d = await draft(), head = (await call('list_programmes')).items[0]
  await expect(call('publish_program_draft', params(d, { expected_rev: 2 }))).rejects.toMatchObject({ code: 'REV_CONFLICT' })
  await expect(call('publish_program_draft', params(d))).rejects.toMatchObject({ code: 'PARENT_CONFLICT' })
  await expect(call('publish_program_draft', params(d, { expected_parent_version_id: head.versionId }))).rejects.toMatchObject({ code: 'PARENT_CONFLICT' })
  expect(api.calls.every(c => c.method === 'GET')).toBe(true)
  const result = await call('publish_program_draft', params(d, { expected_parent_version_id: head.versionId, replace: true, dry_run: false, confirm: true }))
  expect(result.n).toBe(2)
})
test('server parent-version race is rejected atomically with no retry', async () => {
  const api = await connect(), d = await draft(); let raced = false
  tools = createTools({ env, fetcher: async (url, init) => {
    if (init.method === 'PUT' && !raced) { raced = true; const competing = syntheticProgramme(); competing.name = 'Synthetic competitor'; await api.request('PUT', '/api/programmes/library/synthetic', { definition: competing, expectedVersionId: null, minLevel: 'Ready' }) }
    return api.fetcher(url, init)
  } })
  await expect(call('publish_program_draft', params(d, { dry_run: false, confirm: true }))).rejects.toMatchObject({ code: 'PARENT_CONFLICT' })
  expect((await call('list_programmes')).items[0]).toMatchObject({ name: 'Synthetic competitor', versionN: 1 })
  expect(api.calls.filter(c => c.method === 'PUT')).toHaveLength(2)
})
test('local revision changed during HTTP preflight refuses publication', async () => {
  const api = await connect(), d = await draft(); let changed = false
  tools = createTools({ env, fetcher: async (url, init) => {
    const response = await api.fetcher(url, init)
    if (new URL(url).pathname === '/api/programmes/library' && !changed) { changed = true; editStored(d.draft_id, d => d.definition.name = 'Synthetic newer draft') }
    return response
  } })
  await expect(call('publish_program_draft', params(d, { dry_run: false, confirm: true }))).rejects.toMatchObject({ code: 'REV_CONFLICT' })
  expect(api.calls.every(c => c.method === 'GET')).toBe(true)
})

test('activation during publication is refused with the server domain code', async () => {
  const api = await connect(), d = await draft(); let activated = false
  tools = createTools({ env, fetcher: async (url, init) => {
    if (init.method === 'PUT' && new URL(url).pathname.startsWith('/api/programmes/library/') && !activated) {
      activated = true; const before = await api.request('GET', '/api/data')
      await api.request('PUT', '/api/data', { baseRev: before.body.rev, baseWid: before.body.state._wid, state: { ...before.body.state, programmes: { definitions: [syntheticProgramme()], cycles: [{ id: 'c', status: 'active', programmeId: 'synthetic' }] } } })
    }
    return api.fetcher(url, init)
  } })
  await expect(call('publish_program_draft', params(d, { dry_run: false, confirm: true }))).rejects.toMatchObject({ code: 'ACTIVE_DEFINITION' })
  expect((await call('list_programmes')).items).toEqual([]); expect(api.calls.filter(c => c.method === 'PUT' && c.path.startsWith('/api/programmes/library/'))).toHaveLength(1)
})

test('a custom exercise removed after preflight yields the server NOT_READY code', async () => {
  const custom = [{ id: 'c-removed', n: 'Synthetic custom press', bp: 'chest', eq: 'barbell' }], definition = syntheticProgramme(); definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].id = custom[0]!.id
  const api = await connect(state({ customEx: custom })), d = await draft(definition); let removed = false
  tools = createTools({ env, fetcher: async (url, init) => {
    if (init.method === 'PUT' && new URL(url).pathname.startsWith('/api/programmes/library/') && !removed) {
      removed = true; const before = await api.request('GET', '/api/data')
      await api.request('PUT', '/api/data', { baseRev: before.body.rev, baseWid: before.body.state._wid, state: { ...before.body.state, customEx: [] } })
    }
    return api.fetcher(url, init)
  } })
  await expect(call('publish_program_draft', params(d, { dry_run: false, confirm: true }))).rejects.toMatchObject({ code: 'NOT_READY' })
  expect((await call('list_programmes')).items).toEqual([])
})

test('long valid ids and repeated cloning retain fresh publishable opaque ids', async () => {
  await connect(); const definition = syntheticProgramme(); definition.id = 'x'.repeat(128)
  const first = await call('create_program_draft', { from: 'clone', definition }), firstDefinition = call('get_program_draft', { draft_id: first.draft_id, full: true }).definition
  expect(firstDefinition.id).toHaveLength(128)
  const second = await call('create_program_draft', { from: 'clone', draft_id: first.draft_id }), secondDefinition = call('get_program_draft', { draft_id: second.draft_id, full: true }).definition
  expect(secondDefinition.id).toHaveLength(128); expect(secondDefinition.id).not.toBe(firstDefinition.id)
  for (const d of [first, second]) expect(await call('publish_program_draft', params(d, { dry_run: false, confirm: true }))).toMatchObject({ published: true, level: 'Ready' })
  expect((await call('list_programmes')).items).toHaveLength(2)
})
test('fresh profile custom index determines publish readiness, ignoring stale draft metadata', async () => {
  const custom = [{ id: 'c-synthetic', n: 'Synthetic chest press', bp: 'chest', eq: 'barbell' }], definition = syntheticProgramme(); definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].id = custom[0]!.id
  const api = await connect(state({ customEx: custom })), d = await draft(definition)
  expect(d.level).not.toBe('Ready')
  expect(await call('publish_program_draft', params(d, { dry_run: false, confirm: true }))).toMatchObject({ published: true, level: 'Ready' })
  expect(api.calls.filter(c => c.method === 'PUT')[0]!.body.minLevel).toBe('Ready')
})
test('cloning an active definition publishes only its new private id', async () => {
  await connect(state({ programmes: { definitions: [syntheticProgramme()], cycles: [{ id: 'c', status: 'active', programmeId: 'synthetic' }] } }))
  const d = await call('create_program_draft', { from: 'clone', programme_id: 'synthetic' })
  const result = await call('publish_program_draft', params(d, { dry_run: false, confirm: true }))
  expect(result.definitionId).toMatch(/^synthetic-copy-/); expect((await call('list_programmes')).items.map((d: any) => d.id)).toEqual([result.definitionId])
})
test('local draft diff addresses stable slots, order moves and located conformance deltas without HTTP', async () => {
  const a = await draft(), definition = syntheticProgramme(), session = definition.weeks[0].days[0].sessions[0]
  session.routineSnapshot.ex.unshift({ ...structuredClone(session.routineSnapshot.ex[0]), slotId: 'new', reps: 8 })
  session.routineSnapshot.ex[1].reps = 6; delete definition.endPlan; const b = await draft(definition)
  const result = await call('diff_programs', { from: 'draft:' + a.draft_id + '@1', to: 'draft:' + b.draft_id })
  expect(result.entries).toContainEqual({ kind: 'changed', location: { week: 1, day: 'd1', session: 'main', slot: 'bench' }, field: 'reps', before: 5, after: 6 })
  expect(result.entries.some((e: any) => e.kind === 'added' && e.location.slot === 'new')).toBe(true)
  expect(result.entries).toContainEqual({ kind: 'moved', location: { week: 1, day: 'd1', session: 'main', slot: 'bench' }, before: 0, after: 1 })
  expect(result.conformance.introduced.map((i: any) => i.code)).toContain('program.end-plan')
  const reverse = await call('diff_programs', { from: 'draft:' + b.draft_id, to: 'draft:' + a.draft_id }); expect(reverse.conformance.resolved.map((i: any) => i.code)).toContain('program.end-plan')
  await expect(call('diff_programs', { from: 'draft:' + a.draft_id + '@2', to: 'draft:' + b.draft_id })).rejects.toMatchObject({ code: 'REV_CONFLICT' })
})
test('keyed diff survives reordered weeks/days/sessions, handles removal and ignores object key order', () => {
  const a = syntheticProgramme(), b = structuredClone(a)
  a.weeks.push({ ...structuredClone(a.weeks[0]), index: 2 }); b.weeks = structuredClone(a.weeks).reverse()
  a.weeks[0].days.push({ key: 'd2', sessions: [] }); b.weeks[1].days = structuredClone(a.weeks[0].days).reverse()
  const session = a.weeks[0].days[0].sessions[0]; session.routineSnapshot.ex.push({ ...structuredClone(session.routineSnapshot.ex[0]), slotId: 'removed' })
  session.extra = 'changed'; a.weeks[0].days[0].sessions.push({ sessionTemplateId: 's2', routineSnapshot: { ex: [] } })
  b.weeks[1].days[1].sessions = structuredClone(a.weeks[0].days[0].sessions).reverse(); b.weeks[1].days[1].sessions[1].routineSnapshot.ex.pop()
  const entries = diffDefinitions(a, b)
  for (const location of [{ week: 1 }, { week: 1, day: 'd1' }, { week: 1, day: 'd1', session: 'main' }]) expect(entries.some(e => e.kind === 'moved' && JSON.stringify(e.location) === JSON.stringify(location))).toBe(true)
  expect(entries.some(e => e.kind === 'removed' && e.location.slot === 'removed')).toBe(true)
  expect(diffDefinitions({ name: 'x', source: { a: 1, b: 2 } }, { source: { b: 2, a: 1 }, name: 'x' })).toEqual([])
  expect(diffDefinitions({ extra: [] }, { extra: {} })).toEqual([{ kind: 'changed', location: {}, field: 'extra', before: [], after: {} }])
  b.weeks.push(b.weeks[0]); expect(() => diffDefinitions(a, b)).toThrow('unique index')
})
test('definition diff resolves HTTP historical library versions and installed definitions', async () => {
  const api = await connect(state({ programmes: { definitions: [{ ...syntheticProgramme(), id: 'installed' }], cycles: [] } }), [syntheticProgramme()]), d = await draft(), first = (await call('list_programmes')).items[0]
  const second = syntheticProgramme(); second.name = 'Synthetic second version'
  await api.request('PUT', '/api/programmes/library/synthetic', { definition: second, expectedVersionId: first.versionId, minLevel: 'Ready' })
  const result = await call('diff_programs', { from: 'def:synthetic@1', to: 'def:synthetic' })
  expect(result.entries).toContainEqual({ kind: 'changed', location: {}, field: 'name', before: 'Synthetic authored block', after: 'Synthetic second version' })
  expect((await call('diff_programs', { from: 'def:synthetic@' + first.versionId, to: 'draft:' + d.draft_id })).entries.some((e: any) => e.field === 'name')).toBe(false)
  expect((await call('diff_programs', { from: 'def:installed', to: 'draft:' + d.draft_id })).entries.some((e: any) => e.field === 'id')).toBe(true)
  await expect(call('diff_programs', { from: 'def:missing', to: 'draft:' + d.draft_id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(call('diff_programs', { from: 'def:synthetic@999', to: 'draft:' + d.draft_id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  await expect(call('diff_programs', { from: 'def:../bad', to: 'draft:' + d.draft_id })).rejects.toMatchObject({ code: 'EINVAL' })
  expect(api.calls.filter(c => c.method === 'PUT')).toHaveLength(1)
})

test('unchanged anonymous legacy collections can diff metadata, but changed anonymous content fails closed', () => {
  const a = syntheticProgramme(); delete a.weeks[0].days[0].sessions[0].sessionTemplateId; delete a.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].slotId
  const b = structuredClone(a); expect(diffDefinitions(a, b)).toEqual([])
  b.name = 'Synthetic new name'; expect(diffDefinitions(a, b)).toEqual([{ kind: 'changed', location: {}, field: 'name', before: a.name, after: b.name }])
  b.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].reps = 6
  expect(() => diffDefinitions(a, b)).toThrow('changed anonymous collections cannot be matched safely')
})

test('moving an invalid slot/week preserves conformance issue identity despite schema array paths', () => {
  const a = syntheticProgramme(); a.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].sets = 0
  a.weeks.push({ ...structuredClone(syntheticProgramme().weeks[0]), index: 2 }); const b = structuredClone(a); b.weeks.reverse()
  const result = conformanceDelta(validation(a, [], true), validation(b, [], true))
  expect(result.resolved).toEqual([]); expect(result.introduced).toEqual([])
  b.weeks[1].days[0].sessions[0].routineSnapshot.ex[0].sets = 2
  expect(conformanceDelta(validation(a, [], true), validation(b, [], true)).resolved.some((i: any) => i.code === 'structure.invalid')).toBe(true)
})
test.each(['week', 'day', 'session'] as const)('moving an invalid %s preserves its schema issue identity', async level => {
  const definition = syntheticProgramme(), week = definition.weeks[0], day = week.days[0], session = day.sessions[0]
  let rows: any[], field: string, location: any
  if (level === 'week') {
    week.mode = 'invalid'; definition.lengthWeeks = 2
    definition.weeks.push({ ...structuredClone(week), index: 2 })
    rows = definition.weeks; field = 'mode'; location = { week: 1 }
  } else if (level === 'day') {
    day.ordinal = 0; week.days.push({ ...structuredClone(day), key: 'd2' })
    rows = week.days; field = 'ordinal'; location = { week: 1, day: 'd1' }
  } else {
    session.routineSnapshot.name = 123; day.sessions.push({ ...structuredClone(session), sessionTemplateId: 'second' })
    rows = day.sessions; field = 'name'; location = { week: 1, day: 'd1', session: 'main' }
  }
  const prescription = (row: any) => level === 'session' ? row.routineSnapshot : row
  delete prescription(rows[1])[field]
  const a = await draft(definition)
  rows.reverse(); const b = await draft(definition)
  const result = await call('diff_programs', { from: 'draft:' + a.draft_id, to: 'draft:' + b.draft_id, full: true })
  expect(result.conformance.from.issues.filter((i: any) => i.code === 'structure.invalid')).toHaveLength(1)
  expect(result.entries).toContainEqual({ kind: 'moved', location, before: 0, after: 1 })
  expect(result.entries.every((e: any) => e.kind === 'moved')).toBe(true)
  expect(result.conformance.resolved).toEqual([]); expect(result.conformance.introduced).toEqual([])
  // Resolving just one of two identical errors must not merge distinct identities.
  prescription(rows[0])[field] = prescription(rows[1])[field]; const bothInvalid = await draft(definition)
  delete prescription(rows[1])[field]; const c = await draft(definition)
  const repaired = await call('diff_programs', { from: 'draft:' + bothInvalid.draft_id, to: 'draft:' + c.draft_id, full: true })
  expect(repaired.conformance.resolved).toHaveLength(1); expect(repaired.conformance.introduced).toEqual([])
  expect(repaired.conformance.to.issues.filter((i: any) => i.code === 'structure.invalid')).toHaveLength(1)
})

test.each(['from', 'to'] as const)('diff invokes %s validation with its own custom exercise catalogue', async side => {
  const drafts: any[] = []
  for (const [position, id] of ['c-from-help', 'c-to-help'].entries()) {
    const definition = syntheticProgramme(); definition.weeks[0].days[0].sessions[0].routineSnapshot.ex[0].id = id
    if (position === 1) delete definition.licence
    const d = await draft(definition)
    editStored(d.draft_id, stored => { stored.customEx = [{ id, n: 'Synthetic ' + id, bp: position === 0 ? 'chest' : 'back', eq: 'leverage machine', assisted: true }] })
    drafts.push(d)
  }
  const result = await call('diff_programs', { from: 'draft:' + drafts[0].draft_id, to: 'draft:' + drafts[1].draft_id, full: true })
  expect(result.conformance[side]).toMatchObject({ level: side === 'from' ? 'Ready' : 'Complete', counts: { byCode: side === 'from' ? {} : { 'metadata.licence': 1 } } })
  expect(result.conformance[side].issues.map((i: any) => i.code)).toEqual(side === 'from' ? [] : ['metadata.licence'])
  expect(result.conformance.resolved).toEqual([])
  expect(result.conformance.introduced.map((i: any) => i.code)).toEqual(['metadata.licence'])
})
test('large diff is capped with explicit truncation and full opt-in', async () => {
  const a = await draft(), definition = syntheticProgramme(); definition.note = 'Synthetic '.repeat(10000); const b = await draft(definition)
  const p = { from: 'draft:' + a.draft_id, to: 'draft:' + b.draft_id }
  const short = await call('diff_programs', p); expect(short.truncated).toBe(true); expect(short.totalEntries).toBe(1); expect(Buffer.byteLength(JSON.stringify(short))).toBeLessThan(64 * 1024)
  expect((await call('diff_programs', { ...p, full: true })).entries[0].after).toBe(definition.note)
})

test('conformance deltas use issues beyond the summary cap and report capped output accurately', async () => {
  const definition = syntheticProgramme(), session = definition.weeks[0].days[0].sessions[0], slot = session.routineSnapshot.ex[0]
  session.routineSnapshot.ex = Array.from({ length: 100 }, (_, i) => { const e = { ...structuredClone(slot), slotId: 'e' + i }; delete e.target; return e })
  definition.weeks[0].days[0].sessions = Array.from({ length: 3 }, (_, i) => ({ ...structuredClone(session), sessionTemplateId: 's' + i }))
  const a = await draft(definition); definition.weeks[0].days[0].sessions[2].routineSnapshot.ex[99].target = { rpe: 8 }; const b = await draft(definition)
  const result = await call('diff_programs', { from: 'draft:' + a.draft_id, to: 'draft:' + b.draft_id })
  expect(result.conformance.from.totalIssues).toBeGreaterThan(200)
  expect(result.conformance.resolved.some((i: any) => i.location.session === 's2' && i.location.slot === 'e99')).toBe(true)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(64 * 1024)
})

test('definition diff distinguishes missing and empty collections at every authoring level', () => {
 const checks: [any, any, string][] = [[{}, {weeks: []}, 'weeks'],
  [{weeks: [{index: 1}]}, {weeks: [{index: 1, days: []}]}, 'days'],
  [{weeks: [{index: 1, days: [{key: 'd1'}]}]}, {weeks: [{index: 1, days: [{key: 'd1', sessions: []}]}]}, 'sessions'],
  [{weeks: [{index: 1, days: [{key: 'd1', sessions: [{sessionTemplateId: 'main', routineSnapshot: {}}]}]}]}, {weeks: [{index: 1, days: [{key: 'd1', sessions: [{sessionTemplateId: 'main', routineSnapshot: {ex: []}}]}]}]}, 'ex']]
 for (const [a,b,field] of checks) {
   expect(diffDefinitions(a,b)).toContainEqual(expect.objectContaining({kind: 'changed', field, after: []}))
   expect(diffDefinitions(b,a)).toContainEqual(expect.objectContaining({kind: 'changed', field, before: []}))
 }
})
