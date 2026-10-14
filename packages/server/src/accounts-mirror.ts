import type { Database } from 'bun:sqlite'
import { setMeta, writeAccountsMirror } from './storage'

export interface AccountsMirrorOptions {
  mirror?: typeof writeAccountsMirror
  log?: (message: string) => void
}

/** A committed account mutation stays successful even when its rollback mirror is stale. */
export function saveAccountsMirror(db: Database, dataDir: string, options: AccountsMirrorOptions = {}): void {
  try {
    (options.mirror ?? writeAccountsMirror)(db, dataDir)
    setMeta(db, 'accounts_mirror_stale', '0')
  } catch {
    // SQLite has already committed. Account mirrors follow the same acknowledgement
    // rule as state mirrors; rollback:prepare verifies them before any legacy restart.
    try { setMeta(db, 'accounts_mirror_stale', '1') } catch { /* diagnostic write is best effort */ }
    try { (options.log ?? console.warn)('accounts mirror write failed') } catch { /* logging is best effort */ }
  }
}
