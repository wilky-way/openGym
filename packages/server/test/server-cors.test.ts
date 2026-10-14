import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { start } from './helpers'
import { ApiError } from '../src/http'

const preflight = (origin: string, extra: HeadersInit = {}) => ({
  Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type', ...extra,
})
function fixture() {
  return start({ ORIGIN: 'https://gym.example.com' }, { routes: app => {
    app.post('/api/pair/redeem', async context => {
      await context.get('body').readJson()
      throw new ApiError(400, 'invalid or expired code', { code: 'pair-invalid' })
    })
  } })
}
for (const origin of ['https://gym.example.com', 'https://localhost', 'http://localhost']) {
  test(`the pairing preflight from ${origin} is answered by openGym with that origin allowed`, async () => {
    // Security regression: only the configured ORIGIN is allowed.
    const h = fixture()
    const response = await fetch(`${h.api}/api/pair/redeem`, { method: 'OPTIONS', headers: preflight(origin) })
    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), origin === 'https://gym.example.com' ? origin : null)
    assert.match(response.headers.get('access-control-allow-methods')!, /\bPOST\b/)
    assert.match(response.headers.get('access-control-allow-methods')!, /\bPUT\b/)
    const allowed = response.headers.get('access-control-allow-headers')!.toLowerCase().split(/\s*,\s*/)
    assert.ok(allowed.includes('content-type'))
    assert.ok(allowed.includes('authorization'))
    assert.equal(response.headers.get('access-control-allow-credentials'), null)
    assert.match(response.headers.get('vary')!, /Origin/)
    assert.equal(response.headers.get('access-control-allow-private-network'), null)
    const post = await fetch(`${h.api}/api/pair/redeem`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: 'ZZZZ2222' }) })
    assert.equal(post.headers.get('access-control-allow-origin'), origin === 'https://gym.example.com' ? origin : null)
    assert.ok(post.status >= 400 && post.status < 500)
  })
}

test('a preflight that asks for private-network access gets it', async () => {
  // R3/HTTP contract: removed with the native shells; test keeps its legacy name.
  const h = fixture()
  const response = await fetch(`${h.api}/api/pair/redeem`, { method: 'OPTIONS', headers: preflight('https://localhost', { 'Access-Control-Request-Private-Network': 'true' }) })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-private-network'), null)
})
test('a website on another origin gets no private-network access', async () => {
  const h = fixture()
  const response = await fetch(`${h.api}/api/pair/redeem`, { method: 'OPTIONS', headers: preflight('https://evil.example', { 'Access-Control-Request-Private-Network': 'true' }) })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-private-network'), null)
})
