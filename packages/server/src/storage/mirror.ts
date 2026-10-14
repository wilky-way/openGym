// The JSON mirror: `state-<uid>.json` and `db.json` (+ `.bak`) written after each committed change, in the
// legacy shape, so the rollback image can read them (STORAGE-CONTRACT §1, §3). SQLite is the truth; the mirror
// is a copy that boot checks and repairs.
import type { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { atomicWrite, type AtomicHooks } from './durable'
import { readStateDoc, isKnownWid, profilesWithState } from './state'
import { listUsers, listAllCreds, listAllSubs, listInvites, listDeviceLinks, getMeta, setMeta, type UserRow } from './repos'

export const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex')

export const stateMirrorFile = (dataDir: string, uid: string): string =>
  path.join(dataDir, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json')
export const accountsMirrorFile = (dataDir: string): string => path.join(dataDir, 'db.json')

// The write id of the last state text that reached the disk for a profile. Recorded only after the rename succeeds,
// so a run of failed mirror writes cannot age it out of the history ring (see reconcileStateMirror).
const mirrorWidKey = (profileId: string): string => `mirror_wid:${profileId}`

/** Writes the profile's current document to its mirror file. Throws on failure; the caller decides what that means. */
export function writeStateMirror(db: Database, dataDir: string, profileId: string, hooks?: AtomicHooks): string {
  const row = readStateDoc(db, profileId)
  if (!row) throw new Error(`no state document for ${profileId}`)
  const file = stateMirrorFile(dataDir, profileId)
  atomicWrite(file, row.json, 0o600, hooks)
  if (row.wid !== null) setMeta(db, mirrorWidKey(profileId), row.wid)
  return file
}

/** The accounts as the legacy db.json shape. Fields with no column of their own come back from `x`. */
export function exportAccounts(db: Database): Record<string, unknown[]> {
  const users = listUsers(db).map(userRecord)
  const creds = listAllCreds(db).map(c => ({
    ...JSON.parse(c.x) as object, id: c.id, userId: c.user_id, publicKey: c.public_key, counter: c.counter,
    transports: JSON.parse(c.transports) as unknown, ...(c.created !== null ? { created: c.created } : {}),
    ...(c.last_used !== null ? { lastUsed: c.last_used } : {}), ...(c.name !== null ? { name: c.name } : {}),
  }))
  const subs = listAllSubs(db).map(s => ({
    endpoint: s.endpoint, userId: s.user_id, keys: { p256dh: s.p256dh, auth: s.auth },
    ...(s.device_id !== null ? { deviceId: s.device_id } : {}), ...(s.created !== null ? { created: s.created } : {}),
  }))
  const invites = listInvites(db).map(i => ({
    code: i.code, note: i.note, createdBy: i.created_by, created: i.created, usedBy: i.used_by, usedAt: i.used_at,
    ...(i.revoked ? { revoked: true } : {}),
  }))
  const deviceLinks = listDeviceLinks(db).map(l => ({ h: l.h, userId: l.user_id, exp: l.exp, created: l.created }))
  return { users, creds, subs, invites, deviceLinks }
}

function userRecord(u: UserRow): Record<string, unknown> {
  return {
    ...JSON.parse(u.x) as object, id: u.id, name: u.name, created: u.created,
    ...(u.admin ? { admin: true } : {}), ...(u.disabled ? { disabled: true } : {}), sv: u.sv,
    ...(u.invited_by !== null ? { invitedBy: u.invited_by } : {}),
    ...(u.last_pull !== null ? { lastPull: u.last_pull } : {}),
    ...(u.last_reminder !== null ? { lastReminder: u.last_reminder } : {}),
    ...(u.last_nudge !== null ? { lastNudge: u.last_nudge } : {}),
  }
}

export const accountsText = (db: Database): string => JSON.stringify(exportAccounts(db), null, 2)

// Fingerprints of the last two db.json texts this code wrote, kept in meta. They let boot tell "our mirror, now
// behind SQLite" (rewrite) from "someone else wrote the file" (refuse). The pair covers a crash between recording
// the new fingerprint and renaming the file: the file is then still the previous one.
const FP_LAST = 'accounts_mirror_last'
const FP_PREV = 'accounts_mirror_prev'
const fingerprint = (db: Database, key: string): string | null => {
  const v = getMeta(db, key)
  return v === null || v === '' ? null : v
}

// The fingerprint of the db.json text that is on disk. Set only after db.json's rename succeeds: a failed write
// leaves it at the older text, which is what the file still holds.
const FP_DISK = 'accounts_mirror_ondisk'

/**
 * db.json and db.json.bak (the copy of the last save), both 0600, both durable. The pre-write pair (LAST, PREV)
 * goes first, so a crash between recording and renaming still finds the file's previous text; once the rename
 * succeeds, the on-disk fingerprint is recorded. A write that throws leaves the on-disk fingerprint untouched.
 */
export function writeAccountsMirror(db: Database, dataDir: string, hooks?: AtomicHooks): string {
  const text = accountsText(db)
  const digest = sha256(text)
  db.transaction(() => {
    setMeta(db, FP_PREV, getMeta(db, FP_LAST) ?? '')
    setMeta(db, FP_LAST, digest)
  }).immediate()
  const file = accountsMirrorFile(dataDir)
  atomicWrite(file, text, 0o600, hooks)
  setMeta(db, FP_DISK, digest)
  atomicWrite(file + '.bak', text, 0o600)
  return file
}

/**
 * Crash leftovers: `<mirror>.<pid>.<hex>.tmp` files that never reached their rename. Safe to remove at boot.
 * This deletes any writer's temp file regardless of its pid, which is only safe while one server process owns the
 * data directory. That is a deployment rule: write_owner records the engine, not a single process, so nothing
 * in the code enforces it.
 */
const TEMP_RE = /^(?:state-[a-zA-Z0-9_-]+\.json|db\.json(?:\.bak)?)\.\d+\.[0-9a-f]{12}\.tmp$/
export function sweepTempFiles(dataDir: string): string[] {
  if (!fs.existsSync(dataDir)) return []
  const removed: string[] = []
  for (const name of fs.readdirSync(dataDir)) {
    if (!TEMP_RE.test(name)) continue
    fs.rmSync(path.join(dataDir, name), { force: true })
    removed.push(name)
  }
  return removed
}

export type MirrorAction =
  | 'current'     // the mirror already holds the committed bytes
  | 'created'     // no mirror file existed; written from SQLite
  | 'rewritten'   // mirror was behind SQLite (a version SQLite committed, or a fingerprint of our own); SQLite wins
  | 'refused'     // the file holds something SQLite cannot account for: refuse rather than guess

export interface MirrorReport {
  profileId: string
  action: MirrorAction
  mirrorWid: string | null
  sqliteWid: string | null
  code?: string
}

/**
 * Boot check for one profile (STORAGE-CONTRACT §3, write-ownership rule). A mirror version that SQLite has
 * committed is behind and gets rewritten. A version SQLite has never seen means legacy code wrote after a
 * rollback: the profile is refused rather than overwritten, because the JSON may be newer. Without a write id on
 * both sides, neither can be ordered, so differing bytes are refused too.
 */
export function reconcileStateMirror(db: Database, dataDir: string, profileId: string): MirrorReport {
  const row = readStateDoc(db, profileId)
  if (!row) return { profileId, action: 'current', mirrorWid: null, sqliteWid: null }
  const file = stateMirrorFile(dataDir, profileId)
  if (!fs.existsSync(file)) {
    writeStateMirror(db, dataDir, profileId)
    return { profileId, action: 'created', mirrorWid: null, sqliteWid: row.wid }
  }
  const text = fs.readFileSync(file, 'utf8')
  if (text === row.json) {
    // Accepting the bytes records them: a crash may have fallen between the rename and its record.
    if (row.wid !== null) setMeta(db, mirrorWidKey(profileId), row.wid)
    return { profileId, action: 'current', mirrorWid: row.wid, sqliteWid: row.wid }
  }
  let mirrorWid: string | null
  try {
    const parsed = JSON.parse(text) as { _wid?: unknown }
    mirrorWid = typeof parsed._wid === 'string' ? parsed._wid : null
  } catch {
    // Atomic writes cannot leave a torn file, so an unreadable mirror came from outside: refuse, do not guess.
    return { profileId, action: 'refused', mirrorWid: null, sqliteWid: row.wid, code: 'MIRROR_UNREADABLE' }
  }
  if (row.wid === null || mirrorWid === null) {
    return { profileId, action: 'refused', mirrorWid, sqliteWid: row.wid, code: 'UNVERSIONED_MIRROR' }
  }
  const onDisk = getMeta(db, mirrorWidKey(profileId))
  if (mirrorWid === row.wid || mirrorWid === onDisk || isKnownWid(db, profileId, mirrorWid)) {
    writeStateMirror(db, dataDir, profileId)
    return { profileId, action: 'rewritten', mirrorWid, sqliteWid: row.wid }
  }
  return { profileId, action: 'refused', mirrorWid, sqliteWid: row.wid, code: 'LEGACY_WRITES_DETECTED' }
}

/** Reconciles every profile that has a document. */
export function reconcileAllMirrors(db: Database, dataDir: string): MirrorReport[] {
  return profilesWithState(db).map(id => reconcileStateMirror(db, dataDir, id))
}

export interface AccountsMirrorReport {
  action: MirrorAction
  code?: string
}

/**
 * Boot check for db.json and db.json.bak. A file whose bytes match one of our two recorded fingerprints is ours
 * and out of date with SQLite (a commit whose mirror write was cut short), so it is rewritten. Any other file
 * was written by someone else and is refused. The backup copy is repaired even when db.json is current, because
 * the crash can fall between the two writes.
 */
export function reconcileAccountsMirror(db: Database, dataDir: string): AccountsMirrorReport {
  const text = accountsText(db)
  const file = accountsMirrorFile(dataDir)
  if (!fs.existsSync(file)) {
    writeAccountsMirror(db, dataDir)
    return { action: 'created' }
  }
  const current = fs.readFileSync(file, 'utf8')
  if (current === text) {
    // Accepting the bytes records them, for the same crash-before-record reason as the state mirror.
    setMeta(db, FP_DISK, sha256(current))
    const bak = file + '.bak'
    if (!fs.existsSync(bak) || fs.readFileSync(bak, 'utf8') !== text) {
      atomicWrite(bak, text, 0o600)
      return { action: 'rewritten' }
    }
    return { action: 'current' }
  }
  const digest = sha256(current)
  if (digest === fingerprint(db, FP_LAST) || digest === fingerprint(db, FP_PREV) || digest === fingerprint(db, FP_DISK)) {
    writeAccountsMirror(db, dataDir)
    return { action: 'rewritten' }
  }
  return { action: 'refused', code: 'LEGACY_ACCOUNT_WRITES' }
}
