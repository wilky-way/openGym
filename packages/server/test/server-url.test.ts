import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { start, raw } from './helpers'

test('an unparseable request target is a 400, and the server keeps answering afterwards', async () => {
  const h = start()
  for (const target of ['//', '//api%2Fhealth', '//api%2F/health']) {
    const response = await raw(h.server.port!, target)
    assert.match(response, /^HTTP\/1\.1 400 /, `${target}: ${response}`)
  }
  assert.match(await raw(h.server.port!, '/api/health'), /^HTTP\/1\.1 200 /)
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200)
  assert.equal(h.server.pendingRequests, 0)
})

test('network-path targets dispatch on the parsed legacy URL pathname', async () => {
  const h = start({}, { writable: () => true })
  for (const target of ['//other/api/health', '//other/api/health?probe=1', '//other/api/%2e/health']) {
    assert.match(await raw(h.server.port!, target), /^HTTP\/1\.1 200 /, target)
  }
  assert.match(await raw(h.server.port!, '//other/api/%68ealth'), /^HTTP\/1\.1 404 /)
  assert.match(await raw(h.server.port!, '//other/api/health/'), /^HTTP\/1\.1 404 /)
  // GM-approved runtime waiver: Bun loses the authority/parent bytes before fetch.
  assert.match(await raw(h.server.port!, '//other/../api/health'), /^HTTP\/1\.1 404 /)
  assert.match(await raw(h.server.port!, '//other//'), /^HTTP\/1\.1 404 /)
  assert.match(await raw(h.server.port!, '//other//?query=1'), /^HTTP\/1\.1 404 /)
})
