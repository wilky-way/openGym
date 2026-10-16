// Port of legacy/api/test/durable.test.js. Same describe/it intent, same assertion budget (≥5 expect calls).
// The fixed `<file>.tmp` name became the unique temporary name of STORAGE-CONTRACT §1; the order check follows it.
import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite, syncDir } from '../src/storage/durable'
import { scratchDir } from './helpers'

test('atomicWrite: bytes flushed, then the rename, then the directory', () => {
  const dir = scratchDir()
  const file = path.join(dir, 'state-u1.json')
  const calls: [string, string][] = []
  const fdPath = new Map<number, string>()
  const open = fs.openSync, fsync = fs.fsyncSync, rename = fs.renameSync
  try {
    fs.openSync = ((p: fs.PathLike, ...rest: unknown[]) => {
      const fd = (open as (...a: unknown[]) => number)(p, ...rest)
      fdPath.set(fd, String(p))
      return fd
    }) as typeof fs.openSync
    fs.fsyncSync = ((fd: number) => { calls.push(['fsync', fdPath.get(fd) ?? '']); return fsync(fd) }) as typeof fs.fsyncSync
    fs.renameSync = ((a: fs.PathLike, b: fs.PathLike) => { calls.push(['rename', String(b)]); return rename(a, b) }) as typeof fs.renameSync
    atomicWrite(file, '{"_rev":1}', 0o600)
  } finally {
    fs.openSync = open; fs.fsyncSync = fsync; fs.renameSync = rename
  }
  expect(calls.length).toBe(3)
  expect(calls[0]?.[0]).toBe('fsync')
  expect(calls[0]?.[1]).toMatch(/state-u1\.json\.\d+\.[0-9a-f]{12}\.tmp$/)
  expect(calls[1]).toEqual(['rename', file])
  expect(calls[2]).toEqual(['fsync', dir])
  expect(fs.readFileSync(file, 'utf8')).toBe('{"_rev":1}')
  expect(fs.statSync(file).mode & 0o777).toBe(0o600)
})

test('atomicWrite: leaves no temporary file behind, and a failed write keeps the old file', () => {
  const dir = scratchDir()
  const file = path.join(dir, 'db.json')
  atomicWrite(file, 'old')
  expect(() => atomicWrite(file, 'new', 0o600, { beforeRename: () => { throw new Error('boom') } })).toThrow('boom')
  expect(fs.readFileSync(file, 'utf8')).toBe('old')
  expect(fs.readdirSync(dir)).toEqual(['db.json'])
})

test('syncDir: a directory that cannot be fsynced is tolerated', () => {
  expect(() => syncDir(path.join(scratchDir(), 'missing'))).not.toThrow()
  expect(() => syncDir(scratchDir())).not.toThrow()
})

test('the temporary name is unique per write', () => {
  const dir = scratchDir()
  const seen = new Set<string>()
  for (let i = 0; i < 5; i++) {
    atomicWrite(path.join(dir, 'state-u2.json'), String(i), 0o600, { beforeRename: tmp => { seen.add(tmp) } })
  }
  expect(seen.size).toBe(5)
  expect(fs.readFileSync(path.join(dir, 'state-u2.json'), 'utf8')).toBe('4')
})

test('written files keep the owner-only mode after a rewrite', () => {
  const dir = scratchDir()
  const file = path.join(dir, 'secret')
  atomicWrite(file, 'a', 0o600)
  atomicWrite(file, 'b', 0o600)
  expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  expect(fs.readFileSync(file, 'utf8')).toBe('b')
})

// Rewritten from legacy's "server.js and media.js write through it" (PORTING-RULES R4: a source-text assertion
// rewritten against the new path). The storage writers are in this package; server.js and media.js arrive with
// S03/S04 and carry their own copy of this assertion there.
test('storage writers write through atomicWrite, never a bare writeFileSync', () => {
  const src = path.join(import.meta.dir, '..', 'src', 'storage')
  for (const name of ['mirror.ts', 'state.ts', 'backup.ts']) {
    const text = fs.readFileSync(path.join(src, name), 'utf8')
    expect(text).not.toMatch(/writeFileSync/)
  }
  expect(fs.readFileSync(path.join(src, 'mirror.ts'), 'utf8')).toMatch(/atomicWrite\(file, row\.json|atomicWrite\(file, text/)
  expect(fs.readFileSync(path.join(src, 'backup.ts'), 'utf8')).toMatch(/atomicWrite\(manifestFile/)
})
