// Boot path for storage: open and migrate the database, refuse unsafe write ownership, sweep crash leftovers,
// and reconcile the JSON mirrors before anything is served.
import type { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { openDb, StorageRefused } from './db'
import { getMeta, setMeta } from './repos'
import { reconcileAccountsMirror, reconcileAllMirrors, sweepTempFiles, type MirrorReport, type AccountsMirrorReport } from './mirror'
import type { Migration } from './migrations'

export { openDb, migrate, schemaVersion, StorageRefused } from './db'
export { MIGRATIONS, type Migration } from './migrations'
export * from './repos'
export * from './state'
export * from './mirror'
export * from './backup'
export { atomicWrite, syncDir, syncFile, type AtomicHooks } from './durable'

export const DB_FILE = 'opengym.db'

export interface Store {
  db: Database
  dataDir: string
  close(): void
}

export interface BootResult extends Store {
  swept: string[]
  accounts: AccountsMirrorReport
  mirrors: MirrorReport[]
}

/** Legacy JSON that a fresh database must not silently replace: db.json, or any state-<uid>.json. */
function legacyFilesPresent(dataDir: string): boolean {
  if (!fs.existsSync(dataDir)) return false
  return fs.readdirSync(dataDir).some(n => n === 'db.json' || /^state-[a-zA-Z0-9_-]+\.json$/.test(n))
}

/** Whether the database holds any data a write owner would be claiming: accounts or state documents. */
function holdsData(db: Database): boolean {
  const row = db.query<{ n: number }, []>(`SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM state_docs) AS n`).get()
  return (row?.n ?? 0) > 0
}

/**
 * Opens the store under `dataDir`. Write ownership is claimed only when there is nothing to lose: an empty
 * database with no legacy JSON beside it. Legacy JSON beside it, or data without a recorded owner, is refused
 * and needs the importer, which records the owner itself. An empty, ownerless database (say, a first boot that
 * failed mid-migration) is still claimable, so a fresh install is never bricked by its own first attempt.
 */
export function openStore(dataDir: string, migrations?: readonly Migration[]): Store {
  const db = openDb(path.join(dataDir, DB_FILE), migrations)
  try {
    if (getMeta(db, 'write_owner') === null) {
      if (legacyFilesPresent(dataDir)) {
        throw new StorageRefused('LEGACY_DATA_PRESENT', 'legacy JSON exists beside the database; run the importer before serving')
      }
      if (holdsData(db)) throw new StorageRefused('OWNER_MISSING', `${DB_FILE} holds data but has no write_owner; run the importer`)
      setMeta(db, 'write_owner', 'sqlite')
    }
  } catch (err) {
    db.close()
    throw err
  }
  return { db, dataDir, close: () => db.close() }
}

/**
 * Boot: open, then serve only if the write owner is SQLite and every mirror is either current or repairable.
 * A refused mirror (JSON that SQLite cannot account for) throws StorageRefused: the operator must reconcile first.
 */
export function bootStore(dataDir: string, migrations?: readonly Migration[]): BootResult {
  const store = openStore(dataDir, migrations)
  try {
    const owner = getMeta(store.db, 'write_owner')
    if (owner !== 'sqlite') {
      throw new StorageRefused('LEGACY_WRITES_DETECTED', `write_owner is ${owner}; run import --reconcile before serving`)
    }
    const swept = sweepTempFiles(dataDir)
    const accounts = reconcileAccountsMirror(store.db, dataDir)
    const mirrors = reconcileAllMirrors(store.db, dataDir)
    if (accounts.action === 'refused') {
      throw new StorageRefused(accounts.code ?? 'LEGACY_ACCOUNT_WRITES', 'db.json was written by something SQLite cannot account for; run import --reconcile')
    }
    const refused = mirrors.filter(m => m.action === 'refused')
    if (refused.length) {
      throw new StorageRefused(refused[0]?.code ?? 'LEGACY_WRITES_DETECTED',
        `${refused.length} profile mirror(s) hold writes SQLite has not seen; run import --reconcile`)
    }
    return { ...store, swept, accounts, mirrors }
  } catch (err) {
    store.close()
    throw err
  }
}
