// Open and migrate, fail closed (STORAGE-CONTRACT §6). Extra gate: a migration failure leaves the DB untouched.
import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { openStore, openDb, migrate, schemaVersion, StorageRefused, MIGRATIONS, getMeta } from '../src/storage'
import { scratchDir } from './helpers'

const tables = (file: string): string[] => {
  const raw = new Database(file, { readonly: true })
  try {
    return raw.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name)
  } finally { raw.close() }
}

test('a fresh directory gets the v1 schema, owner-only files and write_owner=sqlite', () => {
  const dir = scratchDir()
  const store = openStore(dir)
  try {
    expect(schemaVersion(store.db)).toBe(1)
    expect(getMeta(store.db, 'write_owner')).toBe('sqlite')
    const mode = fs.statSync(path.join(dir, 'opengym.db')).mode & 0o777
    expect(mode).toBe(0o600)
    expect(store.db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()?.journal_mode).toBe('wal')
  } finally { store.close() }
  expect(tables(path.join(dir, 'opengym.db'))).toEqual(expect.arrayContaining([
    'audit_events', 'creds', 'device_links', 'devices', 'invites', 'library_bodies', 'library_definitions',
    'library_versions', 'media_objects', 'meta', 'push_subs', 'schema_migrations', 'state_docs', 'state_doc_history', 'users',
  ]))
})

test('reopening is idempotent: no migration runs twice and the version row stays single', () => {
  const dir = scratchDir()
  openStore(dir).close()
  const store = openStore(dir)
  try {
    expect(schemaVersion(store.db)).toBe(1)
    const rows = store.db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM schema_migrations').get()
    expect(rows?.n).toBe(1)
  } finally { store.close() }
})

test('a failing migration aborts the open and leaves the database exactly as it was', () => {
  const dir = scratchDir()
  const file = path.join(dir, 'opengym.db')
  const bad = [...MIGRATIONS, { version: 2, name: 'broken', sql: 'CREATE TABLE half_applied (x INTEGER) STRICT; INSERT INTO no_such_table VALUES (1);' }]
  expect(() => openDb(file, bad)).toThrow(StorageRefused)
  // v1 committed on its own; v2's CREATE was in the same transaction as the failing INSERT, so it rolled back too.
  expect(tables(file)).not.toContain('half_applied')
  const raw = new Database(file, { readonly: true })
  try { expect(schemaVersion(raw)).toBe(1) } finally { raw.close() }
  // A good build still opens the same file afterwards.
  const store = openStore(dir)
  try { expect(schemaVersion(store.db)).toBe(1) } finally { store.close() }
})

test('a half-applied earlier migration is never left behind: version 1 rolls back with a bad version 1', () => {
  const dir = scratchDir()
  const file = path.join(dir, 'opengym.db')
  expect(() => openDb(file, [{ version: 1, name: 'init', sql: 'CREATE TABLE a (x INTEGER); SELECT * FROM missing;' }])).toThrow()
  expect(tables(file)).toEqual([])
})

test('a database newer than this build is refused, not downgraded', () => {
  const dir = scratchDir()
  openStore(dir).close()
  const file = path.join(dir, 'opengym.db')
  const db = new Database(file)
  try {
    db.run('INSERT INTO schema_migrations(version, name, applied_at) VALUES (9, "future", 0)')
    expect(() => migrate(db, MIGRATIONS)).toThrow(StorageRefused)
  } finally { db.close() }
})

test('a file that is not a SQLite database is refused with UNREADABLE', () => {
  const dir = scratchDir()
  const file = path.join(dir, 'opengym.db')
  fs.writeFileSync(file, 'this is not sqlite '.repeat(200))
  try {
    openDb(file)
    throw new Error('expected a refusal')
  } catch (err) {
    expect(err).toBeInstanceOf(StorageRefused)
    expect((err as StorageRefused).code).toBe('UNREADABLE')
  }
})


test('legacy JSON beside a new database is refused, and the refusal sticks on the next boot', () => {
  const dir = scratchDir()
  fs.writeFileSync(path.join(dir, 'db.json'), '{"users":[]}')
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      openStore(dir)
      throw new Error('expected a refusal')
    } catch (err) {
      expect((err as StorageRefused).code).toBe('LEGACY_DATA_PRESENT')
    }
  }
})

test('data with no recorded owner is refused, never claimed', () => {
  const dir = scratchDir()
  const raw = openDb(path.join(dir, 'opengym.db'))
  raw.run("INSERT INTO users (id, name, created, ord) VALUES ('u1', 'n', 'c', 0)")
  raw.close()
  try {
    openStore(dir)
    throw new Error('expected a refusal')
  } catch (err) {
    expect((err as StorageRefused).code).toBe('OWNER_MISSING')
  }
})

test('an empty, ownerless database from a failed first boot is still claimed on the next one', () => {
  const dir = scratchDir()
  openDb(path.join(dir, 'opengym.db')).close()
  const store = openStore(dir)
  try {
    expect(getMeta(store.db, 'write_owner')).toBe('sqlite')
  } finally { store.close() }
})
