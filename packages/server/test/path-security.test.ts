import { test, expect } from 'bun:test'
import { DELETED_ROUTES } from '@opengym/contract/http/api'
import { start, raw } from './helpers'
import { json } from '../src/http'

const origin = 'https://gym.example'
const evil = 'https://evil.example'
const notFound = '{"error":"not found"}'
const refused = '{"error":"cross-origin request refused"}'

async function check(port: number, path: string, method: string, headers: Record<string, string>, status: number, body: string) {
  const response = await raw(port, path, method, headers)
  expect(response, `${method} ${path}`).toMatch(new RegExp(`^HTTP/1\\.1 ${status} `))
  expect(response.split('\r\n\r\n')[1], `${method} ${path}`).toBe(body)
  expect(response.toLowerCase()).toContain('content-type: application/json')
  expect(response.toLowerCase()).toContain('cache-control: no-store')
}

/** Escape every character of every segment, plus both cases of encoded separators.
 * Double escapes ensure neither routing nor policy introduces a second decode. */
function escaped(path: string): string[] {
  const variants = new Set<string>()
  // The origin-form leading slash is required by Bun's HTTP parser (covered below).
  for (let index = 1; index < path.length; index++) {
    const char = path[index]!
    const hex = char.charCodeAt(0).toString(16).padStart(2, '0')
    for (const digits of [hex.toLowerCase(), hex.toUpperCase()]) {
      variants.add(`${path.slice(0, index)}%${digits}${path.slice(index + 1)}`)
      variants.add(`${path.slice(0, index)}%25${digits}${path.slice(index + 1)}`)
    }
  }
  return [...variants]
}

test('wire encoded paths never enter canonical data/logout/bootstrap handlers', async () => {
  let calls = 0
  const routes = [
    ['PUT', '/api/data'], ['POST', '/api/logout'],
    ['POST', '/api/register/options'], ['GET', '/api/health'],
    ['PUT', '/api/programmes/library/synthetic'],
  ] as const
  const h = start({ ORIGIN: origin }, { writable: () => true, routes: app => {
    for (const [method, path] of routes.slice(0, 3)) app.on(method, path, () => { calls++; return json(200, { ok: true }) })
    app.put('/api/programmes/library/synthetic', () => { calls++; return json(200, { ok: true }) })
  } })
  for (const [method, path] of routes) for (const variant of escaped(path)) {
    // Same-origin and Bearer must still be 404: merely fixing CSRF would leave aliases.
    const allowedHeaders: Record<string, string>[] = [{ Origin: origin }, { Origin: evil, Authorization: 'Bearer synthetic' }]
    for (const headers of allowedHeaders) {
      await check(h.server.port!, variant, method, headers, 404, notFound)
    }
    await check(h.server.port!, variant, method, { Origin: evil }, method === 'GET' ? 404 : 403, method === 'GET' ? notFound : refused)
  }
  expect(calls).toBe(0)
  for (const path of ['%2Fapi/data', '%2fapi/data', '%252Fapi/data', '%252fapi/data']) {
    expect(await raw(h.server.port!, path, 'PUT', { Origin: evil })).toMatch(/^HTTP\/1\.1 400 /)
  }
  for (const [method, path] of routes.slice(0, 3)) {
    await check(h.server.port!, path, method, { Origin: origin }, 200, '{"ok":true}')
  }
  expect(calls).toBe(3)
  // A real bootstrap exemption remains exact; encoded aliases never inherit it.
  await check(h.server.port!, '/api/register/options', 'POST', { Origin: evil }, 200, '{"ok":true}')
  await check(h.server.port!, '/api/data', 'PUT', { Origin: evil }, 403, refused)
  await check(h.server.port!, '/api/logout', 'POST', { Origin: evil }, 403, refused)
  for (const path of ['//other/api/data', '//other/api/%2e/data']) {
    await check(h.server.port!, path, 'PUT', { Origin: evil }, 403, refused)
    await check(h.server.port!, path, 'PUT', { Origin: origin }, 200, '{"ok":true}')
  }
  await check(h.server.port!, '//other/api/%64ata', 'PUT', { Origin: origin }, 404, notFound)
  await check(h.server.port!, '//other/../api/data', 'PUT', { Origin: origin }, 404, notFound)
  await check(h.server.port!, '//other/../api/data', 'PUT', { Origin: evil }, 403, refused)
})

test('wire deleted routes and media cannot be revived by encoded aliases or remounting', async () => {
  let calls = 0
  const media = [
    ['PUT', `/api/media/${'a'.repeat(64)}`], ['GET', `/api/media/${'a'.repeat(64)}`],
    ['POST', '/api/media/missing'], ['POST', '/api/media/sweep'],
  ] as const
  const routes = [...DELETED_ROUTES.map(key => key.split(' ') as [string, string]), ...media]
  const h = start({ ORIGIN: origin }, { routes: app => {
    for (const [method, path] of routes) app.on(method, path, () => { calls++; return json(200, { revived: true }) })
    app.put('/api/media/:hash', () => { calls++; return json(200, { revived: true }) })
    app.get('/api/media/:hash', () => { calls++; return json(200, { revived: true }) })
  } })
  for (const [method, path] of routes) {
    await check(h.server.port!, path, method, { Origin: evil }, 404, notFound)
    for (const variant of escaped(path)) {
      await check(h.server.port!, variant, method, { Origin: origin }, 404, notFound)
      await check(h.server.port!, variant, method, { Origin: evil, Authorization: 'Bearer synthetic' }, 404, notFound)
    }
  }
  expect(calls).toBe(0)
})

test('wire encoded library segments cannot alias parameterised routes', async () => {
  let calls = 0
  const h = start({ ORIGIN: origin }, { routes: app => {
    app.put('/api/programmes/library/:id', () => { calls++; return json(200, { ok: true }) })
    app.get('/api/programmes/library/:id/versions', () => { calls++; return json(200, { ok: true }) })
  } })
  for (const prefix of escaped('/api/programmes/library/')) {
    const path = `${prefix}synthetic`
    await check(h.server.port!, path, 'PUT', { Origin: origin }, 404, notFound)
    await check(h.server.port!, path, 'PUT', { Origin: evil, Authorization: 'Bearer synthetic' }, 404, notFound)
    await check(h.server.port!, path, 'PUT', { Origin: evil }, 403, refused)
    await check(h.server.port!, `${path}/versions`, 'GET', { Origin: evil }, 404, notFound)
  }
  expect(calls).toBe(0)
  for (const id of ['synthetic', 'a%2Fb', 'a%2fb', 'a%252Fb', 'a%252fb']) {
    await check(h.server.port!, `/api/programmes/library/${id}`, 'PUT', { Origin: origin }, 200, '{"ok":true}')
    await check(h.server.port!, `/api/programmes/library/${id}/versions`, 'GET', { Origin: evil }, 200, '{"ok":true}')
  }
  expect(calls).toBe(10)
})

test('wire CSRF fails closed for every unsafe method even outside ROUTE_POLICY', async () => {
  let calls = 0
  const methods = ['POST', 'PUT', 'PATCH', 'DELETE', 'TRACE', 'PROPFIND']
  const h = start({ ORIGIN: origin }, { routes: app => {
    app.on(methods, '/api/unlisted', () => { calls++; return json(200, { ok: true }) })
    app.patch('/api/data', () => { calls++; return json(200, { ok: true }) })
    app.put('/api/programmes/library/:id', () => { calls++; return json(200, { ok: true }) })
  } })
  for (const method of methods) {
    await check(h.server.port!, '/api/unlisted', method, { Origin: evil }, 403, refused)
    await check(h.server.port!, '/api/unknown', method, { 'Sec-Fetch-Site': 'cross-site' }, 403, refused)
  }
  await check(h.server.port!, '/api/data', 'PATCH', { Origin: evil }, 403, refused)
  // Encoded slashes remain part of a parameter, with the same CSRF guard.
  for (const id of ['synthetic', 'a%2Fb', 'a%2fb', 'a%252Fb', 'a%252fb']) {
    await check(h.server.port!, `/api/programmes/library/${id}`, 'PUT', { Origin: evil }, 403, refused)
  }
  expect(calls).toBe(0)
  for (const method of methods) await check(h.server.port!, '/api/unlisted', method, { Origin: origin }, 200, '{"ok":true}')
  expect(calls).toBe(methods.length)
  await check(h.server.port!, '/api/unknown', 'POST', { Origin: origin }, 404, notFound)
})

test('wire dot segments normalise identically for routing, CSRF and tombstones', async () => {
  let calls = 0
  const h = start({ ORIGIN: origin }, { routes: app => {
    app.put('/api/data', () => { calls++; return json(200, { ok: true }) })
    app.post('/api/login/password', () => { calls++; return json(200, { revived: true }) })
  } })
  const dots = ['.', '%2e', '%2E']
  const parents = ['..', '.%2e', '.%2E', '%2e.', '%2E.', '%2e%2e', '%2E%2E', '%2e%2E', '%2E%2e']
  const paths = [...dots.map(dot => `/api/${dot}/data`), ...parents.map(dot => `/api/unused/${dot}/data`), '/api/./unused/../data', '/api\\data']
  for (const path of paths) {
    await check(h.server.port!, path, 'PUT', { Origin: evil }, 403, refused)
    await check(h.server.port!, path, 'PUT', { Origin: origin }, 200, '{"ok":true}')
  }
  expect(calls).toBe(paths.length)
  for (const dot of parents) await check(h.server.port!, `/api/login/unused/${dot}/password`, 'POST', { Origin: evil }, 404, notFound)
  for (const dot of ['%252e', '%252E', '%252e%252e', '%252E%252E']) {
    await check(h.server.port!, `/api/${dot}/data`, 'PUT', { Origin: origin }, 404, notFound)
    await check(h.server.port!, `/api/${dot}/data`, 'PUT', { Origin: evil }, 403, refused)
  }
  for (const path of ['/api/%/data', '/api/%ZZ/data', '/api%5Cdata', '/api/%C0%AFdata', '/api/%FFdata']) {
    await check(h.server.port!, path, 'PUT', { Origin: origin }, 404, notFound)
    await check(h.server.port!, path, 'PUT', { Origin: evil }, 403, refused)
  }
  expect(calls).toBe(paths.length)
})
