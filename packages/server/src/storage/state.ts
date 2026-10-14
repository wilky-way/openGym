// The state document: one row per profile holding the exact text legacy writes to state-<uid>.json, plus a
// ring of recent versions (STORAGE-CONTRACT §2–3). The text is stored verbatim, never re-serialised, because
// sync compares JSON.stringify output and key order is significant.
import type { Database } from 'bun:sqlite'

export interface StateDocRow {
  profile_id: string; rev: number; wid: string | null; json: string; bytes: number; updated_at: number
}
export interface HistoryRow { profile_id: string; rev: number; wid: string; json: string; written_at: number }
export interface CommitResult { rev: number; wid: string | null; bytes: number }

export function readStateDoc(db: Database, profileId: string): StateDocRow | null {
  return db.query<StateDocRow, [string]>('SELECT * FROM state_docs WHERE profile_id = ?').get(profileId) ?? null
}

// Newest first by insertion (rowid), not by revision: a revision can rewind or repeat, commit order cannot.
export function stateHistory(db: Database, profileId: string): Omit<HistoryRow, 'json'>[] {
  return db.query<Omit<HistoryRow, 'json'>, [string]>(
    'SELECT profile_id, rev, wid, written_at FROM state_doc_history WHERE profile_id = ? ORDER BY rowid DESC')
    .all(profileId)
}

/** Whether `wid` is one of the last versions kept for the profile (the mirror-behind check at boot). */
export function isKnownWid(db: Database, profileId: string, wid: string): boolean {
  return db.query<{ n: number }, [string, string]>('SELECT 1 AS n FROM state_doc_history WHERE profile_id = ? AND wid = ?')
    .get(profileId, wid) !== null
}

/**
 * Commits one version. `rev` and `wid` are read from the document itself so the row can never disagree with
 * its own text. The write, the history entry and the pruning share one IMMEDIATE transaction; the caller's
 * 200 must wait for this to return (synchronous=FULL makes it durable).
 */
export function commitStateDoc(db: Database, profileId: string, text: string, now: number, keep: number): CommitResult {
  const doc: unknown = JSON.parse(text)
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new TypeError('state document must be a JSON object')
  const rev = (doc as { _rev?: unknown })._rev
  if (!Number.isSafeInteger(rev)) throw new TypeError('state document has no integer _rev')
  const wid = typeof (doc as { _wid?: unknown })._wid === 'string' ? (doc as { _wid: string })._wid : null
  const bytes = Buffer.byteLength(text, 'utf8')
  db.transaction(() => {
    db.query(`INSERT INTO state_docs (profile_id, rev, wid, json, bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET rev = excluded.rev, wid = excluded.wid, json = excluded.json,
        bytes = excluded.bytes, updated_at = excluded.updated_at`)
      .run(profileId, rev as number, wid, text, bytes, now)
    if (wid !== null) {
      // Delete then insert, so a re-committed wid gets a fresh rowid and counts as the newest commit.
      db.query('DELETE FROM state_doc_history WHERE profile_id = ? AND wid = ?').run(profileId, wid)
      db.query('INSERT INTO state_doc_history (profile_id, rev, wid, json, written_at) VALUES (?, ?, ?, ?, ?)')
        .run(profileId, rev as number, wid, text, now)
    }
    if (keep > 0) {
      db.query(`DELETE FROM state_doc_history WHERE profile_id = ? AND rowid NOT IN
        (SELECT rowid FROM state_doc_history WHERE profile_id = ? ORDER BY rowid DESC LIMIT ?)`)
        .run(profileId, profileId, keep)
    }
  }).immediate()
  return { rev: rev as number, wid, bytes }
}

/** Profiles that have a state document, for the boot-time mirror pass. */
export function profilesWithState(db: Database): string[] {
  return db.query<{ profile_id: string }, []>('SELECT profile_id FROM state_docs ORDER BY profile_id')
    .all().map(r => r.profile_id)
}
