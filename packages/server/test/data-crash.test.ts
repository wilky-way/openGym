import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { bootStore, openStore, putUser, readStateDoc, writeAccountsMirror } from '../src/storage'
import { DataService } from '../src/data'
import { scratchDir, user } from './helpers'
for (const mode of ['transaction', 'mirror']) {
  test(`kill -9 mid-PUT at ${mode}: only committed versions survive and boot repairs the mirror`, async () => {
    const dir = scratchDir(), store = openStore(dir)
    putUser(store.db, user('u1'))
    writeAccountsMirror(store.db, dir)
    new DataService(store.db, dir).compareAndWrite('u1', { stamped: true, state: { workouts: [{ id: 'old' }], routines: [] } })
    const before = readStateDoc(store.db, 'u1')!.json
    store.close()
    const child = Bun.spawn([process.execPath, new URL('./fixtures/crash-data.ts', import.meta.url).pathname, dir, mode], { stdout: 'pipe', stderr: 'pipe' })
    try {
      const ready = path.join(dir, 'put-ready')
      const deadline = performance.now() + 5000
      while (!fs.existsSync(ready) && performance.now() < deadline && child.exitCode === null) await Bun.sleep(10)
      expect(fs.existsSync(ready)).toBe(true)
      child.kill(9)
      await child.exited
      expect(child.signalCode).toBe('SIGKILL')
      const booted = bootStore(dir)
      try {
        const row = readStateDoc(booted.db, 'u1')!
        if (mode === 'transaction') expect(row.json).toBe(before)
        else { expect(row.rev).toBe(2); expect(JSON.parse(row.json).workouts).toEqual([{ id: 'new' }]) }
        expect(fs.readFileSync(path.join(dir, 'state-u1.json'), 'utf8')).toBe(row.json)
        expect(booted.db.query('SELECT * FROM state_doc_history').all()).toHaveLength(mode === 'transaction' ? 1 : 2)
        expect(booted.db.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      } finally { booted.close() }
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill(9); await child.exited }
  }, 10000)
}
