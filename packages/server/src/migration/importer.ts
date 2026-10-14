import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { syncDir } from '../storage/durable'
import { Database } from 'bun:sqlite'
import { openDb } from '../storage/db'
import { commitStateDoc, profilesWithState, readStateDoc } from '../storage/state'
import { accountsText, sha256 } from '../storage/mirror'
import { getMeta, setMeta, putUser, putCred, putSub, putInvite, putDeviceLink } from '../storage/repos'
import { authorize, containedFile, checkedDatabase, readCheckedFile, type MigrationOptions } from './safety'
import { assertStateDepth } from '../data'
import { readMigrationArchive } from './archive'
import { LIMITS } from '@opengym/contract/http/api'

export const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('expected JSON object')
  return v as Record<string, unknown>
}
const str = (v: unknown): string => { if (typeof v !== 'string') throw new Error('expected string'); return v }
const integer = (v: unknown): number => { if (!Number.isSafeInteger(v)) throw new Error('expected safe integer'); return v as number }
const nullable = (v: unknown): string | null => v == null ? null : str(v)
const rows = (v: unknown): Record<string, unknown>[] => {
  if (v == null) return []
  if (!Array.isArray(v)) throw new Error('expected account array')
  return v.map(record)
}
const extra = (r: Record<string, unknown>, keys: string[]) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k))))
export interface ImportReport {
  dryRun: boolean; reconciled: boolean; profiles: { id: string; bytes: number; sha256: string; equal: boolean }[]
  accountsEqual: boolean; auditEvents: number; auditSkipped: number; passwordFieldsDropped: number; uploadsIgnored: { path: string; bytes: number }[]; accountsSource: string
}
interface Snapshot { accounts: Record<string, unknown>; accountsOriginal: string; states: Map<string, string>; stateBytes: Map<string, Buffer>; audit: Record<string, unknown>[]; skipped: number; uploads: { path: string; bytes: number }[]; dropped: number; accountsSource: string }
function snapshot(data: string, archive?: Map<string, string>): Snapshot {
  const readBytes = (name: string): Buffer => archive ? Buffer.from(archive.get(name) ?? (() => { throw new Error('archive entry missing: ' + name) })(), 'utf8') : fs.readFileSync(containedFile(data, name))
  const decode = (bytes: Buffer): string => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  const read = (name: string): string => decode(readBytes(name))
  const names = archive ? [...archive.keys()] : fs.readdirSync(data)
  let raw: string, accounts: Record<string, unknown>, accountsSource = 'db.json'
  try { raw = read('db.json'); accounts = record(JSON.parse(raw)) }
  catch {
    if (archive) throw new Error('archive db.json unreadable')
    try { raw = read('db.json.bak'); accounts = record(JSON.parse(raw)); accountsSource = 'db.json.bak' }
    catch { throw new Error('Refusing to start: no readable db.json or db.json.bak; restore a backup') }
  }
  assertStateDepth(accounts)
  let dropped = 0
  accounts.users = rows(accounts.users).map(u => {
    const out = { ...u }
    for (const k of ['pw', 'pwReset', 'email']) if (Object.hasOwn(out, k)) { delete out[k]; dropped++ }
    return out
  })
  for (const [table, key] of [['creds', 'id'], ['subs', 'endpoint'], ['invites', 'code'], ['deviceLinks', 'h']] as const) {
    const seen = new Set<string>()
    for (const row of rows(accounts[table])) {
      const value = str(row[key])
      if (!value || seen.has(value)) throw new Error('duplicate or empty account key: ' + table)
      seen.add(value)
    }
  }
  const ids = new Set<string>()
  const states = new Map<string, string>()
  const stateBytes = new Map<string, Buffer>()
  for (const u of rows(accounts.users)) {
    const id = str(u.id)
    if (!/^[A-Za-z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('duplicate or unsafe user id')
    ids.add(id)
    const f = containedFile(data, `state-${id}.json`)
    if (archive ? !archive.has(`state-${id}.json`) : !fs.existsSync(f)) continue
    const bytes = readBytes(`state-${id}.json`), text = decode(bytes), doc = record(JSON.parse(text))
    assertStateDepth(doc)
    if (Buffer.byteLength(text) > LIMITS.maxBodyBytes) throw new Error('state exceeds 5 MiB')
    if (doc._rev !== undefined) integer(doc._rev)
    states.set(id, text)
    stateBytes.set(id, bytes)
  }
  for (const name of names) if (/^state-.*\.json$/.test(name) && !ids.has(name.slice(6, -5))) throw new Error('orphan state file refused')
  const audit: Record<string, unknown>[] = []; let skipped = 0
  const af = containedFile(data, 'audit.log')
  if (archive ? archive.has('audit.log') : fs.existsSync(af)) for (const line of read('audit.log').split('\n')) {
    if (!line) continue
    try { const r = record(JSON.parse(line)); if (!r.id || !r.ev) { skipped++; continue }; audit.push(r) }
    catch { skipped++ }
  }
  // Media was deleted. Count inert files, refuse symlink escapes, leave bytes untouched.
  const uploads: { path: string; bytes: number }[] = []
  function walk(relative: string): void {
    const f = containedFile(data, relative)
    if (!fs.existsSync(f)) return
    if (fs.statSync(f).isDirectory()) for (const n of fs.readdirSync(f)) walk(path.join(relative, n))
    else uploads.push({ path: relative, bytes: fs.statSync(f).size })
  }
  walk('uploads')
  return { accounts, accountsOriginal: dropped ? JSON.stringify(accounts, null, 2) : raw, states, stateBytes, audit, skipped, uploads, dropped, accountsSource }
}
function importAccounts(db: Database, a: Record<string, unknown>): void {
  rows(a.users).forEach((u, ord) => putUser(db, { id: str(u.id), name: str(u.name), created: str(u.created), admin: Number(u.admin === true), disabled: Number(u.disabled === true), sv: integer(u.sv ?? 0), invited_by: nullable(u.invitedBy), last_pull: u.lastPull == null ? null : integer(u.lastPull), last_reminder: nullable(u.lastReminder), last_nudge: nullable(u.lastNudge), ord,
    x: extra(u, ['id','name','created','admin','disabled','sv','invitedBy','lastPull','lastReminder','lastNudge']) }))
  rows(a.creds).forEach((c, ord) => putCred(db, { id: str(c.id), user_id: str(c.userId), public_key: str(c.publicKey), counter: integer(c.counter ?? 0), transports: JSON.stringify(c.transports ?? []), created: nullable(c.created), last_used: nullable(c.lastUsed), name: nullable(c.name), ord, x: extra(c, ['id','userId','publicKey','counter','transports','created','lastUsed','name']) }))
  rows(a.subs).forEach((s, ord) => { const keys = record(s.keys); putSub(db, { endpoint: str(s.endpoint), user_id: str(s.userId), p256dh: str(keys.p256dh), auth: str(keys.auth), device_id: nullable(s.deviceId), created: nullable(s.created), ord }) })
  rows(a.invites).forEach((i, ord) => putInvite(db, { code: str(i.code), note: str(i.note ?? ''), created_by: nullable(i.createdBy), created: nullable(i.created), used_by: nullable(i.usedBy), used_at: nullable(i.usedAt), revoked: Number(i.revoked === true), ord }))
  rows(a.deviceLinks).forEach(l => putDeviceLink(db, { h: str(l.h), user_id: str(l.userId), exp: integer(l.exp), created: integer(l.created) }))
}
export async function importLegacy(options: MigrationOptions): Promise<ImportReport> {
  const data = authorize(options)
  const archive = options.archive ? await readMigrationArchive(new Blob([fs.readFileSync(containedFile(data, options.archive))])) : undefined
  if (archive) {
    // Existing JSON mirrors must agree with an archive. Never claim SQLite owns divergent legacy bytes.
    for (const name of fs.readdirSync(data).filter(n => n === 'db.json' || /^state-.*\.json$/.test(n))) {
      const existing = fs.readFileSync(containedFile(data, name), 'utf8')
      if (archive.get(name) !== existing) throw new Error('archive conflicts with legacy JSON; restore into an empty scratch DATA_DIR')
    }
  }
  const source = snapshot(data, archive), file = containedFile(data, 'opengym.db')
  for (const suffix of ['-wal', '-shm']) containedFile(data, 'opengym.db' + suffix)
  if (fs.existsSync(file) && !options.reconcile) throw new Error('database exists; use --reconcile')
  // Fresh imports are published only after verification; failed imports leave no database behind.
  const stage = options.apply && !fs.existsSync(file) ? containedFile(data, `opengym.db.import-${process.pid}-${randomBytes(6).toString('hex')}`) : null
  let db: Database
  if (!options.apply && fs.existsSync(file)) {
    db = databaseSnapshot(file, options)
    db.run('PRAGMA foreign_keys=ON')
  } else db = options.apply ? checkedDatabase(options, stage ?? file, true, !!stage) : openDb(':memory:')
  try {
    const report = db.transaction(() => {
      if (options.reconcile) {
        // Keep library/version data for surviving users. JSON wins for all legacy-owned tables.
        db.run('DELETE FROM creds; DELETE FROM push_subs; DELETE FROM invites; DELETE FROM device_links; DELETE FROM state_docs; DELETE FROM state_doc_history; DELETE FROM audit_events;')
        const incoming = new Set(rows(source.accounts.users).map(u => str(u.id)))
        for (const u of db.query<{ id: string }, []>('SELECT id FROM users').all()) if (!incoming.has(u.id)) db.query('DELETE FROM users WHERE id=?').run(u.id)
      }
      importAccounts(db, source.accounts)
      for (const [id, text] of source.states) {
        const doc = record(JSON.parse(text))
        // Legacy permits pre-revision docs. Preserve their bytes with a derived zero revision.
        if (doc._rev === undefined) db.query('INSERT INTO state_docs(profile_id,rev,wid,json,bytes,updated_at) VALUES (?,?,?,?,?,?)').run(id, 0, typeof doc._wid === 'string' ? doc._wid : null, text, Buffer.byteLength(text), options.now ?? Date.now())
        else commitStateDoc(db, id, text, options.now ?? Date.now(), 30)
      }
      let seq = 0
      for (const r of source.audit) {
        const id = integer(r.id); seq = Math.max(seq, id)
        db.query('INSERT INTO audit_events(id,ts,ev,ok,uid,name,tgt,tname,msg,act,ip) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(id, integer(r.ts), str(r.ev), Number(r.ok === true || r.ok === 1), nullable(r.uid), nullable(r.name), nullable(r.tgt), nullable(r.tname), nullable(r.msg), nullable(r.act), nullable(r.ip))
      }
      setMeta(db, 'audit_seq', String(Math.max(seq, Number(getMeta(db, 'audit_seq') ?? 0))))
      const projected = accountsText(db)
      setMeta(db, 'import_accounts_original', source.accountsOriginal)
      setMeta(db, 'import_accounts_projection', sha256(projected))
      if (fs.existsSync(containedFile(data, 'db.json'))) setMeta(db, 'accounts_mirror_ondisk', sha256(fs.readFileSync(containedFile(data, 'db.json'), 'utf8')))
      setMeta(db, 'imported_from', 'legacy-json')
      const profiles = [...source.stateBytes].map(([id, bytes]) => ({ id, bytes: bytes.length, sha256: sha256(bytes), equal: Buffer.from(readStateDoc(db, id)?.json ?? '', 'utf8').equals(bytes) }))
      if (profiles.some(p => !p.equal)) throw new Error('state byte verification failed')
      setMeta(db, 'write_owner', 'sqlite')
      return { dryRun: !options.apply, reconciled: !!options.reconcile, profiles, accountsEqual: true, auditEvents: source.audit.length, auditSkipped: source.skipped, passwordFieldsDropped: source.dropped, uploadsIgnored: source.uploads, accountsSource: source.accountsSource }
    }).immediate()
    if (stage) {
      db.run('PRAGMA wal_checkpoint(TRUNCATE)')
      db.close()
      // An exclusive hard link prevents a concurrent fresh importer from overwriting a winner.
      fs.linkSync(stage, file); fs.unlinkSync(stage); syncDir(data)
    }
    return report
  } finally {
    db.close()
    if (stage) for (const suffix of ['', '-wal', '-shm']) fs.rmSync(stage + suffix, { force: true })
  }
}
export function openMigration(options: MigrationOptions, writablePreview = false): { db: Database; data: string } {
  const data = authorize(options), file = containedFile(data, 'opengym.db')
  for (const s of ['-wal', '-shm']) containedFile(data, 'opengym.db' + s)
  if (!fs.existsSync(file)) throw new Error('import first: database missing')
  const db = options.apply ? checkedDatabase(options, file, true) : databaseSnapshot(file, options, !writablePreview)
  if (getMeta(db, 'write_owner') !== 'sqlite') { db.close(); throw new Error('import --reconcile before migration') }
  return { db, data }
}
export function verifyLegacy(options: MigrationOptions) {
  const { db, data } = openMigration({ ...options, apply: false })
  try {
    const s = snapshot(data)
    const profiles = [...s.stateBytes].map(([id, bytes]) => ({ id, equal: Buffer.from(readStateDoc(db, id)?.json ?? '', 'utf8').equals(bytes), sha256: sha256(bytes) }))
    const accountsEqual = getMeta(db, 'import_accounts_original') === s.accountsOriginal && getMeta(db, 'import_accounts_projection') === sha256(accountsText(db))
    const auditEqual = s.audit.every(r => {
      const saved = db.query<Record<string, unknown>, [number]>('SELECT * FROM audit_events WHERE id=?').get(integer(r.id))
      const expected = { id: integer(r.id), ts: integer(r.ts), ev: str(r.ev), ok: Number(r.ok === true || r.ok === 1), uid: nullable(r.uid), name: nullable(r.name), tgt: nullable(r.tgt), tname: nullable(r.tname), msg: nullable(r.msg), act: nullable(r.act), ip: nullable(r.ip) }
      return saved !== null && JSON.stringify(saved) === JSON.stringify(expected)
    }) && Number(getMeta(db, 'audit_seq') ?? 0) >= Math.max(0, ...s.audit.map(r => integer(r.id)))
    const ok = auditEqual && accountsEqual && profiles.every(p => p.equal) && profilesWithState(db).length === s.states.size
    if (!ok) throw new Error('legacy byte verification failed')
    return { ok, accountsEqual, auditEqual, profiles }
  } finally { db.close() }
}

/** A read-only dry run cannot create WAL sidecars. Deserialize a consistent image in memory. */
function databaseSnapshot(file: string, options: MigrationOptions, readonly = false): Database {
  let image: Buffer
  if (fs.existsSync(file + '-wal') && fs.statSync(file + '-wal').size > 0) {
    const source = checkedDatabase(options, file, false)
    try { image = source.serialize() } finally { source.close() }
  } else image = readCheckedFile(options, file)
  // Serialized WAL headers otherwise try to open an on-disk WAL for this in-memory image.
  image[18] = 1; image[19] = 1
  const snapshot = Database.deserialize(image, { readonly, strict: true })
  snapshot.run('PRAGMA foreign_keys=ON')
  return snapshot
}
