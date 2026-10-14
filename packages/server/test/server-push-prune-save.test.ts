import assert from 'node:assert/strict'
import { test, fixture, post, wait } from './notification-helpers'
const start = () => fixture([{ userId: 'u_test_1', endpoint: 'https://10.1.2.3/push/abc', keys: { p256dh: 'p', auth: 'a' } }],
  { persist: () => { throw new Error('EIO') } })
test('an unwritable ./data cannot take the process down through the rest timer nobody awaits', async () => {
  const h = start()
  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1 })).status, 200)
  await wait(2500)
  assert.equal(h.store.db.query<{ n: number }, []>('SELECT count(*) AS n FROM push_subs').get()!.n, 0)
  assert.equal((await fetch(h.api + '/api/health')).status, 200, 'still serving')
  assert.match(h.log, /push: could not save db.json/, 'failed mirror write was contained')
})
test('a push that was delivered is a 200 even when only the prune save failed', async () => {
  const h = start(), r = await post(h, '/api/push/test')
  assert.equal(r.status, 200, 'the awaited caller does not report the bookkeeping failure')
  assert.deepEqual(await r.json(), { ok: true })
  assert.equal(h.store.db.query<{ n: number }, []>('SELECT count(*) AS n FROM push_subs').get()!.n, 0)
})
test('SQLite readonly pruning is contained and retried after storage recovers', async () => {
  const h = fixture([{ userId: 'u_test_1', endpoint: 'https://10.1.2.3/x', keys: { p256dh: 'p', auth: 'a' } }])
  h.store.db.exec('PRAGMA query_only=ON')
  await h.notifications.push.sendPush('u_test_1', { title: 'Synthetic', body: 'Test', tag: 'test' })
  assert.match(h.log, /push: could not save db.json/)
  assert.equal(h.store.db.query<{ n: number }, []>('SELECT count(*) AS n FROM push_subs').get()!.n, 1)
  h.store.db.exec('PRAGMA query_only=OFF')
  await h.notifications.push.sendPush('u_test_1', { title: 'Synthetic', body: 'Test', tag: 'test' })
  assert.equal(h.db().subs.length, 0)
  assert.equal((await fetch(h.api + '/api/health')).status, 200)
})
