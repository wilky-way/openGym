import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { chmodSync, readdirSync } from 'node:fs'
import { start } from './helpers'

test('a writable data directory answers 200, and says so', async () => {
  const h = start({}, { userCount: () => 1 })
  const response = await fetch(`${h.api}/api/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, users: 1, writable: true })
  assert.equal(response.headers.get('content-type'), 'application/json')
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('a data directory the server cannot write to is 503, not healthy', async () => {
  let clock = 10000
  const h = start({}, { now: () => clock })
  chmodSync(h.dataDir, 0o500)
  const response = await fetch(`${h.api}/api/health`)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { ok: false, writable: false })
  assert.match(h.log.join('\n'), /health: cannot write to/)
  chmodSync(h.dataDir, 0o700)
  assert.equal((await fetch(`${h.api}/api/health`)).status, 503)
  clock += 5001
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200)
  assert.deepEqual(readdirSync(h.dataDir).filter(file => file.startsWith('.health-')), [])
})
