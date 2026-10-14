import { test, expect, spyOn } from 'bun:test'
import { CSRF_EXEMPT } from '@opengym/contract/http/api'
import { start, raw } from './helpers'
import { csrfOk, json, RequestBody } from '../src/http'

const origin = 'https://gym.example'
test('CSRF matrix preserves exemption, Bearer, metadata and Origin precedence', () => {
  const cases: [HeadersInit, boolean][] = [
    [{}, true], [{ Origin: origin }, true], [{ Origin: `${origin}///` }, true],
    [{ Origin: 'https://evil.example' }, false], [{ Origin: 'https://localhost' }, false],
    [{ 'Sec-Fetch-Site': 'same-origin', Origin: 'https://evil.example' }, true],
    [{ 'Sec-Fetch-Site': 'none', Origin: 'https://evil.example' }, true],
    [{ 'Sec-Fetch-Site': 'same-site', Origin: origin }, false],
    [{ 'Sec-Fetch-Site': 'cross-site', Origin: origin }, false],
    [{ 'Sec-Fetch-Site': 'bogus' }, false],
    [{ Authorization: 'Bearer synthetic', 'Sec-Fetch-Site': 'cross-site' }, true],
    [{ Authorization: 'Bearer ', Origin: 'https://evil.example' }, false], // Headers trims trailing whitespace
    [{ Authorization: 'bearer synthetic', Origin: 'https://evil.example' }, false],
    [{ Cookie: 'gymsid=synthetic', Origin: 'https://evil.example' }, false],
  ]
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) for (const [headers, expected] of cases) {
    expect(csrfOk(new Request(`${origin}/api/data`, { method, headers }), `${method} /api/data`, origin)).toBe(expected)
  }
  for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(csrfOk(new Request(origin, { method, headers: { Origin: 'https://evil.example' } }), `${method} /api/data`, origin)).toBe(true)
  for (const key of CSRF_EXEMPT) {
    const [method, path] = key.split(' ')
    expect(csrfOk(new Request(`${origin}${path}`, { method, headers: { 'Sec-Fetch-Site': 'cross-site' } }), key, origin)).toBe(true)
  }
})

test('body receipt starts only after CSRF and deleted-route checks', async () => {
  const receiving = spyOn(RequestBody.prototype, 'startReceiving')
  try {
    const h = start({ ORIGIN: origin }, { routes: app => {
      app.put('/api/data', () => json(200, { ok: true }))
    } })
    for (const [path, method, status] of [
      ['/api/data', 'PUT', 403], ['/api/unlisted', 'POST', 403],
      ['/api/login/password', 'POST', 404], ['/api/media/missing', 'POST', 404],
      ['/api/health', 'HEAD', 404], ['/api/data', 'OPTIONS', 204],
    ] as const) {
      const response = await raw(h.server.port!, path, method, { Origin: 'https://evil.example', 'Content-Length': '999999' })
      expect(response).toMatch(new RegExp(`^HTTP/1\\.1 ${status} `))
      expect(receiving).not.toHaveBeenCalled()
    }
    expect((await fetch(`${h.api}/api/data`, { method: 'PUT', headers: { Origin: origin }, body: '{}' })).status).toBe(200)
    expect(receiving).toHaveBeenCalledTimes(1)
  } finally { receiving.mockRestore() }
})
test('CSRF runs before handlers; deleted 404 runs before CSRF; errors retain CORS', async () => {
  let calls = 0
  const h = start({ ORIGIN: origin }, { routes: app => {
    app.put('/api/data', () => { calls++; return json(200, { ok: true }) })
  } })
  const refused = await fetch(`${h.api}/api/data`, { method: 'PUT', headers: { Origin: 'https://evil.example' }, body: '{}' })
  expect(refused.status).toBe(403)
  expect(await refused.text()).toBe('{"error":"cross-origin request refused"}')
  expect(refused.headers.get('access-control-allow-origin')).toBeNull()
  expect(calls).toBe(0)
  const unknown = await fetch(`${h.api}/api/missing`, { method: 'POST', headers: { Origin: 'https://evil.example' }, body: '{}' })
  expect(unknown.status).toBe(403)
  const accepted = await fetch(`${h.api}/api/data`, { method: 'PUT', headers: { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://evil.example' }, body: '{}' })
  expect(accepted.status).toBe(200)
  expect(calls).toBe(1)
})
