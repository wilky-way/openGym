// Opening the database: pragmas, file modes, and migrations that fail closed (STORAGE-CONTRACT §6).
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { MIGRATIONS, type Migration } from './migrations'

/** Raised when the database cannot be served: unreadable, newer than this build, or otherwise refused. */
export class StorageRefused extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'StorageRefused'
    this.code = code
  }
}

const PRAGMAS = 'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;'

/** Highest applied migration version; 0 for a database with no migration table yet. */
export function schemaVersion(db: Database): number {
  const table = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get()
  if (!table) return 0
  const row = db.query<{ v: number }, []>('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get()
  return row?.v ?? 0
}

/**
 * Applies every migration above the recorded version, each in its own transaction. A failing migration
 * rolls back with nothing applied, aborts the boot, and leaves the database as it was. A database that
 * records a version this build does not know is refused rather than downgraded.
 */
export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): number {
  const current = schemaVersion(db)
  const newest = Math.max(0, ...migrations.map(m => m.version))
  if (current > newest) throw new StorageRefused('SCHEMA_NEWER', `database schema ${current} is newer than this build (${newest})`)
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue
    db.transaction(() => {
      db.run(m.sql)
      // 0001 records itself; later migrations rely on this line.
      db.query('INSERT OR IGNORE INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, Date.now())
    }).immediate()
  }
  return schemaVersion(db)
}

/** Restricts the database files to the owner. Best effort: a bind-mounted host may refuse chmod. */
function restrictModes(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try { if (fs.existsSync(f)) fs.chmodSync(f, 0o600) } catch { /* host refuses chmod */ }
  }
}

/** Opens (creating if needed) `file`, applies the pragmas and migrations, and returns the handle. */
export function openDb(file: string, migrations: readonly Migration[] = MIGRATIONS): Database {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  let db: Database
  try {
    db = new Database(file, { create: true, strict: true })
  } catch (err) {
    throw new StorageRefused('UNREADABLE', `cannot open ${path.basename(file)}: ${(err as Error).message}`)
  }
  try {
    db.run(PRAGMAS)
  } catch (err) {
    db.close()
    throw new StorageRefused('UNREADABLE', `${path.basename(file)} is not a usable SQLite database: ${(err as Error).message}`)
  }
  try {
    migrate(db, migrations)
  } catch (err) {
    db.close()
    if (err instanceof StorageRefused) throw err
    throw new StorageRefused('MIGRATION_FAILED', `migration failed, database left at its last good version: ${(err as Error).message}`)
  }
  restrictModes(file)
  return db
}
