import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { dataServer } from './data-helpers'

test('a poll right after a sync reports the revision that sync returned, not the one before it', async () => {
  const h = dataServer(), stale: string[] = []
  for (let i = 0; i < 20; i++) {
    const wrote = await h.call('PUT', '/api/data', { stamped: true, state: { _ts: 100 + i, workouts: [], routines: [] } })
    const polled = await h.call('GET', '/api/data/rev')
    if (wrote.body.rev !== polled.body.rev) stale.push(`round ${i}`)
  }
  expect(stale).toEqual([])
  expect(h.data.rev('u1').rev).toBe(JSON.parse(h.stored()!)._rev)
})
test('the poll really is reading through the stat cache', async () => {
  // The SQLite port has no filesystem stat key. A pinned-mtime mirror edit has
  // no authority; a transaction invalidates through the SQLite generation.
  const h = dataServer()
  h.plant({ _rev: 7, workouts: [], routines: [] })
  const file = path.join(h.dataDir, 'state-u1.json'), pinned = new Date(1700000000000)
  fs.utimesSync(file, pinned, pinned)
  const a = fs.statSync(file)
  expect(h.data.rev('u1').rev).toBe(7)
  fs.writeFileSync(file, '{"_rev":8,"workouts":[],"routines":[]}')
  fs.utimesSync(file, pinned, pinned)
  const b = fs.statSync(file)
  expect(a.mtimeMs).toBe(b.mtimeMs)
  expect(a.size).toBe(b.size)
  expect(h.data.rev('u1').rev).toBe(7)
  const put = await h.call('PUT', '/api/data', { stamped: true, state: { workouts: [], routines: [] } })
  expect(h.data.rev('u1').rev).toBe(put.body.rev)
})
test('the three hot-path state reads all go through readStateCached', () => {
  // Presence tests cover push-language reads. Pin the same hot-path property on the data API's
  // stat-free rev cache, including uncached GET and conditional PUT.
  const source = fs.readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8')
  const rev = source.slice(source.indexOf('  rev('), source.indexOf('  compareAndWrite('))
  expect(rev).toContain('this.cache.get(profileId)')
  expect(rev).toContain('SELECT rev, wid')
  expect(rev).not.toContain('readStateDoc(')
  expect(source.slice(source.indexOf('  get('), source.indexOf('  rev('))).toContain('this.current(profileId)')
  expect(source.slice(source.indexOf('  compareAndWrite('))).toContain('this.current(profileId)')
})
