import { test, expect } from 'bun:test'
import { dataServer } from './data-helpers'

function observeReads(h: ReturnType<typeof dataServer>) {
  const original = h.db.query.bind(h.db), reads = { n: 0 }
  h.db.query = ((sql: string) => {
    if (sql.startsWith('SELECT rev, wid')) reads.n++
    return original(sql)
  }) as typeof h.db.query
  return reads
}
test('the cache holds at most 64 users, and the least recently polled is the one dropped', () => {
  const ids = Array.from({ length: 65 }, (_, i) => `u_cache_${i}`), h = dataServer(ids)
  for (const id of ids) h.plant({ _rev: 7, workouts: [], routines: [] }, id)
  const reads = observeReads(h)
  expect(h.data.rev(ids[0]!).rev).toBe(7)
  expect(reads.n).toBe(1)
  expect(h.data.rev(ids[0]!).rev).toBe(7)
  expect(reads.n).toBe(1)
  for (const id of ids.slice(1, 64)) h.data.rev(id)
  expect(reads.n).toBe(64)
  h.data.rev(ids[0]!) // refresh this entry; user 1 is now least recently polled
  h.data.rev(ids[64]!)
  expect((h.data as any).cache.size).toBe(64)
  expect(reads.n).toBe(65)
  h.data.rev(ids[0]!)
  expect(reads.n).toBe(65)
  expect(h.data.rev(ids[1]!).rev).toBe(7)
  expect(reads.n).toBe(66)
})
test('an entry nobody has polled for longer than the TTL is dropped', () => {
  const h = dataServer(['u1'], { cacheTtlMs: 150 })
  h.plant({ _rev: 7, workouts: [], routines: [] })
  const reads = observeReads(h)
  expect(h.data.rev('u1').rev).toBe(7)
  expect(reads.n).toBe(1)
  h.clock.t += 100
  expect(h.data.rev('u1').rev).toBe(7)
  expect(reads.n).toBe(1)
  h.clock.t += 151
  expect(h.data.rev('u1').rev).toBe(7)
  expect(reads.n).toBe(2)
})
