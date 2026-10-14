import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { dataServer, dataHeaders } from './data-helpers'
import { MAX_STORED_BYTES } from '../src/data'

test('concurrent PUTs from two clients serialize compare-and-write; the loser receives the winner', async () => {
  const h = dataServer()
  await h.call('PUT', '/api/data', { state: { workouts: [], routines: [] }, stamped: true })
  const results = await Promise.all(['phone', 'desktop'].map(id => h.call('PUT', '/api/data', { baseRev: 1, stamped: true, state: { workouts: [{ id }], routines: [] } })))
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  const winner = results.find(r => r.status === 200)!, loser = results.find(r => r.status === 409)!
  expect(loser.body.state._wid).toBe(winner.body.wid)
  expect(loser.body.rev).toBe(2)
  expect(JSON.parse(h.stored()!)._rev).toBe(2)
  expect(h.db.query('SELECT * FROM state_doc_history').all()).toHaveLength(2)
})
test('the stored-size guard rolls back growth caused by restored omitted fields', async () => {
  const h = dataServer()
  const p = { workouts: [], routines: [], preserved: 'a'.repeat(MAX_STORED_BYTES - 500) }
  await h.call('PUT', '/api/data', { state: p, stamped: true })
  const before = h.stored()
  const response = await h.call('PUT', '/api/data', { baseRev: 1, state: { workouts: [], routines: [], more: 'b'.repeat(1000) } })
  expect(response.status).toBe(413)
  expect(response.body).toEqual({ error: 'body too large' })
  expect(h.stored()).toBe(before)
  expect(h.db.query('SELECT * FROM state_doc_history').all()).toHaveLength(1)
})
test('SQLite disk-full aborts the entire transaction without a new doc, history, or mirror', async () => {
  const h = dataServer()
  await h.call('PUT', '/api/data', { stamped: true, state: { workouts: [], routines: [] } })
  const before = h.stored(), mirror = fs.readFileSync(path.join(h.dataDir, 'state-u1.json'), 'utf8')
  const pages = h.db.query<{ page_count: number }, []>('PRAGMA page_count').get()!.page_count
  h.db.run(`PRAGMA max_page_count=${pages}`)
  const result = await h.call('PUT', '/api/data', { baseRev: 1, stamped: true, state: { workouts: [], routines: [], pad: 'x'.repeat(1024 * 1024) } })
  expect(result.status).toBe(500)
  expect(result.body).toEqual({ error: 'server error' })
  expect(h.stored()).toBe(before)
  expect(fs.readFileSync(path.join(h.dataDir, 'state-u1.json'), 'utf8')).toBe(mirror)
  expect(h.db.query('SELECT * FROM state_doc_history').all()).toHaveLength(1)
  expect(h.db.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
})
test('mirror failure raises a stale flag after durable commit and recovers on a later PUT', async () => {
  let fail = true
  const h = dataServer(['u1'], { mirror: () => { if (fail) throw new Error('ENOSPC') } })
  expect((await h.call('PUT', '/api/data', { stamped: true, state: { workouts: [], routines: [] } })).status).toBe(200)
  expect(h.data.staleMirrors.has('u1')).toBe(true)
  expect(h.logs).toContain('state mirror stale')
  expect(JSON.parse(h.stored()!)._rev).toBe(1)
  fail = false
  await h.call('PUT', '/api/data', { baseRev: 1, stamped: true, state: { workouts: [], routines: [] } })
  expect(h.data.staleMirrors.has('u1')).toBe(false)
})
test('rev cache sees commits through a second SQLite connection and ignores edited mirrors', async () => {
  const h = dataServer()
  await h.call('PUT', '/api/data', { stamped: true, state: { workouts: [], routines: [] } })
  expect(h.data.rev('u1').rev).toBe(1)
  fs.writeFileSync(path.join(h.dataDir, 'state-u1.json'), '{"_rev":99}')
  expect(h.data.rev('u1').rev).toBe(1)
  const other = new Database(path.join(h.dataDir, 'opengym.db'))
  try { other.query("UPDATE state_docs SET rev=2, json=json_set(json,'$._rev',2) WHERE profile_id='u1'").run() }
  finally { other.close() }
  expect(h.data.rev('u1').rev).toBe(2)
})
test('fixed data routes refuse encoded slash, dot-dot, and backslash suffixes', async () => {
  const h = dataServer()
  for (const suffix of ['a%2Fb', '%2e%2e%2F', '%5C']) {
    expect((await fetch(`${h.api}/api/data/${suffix}`, { headers: dataHeaders('u1') })).status).toBe(404)
  }
})
