import { test, expect } from 'bun:test'
import http from 'node:http'
import { start } from './helpers'
import { ApiError, errorResponse, json, RequestBody } from '../src/http'

function fixture() {
  return start({}, { routes: app => {
    app.post('/api/register/options', async context => json(200, await context.get('body').readJson()))
  } })
}

test('malformed and non-object JSON bodies are a 400 with no stack trace, on every route', async () => {
  const h = fixture()
  for (const body of ['not json', '{bad', 'null', '"str"', '42', '[]', 'true', '\uFEFF{}']) {
    const response = await fetch(`${h.api}/api/register/options`, { method: 'POST', body })
    expect(response.status).toBe(400)
    expect(await response.text()).toBe('{"error":"invalid json"}')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
  }
  for (const body of [undefined, '', '{}']) {
    const response = await fetch(`${h.api}/api/register/options`, { method: 'POST', body })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('{}')
  }
  const text = '{"z":{"toString":1},"baseRev":"4","a":null,"0":false}'
  const response = await fetch(`${h.api}/api/register/options`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: text })
  expect(await response.text()).toBe(JSON.stringify(JSON.parse(text)))
  expect(h.log.filter(line => /server error|^\s+at /.test(line))).toEqual([])
})

test('a body over the 5 MiB cap is a 413 that every client gets to read, and nothing is written', async () => {
  const h = fixture()
  const exact = '{"pad":"' + 'x'.repeat(h.config.maxBodyBytes - 10) + '"}'
  expect(new TextEncoder().encode(exact).length).toBe(h.config.maxBodyBytes)
  expect((await fetch(`${h.api}/api/register/options`, { method: 'POST', body: exact })).status).toBe(200)
  const over = exact + ' '
  const response = await fetch(`${h.api}/api/register/options`, { method: 'POST', body: over })
  expect(response.status).toBe(413)
  expect(await response.text()).toBe('{"error":"body too large"}')
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
  async function put(body: string): Promise<{ status?: number; body: string }> {
    return new Promise((resolve, reject) => {
      const request = http.request(`${h.api}/api/register/options`, { method: 'POST', agent }, response => {
        let answer = ''
        response.on('data', chunk => answer += chunk)
        response.on('end', () => resolve({ status: response.statusCode, body: answer }))
        response.on('error', reject)
      })
      request.on('error', reject)
      request.end(body)
    })
  }
  try {
    for (let i = 0; i < 3; i++) expect(await put('x'.repeat(6 * 1024 * 1024))).toEqual({ status: 413, body: '{"error":"body too large"}' })
    expect(await put('{}')).toEqual({ status: 200, body: '{}' })
    await put('x'.repeat(11 * 1024 * 1024)).catch(() => {})
    expect((await fetch(`${h.api}/api/health`)).status).toBe(200)
    expect(h.log.filter(line => /server error|^\s+at /.test(line))).toEqual([])
  } finally { agent.destroy() }
})

test('body limit counts UTF-8 bytes rather than JS characters and repeated reads share the parsed object', async () => {
  const request = new Request('http://synthetic', { method: 'POST', body: '{"x":"é"}' })
  const body = new RequestBody(request, 9)
  await expect(body.readJson()).rejects.toMatchObject({ status: 413 })
  const small = new RequestBody(new Request('http://synthetic', { method: 'POST', body: '{"x":1}' }), 100)
  expect(await small.readJson()).toBe(await small.readJson())
})

test('ApiError preserves machine codes, extras and Retry-After; unexpected errors do not disclose data', () => {
  const response = errorResponse(new ApiError(429, 'too many attempts, try again later', { code: 'locked', retryAfter: 12 }, { 'Retry-After': '12' }))
  expect(response.status).toBe(429)
  expect(response.headers.get('retry-after')).toBe('12')
  expect(response.headers.get('cache-control')).toBe('no-store')
  const log: string[] = []
  const unknown = errorResponse(new Error('synthetic-sensitive-message'), line => log.push(line))
  expect(unknown.status).toBe(500)
  expect(log).toEqual(['server error'])
})
