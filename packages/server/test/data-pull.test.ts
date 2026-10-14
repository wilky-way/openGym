import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { dataServer, CLOCK } from './data-helpers'
import { getUser } from '../src/storage'

test('GET /api/data notes pulls at most once per ten minutes; rev polls leave last_pull alone', async () => {
  const h = dataServer()
  expect(getUser(h.db, 'u1')!.last_pull).toBeNull()
  expect((await h.call('GET', '/api/data/rev')).status).toBe(200)
  expect(getUser(h.db, 'u1')!.last_pull).toBeNull()
  expect((await h.call('GET', '/api/data')).body).toEqual({ state: null, rev: 0 })
  expect(getUser(h.db, 'u1')!.last_pull).toBe(CLOCK)
  expect(JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8')).users[0].lastPull).toBe(CLOCK)
  h.clock.t += 599999
  await h.call('GET', '/api/data')
  expect(getUser(h.db, 'u1')!.last_pull).toBe(CLOCK)
  h.clock.t++
  await h.call('GET', '/api/data')
  expect(getUser(h.db, 'u1')!.last_pull).toBe(CLOCK + 600000)
})
test('an unreadable pull leaves last_pull alone, and a failed account mirror is flagged without failing the pull', async () => {
  const h = dataServer(['u1'], { accountsMirror: () => { throw new Error('ENOSPC') } })
  h.plant('{not json')
  expect((await h.call('GET', '/api/data')).status).toBe(503)
  expect(getUser(h.db, 'u1')!.last_pull).toBeNull()
  h.plant({ workouts: [], routines: [] })
  expect((await h.call('GET', '/api/data')).status).toBe(200)
  expect(getUser(h.db, 'u1')!.last_pull).toBe(CLOCK)
  expect(h.data.accountsMirrorStale).toBe(true)
})
test('a pull shows as the last sync, in the list and the drill-down', async () => {
  const h = dataServer(['u1', 'u_admin'])
  h.db.query("UPDATE users SET admin=1 WHERE id='u_admin'").run()
  h.plant({ _rev: 3, workouts: [{ id: 'w1' }] })
  const list = async () => (await h.call('GET', '/api/admin/users', undefined, 'u_admin')).body.users.find((u: any) => u.id === 'u1')
  expect((await list()).lastSync).toBeNull()
  const before = h.clock.t
  expect((await h.call('GET', '/api/data')).status).toBe(200)
  expect((await list()).lastSync).toBeGreaterThanOrEqual(before)
  expect((await h.call('GET', '/api/admin/user?id=u1', undefined, 'u_admin')).body.lastSync).toBeGreaterThanOrEqual(before)
  expect(JSON.parse(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8')).users.find((u: any) => u.id === 'u1').lastPull).toBeGreaterThanOrEqual(before)
  h.plant({ _rev: 4, _ts: before + 60000, workouts: [{ id: 'w1' }] })
  expect((await list()).lastSync).toBeGreaterThan(before)
})
test('a failed last_pull update leaves valid state readable and retries on the next pull', async () => {
  const h = dataServer()
  const state = { _rev: 3, workouts: [{ id: 'w1' }] }
  h.plant(state)
  const mirrorBefore = fs.readFileSync(path.join(h.dataDir, 'state-u1.json'))
  h.db.run("CREATE TRIGGER fail_pull BEFORE UPDATE OF last_pull ON users BEGIN SELECT RAISE(ABORT, 'injected pull failure'); END")
  const response = await h.call('GET', '/api/data')
  expect(response.status).toBe(200)
  expect(response.body).toEqual({ state, rev: 3 })
  expect(getUser(h.db, 'u1')!.last_pull).toBeNull()
  expect(h.data.accountsMirrorStale).toBe(true)
  expect(fs.readFileSync(path.join(h.dataDir, 'state-u1.json'))).toEqual(mirrorBefore)
  h.db.run('DROP TRIGGER fail_pull')
  expect((await h.call('GET', '/api/data')).status).toBe(200)
  expect(getUser(h.db, 'u1')!.last_pull).toBe(CLOCK)
  expect(h.data.accountsMirrorStale).toBe(false)
})
