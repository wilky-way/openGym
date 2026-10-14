import { test, expect } from 'bun:test'
import { dataServer } from './data-helpers'
test('an unreadable state file is a 503 on GET and PUT, and is not replaced', async () => {
  const h = dataServer(), raw = '{"_rev":7,"workouts":[{"id":"w1"'
  h.plant(raw)
  expect((await h.call('GET', '/api/data')).status).toBe(503)
  expect((await h.call('PUT', '/api/data', { state: { workouts: [], routines: [] } })).status).toBe(503)
  expect(h.stored()).toBe(raw)
  expect((await h.call('GET', '/api/data/rev')).body).toEqual({ rev: 0 })
})
