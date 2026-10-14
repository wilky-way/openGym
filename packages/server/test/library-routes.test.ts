import { test, expect } from 'bun:test'
import { definition, libraryServer } from './library-helpers'
import { bearer, cookie } from './auth-helpers'
import { commitStateDoc, getUser, putUser } from '../src/storage'
import { LIMITS } from '@opengym/contract/http/api'
import { createApp } from '../src/app'
import { RequestBody } from '../src/http'
import { getLibraryEntry } from '../src/storage/library'
import { request as httpRequest } from 'node:http'

const state = (h: ReturnType<typeof libraryServer>, value: unknown, uid = 'u_phone') => commitStateDoc(h.db, uid, JSON.stringify({ _rev: 1, ...(value as object) }), h.clock.t, 50)
// Dial the scratch listener directly, regardless of proxy environment variables.
function tcpRequest(h: ReturnType<typeof libraryServer>, path: string, method = 'GET', body?: unknown): Promise<Response> {
  const text = body === undefined ? undefined : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = httpRequest(h.api + '/api/programmes/' + path, { method, agent: false,
      headers: { ...cookie('u_phone'), ...(text === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) }) } }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(Buffer.from(chunk)))
      res.on('error', reject)
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode! })))
    })
    req.on('error', reject)
    req.end(text)
  })
}
const tcpPut = (h: ReturnType<typeof libraryServer>, d: ReturnType<typeof definition>, expectedVersionId: string | null, minLevel = 'Valid') =>
  tcpRequest(h, 'library/' + d.id, 'PUT', { definition: d, expectedVersionId, minLevel })

test('a custom catalogue-alias id cannot break profile validation or publishing over TCP', async () => {
  const h = libraryServer()
  state(h, { customEx: [{ id: '1019', n: 'Synthetic custom lift', bp: 'back', eq: 'custom' }] })
  for (const [id, exerciseId] of [['unrelated', '0025'], ['uses-custom-alias', '1019']]) {
    const d = definition(id)
    d.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!.id = exerciseId!
    const ready = await tcpRequest(h, 'validate', 'POST', { definition: d })
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ level: 'Ready', nextLevel: null, issues: [], counts: { byCode: {}, byLevel: {} } })
    const published = await tcpPut(h, d, null, 'Ready')
    expect(published.status).toBe(200)
    const parent = await published.json()
    expect(parent).toMatchObject({ level: 'Ready', n: 1, definition: d })
    delete d.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!.target
    const incomplete = await tcpRequest(h, 'validate', 'POST', { definition: d })
    expect(incomplete.status).toBe(200)
    const issues = { level: 'Valid', nextLevel: 'Complete', issues: [{ code: 'slot.effort', location: { week: 1, day: 'd1', session: 'main', slot: 'bench' }, fix: 'Supply an authored RIR, RPE or percentage target for every working set.', requiredFor: 'Complete', sets: [1, 2] }], counts: { byCode: { 'slot.effort': 1 }, byLevel: { Complete: 1 } } }
    expect(await incomplete.json()).toEqual(issues)
    const rejected = await tcpPut(h, d, parent.versionId, 'Ready')
    expect(rejected.status).toBe(422)
    expect(await rejected.json()).toMatchObject({ code: 'not-ready', ...issues })
    const draft = await tcpPut(h, d, parent.versionId)
    expect(draft.status).toBe(200)
    expect(await draft.json()).toMatchObject({ level: 'Valid', n: 2, definition: d })
  }
})

test('malformed cycle statuses neither crash the TCP listing nor mark definitions in use', async () => {
  const h = libraryServer()
  let parent = await (await tcpPut(h, definition(), null)).json()
  for (const status of [{ toString: null }, ['active'], ['paused'], {}, null, 1]) {
    state(h, { programmes: { cycles: [{ id: 'cycle', status, programmeId: 'synthetic' }] } })
    const listing = await tcpRequest(h, 'library')
    expect(listing.status).toBe(200)
    expect((await listing.json()).items[0].inUse).toBe(false)
    const d = { ...definition(), name: 'Replacement ' + JSON.stringify(status) }
    const published = await tcpPut(h, d, parent.versionId)
    expect(published.status).toBe(200)
    parent = await published.json()
    expect(parent.definition).toEqual(d)
  }
})

test('all five library/validation routes require a session and writes retain CSRF enforcement', async () => {
  const h = libraryServer()
  for (const [path, method] of [['library','GET'], ['library/synthetic','GET'], ['library/synthetic/versions','GET'], ['library/synthetic','PUT'], ['validate','POST']]) {
    const r = await fetch(h.api + '/api/programmes/' + path, { method, ...(method === 'GET' ? {} : { body: '{}' }) })
    expect(r.status).toBe(401)
  }
  const r = await fetch(h.api + '/api/programmes/library/synthetic', { method: 'PUT', headers: { ...cookie('u_phone'), Origin: 'https://hostile.invalid' }, body: JSON.stringify({ definition: definition(), expectedVersionId: null }) })
  expect(r.status).toBe(403)
  expect((await h.request('library')).status).toBe(200)
})

test('publish, list, entry and immutable version selectors preserve original order and metadata', async () => {
  const h = libraryServer(), d = definition()
  const published = await h.put(d)
  expect(published.status).toBe(200)
  const one = await published.json()
  expect(one).toMatchObject({ n: 1, level: 'Ready', definition: d })
  expect(one.versionId).toMatch(/^sha256:[a-f0-9]{64}$/)
  const listing = await (await h.request('library')).json()
  expect(listing.items).toEqual([{ id: d.id, name: d.name, level: 'Ready', private: false, versionN: 1, versionId: one.versionId, bytes: Buffer.byteLength(JSON.stringify(d)), updatedAt: new Date(h.clock.t).toISOString(), sourceKind: 'own', daysPerWeek: 1, lengthWeeks: 1, goal: 'Strength', inUse: false }])
  expect((await (await h.request('library')).json()).etag).toBe(listing.etag)
  const reordered = Object.fromEntries(Object.entries(d).reverse()) as typeof d
  const two = await (await h.put(reordered, one.versionId)).json()
  expect(two).toEqual(one)
  const latest = await (await h.request('library/synthetic')).json()
  expect(JSON.stringify(latest.definition)).toBe(JSON.stringify(d))
  const original = await (await h.request('library/synthetic?version=1')).json()
  expect(JSON.stringify(original.definition)).toBe(JSON.stringify(d))
  expect(await (await h.request('library/synthetic?version=' + one.versionId)).json()).toEqual(two)
  const changed = { ...reordered, name: 'Synthetic child' }
  expect((await h.put(changed, one.versionId)).status).toBe(200)
  const versions = await (await h.request('library/synthetic/versions')).json()
  expect(versions.versions).toHaveLength(2)
  expect(versions.versions[1]).toMatchObject({ n: 2, parentVersionId: one.versionId, bytes: Buffer.byteLength(JSON.stringify(changed)) })
  expect((await h.request('library/synthetic?version=999')).status).toBe(404)
  expect((await h.request('library/missing')).status).toBe(404)
  expect((await h.request('library/missing/versions')).status).toBe(404)
  expect((await (await h.request('library')).json()).etag).not.toBe(listing.etag)
})

test('concurrent changed PUTs with the same parent yield one success and one version conflict', async () => {
  const h = libraryServer(), parent = await (await h.put()).json()
  const responses = await Promise.all(['Child A','Child B'].map(name => h.put({ ...definition(), name }, parent.versionId)))
  expect(responses.map(r => r.status).sort()).toEqual([200,409])
  expect(await responses.find(r => r.status === 409)!.json()).toMatchObject({ code: 'version-conflict' })
  expect((await (await h.request('library/synthetic/versions')).json()).versions).toHaveLength(2)
  expect((await h.put(definition(), null)).status).toBe(409)
  expect((await h.put(definition('new-id'), parent.versionId)).status).toBe(409)
})

test('default Valid admits incomplete imports while Ready publishing returns actionable conformance issues', async () => {
  const h = libraryServer(), d = definition()
  delete d.goal; delete d.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!.target
  const result = await (await h.request('validate', 'POST', { definition: d })).json()
  expect(result.level).toBe('Valid'); expect(result.nextLevel).toBe('Complete')
  expect(result.issues.some((i: { code: string }) => i.code === 'slot.effort')).toBe(true)
  expect(result.counts.byCode['slot.effort']).toBe(1)
  expect(result.counts.byLevel.Complete).toBe(1)
  const rejected = await h.put(d, null, 'Ready')
  expect(rejected.status).toBe(422)
  expect(await rejected.json()).toMatchObject({ code: 'not-ready', ...result })
  expect((await h.put(d)).status).toBe(200)
  const ready = await (await h.request('validate', 'POST', { definition: definition() })).json()
  expect(ready).toEqual({ level: 'Ready', nextLevel: null, issues: [], counts: { byCode: {}, byLevel: {} } })
})

test('malformed definitions return Invalid and are refused by the default publish level', async () => {
  const h = libraryServer()
  for (const d of [null, 1, [], {}, { ...definition(), weeks: [null] }, { ...definition(), weeks: 'broken' }]) {
    const r = await h.request('validate', 'POST', { definition: d })
    expect(r.status).toBe(200); expect((await r.json()).level).toBe('Invalid')
  }
  const bad = await h.put({ ...definition(), weeks: [] } as any)
  expect(bad.status).toBe(422); expect((await bad.json()).code).toBe('not-ready')
  for (const body of [{}, { definition: definition() }, { definition: definition(), expectedVersionId: 1 }, { definition: definition(), expectedVersionId: null, minLevel: 'unknown' }, { definition: definition('different'), expectedVersionId: null }]) {
    expect((await h.request('library/synthetic', 'PUT', body)).status).toBe(400)
  }
  expect((await h.request('validate', 'POST', {})).status).toBe(400)
  const r = await fetch(h.api + '/api/programmes/validate', { method: 'POST', headers: cookie('u_phone'), body: '{broken' })
  expect(r.status).toBe(400)
})

test('active and paused cycles including snapshot references block creation and replacement; terminal cycles permit writes', async () => {
  const h = libraryServer(), parent = await (await h.put()).json()
  for (const status of ['active','paused']) for (const reference of [{ programmeId: 'synthetic' }, { snapshot: { id: 'synthetic' } }]) {
    state(h, { programmes: { cycles: [{ id: 'cycle', status, ...reference }] } })
    const r = await h.put({ ...definition(), name: 'Replacement' }, parent.versionId)
    expect(r.status).toBe(409); expect((await r.json()).code).toBe('active-definition')
    expect((await (await h.request('library')).json()).items[0].inUse).toBe(true)
    expect(await (await h.request('library/synthetic')).json()).toEqual(parent)
  }
  state(h, { programmes: { cycles: [{ id: 'new', status: 'active', programmeId: 'new-id' }] } })
  expect((await h.put(definition('new-id'))).status).toBe(409)
  for (const status of ['finished','archived']) {
    state(h, { programmes: { cycles: [{ id: 'cycle', status, programmeId: 'synthetic' }] } })
    expect((await (await h.request('library')).json()).items[0].inUse).toBe(false)
  }
  expect((await h.put({ ...definition(), name: 'Replacement' }, parent.versionId)).status).toBe(200)
})

test('private head and installed private definitions cannot be downgraded; paid prefixes remain private', async () => {
  const h = libraryServer(), d = definition()
  d.source!.private = true
  const first = await (await h.put(d)).json()
  const publicD = definition(), denied = await h.put(publicD, first.versionId)
  expect(denied.status).toBe(403); expect((await denied.json()).code).toBe('private-downgrade')
  const removed = { ...publicD }; delete removed.source
  expect((await h.put(removed, first.versionId)).status).toBe(403)
  expect(await (await h.request('library/synthetic')).json()).toEqual(first)
  for (const id of [String.fromCharCode(98,98,109),String.fromCharCode(115,98,115)].map(prefix => `${prefix}-synthetic`)) {
    expect((await h.put(definition(id))).status).toBe(200)
    expect((await (await h.request('library')).json()).items.find((i: { id: string }) => i.id === id).private).toBe(true)
  }
  state(h, { programmes: { definitions: [d] } }, 'u_test_1')
  expect((await h.put(publicD, null, undefined, 'u_test_1')).status).toBe(403)
})

test('profile isolation applies to reads, versions, parent CAS, in-use and custom validation', async () => {
  const h = libraryServer(), d = definition()
  await h.put(d)
  expect((await (await h.request('library','GET',undefined,'u_test_1')).json()).items).toEqual([])
  expect((await h.request('library/synthetic','GET',undefined,'u_test_1')).status).toBe(404)
  expect((await h.request('library/synthetic/versions','GET',undefined,'u_test_1')).status).toBe(404)
  state(h, { programmes: { cycles: [{ id: 'cycle', status: 'active', programmeId: d.id }] } })
  expect((await h.put(d,null,undefined,'u_test_1')).status).toBe(200)
})

test('REAL custom assisted exercise from profile state reaches validation and publishing with no global leak', async () => {
  const h = libraryServer(), d = definition()
  d.weeks[0]!.days[0]!.sessions[0]!.routineSnapshot.ex[0]!.id = 'custom-assisted'
  const customEx = [{ id: 'custom-assisted', name: 'Synthetic assisted pull-up', eq: 'assisted', bp: 'back', custom: true, assisted: true }]
  state(h, { customEx })
  const validated = await h.request('validate','POST',{ definition: d })
  expect(validated.status).toBe(200); expect((await validated.json()).level).toBe('Ready')
  expect((await h.put(d,null,'Ready')).status).toBe(200)
  const other = await h.request('validate','POST',{ definition: d },'u_test_1')
  expect((await other.json()).level).toBe('Invalid')
  expect((await h.put(d,null,'Ready','u_test_1')).status).toBe(422)
})

test('wire IDs reject encoded slash, traversal, backslash and overlong segments before storage', async () => {
  const h = libraryServer()
  for (const id of ['a%2Fb','%2e%2e%2Foutside','a%5Cb','%252F','a'.repeat(129)]) for (const suffix of ['', '/versions']) {
    const r = await h.request('library/' + id + suffix)
    expect(r.status).toBe(400); expect((await r.json()).code).toBe('bad-request')
  }
  for (const id of ['a%2Fb','%2e%2e%2Foutside','a%5Cb']) {
    const r = await h.request('library/' + id, 'PUT', { definition: definition(), expectedVersionId: null })
    expect(r.status).toBe(400)
  }
  expect((await h.put(definition('__proto__'))).status).toBe(200)
  expect((await h.request('library/__proto__')).status).toBe(200)
  expect(h.db.query('SELECT * FROM library_definitions').all()).toHaveLength(1)
})

test('definition UTF-8 cap refuses repository oversize and transport cap refuses oversized HTTP body', async () => {
  const h = libraryServer(), d = { ...definition(), retained: 'é'.repeat(LIMITS.maxDefinitionBytes / 2) }
  const r = await h.put(d)
  expect(r.status).toBe(413)
  expect((await (await h.request('library')).json()).items).toEqual([])
  const { putLibraryEntry } = await import('../src/storage/library')
  expect(() => putLibraryEntry(h.db,'u_phone',d.id,{ definition: d, expectedVersionId: null })).toThrow('too large')
})

test('pending publish and validate reverify a session disabled during the body read', async () => {
  for (const path of ['library/synthetic','validate']) {
    const h = libraryServer(), method = path === 'validate' ? 'POST' : 'PUT'
    const request = new Request('http://gym/api/programmes/' + path, { method, headers: cookie('u_phone') })
    let reading!: () => void, release!: () => void
    const started = new Promise<void>(r => reading = r), ready = new Promise<void>(r => release = r)
    class Delayed extends RequestBody {
      override async readJson(): Promise<Record<string, unknown>> { reading(); await ready; return { definition: definition(), expectedVersionId: null } }
    }
    const app = createApp(h.config,{ auth: h.auth })
    const pending = app.fetch(request,{ body: new Delayed(request,1000) })
    await started; putUser(h.db,{ ...getUser(h.db,'u_phone')!, disabled: 1 }); release()
    expect((await pending).status).toBe(401)
    expect(getLibraryEntry(h.db,'u_phone','synthetic')).toBeNull()
  }
})

test('agent bearer publishes over HTTP with mcp origin', async () => {
  const h = libraryServer({ DEVICE_TOKENS: '1' }), token = h.auth.mint(getUser(h.db,'u_phone')!, 'agent')
  const r = await fetch(h.api + '/api/programmes/library/synthetic',{ method: 'PUT', headers: bearer(token), body: JSON.stringify({ definition: definition(), expectedVersionId: null, minLevel: 'Ready' }) })
  expect(r.status).toBe(200)
  expect(h.db.query<{origin:string}, []>('SELECT origin FROM library_versions').get()!.origin).toBe('mcp')
})


test('adversarial JSON depth is refused without a 500 on publish or validation', async () => {
  const h = libraryServer()
  const deeplyNested = '{"x":'.repeat(40000) + '0' + '}'.repeat(40000)
  for (const [path,method] of [['library/synthetic','PUT'],['validate','POST']]) {
    const body = '{"expectedVersionId":null,"definition":{"id":"synthetic","name":"Synthetic","retained":' + deeplyNested + '}}'
    const r = await fetch(h.api + '/api/programmes/' + path, { method, headers: cookie('u_phone'), body })
    expect(r.status).toBe(400)
    expect((await r.json()).code).toBe('bad-request')
  }
  expect((await (await h.request('library')).json()).items).toEqual([])
})


test('explicit Invalid minimum stores an invalid draft without inserting fractional metadata into strict INTEGER columns', async () => {
  const h = libraryServer(), d = { ...definition(), daysPerWeek: 1.5, lengthWeeks: 1.5 }
  const r = await h.put(d,null,'Invalid')
  expect(r.status).toBe(200)
  expect(await r.json()).toMatchObject({ level: 'Invalid', definition: d })
  const item = (await (await h.request('library')).json()).items[0]
  expect(item.daysPerWeek).toBeUndefined(); expect(item.lengthWeeks).toBeUndefined()
})


test('nested arrays below serializer failure depth cannot produce a canonicalization 500', async () => {
  const h = libraryServer()
  const nested = '['.repeat(25000) + '0' + ']'.repeat(25000)
  const body = '{"definition":{"id":"synthetic","name":"Synthetic","retained":' + nested + '},"expectedVersionId":null}'
  const r = await fetch(h.api + '/api/programmes/library/synthetic', { method: 'PUT', headers: cookie('u_phone'), body })
  expect(r.status).toBe(400)
  expect((await r.json()).code).toBe('bad-request')
  expect((await (await h.request('library')).json()).items).toEqual([])
})


test('two same-parent canonical no-op writes converge on one immutable version without duplicate history', async () => {
  const h = libraryServer(), d = definition(), parent = await (await h.put(d)).json()
  const before = await (await h.request('library')).json()
  const reordered = Object.fromEntries(Object.entries(d).reverse()) as typeof d
  const responses = await Promise.all([h.put(d,parent.versionId),h.put(reordered,parent.versionId)])
  expect(responses.map(r => r.status)).toEqual([200,200])
  for (const r of responses) expect(await r.json()).toEqual(parent)
  expect((await (await h.request('library/synthetic/versions')).json()).versions).toHaveLength(1)
  expect(await (await h.request('library')).json()).toEqual(before)
  expect(h.db.query('SELECT * FROM library_bodies').all()).toHaveLength(1)
})
