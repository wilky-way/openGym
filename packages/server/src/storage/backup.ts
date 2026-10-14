// Backups by `VACUUM INTO`, and a verifier that reopens them read-only (STORAGE-CONTRACT §5).
// A backup is a single file with a sidecar manifest holding the sha256 of every state document and of the
// accounts export, so verification proves each document, not just that the file opens.
//
// The manifest is read back from the finished copy, never from the live database: a commit between the two
// reads would otherwise leave a backup that its own manifest rejects. The copy is written under a temporary name,
// checked, and only then renamed into place, so an interrupted run never leaves a partial file under the real name.
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { accountsText, sha256 } from './mirror'
import { atomicWrite, syncDir, syncFile, tempName } from './durable'

export interface BackupManifest {
  version: 1
  createdAt: string
  file: string
  fileSha256: string
  accountsSha256: string
  docs: { profile_id: string; rev: number; wid: string | null; sha256: string }[]
}

export const manifestFile = (backup: string): string => `${backup}.manifest.json`

/** Reads the manifest facts from a finished backup file: documents, accounts, and the file's own hash. */
function manifestFacts(file: string): Omit<BackupManifest, 'version' | 'createdAt' | 'file'> {
  const copy = new Database(file, { readonly: true })
  try {
    const docs = copy.query<{ profile_id: string; rev: number; wid: string | null; json: string }, []>(
      'SELECT profile_id, rev, wid, json FROM state_docs ORDER BY profile_id').all()
    return {
      fileSha256: sha256(fs.readFileSync(file)),
      accountsSha256: sha256(accountsText(copy)),
      docs: docs.map(d => ({ profile_id: d.profile_id, rev: d.rev, wid: d.wid, sha256: sha256(d.json) })),
    }
  } finally { copy.close() }
}

/** Writes `dest` as a consistent snapshot of `db` and its manifest beside it. Refuses to overwrite. */
export function createBackup(db: Database, dest: string, now = new Date()): BackupManifest {
  if (fs.existsSync(dest)) throw new Error(`refusing to overwrite ${dest}`)
  const dir = path.dirname(dest)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = tempName(dest)
  let facts: Omit<BackupManifest, 'version' | 'createdAt' | 'file'>
  try {
    db.run('VACUUM INTO ?', [tmp])
    // A WAL-mode copy would need its -wal/-shm beside it to open; the backup is one file, so WAL is off on the copy.
    const copy = new Database(tmp)
    try {
      copy.run('PRAGMA journal_mode=DELETE')
      const check = copy.query<{ integrity_check: string }, []>('PRAGMA integrity_check').all()
      if (check.length !== 1 || check[0]?.integrity_check !== 'ok') throw new Error('integrity_check failed on the new backup')
    } finally { copy.close() }
    fs.chmodSync(tmp, 0o600)
    // The copy's bytes must be on disk before the rename makes them the backup; syncDir alone covers only the name.
    syncFile(tmp)
    facts = manifestFacts(tmp)
    fs.renameSync(tmp, dest)
    syncDir(dir)
  } catch (err) {
    fs.rmSync(tmp, { force: true })
    throw err
  }
  const manifest: BackupManifest = { version: 1, createdAt: now.toISOString(), file: path.basename(dest), ...facts }
  atomicWrite(manifestFile(dest), JSON.stringify(manifest, null, 2) + '\n', 0o600)
  return manifest
}

export interface VerifyResult { ok: boolean; problems: string[]; docs: number }

/** Opens the backup read-only, runs integrity_check, and checks every document and the accounts against the manifest. */
export function verifyBackup(file: string): VerifyResult {
  const problems: string[] = []
  let manifest: BackupManifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile(file), 'utf8')) as BackupManifest
  } catch (err) {
    return { ok: false, problems: [`manifest unreadable: ${(err as Error).message}`], docs: 0 }
  }
  if (sha256(fs.readFileSync(file)) !== manifest.fileSha256) problems.push('file sha256 differs from manifest')
  let db: Database
  try { db = new Database(file, { readonly: true }) }
  catch (err) { return { ok: false, problems: [`cannot open backup: ${(err as Error).message}`], docs: 0 } }
  try {
    const check = db.query<{ integrity_check: string }, []>('PRAGMA integrity_check').all()
    if (check.length !== 1 || check[0]?.integrity_check !== 'ok') problems.push('integrity_check failed')
    const rows = db.query<{ profile_id: string; json: string }, []>('SELECT profile_id, json FROM state_docs ORDER BY profile_id').all()
    const byId = new Map(rows.map(r => [r.profile_id, r.json]))
    for (const d of manifest.docs) {
      const json = byId.get(d.profile_id)
      if (json === undefined) problems.push(`document missing: ${d.profile_id}`)
      else if (sha256(json) !== d.sha256) problems.push(`document differs: ${d.profile_id}`)
    }
    if (rows.length !== manifest.docs.length) problems.push(`document count ${rows.length} != manifest ${manifest.docs.length}`)
    if (sha256(accountsText(db)) !== manifest.accountsSha256) problems.push('accounts differ from manifest')
  } catch (err) {
    problems.push(`verify failed: ${(err as Error).message}`)
  } finally { db.close() }
  return { ok: problems.length === 0, problems, docs: manifest.docs.length }
}
