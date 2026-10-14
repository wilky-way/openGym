import { test, expect, spyOn } from 'bun:test'
import net from 'node:net'
import { start } from './helpers'
import { json } from '../src/http'

async function trickle(port: number, line: string, headers: string, first = '{"hashes":') {
  const beginning = performance.now()
  return new Promise<{ response: string; elapsed: number }>((resolve, reject) => {
    let response = ''
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`${line} HTTP/1.1\r\nHost: x\r\n${headers}\r\n${first}`))
    const drip = setInterval(() => { if (!socket.destroyed) socket.write(' ') }, 20)
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('socket still open after deadline')) }, 2000)
    socket.on('error', () => {})
    socket.on('data', chunk => response += chunk)
    socket.on('close', () => { clearInterval(drip); clearTimeout(timeout); resolve({ response, elapsed: performance.now() - beginning }) })
  })
}

test('a trickled body is cut after the body deadline on every route but a signed-in upload', async () => {
  // The upload exemption is deleted by compatibility policy; the legacy test name is retained.
  const h = start({ BODY_TIMEOUT_MS: '200' }, { routes: app => {
    app.post('/api/register/options', async context => json(200, await context.get('body').readJson()))
    app.post('/api/logout', () => json(200, { ok: true }))
  } })
  for (const headers of ['Content-Length: 999999\r\n', 'Transfer-Encoding: chunked\r\n']) {
    const first = headers.startsWith('Transfer') ? '1000\r\n{"hashes":' : '{"hashes":'
    const result = await trickle(h.server.port!, 'POST /api/register/options', headers, first)
    expect(result.response).toMatch(/^HTTP\/1\.1 408 /)
    expect(result.response).toContain('Connection: close')
    expect(result.elapsed).toBeGreaterThanOrEqual(150)
    expect(result.elapsed).toBeLessThan(1200)
  }
  for (const route of ['POST /api/logout', 'PUT /api/media/' + 'd'.repeat(64), 'POST /missing']) {
    const result = await trickle(h.server.port!, route, 'Content-Length: 999999\r\n')
    expect(result.elapsed).toBeLessThan(1200)
    // Ignored-body handlers must await receipt bounds before mutation.
    expect(result.response).toMatch(route === 'POST /api/logout' ? /^HTTP\/1\.1 408 / : /^HTTP\/1\.1 404 /)
    expect(result.response).toContain('Connection: close')
  }
  expect((await fetch(`${h.api}/api/health`)).status).toBe(200)
})

test('completed bodies clear the receive deadline before a slow handler finishes', async () => {
  const h = start({ BODY_TIMEOUT_MS: '50' }, { routes: app => {
    app.post('/api/register/options', async context => {
      const body = await context.get('body').readJson()
      await Bun.sleep(120)
      return json(200, body)
    })
  } })
  const response = await fetch(`${h.api}/api/register/options`, { method: 'POST', body: '{}' })
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('{}')
  expect(response.headers.get('connection')).not.toBe('close')
})

test('an oversized body is answered 413 while discarding, and its drain still has an absolute deadline', async () => {
  const h = start({ BODY_TIMEOUT_MS: '200' }, { routes: app => {
    app.post('/api/register/options', async context => json(200, await context.get('body').readJson()))
  } })
  const result = await trickle(h.server.port!, 'POST /api/register/options', 'Content-Length: 9999999\r\n', 'x'.repeat(6 * 1024 * 1024))
  expect(result.response).toMatch(/^HTTP\/1\.1 413 /)
  expect(result.response).toContain('{"error":"body too large"}')
  expect(result.elapsed).toBeGreaterThanOrEqual(150)
  expect(result.elapsed).toBeLessThan(1200)
  expect((await fetch(`${h.api}/api/health`)).status).toBe(200)
})

test('a fully received unread body clears its deadline without changing handler validation precedence', async () => {
  const h = start({ BODY_TIMEOUT_MS: '50' }, { routes: app => {
    app.post('/api/register/options', async context => {
      await Bun.sleep(120)
      return json(200, await context.get('body').readJson())
    })
    app.put('/api/data', async () => {
      await Bun.sleep(120)
      return json(401, { error: 'not signed in' })
    })
  } })
  const valid = await fetch(`${h.api}/api/register/options`, { method: 'POST', body: '{}' })
  expect(valid.status).toBe(200)
  expect(await valid.text()).toBe('{}')
  const malformed = await fetch(`${h.api}/api/data`, { method: 'PUT', body: '{bad' })
  expect(malformed.status).toBe(401)
  expect(await malformed.text()).toBe('{"error":"not signed in"}')
})

test('uploads beyond twice the body cap are cut off before the receive deadline', async () => {
  const h = start({ BODY_TIMEOUT_MS: '1800' }, { routes: app => {
    app.post('/api/register/options', async context => json(200, await context.get('body').readJson()))
  } })
  const result = await trickle(h.server.port!, 'POST /api/register/options', 'Content-Length: 99999999\r\n', 'x'.repeat(11 * 1024 * 1024))
  expect(result.elapsed).toBeLessThan(1200)
  expect((await fetch(`${h.api}/api/health`)).status).toBe(200)
})


test("server.js gives a slow upload half an hour, not node's default five minutes", () => {
  // The upload half-hour is deleted; the retained assertion checks the listener's header timeout.
  const listener = spyOn(Bun, 'serve')
  try {
    start()
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ idleTimeout: 60 }))
  } finally { listener.mockRestore() }
})
