// The JSON mirror and the boot check for it (STORAGE-CONTRACT §1, §3).
import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { openStore, bootStore, commitStateDoc, writeStateMirror, writeAccountsMirror, reconcileStateMirror,
  sweepTempFiles, stateMirrorFile, accountsMirrorFile, accountsText, setMeta, StorageRefused, exportAccounts,
  reconcileAccountsMirror } from '../src/storage'
import * as repo from '../src/storage/repos'
import { scratchDir, user, stateText } from './helpers'

const seed = (dir: string) => {
  const store = openStore(dir)
  repo.putUser(store.db, user('p1'))
  return store
}

test('the mirror holds the exact committed bytes, owner-only', () => {
  const dir = scratchDir()
  const store = seed(dir)
  try {
    const text = stateText(3, 'w3', 'héllo')
    commitStateDoc(store.db, 'p1', text, 1, 30)
    const file = writeStateMirror(store.db, dir, 'p1')
    expect(file).toBe(stateMirrorFile(dir, 'p1'))
    expect(fs.readFileSync(file, 'utf8')).toBe(text)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  } finally { store.close() }
})

test('the mirror file name sanitises the profile id as the legacy server did', () => {
  expect(path.basename(stateMirrorFile('/d', 'ab/../c d'))).toBe('state-abcd.json')
})

test('reconcile: no mirror yet means it is created from SQLite', () => {
  const dir = scratchDir()
  const store = seed(dir)
  try {
    commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 30)
    expect(reconcileStateMirror(store.db, dir, 'p1').action).toBe('created')
    expect(reconcileStateMirror(store.db, dir, 'p1').action).toBe('current')
  } finally { store.close() }
})

test('reconcile: a mirror behind SQLite (its version is in the history ring) is rewritten', () => {
  const dir = scratchDir()
  const store = seed(dir)
  try {
    commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 30)
    writeStateMirror(store.db, dir, 'p1')
    commitStateDoc(store.db, 'p1', stateText(2, 'w2'), 2, 30)
    const report = reconcileStateMirror(store.db, dir, 'p1')
    expect(report).toMatchObject({ action: 'rewritten', mirrorWid: 'w1', sqliteWid: 'w2' })
    expect(fs.readFileSync(stateMirrorFile(dir, 'p1'), 'utf8')).toBe(stateText(2, 'w2'))
  } finally { store.close() }
})

test('reconcile: a mirror with a version SQLite never saw is refused, and the JSON is left alone', () => {
  const dir = scratchDir()
  const store = seed(dir)
  try {
    commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 30)
    const legacy = stateText(9, 'legacy-only')
    fs.writeFileSync(stateMirrorFile(dir, 'p1'), legacy)
    const report = reconcileStateMirror(store.db, dir, 'p1')
    expect(report).toMatchObject({ action: 'refused', code: 'LEGACY_WRITES_DETECTED', mirrorWid: 'legacy-only' })
    expect(fs.readFileSync(stateMirrorFile(dir, 'p1'), 'utf8')).toBe(legacy)
  } finally { store.close() }
})

test('reconcile: an unreadable mirror is refused rather than guessed at', () => {
  const dir = scratchDir()
  const store = seed(dir)
  try {
    commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 30)
    fs.writeFileSync(stateMirrorFile(dir, 'p1'), '{"_rev":')
    expect(reconcileStateMirror(store.db, dir, 'p1').code).toBe('MIRROR_UNREADABLE')
  } finally { store.close() }
})

test('boot sweeps crash leftovers of the unique temporary name and nothing else', () => {
  const dir = scratchDir()
  seed(dir).close()
  const leftover = `state-p1.json.4242.0123456789ab.tmp`
  fs.writeFileSync(path.join(dir, leftover), 'partial')
  fs.writeFileSync(path.join(dir, 'notes.tmp'), 'keep me')
  expect(sweepTempFiles(dir)).toEqual([leftover])
  expect(fs.existsSync(path.join(dir, 'notes.tmp'))).toBe(true)
})

test('boot serves only when write_owner is sqlite, and refuses a legacy owner', () => {
  const dir = scratchDir()
  const store = seed(dir)
  setMeta(store.db, 'write_owner', 'legacy')
  store.close()
  try {
    bootStore(dir)
    throw new Error('expected a refusal')
  } catch (err) {
    expect(err).toBeInstanceOf(StorageRefused)
    expect((err as StorageRefused).code).toBe('LEGACY_WRITES_DETECTED')
  }
})

test('boot reconciles every profile and reports what it did', () => {
  const dir = scratchDir()
  const store = seed(dir)
  repo.putUser(store.db, user('p2', 1))
  commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 30)
  commitStateDoc(store.db, 'p2', stateText(1, 'x1'), 1, 30)
  store.close()
  const booted = bootStore(dir)
  try {
    expect(booted.mirrors.map(m => `${m.profileId}:${m.action}`)).toEqual(['p1:created', 'p2:created'])
  } finally { booted.close() }
})

test('accounts mirror: db.json and db.json.bak are written, 0600, and hold the legacy top-level keys', () => {
  const dir = scratchDir()
  const store = seed(dir)
  try {
    repo.putCred(store.db, { id: 'c1', user_id: 'p1', public_key: 'pk', counter: 2, transports: '["usb"]', created: 'c', last_used: null, name: 'Key', ord: 0, x: '{}' })
    repo.putDeviceLink(store.db, { h: 'h1', user_id: 'p1', exp: 9, created: 1 })
    const file = writeAccountsMirror(store.db, dir)
    expect(file).toBe(accountsMirrorFile(dir))
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown[]>
    expect(Object.keys(parsed)).toEqual(['users', 'creds', 'subs', 'invites', 'deviceLinks'])
    expect(parsed.creds).toEqual([{ id: 'c1', userId: 'p1', publicKey: 'pk', counter: 2, transports: ['usb'], created: 'c', name: 'Key' }])
    expect(fs.readFileSync(file + '.bak', 'utf8')).toBe(fs.readFileSync(file, 'utf8'))
    expect(fs.statSync(file + '.bak').mode & 0o777).toBe(0o600)
    expect(exportAccounts(store.db).users).toHaveLength(1)
  } finally { store.close() }
})

test('reconcile: differing bytes with no write id on either side are refused, never overwritten', () => {
  const dir = scratchDir()
  const store = seed(dir)
  try {
    commitStateDoc(store.db, 'p1', '{"_rev":3,"body":"sqlite"}', 1, 30)
    const newerJson = '{"_rev":9,"body":"unversioned JSON"}'
    fs.writeFileSync(stateMirrorFile(dir, 'p1'), newerJson)
    expect(reconcileStateMirror(store.db, dir, 'p1')).toMatchObject({ action: 'refused', code: 'UNVERSIONED_MIRROR' })
    expect(fs.readFileSync(stateMirrorFile(dir, 'p1'), 'utf8')).toBe(newerJson)
  } finally { store.close() }
})

test('accounts: our own db.json that is behind SQLite is rewritten at boot', () => {
  const dir = scratchDir()
  const store = seed(dir)
  try {
    writeAccountsMirror(store.db, dir)
    repo.putUser(store.db, user('p2', 1))
    expect(reconcileAccountsMirror(store.db, dir).action).toBe('rewritten')
    const parsed = JSON.parse(fs.readFileSync(accountsMirrorFile(dir), 'utf8')) as { users: { id: string }[] }
    expect(parsed.users.map(u => u.id)).toEqual(['p1', 'p2'])
    expect(reconcileAccountsMirror(store.db, dir).action).toBe('current')
  } finally { store.close() }
})

test('accounts: a db.json that no fingerprint accounts for is refused, and boot refuses with it', () => {
  const dir = scratchDir()
  const store = seed(dir)
  writeAccountsMirror(store.db, dir)
  store.close()
  fs.writeFileSync(accountsMirrorFile(dir), '{"users":[{"id":"legacy"}]}')
  try {
    expect(() => bootStore(dir)).toThrow(StorageRefused)
    const reopened = openStore(dir)
    try {
      expect(reconcileAccountsMirror(reopened.db, dir)).toEqual({ action: 'refused', code: 'LEGACY_ACCOUNT_WRITES' })
    } finally { reopened.close() }
  } finally {
    expect(fs.readFileSync(accountsMirrorFile(dir), 'utf8')).toBe('{"users":[{"id":"legacy"}]}')
  }
})

test('accounts: a backup copy left behind by a crash between the two writes is repaired', () => {
  const dir = scratchDir()
  const store = seed(dir)
  try {
    writeAccountsMirror(store.db, dir)
    const stale = fs.readFileSync(accountsMirrorFile(dir), 'utf8')
    repo.putUser(store.db, user('p2', 1))
    writeAccountsMirror(store.db, dir)
    fs.writeFileSync(accountsMirrorFile(dir) + '.bak', stale)
    expect(reconcileAccountsMirror(store.db, dir).action).toBe('rewritten')
    expect(fs.readFileSync(accountsMirrorFile(dir) + '.bak', 'utf8')).toBe(fs.readFileSync(accountsMirrorFile(dir), 'utf8'))
  } finally { store.close() }
})

// A mirror write that fails after its bytes are durable and before the rename: ENOSPC, EACCES on a bind mount, or an
// I/O error that does not kill the process. The next commit must still leave the next boot able to reconcile.
const failRename = { beforeRename: () => { throw new Error('ENOSPC (test)') } }

test('accounts: two failed db.json writes in a row do not make the next boot refuse', () => {
  const dir = scratchDir()
  const store = seed(dir)
  writeAccountsMirror(store.db, dir)
  repo.putUser(store.db, user('p2', 1))
  expect(() => writeAccountsMirror(store.db, dir, failRename)).toThrow('ENOSPC')
  repo.putUser(store.db, user('p3', 2))
  expect(() => writeAccountsMirror(store.db, dir, failRename)).toThrow('ENOSPC')
  store.close()
  const booted = bootStore(dir)
  try {
    expect(booted.accounts.action).toBe('rewritten')
    const parsed = JSON.parse(fs.readFileSync(accountsMirrorFile(dir), 'utf8')) as { users: { id: string }[] }
    expect(parsed.users.map(u => u.id)).toEqual(['p1', 'p2', 'p3'])
  } finally { booted.close() }
})

test('state: two failed mirror writes in a row do not make the next boot refuse', () => {
  // keep=2: the on-disk version ages out of the ring after two later commits, so two failures reach the old refusal.
  const dir = scratchDir()
  const store = seed(dir)
  commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 2)
  writeStateMirror(store.db, dir, 'p1')
  commitStateDoc(store.db, 'p1', stateText(2, 'w2'), 2, 2)
  expect(() => writeStateMirror(store.db, dir, 'p1', failRename)).toThrow('ENOSPC')
  commitStateDoc(store.db, 'p1', stateText(3, 'w3'), 3, 2)
  expect(() => writeStateMirror(store.db, dir, 'p1', failRename)).toThrow('ENOSPC')
  store.close()
  const booted = bootStore(dir)
  try {
    expect(booted.mirrors).toEqual([{ profileId: 'p1', action: 'rewritten', mirrorWid: 'w1', sqliteWid: 'w3' }])
    expect(fs.readFileSync(stateMirrorFile(dir, 'p1'), 'utf8')).toBe(stateText(3, 'w3'))
  } finally { booted.close() }
})

test('state: more failed mirror writes than the history keeps still reconcile at boot', () => {
  // keep=3 with six failed writes: the mirror's own version has long left the ring, but it is what is on disk.
  const dir = scratchDir()
  const store = seed(dir)
  commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 3)
  writeStateMirror(store.db, dir, 'p1')
  for (let rev = 2; rev <= 7; rev++) {
    commitStateDoc(store.db, 'p1', stateText(rev, `w${rev}`), rev, 3)
    expect(() => writeStateMirror(store.db, dir, 'p1', failRename)).toThrow('ENOSPC')
  }
  store.close()
  const booted = bootStore(dir)
  try {
    expect(booted.mirrors).toEqual([{ profileId: 'p1', action: 'rewritten', mirrorWid: 'w1', sqliteWid: 'w7' }])
    expect(fs.readFileSync(stateMirrorFile(dir, 'p1'), 'utf8')).toBe(stateText(7, 'w7'))
  } finally { booted.close() }
})

test('state: a mirror version SQLite never committed is still refused after failed writes', () => {
  const dir = scratchDir()
  const store = seed(dir)
  commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 2)
  writeStateMirror(store.db, dir, 'p1')
  fs.writeFileSync(stateMirrorFile(dir, 'p1'), stateText(9, 'legacy-only'))
  commitStateDoc(store.db, 'p1', stateText(2, 'w2'), 2, 2)
  expect(() => writeStateMirror(store.db, dir, 'p1', failRename)).toThrow('ENOSPC')
  try {
    expect(reconcileStateMirror(store.db, dir, 'p1')).toMatchObject({ action: 'refused', code: 'LEGACY_WRITES_DETECTED' })
  } finally { store.close() }
})

test('accounts: a crash between db.json\'s rename and its record does not strand the file after two failures', () => {
  const dir = scratchDir()
  const store = seed(dir)
  writeAccountsMirror(store.db, dir)
  repo.putUser(store.db, user('p2', 1))
  expect(() => writeAccountsMirror(store.db, dir, failRename)).toThrow('ENOSPC')
  // The rename happened, then the process died before the on-disk fingerprint was recorded.
  fs.writeFileSync(accountsMirrorFile(dir), accountsText(store.db))
  store.close()
  bootStore(dir).close()
  const again = openStore(dir)
  repo.putUser(again.db, user('p3', 2))
  expect(() => writeAccountsMirror(again.db, dir, failRename)).toThrow('ENOSPC')
  repo.putUser(again.db, user('p4', 3))
  expect(() => writeAccountsMirror(again.db, dir, failRename)).toThrow('ENOSPC')
  again.close()
  const booted = bootStore(dir)
  try {
    expect(booted.accounts.action).toBe('rewritten')
  } finally { booted.close() }
})

test('state: a crash between a mirror rename and its record does not strand the file after failures past keep', () => {
  const dir = scratchDir()
  const store = seed(dir)
  commitStateDoc(store.db, 'p1', stateText(1, 'w1'), 1, 2)
  writeStateMirror(store.db, dir, 'p1')
  commitStateDoc(store.db, 'p1', stateText(2, 'w2'), 2, 2)
  expect(() => writeStateMirror(store.db, dir, 'p1', failRename)).toThrow('ENOSPC')
  // The rename happened, then the process died before the on-disk wid was recorded.
  fs.writeFileSync(stateMirrorFile(dir, 'p1'), stateText(2, 'w2'))
  store.close()
  bootStore(dir).close()
  const again = openStore(dir)
  commitStateDoc(again.db, 'p1', stateText(3, 'w3'), 3, 2)
  expect(() => writeStateMirror(again.db, dir, 'p1', failRename)).toThrow('ENOSPC')
  commitStateDoc(again.db, 'p1', stateText(4, 'w4'), 4, 2)
  expect(() => writeStateMirror(again.db, dir, 'p1', failRename)).toThrow('ENOSPC')
  again.close()
  const booted = bootStore(dir)
  try {
    expect(booted.mirrors).toEqual([{ profileId: 'p1', action: 'rewritten', mirrorWid: 'w2', sqliteWid: 'w4' }])
  } finally { booted.close() }
})
