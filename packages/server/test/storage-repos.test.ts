// Repositories for users, passkeys, push subscriptions, invites, device links and the audit log.
import { test, expect } from 'bun:test'
import { openStore } from '../src/storage'
import * as repo from '../src/storage/repos'
import { scratchDir, user } from './helpers'

const cred = (id: string, userId: string, ord: number) => ({
  id, user_id: userId, public_key: 'pk-' + id, counter: 0, transports: '["internal"]',
  created: '2026-10-01T00:00:00.000Z', last_used: null, name: 'Phone', ord, x: '{}',
})

test('users round-trip and list in legacy array order', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('u2', 1, { admin: 1 }))
    repo.putUser(store.db, user('u1', 0, { x: '{"theme":"dark"}' }))
    expect(repo.listUsers(store.db).map(u => u.id)).toEqual(['u1', 'u2'])
    expect(repo.getUser(store.db, 'u1')?.x).toBe('{"theme":"dark"}')
    expect(repo.getUser(store.db, 'nobody')).toBeNull()
  } finally { store.close() }
})

test('updating a user keeps its passkeys and subscriptions (UPSERT, never REPLACE)', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('u1'))
    repo.putCred(store.db, cred('c1', 'u1', 0))
    repo.putSub(store.db, { endpoint: 'https://push/1', user_id: 'u1', p256dh: 'p', auth: 'a', device_id: null, created: null, ord: 0 })
    repo.putUser(store.db, user('u1', 0, { name: 'renamed', sv: 3 }))
    expect(repo.getUser(store.db, 'u1')?.name).toBe('renamed')
    expect(repo.listCreds(store.db, 'u1').map(c => c.id)).toEqual(['c1'])
    expect(repo.listSubs(store.db, 'u1').length).toBe(1)
  } finally { store.close() }
})

test('deleting a user cascades to passkeys, subscriptions and state documents', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('u1'))
    repo.putCred(store.db, cred('c1', 'u1', 0))
    repo.putSub(store.db, { endpoint: 'https://push/1', user_id: 'u1', p256dh: 'p', auth: 'a', device_id: null, created: null, ord: 0 })
    repo.deleteUser(store.db, 'u1')
    expect(repo.listCreds(store.db, 'u1')).toEqual([])
    expect(repo.listSubs(store.db, 'u1')).toEqual([])
  } finally { store.close() }
})

test('a passkey or subscription for a missing user is refused by the foreign key', () => {
  const store = openStore(scratchDir())
  try {
    expect(() => repo.putCred(store.db, cred('c9', 'ghost', 0))).toThrow()
  } finally { store.close() }
})

test('passkeys are updated in place and deleted by id', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('u1'))
    repo.putCred(store.db, cred('c1', 'u1', 0))
    repo.putCred(store.db, { ...cred('c1', 'u1', 0), counter: 7, name: null })
    expect(repo.listCreds(store.db, 'u1')[0]?.counter).toBe(7)
    repo.deleteCred(store.db, 'c1')
    expect(repo.listAllCreds(store.db)).toEqual([])
  } finally { store.close() }
})

test('invites are kept with their read-only revoked flag and deleted on revoke', () => {
  const store = openStore(scratchDir())
  try {
    repo.putInvite(store.db, { code: 'ABCDEF0123456789', note: 'friend', created_by: 'u1', created: 'now', used_by: null, used_at: null, revoked: 0, ord: 0 })
    expect(repo.getInvite(store.db, 'ABCDEF0123456789')?.note).toBe('friend')
    repo.putInvite(store.db, { code: 'ABCDEF0123456789', note: 'friend', created_by: 'u1', created: 'now', used_by: 'u2', used_at: 'later', revoked: 1, ord: 0 })
    expect(repo.listInvites(store.db)[0]?.used_by).toBe('u2')
    repo.deleteInvite(store.db, 'ABCDEF0123456789')
    expect(repo.getInvite(store.db, 'ABCDEF0123456789')).toBeNull()
  } finally { store.close() }
})

test('device links expire and are pruned at or after their expiry', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('u1'))
    repo.putDeviceLink(store.db, { h: 'h-old', user_id: 'u1', exp: 1000, created: 500 })
    repo.putDeviceLink(store.db, { h: 'h-new', user_id: 'u1', exp: 5000, created: 600 })
    expect(repo.getDeviceLink(store.db, 'h-old')?.exp).toBe(1000)
    expect(repo.pruneDeviceLinks(store.db, 1000)).toBe(1)
    expect(repo.listDeviceLinks(store.db).map(l => l.h)).toEqual(['h-new'])
  } finally { store.close() }
})

test('audit ids never reset, even after the log is cleared', () => {
  const store = openStore(scratchDir())
  try {
    const row = { ts: 1, ev: 'login', ok: 1, uid: 'u1', name: null, tgt: null, tname: null, msg: null, act: null, ip: null }
    expect(repo.appendAudit(store.db, row)).toBe(1)
    expect(repo.appendAudit(store.db, { ...row, ev: 'logout' })).toBe(2)
    store.db.run('DELETE FROM audit_events')
    expect(repo.appendAudit(store.db, row)).toBe(3)
    expect(repo.listAudit(store.db).map(r => r.id)).toEqual([3])
  } finally { store.close() }
})

test('audit retention drops old rows by age, then keeps only the newest N', () => {
  const store = openStore(scratchDir())
  try {
    const row = { ev: 'x', ok: 1, uid: null, name: null, tgt: null, tname: null, msg: null, act: null, ip: null }
    for (const ts of [10, 20, 30, 40, 50]) repo.appendAudit(store.db, { ...row, ts })
    expect(repo.pruneAudit(store.db, { minTs: 25 })).toBe(2)
    expect(repo.pruneAudit(store.db, { maxRows: 2 })).toBe(1)
    expect(repo.listAudit(store.db).map(r => r.ts)).toEqual([50, 40])
  } finally { store.close() }
})

test('push subscriptions upsert by endpoint and delete by endpoint', () => {
  const store = openStore(scratchDir())
  try {
    repo.putUser(store.db, user('u1'))
    const sub = { endpoint: 'https://push/1', user_id: 'u1', p256dh: 'p', auth: 'a', device_id: 'd1', created: null, ord: 0 }
    repo.putSub(store.db, sub)
    repo.putSub(store.db, { ...sub, auth: 'b' })
    expect(repo.listAllSubs(store.db).map(s => s.auth)).toEqual(['b'])
    repo.deleteSub(store.db, sub.endpoint)
    expect(repo.listAllSubs(store.db)).toEqual([])
  } finally { store.close() }
})
