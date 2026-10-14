import { test, expect } from 'bun:test'
import { fixture } from './notification-helpers'
const ids = ['u_cache_probe', ...Array.from({ length: 64 }, (_, i) => `u_cache_${i}`)]
test('the cache holds at most 64 users, and the least recently polled is the one dropped', () => {
  const h = fixture([], {}, {}, ids), read = h.notifications.reminders.readStateCached
  for (const id of ids) h.write({ _rev: 7 }, id)
  const first = read(ids[0]!)
  expect(first?._rev).toBe(7)
  expect(read(ids[0]!)).toBe(first)
  for (const id of ids.slice(1)) read(id)
  expect(h.notifications.reminders.cacheSize()).toBe(64)
  expect(read(ids[0]!)).not.toBe(first)
})
test('an entry nobody has polled for longer than the TTL is dropped', async () => {
  const h = fixture([], {}, { STATE_CACHE_TTL_MS: '150' }), read = h.notifications.reminders.readStateCached
  h.write({ _rev: 7 }); const first = read('u_test_1')
  expect(first?._rev).toBe(7)
  expect(read('u_test_1')).toBe(first)
  await h.advance(151)
  expect(read('u_test_1')).not.toBe(first)
})
test('SQLite content invalidates a cached read even with unchanged revision and bytes', () => {
  const h = fixture(), read = h.notifications.reminders.readStateCached
  h.write({ _rev: 7, lang: 'en' }); read('u_test_1')
  h.write({ _rev: 7, lang: 'xx' })
  expect(read('u_test_1')?.lang).toBe('xx')
  h.store.db.query('DELETE FROM state_docs WHERE profile_id=?').run('u_test_1')
  expect(read('u_test_1')).toBeNull()
})
