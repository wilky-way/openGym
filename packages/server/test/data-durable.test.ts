import { test, expect } from 'bun:test'
import fs from 'node:fs'

// S02 deferred this legacy source assertion to the route owner. Media uploads
// are removed by the contract; state/accounts still use the durable mirror seam.
test('server.js and media.js write through it', () => {
  const data = fs.readFileSync(new URL('../src/data.ts', import.meta.url), 'utf8')
  const mirror = fs.readFileSync(new URL('../src/storage/mirror.ts', import.meta.url), 'utf8')
  expect(data).not.toMatch(/writeFileSync/)
  expect(data).toContain('writeStateMirror(this.db, this.dataDir, profileId)')
  expect(data).toContain('writeAccountsMirror(this.db, this.dataDir)')
  expect(mirror).toContain("from './durable'")
  expect(mirror).toContain('atomicWrite(file, row.json, 0o600, hooks)')
})
