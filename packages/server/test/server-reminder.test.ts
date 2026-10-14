import assert from 'node:assert/strict'
import { test, fixture } from './notification-helpers'
const sub = (uid = 'u_test_1') => ({ userId: uid, endpoint: `https://localhost/${uid}`, keys: { p256dh: 'p', auth: 'a' } })
const goodState = (time: string, over: any = {}) => ({ reminder: { on: true, time, tz: 'UTC' },
  routines: [{ id: 'r1', name: 'Full body', emoji: '💪', ex: [] }],
  week: { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1', 5: 'r1', 6: 'r1' }, workouts: [], ...over })
const firings = (log: string) => (log.match(/reminder firing/g) || []).length
test('a null workout in a live queue logs and skips only that user without consuming the reminder', async () => {
  const h = fixture([sub(), sub('u_test_2')])
  h.write(goodState('20:05', { workouts: [null], queue: { ids: ['r1'], since: 0, startsOn: '2026-09-07' } }))
  h.write(goodState('20:05'), 'u_test_2')
  await h.tick()
  assert.equal(h.sent.filter(s => s.sub.endpoint.endsWith('/u_test_1')).length, 0)
  assert.match(h.log, /reminder tick failed/)
  assert.equal(h.db().users.find((u: any) => u.id === 'u_test_1').lastReminder, undefined)
  assert.equal(h.sent[0].sub.endpoint, 'https://localhost/u_test_2')
  assert.equal(h.sent.length, 1)
  h.write(goodState('20:05', { workouts: [], queue: { ids: ['r1'], since: 0, startsOn: '2026-09-07' } }))
  await h.tick()
  assert.equal(h.sent.filter(s => s.sub.endpoint.endsWith('/u_test_1')).length, 1)
})
test('a non-array workouts on disk is logged and skipped by the reminder tick; the next user still fires', async () => {
  const h = fixture([sub(), sub('u_test_2')])
  h.write(goodState('20:05', { workouts: {} }))
  h.write(goodState('20:05'), 'u_test_2')
  await h.tick()
  assert.equal((await fetch(h.api + '/api/health')).status, 200)
  assert.match(h.log, /reminder tick failed/)
  assert.match(h.log, /reminder firing/)
  assert.equal((await fetch(h.api + '/api/health')).status, 200)
  assert.ok(h.db().users.find((u: any) => u.id === 'u_test_2').lastReminder)
})
test('a reminder whose minute passed 3 minutes ago still fires — once', async () => {
  const h = fixture([sub()]); h.write(goodState('20:02'))
  await h.tick(); assert.equal(firings(h.log), 1)
  await h.tick(); await h.tick(); assert.equal(firings(h.log), 1)
  assert.ok(h.db().users[0].lastReminder)
})
test('a reminder 20 minutes past is not delivered late, and a day already trained is skipped', async () => {
  const h = fixture([sub()]); h.write(goodState('19:45'))
  await h.tick(); assert.equal(firings(h.log), 0)
  h.write(goodState('20:03', { workouts: [{ id: 'w1', d: '2026-09-07' }] }))
  await h.tick(); assert.equal(firings(h.log), 0)
  h.write(goodState('20:03', { dayNotes: { '2026-09-07': { tag: 'sick', _ts: 1 } } }))
  await h.tick(); assert.equal(firings(h.log), 0)
})
test('a null entry in workouts or routines does not cost that profile its reminder', async () => {
  const h = fixture([sub()]); h.write(goodState('20:03', {
    workouts: [null, { id: 'w1', d: '2026-01-01' }], routines: [null, { id: 'r1', name: 'Full body', emoji: '💪', ex: [] }],
  }))
  await h.tick(); assert.equal(firings(h.log), 1)
  assert.doesNotMatch(h.log, /reminder tick failed/)
})
test('pinned reminder transcript: exact 15-minute edge, midnight, user zone, invalid zone and first combined routine', async () => {
  for (const [ms, time, tz, count] of [
    ['2026-09-07T20:15:00Z', '20:00', 'UTC', 1], ['2026-09-07T20:16:00Z', '20:00', 'UTC', 0],
    ['2026-09-08T00:05:00Z', '23:55', 'UTC', 0], ['2026-09-07T20:05:00Z', '15:00', 'America/Chicago', 1],
    ['2026-09-07T20:05:00Z', '20:00', 'bad/zone', 0],
  ] as const) {
    const h = fixture([sub()]); await h.at(Date.parse(ms))
    h.write(goodState(time, { reminder: { on: true, time, tz }, routines: [{ id: 'r1', name: 'First' }, { id: 'r2', name: 'Second' }],
      week: { 1: ['r1', 'r2'], 2: ['r1', 'r2'] } }))
    await h.tick()
    assert.equal(h.sent.length, count)
    if (count) assert.deepEqual(h.sent[0].body, { title: '🏋️ First today', body: "It's on your plan. Let's go 💪", tag: 'day-reminder' })
  }
})
test('a singleton array reminder time retains legacy regex coercion', async () => {
  const h = fixture([sub()]); h.write(goodState('20:05', { reminder: { on: true, time: ['20:05'], tz: 'UTC' } }))
  await h.tick()
  assert.equal(firings(h.log), 1)
  assert.equal(h.sent[0].body.tag, 'day-reminder')
})
