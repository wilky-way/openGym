import { test, expect } from 'bun:test'
import { startAdmin, ADMIN } from './admin-helpers'
import { CLOCK, DAY } from './auth-helpers'
import { createAudit } from '../src/audit'
import { listAudit, getMeta, openDb } from '../src/storage'
import { join } from 'node:path'

const q = (text = '') => new URLSearchParams(text)
test('audit paging is newest-first by id; category and failure totals precede cursor filtering', async () => {
  const h = startAdmin()
  for (const [ev, ok] of [['auth.login.ok', true], ['admin.invite.create', true], ['auth.login.fail', false], ['other', true]] as const)
    h.auth.auditLog.write(ev, { ok, user: { id: ADMIN, name: 'A'.repeat(70) }, target: { id: 'u_target', name: 'T'.repeat(70) }, msg: 'M'.repeat(150), act: 'X'.repeat(60) })
  const a = (await h.get('/api/admin/audit?limit=2')).body
  expect(a.events.map((e: any) => e.id)).toEqual([4, 3])
  expect(a.nextBefore).toBe(3)
  // An append at the front must not duplicate a row on the second page.
  h.auth.auditLog.write('auth.new', {})
  const b = (await h.get('/api/admin/audit?limit=2&before=3')).body
  expect(b.events.map((e: any) => e.id)).toEqual([2, 1])
  expect(b.total).toBe(5)
  expect(b.nextBefore).toBe(1)
  expect(h.auth.auditLog.page(q('before=1')).events).toEqual([])
  expect(h.auth.auditLog.page(q('cat=auth&before=3')).total).toBe(3)
  expect(h.auth.auditLog.page(q('cat=fail')).events.map(e => e.id)).toEqual([3])
  expect(h.auth.auditLog.page(q('cat=admin')).events.map(e => e.id)).toEqual([2])
  expect(a.events[0]).toEqual({ id: 4, ts: CLOCK, ev: 'other', ok: true, uid: ADMIN,
    name: 'A'.repeat(40), tgt: 'u_target', tname: 'T'.repeat(40), msg: 'M'.repeat(120), act: 'X'.repeat(40) })
  expect(h.auth.auditLog.page(q('limit=-1')).events.length).toBe(1)
  expect(h.auth.auditLog.page(q('limit=bad')).events.length).toBe(5)
  expect(h.auth.auditLog.page(q('limit=1.5')).nextBefore).toBeNull()
})

test('audit retention runs age first then count; read never serves expired events', () => {
  const h = startAdmin({ env: { AUDIT_MAX: '3', AUDIT_DAYS: '1' } })
  for (let i = 0; i < 3; i++) h.auth.auditLog.write('auth.old')
  h.clock.t += DAY
  expect(h.auth.auditLog.page(q()).total).toBe(3) // inclusive boundary
  h.clock.t++
  expect(h.auth.auditLog.page(q()).total).toBe(0)
  for (let i = 0; i < 5; i++) h.auth.auditLog.write('auth.new')
  expect(h.auth.auditLog.page(q()).events.map(e => e.id)).toEqual([8, 7, 6])
  expect(getMeta(h.sqlite, 'audit_seq')).toBe('8')
  expect(listAudit(h.sqlite).length).toBe(3)
})

test('audit compaction is amortized, zero caps keep everything, and boot compacts', () => {
  const h = startAdmin({ env: { AUDIT_MAX: '4', AUDIT_DAYS: '0' } })
  for (let i = 0; i < 5; i++) h.auth.auditLog.write('auth.new')
  expect(listAudit(h.sqlite).length).toBe(5) // <= max * 1.25: no physical rewrite yet
  h.auth.auditLog.write('auth.new')
  expect(listAudit(h.sqlite).length).toBe(4)
  const uncapped = createAudit(h.sqlite, { ...h.config, audit: { ...h.config.audit, max: 0, days: 0 } }, { now: () => h.clock.t, ip: () => null })
  for (let i = 0; i < 5; i++) uncapped.write('auth.keep')
  h.clock.t += 100 * DAY
  expect(uncapped.page(q()).total).toBe(9)
  createAudit(h.sqlite, h.config, { now: () => h.clock.t, ip: () => null })
  expect(listAudit(h.sqlite).length).toBe(4)
})

test('clear never resets ids, including reopening the database; disabled audit adds no event', async () => {
  const h = startAdmin()
  h.auth.auditLog.write('auth.one')
  h.auth.auditLog.write('auth.two')
  await h.post('/api/admin/audit/clear')
  expect(listAudit(h.sqlite).map(e => [e.id, e.ev])).toEqual([[3, 'admin.audit.clear']])
  await h.post('/api/admin/audit/clear')
  expect(listAudit(h.sqlite).map(e => e.id)).toEqual([4])
  const reopened = openDb(join(h.dataDir, 'opengym.db'))
  const log = createAudit(reopened, h.config, { now: () => CLOCK, ip: () => null })
  log.write('auth.reboot')
  expect(listAudit(reopened).map(e => e.id)).toEqual([5, 4])
  reopened.close()
  const disabled = createAudit(h.sqlite, { ...h.config, audit: { ...h.config.audit, enabled: false } }, { now: () => CLOCK, ip: () => null })
  disabled.clear({ user: { id: ADMIN, name: 'A' } })
  disabled.write('auth.ignored')
  expect(disabled.page(q()).enabled).toBe(false)
  expect(disabled.page(q()).events).toEqual([])
  expect(getMeta(h.sqlite, 'audit_seq')).toBe('5')
})

test('IP opt-in follows trusted-proxy policy and network masking; no null fields leak onto wire', async () => {
  for (const [mode, trust, expected] of [['off', '1', undefined], ['net', '1', '192.0.2.0/24'], ['full', '1', '192.0.2.42'], ['full', '0', '127.0.0.1']] as const) {
    const h = startAdmin({ env: { AUDIT_IP: mode, TRUST_PROXY: trust } })
    h.auth.auditLog.write('auth.test', {}, new Request('http://x/', { headers: { 'CF-Connecting-IP': '192.0.2.42' } }))
    expect(h.auth.auditLog.page(q()).events[0]).toEqual({ id: 1, ts: CLOCK, ev: 'auth.test', ok: true, ...(expected ? { ip: expected } : {}) })
  }
})

test('an audit write or logging failure cannot break an authentication operation', () => {
  const h = startAdmin(), log: string[] = []
  const audit = createAudit(h.sqlite, h.config, { now: () => CLOCK, ip: () => null, log: message => { log.push(message); throw Error('logger broken') } })
  h.sqlite.run(`CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END`)
  expect(() => audit.write('auth.test')).not.toThrow()
  expect(log).toEqual(['audit write failed'])
  expect(listAudit(h.sqlite)).toEqual([])
  expect(() => h.auth.audit('auth.test')).not.toThrow()
})

test('boot seeds imported audit ids before age pruning and accepts legacy fractional count caps', () => {
  const h = startAdmin({ env: { AUDIT_MAX: '1.5', AUDIT_DAYS: '1' } })
  h.sqlite.query('INSERT INTO audit_events (id, ts, ev, ok) VALUES (?, ?, ?, ?)').run(100, CLOCK - 2 * DAY, 'auth.imported', 1)
  const audit = createAudit(h.sqlite, h.config, { now: () => CLOCK, ip: () => null })
  expect(listAudit(h.sqlite)).toEqual([])
  expect(getMeta(h.sqlite, 'audit_seq')).toBe('100')
  audit.write('auth.new')
  audit.write('auth.new')
  audit.write('auth.new')
  expect(audit.page(q()).events.map(e => e.id)).toEqual([103, 102])
})

test('idle hourly sweep physically deletes expired events and closes its scheduler', () => {
  const h = startAdmin({ env: { AUDIT_DAYS: '1', AUDIT_MAX: '0' } })
  let sweep!: () => void, cancelled = false
  const audit = createAudit(h.sqlite, h.config, { now: () => h.clock.t, ip: () => null,
    every: (callback, ms) => { expect(ms).toBe(3600000); sweep = callback; return () => { cancelled = true } } })
  audit.write('auth.old')
  h.clock.t += DAY + 1
  expect(listAudit(h.sqlite).length).toBe(1)
  sweep()
  expect(listAudit(h.sqlite)).toEqual([])
  expect(getMeta(h.sqlite, 'audit_seq')).toBe('1')
  audit.close()
  expect(cancelled).toBe(true)
})

test('prune failure preserves the durably appended event and id and logs a compact failure', () => {
  const h = startAdmin({ env: { AUDIT_MAX: '1' } }), messages: string[] = []
  const audit = createAudit(h.sqlite, h.config, { now: () => CLOCK, ip: () => null, log: message => messages.push(message) })
  audit.write('auth.one')
  h.sqlite.run(`CREATE TRIGGER fail_prune BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'synthetic prune failure'); END`)
  expect(() => audit.write('auth.two')).not.toThrow()
  expect(listAudit(h.sqlite).map(e => e.id)).toEqual([2, 1])
  expect(getMeta(h.sqlite, 'audit_seq')).toBe('2')
  expect(messages).toEqual(['audit compact failed'])
  // Page filtering is read-only and still hides records beyond the configured cap.
  expect(audit.page(q()).events.map(e => e.id)).toEqual([2])
  audit.close()
})

test('boot prune failure cannot roll back the imported high-water id', () => {
  const h = startAdmin({ env: { AUDIT_DAYS: '1', AUDIT_MAX: '1' } }), messages: string[] = []
  h.sqlite.query('INSERT INTO audit_events (id, ts, ev, ok) VALUES (?, ?, ?, ?)').run(100, CLOCK - 2 * DAY, 'auth.imported', 1)
  h.sqlite.run(`CREATE TRIGGER fail_boot_prune BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'synthetic boot prune failure'); END`)
  const audit = createAudit(h.sqlite, h.config, { now: () => CLOCK, ip: () => null, log: message => messages.push(message) })
  expect(getMeta(h.sqlite, 'audit_seq')).toBe('100')
  audit.write('auth.new')
  expect(listAudit(h.sqlite).map(e => e.id)).toEqual([101, 100])
  expect(getMeta(h.sqlite, 'audit_seq')).toBe('101')
  h.sqlite.run('DROP TRIGGER fail_boot_prune')
  audit.compact()
  audit.write('auth.next')
  expect(listAudit(h.sqlite).map(e => e.id)).toEqual([102])
  expect(getMeta(h.sqlite, 'audit_seq')).toBe('102')
  expect(messages).toEqual(['audit compact failed', 'audit compact failed'])
  audit.close()
})
