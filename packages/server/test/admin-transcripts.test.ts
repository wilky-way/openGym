import { test, expect } from 'bun:test'
import { startAdmin, ADMIN, ADMIN2, VICTIM, as } from './admin-helpers'
import { CLOCK } from './auth-helpers'
import { getUser, getInvite, listAudit, putInvite, putDeviceLink, readStateDoc, stateHistory, writeAccountsMirror } from '../src/storage'
import { createApp } from '../src/app'

const ADMIN_SUMMARY = { id: ADMIN, name: 'Adminna', created: '2026-10-01T00:00:00.000Z', disabled: false, admin: true, invitedBy: null }
const VICTIM_SUMMARY = { id: VICTIM, name: 'Mallory', created: '2026-10-01T00:00:00.000Z', disabled: false, admin: false, invitedBy: 'CODE1' }
const ok = { status: 200, body: { ok: true } }

test('admin transcript: all nine KEEP routes and error bodies', async () => {
  const h = startAdmin({ env: { INVITE_ONLY: '1' } })
  expect(await h.get('/api/admin/users')).toEqual({ status: 200, body: {
    users: [ { ...ADMIN_SUMMARY, workouts: 0, lastWorkout: null, lastSync: null, hasPush: true, live: null },
      { ...VICTIM_SUMMARY, workouts: 0, lastWorkout: null, lastSync: null, hasPush: true, live: null } ], invite_only: true, now: CLOCK } })
  expect(await h.get('/api/admin/user?id=' + VICTIM)).toEqual({ status: 200, body: {
    user: VICTIM_SUMMARY, unit: 'kg', lastSync: null, routines: [], bodyweight: [], workouts: [] } })
  expect(await h.get('/api/admin/user?id=missing')).toEqual({ status: 404, body: { error: 'no such user' } })
  expect(await h.post('/api/admin/user/disable', { id: ADMIN, disabled: true })).toEqual({ status: 400, body: { error: 'cannot disable an admin' } })
  expect(await h.post('/api/admin/user/disable', { id: VICTIM, disabled: true })).toEqual({ status: 200, body: { ok: true, id: VICTIM, disabled: true } })
  expect(await h.post('/api/admin/user/disable', { id: VICTIM, disabled: false })).toEqual({ status: 200, body: { ok: true, id: VICTIM, disabled: false } })
  expect(await h.get('/api/admin/invites')).toEqual({ status: 200, body: { invites: [{ code: 'CODE1', note: '', createdBy: ADMIN,
    created: new Date(CLOCK).toISOString(), usedBy: VICTIM, usedAt: new Date(CLOCK).toISOString(), usedByName: 'Mallory' }], invite_only: true } })
  const created = await h.post('/api/admin/invites/new', { note: 'synthetic guest' }), invite = created.body.invite
  expect(created.status).toBe(200)
  expect(invite.code).toMatch(/^[A-F0-9]{16}$/)
  expect({ ...invite, code: '<invite>' }).toEqual({ code: '<invite>', note: 'synthetic guest', createdBy: ADMIN, created: new Date(CLOCK).toISOString() })
  expect(await h.post('/api/admin/invites/revoke', { code: 'code1' })).toEqual({ status: 400, body: { error: 'already used, cannot revoke' } })
  expect(await h.post('/api/admin/invites/revoke', { code: 'missing' })).toEqual({ status: 404, body: { error: 'no such code' } })
  expect(await h.post('/api/admin/invites/revoke', { code: invite.code.toLowerCase() })).toEqual(ok)
  expect(await h.post('/api/admin/user/delete', { id: ADMIN })).toEqual({ status: 400, body: { error: 'you cannot delete your own account' } })
  expect(await h.post('/api/admin/user/delete', { id: VICTIM })).toEqual({ status: 200, body: { ok: true, id: VICTIM } })
  expect((await h.get('/api/admin/invites')).body.invites[0].usedByName).toBeNull()
  const page = await h.get('/api/admin/audit')
  expect({ ...page, body: { ...page.body, events: page.body.events.map((e: any) => ({ ...e, ...(e.msg === invite.code ? { msg: '[redacted invite]' } : {}) })) } }).toEqual({ status: 200, body: {
    events: [
      { id: 5, ts: CLOCK, ev: 'admin.user.delete', ok: true, uid: ADMIN, name: 'Adminna', msg: 'Mallory' },
      { id: 4, ts: CLOCK, ev: 'admin.invite.revoke', ok: true, uid: ADMIN, name: 'Adminna', msg: '[redacted invite]' },
      { id: 3, ts: CLOCK, ev: 'admin.invite.create', ok: true, uid: ADMIN, name: 'Adminna', msg: '[redacted invite]' },
      { id: 2, ts: CLOCK, ev: 'admin.user.enable', ok: true, uid: ADMIN, name: 'Adminna', tgt: VICTIM, tname: 'Mallory' },
      { id: 1, ts: CLOCK, ev: 'admin.user.disable', ok: true, uid: ADMIN, name: 'Adminna', tgt: VICTIM, tname: 'Mallory' },
    ], total: 5, nextBefore: null, enabled: true, ip_mode: 'off', retention: { max: 5000, days: 90 }, now: CLOCK } })
  expect(await h.post('/api/admin/audit/clear')).toEqual(ok)
  expect((await h.get('/api/admin/audit')).body.events).toEqual([{ id: 6, ts: CLOCK, ev: 'admin.audit.clear', ok: true, uid: ADMIN, name: 'Adminna' }])
})

test('every admin route refuses anonymous and non-admin callers and audits only the latter', async () => {
  const h = startAdmin()
  const routes = [['GET', '/users'], ['GET', '/user?id=' + VICTIM], ['POST', '/user/disable'], ['POST', '/user/delete'],
    ['GET', '/invites'], ['POST', '/invites/new'], ['POST', '/invites/revoke'], ['GET', '/audit'], ['POST', '/audit/clear']]
  for (const [method, suffix] of routes) {
    const path = '/api/admin' + suffix
    const anonymous = await fetch(h.api + path, { method })
    expect({ status: anonymous.status, body: await anonymous.json() }).toEqual({ status: 401, body: { error: 'not signed in' } })
    const nonAdmin = await fetch(h.api + path, { method, headers: as(VICTIM) })
    expect({ status: nonAdmin.status, body: await nonAdmin.json() }).toEqual({ status: 403, body: { error: 'forbidden' } })
  }
  expect(listAudit(h.sqlite).length).toBe(9)
  expect(listAudit(h.sqlite).every(e => e.ev === 'admin.denied' && e.uid === VICTIM && e.ok === 0)).toBe(true)
  expect(getUser(h.sqlite, VICTIM)).not.toBeNull()
  expect(getInvite(h.sqlite, 'CODE1')!.used_by).toBe(VICTIM)
})

test('opaque ids reject encoded slash, dot-dot and backslash on the wire before any lookup', async () => {
  const h = startAdmin()
  for (const hostile of ['a%2Fb', '%2e%2e%2F', 'a%5Cb', '%252e%252e%252F']) {
    expect(await h.get('/api/admin/user?id=' + hostile)).toEqual({ status: 400, body: { error: 'bad request' } })
    // These routes never mount params; a decoded tail must not dispatch to a handler.
    const r = await fetch(h.api + '/api/admin/users/' + hostile, { headers: as(ADMIN) })
    expect(r.status).toBe(404)
  }
  for (const id of ['a/b', '../', 'a\\b', 'a%2Fb', { toString: 1 }]) {
    const expected = typeof id === 'string' ? 400 : 404
    expect((await h.post('/api/admin/user/disable', { id, disabled: true })).status).toBe(expected)
    expect((await h.post('/api/admin/user/delete', { id })).status).toBe(expected)
  }
  for (const code of ['a/b', '../', 'a\\b', '%2e%2e%2F'])
    expect(await h.post('/api/admin/invites/revoke', { code })).toEqual({ status: 400, body: { error: 'bad request' } })
  expect(getUser(h.sqlite, VICTIM)!.disabled).toBe(0)
})

test('disable preserves history/credentials and burns device links; delete cascades v2 devices/history', async () => {
  const live = new Map([[VICTIM, { name: 'Synthetic', setsDone: 2, updatedAt: CLOCK }]])
  const h = startAdmin({ env: { DEVICE_TOKENS: '1' }, presence: { livePresence: id => live.get(id) ?? null, dropPresence: id => { live.delete(id) } } })
  h.plant({ _wid: 'synthetic-version', workouts: [] })
  const token = h.auth.mint(getUser(h.sqlite, VICTIM)!, 'paired')
  putDeviceLink(h.sqlite, { h: 'synthetic-link-hash', user_id: VICTIM, exp: CLOCK + 100000, created: CLOCK })
  expect((await h.get('/api/admin/users')).body.users[1].live).toEqual(live.get(VICTIM))
  expect((await h.post('/api/admin/user/disable', { id: VICTIM, disabled: 'yes' })).status).toBe(200)
  expect(live.has(VICTIM)).toBe(false)
  expect(h.sqlite.query('SELECT * FROM device_links WHERE user_id=?').all(VICTIM)).toEqual([])
  expect(h.db().creds.some((c: any) => c.userId === VICTIM)).toBe(true)
  expect(readStateDoc(h.sqlite, VICTIM)).not.toBeNull()
  expect((await fetch(h.api + '/api/me', { headers: { Authorization: 'Bearer ' + token } })).status).toBe(401)
  await h.post('/api/admin/user/disable', { id: VICTIM, disabled: false })
  // I03: disabling burns the session version; re-enabling never revives old tokens.
  expect((await fetch(h.api + '/api/me', { headers: { Authorization: 'Bearer ' + token } })).status).toBe(401)
  await h.del(VICTIM)
  expect(h.sqlite.query('SELECT * FROM devices WHERE user_id=?').all(VICTIM)).toEqual([])
  expect(readStateDoc(h.sqlite, VICTIM)).toBeNull()
  expect(stateHistory(h.sqlite, VICTIM)).toEqual([])
  expect(getInvite(h.sqlite, 'CODE1')!.used_by).toBe(VICTIM)
  expect((await h.post('/api/admin/invites/revoke', { code: 'CODE1' })).status).toBe(400)
  expect((await fetch(h.api + '/api/me', { headers: { Authorization: 'Bearer ' + token } })).status).toBe(401)
})

test('invite notes use legacy scalar coercion, cap 60 chars, retain old codes and revoked flag', async () => {
  const h = startAdmin()
  for (const [note, expected] of [[7, '7'], [{ toString: 1 }, ''], ['x'.repeat(80), 'x'.repeat(60)]] as const)
    expect((await h.post('/api/admin/invites/new', { note })).body.invite.note).toBe(expected)
  putInvite(h.sqlite, { code: 'OLD8CODE', note: '', created_by: null, created: null, used_by: null, used_at: null, revoked: 1, ord: 99 })
  expect((await h.get('/api/admin/invites')).body.invites.at(-1)).toEqual({ code: 'OLD8CODE', note: '', revoked: true, usedByName: null })
  expect(await h.post('/api/admin/invites/revoke', { code: 'old8code' })).toEqual(ok)
  expect(await h.post('/api/admin/invites/revoke', { code: ' old8code ' })).toEqual({ status: 400, body: { error: 'bad request' } })
})

test('environment admins count for disable and self-delete protections', async () => {
  const h = startAdmin({ env: { ADMIN_UIDS: VICTIM } })
  expect((await h.get('/api/admin/users', VICTIM)).status).toBe(200)
  expect(await h.post('/api/admin/user/disable', { id: VICTIM, disabled: true })).toEqual({ status: 400, body: { error: 'cannot disable an admin' } })
  expect(await h.del(VICTIM, VICTIM)).toEqual({ status: 400, body: { error: 'you cannot delete your own account' } })
})

test('body-await revalidation rejects an admin deleted while their request was receiving', async () => {
  const h = startAdmin({ twoAdmins: true })
  const app = createApp(h.config, { auth: h.auth })
  let finish!: () => void
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode('{"note":'))
    finish = () => { controller.enqueue(new TextEncoder().encode('"guest"}')); controller.close() }
  } })
  const pending = app.fetch(new Request('http://localhost/api/admin/invites/new', { method: 'POST', headers: as(ADMIN2), body: stream }))
  // Start fetch has captured the old actor; deleting it before body completion cannot grant a write.
  expect((await h.del(ADMIN2)).status).toBe(200)
  finish()
  const response = await pending
  expect(response.status).toBe(401)
  expect(h.db().invites.length).toBe(1)
})
