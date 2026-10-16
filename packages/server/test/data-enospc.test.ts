// Run by scripts/s04-enospc.ts in an isolated, size-limited RAM filesystem.
import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { openStore, putUser, readStateDoc } from '../src/storage'
import { DataService } from '../src/data'
import { user } from './helpers'

const ramdisk = process.env.S04_RAMDISK_DIR
test.skipIf(!ramdisk)('scratch RAM filesystem ENOSPC during PUT rolls back and preserves acknowledged bytes', () => {
  const dir = fs.mkdtempSync(path.join(ramdisk!, 'data-'))
  const store = openStore(dir)
  const data = new DataService(store.db, dir, { now: () => 1791800000000 })
  try {
    putUser(store.db, user('u1'))
    data.compareAndWrite('u1', { stamped: true, state: { workouts: [], routines: [] } })
    const before = readStateDoc(store.db, 'u1')!.json
    const mirror = fs.readFileSync(path.join(dir, 'state-u1.json'), 'utf8')
    const filler = path.join(dir, 'fill'), fd = fs.openSync(filler, 'w')
    let filled = false
    try {
      const block = Buffer.alloc(65536, 0x61)
      for (;;) fs.writeSync(fd, block)
    } catch (error) {
      expect((error as NodeJS.ErrnoException).code).toBe('ENOSPC')
      filled = true
      // Leave enough for SQLite to open a journal, but too little for the PUT.
      fs.ftruncateSync(fd, Math.max(0, fs.fstatSync(fd).size - 65536))
    } finally { fs.closeSync(fd) }
    expect(filled).toBe(true)
    let failure: any
    try { data.compareAndWrite('u1', { stamped: true, baseRev: 1, state: { workouts: [], routines: [], pad: 'x'.repeat(1048576) } }) }
    catch (error) { failure = error }
    expect(failure).toBeDefined()
    expect(failure.code).toBe('SQLITE_FULL')
    expect(readStateDoc(store.db, 'u1')!.json).toBe(before)
    expect(fs.readFileSync(path.join(dir, 'state-u1.json'), 'utf8')).toBe(mirror)
    expect(store.db.query('SELECT * FROM state_doc_history').all()).toHaveLength(1)
    fs.rmSync(filler)
    expect(store.db.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
  } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
