// Account repositories: users, passkeys (creds), push subscriptions, invites, device links, and the audit log.
// Rows mirror the column names in 0001_init.sql. Writes are UPSERTs, never REPLACE: REPLACE deletes the row
// first, and with foreign_keys=ON that cascades into every credential and subscription of the user.
import type { Database } from 'bun:sqlite'

export interface UserRow {
  id: string; name: string; created: string; admin: number; disabled: number; sv: number
  invited_by: string | null; last_pull: number | null; last_reminder: string | null; last_nudge: string | null
  ord: number; x: string
}
export interface CredRow {
  id: string; user_id: string; public_key: string; counter: number; transports: string
  created: string | null; last_used: string | null; name: string | null; ord: number; x: string
}
export interface SubRow {
  endpoint: string; user_id: string; p256dh: string; auth: string; device_id: string | null; created: string | null; ord: number
}
export interface InviteRow {
  code: string; note: string; created_by: string | null; created: string | null
  used_by: string | null; used_at: string | null; revoked: number; ord: number
}
export interface DeviceLinkRow { h: string; user_id: string; exp: number; created: number }
export interface AuditRow {
  id: number; ts: number; ev: string; ok: number
  uid: string | null; name: string | null; tgt: string | null; tname: string | null; msg: string | null; act: string | null; ip: string | null
}
export type AuditInput = Omit<AuditRow, 'id'>

export function getMeta(db: Database, key: string): string | null {
  return db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null
}
export function setMeta(db: Database, key: string, value: string): void {
  db.query('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

// ───────── users ─────────
export function putUser(db: Database, u: UserRow): void {
  db.query(`INSERT INTO users (id, name, created, admin, disabled, sv, invited_by, last_pull, last_reminder, last_nudge, ord, x)
    VALUES ($id, $name, $created, $admin, $disabled, $sv, $invited_by, $last_pull, $last_reminder, $last_nudge, $ord, $x)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, created = excluded.created, admin = excluded.admin,
      disabled = excluded.disabled, sv = excluded.sv, invited_by = excluded.invited_by, last_pull = excluded.last_pull,
      last_reminder = excluded.last_reminder, last_nudge = excluded.last_nudge, ord = excluded.ord, x = excluded.x`)
    .run({ id: u.id, name: u.name, created: u.created, admin: u.admin, disabled: u.disabled, sv: u.sv,
      invited_by: u.invited_by, last_pull: u.last_pull, last_reminder: u.last_reminder, last_nudge: u.last_nudge, ord: u.ord, x: u.x })
}
export const getUser = (db: Database, id: string) =>
  db.query<UserRow, [string]>('SELECT * FROM users WHERE id = ?').get(id) ?? null
export const listUsers = (db: Database) => db.query<UserRow, []>('SELECT * FROM users ORDER BY ord').all()
export function deleteUser(db: Database, id: string): void {
  db.query('DELETE FROM users WHERE id = ?').run(id)
}

// ───────── passkeys (creds) ─────────
export function putCred(db: Database, c: CredRow): void {
  db.query(`INSERT INTO creds (id, user_id, public_key, counter, transports, created, last_used, name, ord, x)
    VALUES ($id, $user_id, $public_key, $counter, $transports, $created, $last_used, $name, $ord, $x)
    ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id, public_key = excluded.public_key, counter = excluded.counter,
      transports = excluded.transports, created = excluded.created, last_used = excluded.last_used, name = excluded.name,
      ord = excluded.ord, x = excluded.x`)
    .run({ id: c.id, user_id: c.user_id, public_key: c.public_key, counter: c.counter, transports: c.transports,
      created: c.created, last_used: c.last_used, name: c.name, ord: c.ord, x: c.x })
}
export const listCreds = (db: Database, userId: string) =>
  db.query<CredRow, [string]>('SELECT * FROM creds WHERE user_id = ? ORDER BY ord').all(userId)
export const listAllCreds = (db: Database) => db.query<CredRow, []>('SELECT * FROM creds ORDER BY ord').all()
export function deleteCred(db: Database, id: string): void {
  db.query('DELETE FROM creds WHERE id = ?').run(id)
}

// ───────── push subscriptions ─────────
export function putSub(db: Database, s: SubRow): void {
  db.query(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, device_id, created, ord)
    VALUES ($endpoint, $user_id, $p256dh, $auth, $device_id, $created, $ord)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
      device_id = excluded.device_id, created = excluded.created, ord = excluded.ord`)
    .run({ endpoint: s.endpoint, user_id: s.user_id, p256dh: s.p256dh, auth: s.auth, device_id: s.device_id, created: s.created, ord: s.ord })
}
export const listSubs = (db: Database, userId: string) =>
  db.query<SubRow, [string]>('SELECT * FROM push_subs WHERE user_id = ? ORDER BY ord').all(userId)
export const listAllSubs = (db: Database) => db.query<SubRow, []>('SELECT * FROM push_subs ORDER BY ord').all()
export function deleteSub(db: Database, endpoint: string): void {
  db.query('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint)
}

// ───────── invites ─────────
export function putInvite(db: Database, i: InviteRow): void {
  db.query(`INSERT INTO invites (code, note, created_by, created, used_by, used_at, revoked, ord)
    VALUES ($code, $note, $created_by, $created, $used_by, $used_at, $revoked, $ord)
    ON CONFLICT(code) DO UPDATE SET note = excluded.note, created_by = excluded.created_by, created = excluded.created,
      used_by = excluded.used_by, used_at = excluded.used_at, revoked = excluded.revoked, ord = excluded.ord`)
    .run({ code: i.code, note: i.note, created_by: i.created_by, created: i.created, used_by: i.used_by, used_at: i.used_at, revoked: i.revoked, ord: i.ord })
}
export const getInvite = (db: Database, code: string) =>
  db.query<InviteRow, [string]>('SELECT * FROM invites WHERE code = ?').get(code) ?? null
export const listInvites = (db: Database) => db.query<InviteRow, []>('SELECT * FROM invites ORDER BY ord').all()
export function deleteInvite(db: Database, code: string): void {
  db.query('DELETE FROM invites WHERE code = ?').run(code)
}

// ───────── device links (hashed one-time codes) ─────────
export function putDeviceLink(db: Database, l: DeviceLinkRow): void {
  db.query(`INSERT INTO device_links (h, user_id, exp, created) VALUES (?, ?, ?, ?)
    ON CONFLICT(h) DO UPDATE SET user_id = excluded.user_id, exp = excluded.exp, created = excluded.created`)
    .run(l.h, l.user_id, l.exp, l.created)
}
export const getDeviceLink = (db: Database, h: string) =>
  db.query<DeviceLinkRow, [string]>('SELECT * FROM device_links WHERE h = ?').get(h) ?? null
export const listDeviceLinks = (db: Database) => db.query<DeviceLinkRow, []>('SELECT * FROM device_links ORDER BY created').all()
export function deleteDeviceLink(db: Database, h: string): void {
  db.query('DELETE FROM device_links WHERE h = ?').run(h)
}
/** Drops links whose expiry has passed; returns how many went. */
export function pruneDeviceLinks(db: Database, now: number): number {
  return db.query('DELETE FROM device_links WHERE exp <= ?').run(now).changes
}

// ───────── audit ─────────
// Ids come from a counter in `meta`, never from MAX(id)+1: a clear that empties the table must not reuse ids
// (legacy: "a wiped log leaves a visible id gap").
export function appendAudit(db: Database, row: AuditInput): number {
  return db.transaction((): number => {
    const next = Number(getMeta(db, 'audit_seq') ?? '0') + 1
    db.query(`INSERT INTO audit_events (id, ts, ev, ok, uid, name, tgt, tname, msg, act, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(next, row.ts, row.ev, row.ok, row.uid, row.name, row.tgt, row.tname, row.msg, row.act, row.ip)
    setMeta(db, 'audit_seq', String(next))
    return next
  }).immediate()
}
export const listAudit = (db: Database, limit = 500) =>
  db.query<AuditRow, [number]>('SELECT * FROM audit_events ORDER BY id DESC LIMIT ?').all(limit)
/** Retention as legacy: rows older than `minTs` go, then only the newest `maxRows` stay (0 = no cap). */
export function pruneAudit(db: Database, opts: { minTs?: number; maxRows?: number }): number {
  let changes = 0
  if (opts.minTs !== undefined) changes += db.query('DELETE FROM audit_events WHERE ts < ?').run(opts.minTs).changes
  if (opts.maxRows && opts.maxRows > 0) {
    changes += db.query(`DELETE FROM audit_events WHERE id NOT IN
      (SELECT id FROM audit_events ORDER BY id DESC LIMIT ?)`).run(opts.maxRows).changes
  }
  return changes
}
