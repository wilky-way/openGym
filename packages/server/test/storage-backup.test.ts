// Extra gate (S02): `VACUUM INTO` backups verify, and a tampered backup does not.
import { test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { openStore, commitStateDoc, createBackup, verifyBackup, manifestFile } from '../src/storage'
import * as repo from '../src/storage/repos'
import { scratchDir, user, stateText } from './helpers'

function seeded(dir: string) {
  const store = openStore(dir)
  repo.putUser(store.db, user('p1'))
  repo.putUser(store.db, user('p2', 1))
  commitStateDoc(store.db, 'p1', stateText(1, 'a1', 'one'), 1, 30)
  commitStateDoc(store.db, 'p1', stateText(2, 'a2', 'two'), 2, 30)
  commitStateDoc(store.db, 'p2', stateText(7, 'b7', 'seven'), 3, 30)
  repo.putCred(store.db, { id: 'c1', user_id: 'p1', public_key: 'pk', counter: 1, transports: '[]', created: null, last_used: null, name: null, ord: 0, x: '{}' })
  return store
}

test('a backup written while the store is live verifies, with a manifest per document', () => {
  const dir = scratchDir()
  const store = seeded(dir)
  const dest = path.join(scratchDir(), 'opengym-2026-10-13.db')
  try {
    const manifest = createBackup(store.db, dest, new Date('2026-10-13T03:30:00Z'))
    expect(manifest.docs.map(d => [d.profile_id, d.rev, d.wid])).toEqual([['p1', 2, 'a2'], ['p2', 7, 'b7']])
    expect(manifest.createdAt).toBe('2026-10-13T03:30:00.000Z')
  } finally { store.close() }
  expect(fs.statSync(dest).mode & 0o777).toBe(0o600)
  expect(fs.existsSync(dest + '-wal')).toBe(false)
  expect(fs.existsSync(manifestFile(dest))).toBe(true)
  const result = verifyBackup(dest)
  expect(result).toEqual({ ok: true, problems: [], docs: 2 })
})

test('the backup holds the committed history of the documents it was taken from', () => {
  const dir = scratchDir()
  const store = seeded(dir)
  const dest = path.join(scratchDir(), 'copy.db')
  try { createBackup(store.db, dest) } finally { store.close() }
  const copy = new Database(dest, { readonly: true })
  try {
    expect(copy.query<{ json: string }, [string]>('SELECT json FROM state_docs WHERE profile_id = ?').get('p1')?.json).toBe(stateText(2, 'a2', 'two'))
    expect(copy.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM creds').get()?.n).toBe(1)
  } finally { copy.close() }
})

test('a backup whose document was changed after the manifest was written fails verification', () => {
  const dir = scratchDir()
  const store = seeded(dir)
  const dest = path.join(scratchDir(), 'tampered.db')
  try { createBackup(store.db, dest) } finally { store.close() }
  const raw = new Database(dest)
  try { raw.run('UPDATE state_docs SET json = ? WHERE profile_id = ?', [stateText(2, 'a2', 'EDITED'), 'p1']) } finally { raw.close() }
  // Rewrite the file hash too, so only the document check can catch it.
  const manifest = JSON.parse(fs.readFileSync(manifestFile(dest), 'utf8')) as { fileSha256: string }
  manifest.fileSha256 = new Bun.CryptoHasher('sha256').update(fs.readFileSync(dest)).digest('hex')
  fs.writeFileSync(manifestFile(dest), JSON.stringify(manifest))
  const result = verifyBackup(dest)
  expect(result.ok).toBe(false)
  expect(result.problems).toEqual(['document differs: p1'])
})

test('a backup with no manifest, or one that is not a database, does not verify', () => {
  const dir = scratchDir()
  const store = seeded(dir)
  const dest = path.join(scratchDir(), 'nomanifest.db')
  try { createBackup(store.db, dest) } finally { store.close() }
  fs.rmSync(manifestFile(dest))
  expect(verifyBackup(dest).ok).toBe(false)
  const junk = path.join(scratchDir(), 'junk.db')
  fs.writeFileSync(junk, 'not a database')
  fs.writeFileSync(manifestFile(junk), JSON.stringify({ version: 1, fileSha256: 'x', accountsSha256: 'y', docs: [] }))
  const result = verifyBackup(junk)
  expect(result.ok).toBe(false)
  expect(result.problems.length).toBeGreaterThan(0)
})

test('a backup never overwrites an existing file', () => {
  const dir = scratchDir()
  const store = seeded(dir)
  const dest = path.join(scratchDir(), 'once.db')
  try {
    createBackup(store.db, dest)
    expect(() => createBackup(store.db, dest)).toThrow('refusing to overwrite')
  } finally { store.close() }
})
