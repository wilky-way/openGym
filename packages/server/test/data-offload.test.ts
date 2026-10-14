import { test, expect } from 'bun:test'
import { dataServer, dataHeaders } from './data-helpers'

const programmes = (definitions: any[] = [{ id: 'def-synthetic', name: 'Synthetic' }], extra: object = {}) => ({ version: 1, fork: 'opengym/1', definitions, cycles: [], ...extra })
const state = (p: object) => ({ workouts: [], routines: [], programmes: p })
test('OFFLOAD exception: data-offload-bearer consumes manifests even with OFFLOAD_RULE off', async () => {
  const h = dataServer()
  const manifest = { 'def-synthetic': { versionId: 'v1', at: 500 } }
  const p = programmes(undefined, { offloaded: manifest })
  expect((await h.call('PUT', '/api/data', { stamped: true, baseRev: 0, state: state(p) })).status).toBe(200)
  const doc = JSON.parse(h.stored()!)
  expect(doc.programmes.offloaded).toEqual(manifest)
  expect(doc.programmes.definitions).toEqual([])
  const response = await fetch(h.api + '/api/data', { method: 'PUT', headers: { Authorization: 'Bearer ' + h.auth.mint(h.auth.sessionOf(new Request('http://x',{headers: {Cookie: dataHeaders('u1').Cookie}}))!.user) }, body: JSON.stringify({ baseRev: 1, state: state(p) }) })
  expect(response.status).toBe(200)
  const result = await response.json() as any
  expect(result.rev).toBe(2)
  const stored = JSON.parse(h.stored()!)
  expect(stored._rev).toBe(3)
  expect(stored.programmes.definitions).toEqual([])
})
test('an unstamped stale writer cannot resurrect definitions by stamping them fresh', async () => {
  const h = dataServer()
  const original = state(programmes())
  expect((await h.call('PUT', '/api/data', { stamped: true, state: original })).status).toBe(200)
  expect((await h.call('PUT', '/api/data', { stamped: true, baseRev: 1, state: state(programmes([], { offloaded: { 'def-synthetic': { versionId: 'v1', at: 500 } } })) })).status).toBe(200)
  const storedBefore = JSON.parse(h.stored()!)
  expect((await h.call('PUT', '/api/data', { baseRev: 2, state: original })).status).toBe(200)
  expect(JSON.parse(h.stored()!).programmes).toEqual(storedBefore.programmes)
})
test('concurrent offloads join after conflict retry and explicit install survives stale replay', async () => {
  const h = dataServer()
  const defs = [{ id: 'a' }, { id: 'b' }]
  await h.call('PUT', '/api/data', { stamped: true, state: state(programmes(defs)) })
  const results = await Promise.all(['a', 'b'].map(id => h.call('PUT', '/api/data', { stamped: true, baseRev: 1, state: state(programmes(defs, { offloaded: { [id]: { versionId: id, at: 500 } } })) })))
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  const conflict = results.find(r => r.status === 409)!
  const id = results[0]!.status === 409 ? 'a' : 'b'
  expect((await h.call('PUT', '/api/data', { stamped: true, baseRev: conflict.body.rev, state: state(programmes(defs, { offloaded: { [id]: { versionId: id, at: 500 } } })) })).status).toBe(200)
  let doc = JSON.parse(h.stored()!)
  expect(Object.keys(doc.programmes.offloaded).sort()).toEqual(['a', 'b'])
  expect(doc.programmes.definitions).toEqual([])
  await h.call('PUT', '/api/data', { stamped: true, baseRev: doc._rev, state: state(programmes([{ id: 'a' }], { installed: { a: { versionId: 'a', at: 501 } } })) })
  doc = JSON.parse(h.stored()!)
  expect(doc.programmes.definitions.map((d: any) => d.id)).toEqual(['a'])
  await h.call('PUT', '/api/data', { baseRev: doc._rev, state: state(programmes(defs)) })
  expect(JSON.parse(h.stored()!).programmes.definitions.map((d: any) => d.id)).toEqual(['a'])
})
test('active and paused cycles protect definitions, persist install markers, and reset clears old manifests', async () => {
  for (const status of ['active', 'paused']) {
    const h = dataServer()
    const cycle = { id: 'cycle', programmeId: 'def-synthetic', status, occurrences: [], snapshot: { sessions: [] } }
    await h.call('PUT', '/api/data', { stamped: true, state: state(programmes(undefined, { cycles: [cycle], offloaded: { 'def-synthetic': { versionId: 'v1', at: 500 } } })) })
    let doc = JSON.parse(h.stored()!)
    expect(doc.programmes.definitions).toHaveLength(1)
    expect(doc.programmes.installed['def-synthetic']).toEqual({ versionId: 'v1', at: 501 })
    await h.call('PUT', '/api/data', { stamped: true, baseRev: doc._rev, state: state(programmes(undefined, { cycles: [{ ...cycle, status: 'completed', _ts: 600 }] })) })
    doc = JSON.parse(h.stored()!)
    expect(doc.programmes.definitions).toHaveLength(1)
    await h.call('PUT', '/api/data', { stamped: true, state: { ...state(programmes([])), resetAt: 1000 } })
    doc = JSON.parse(h.stored()!)
    expect(doc.programmes.offloaded ?? {}).toEqual({})
    expect(doc.programmes.installed ?? {}).toEqual({})
  }
})
