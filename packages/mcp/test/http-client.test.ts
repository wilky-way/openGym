import { afterEach, expect, test, vi } from 'vitest'
import { ApiClient, directFetch } from '../src/http-client'
import { target } from './http-helpers'
let server: Awaited<ReturnType<typeof target>> | undefined
afterEach(async () => { vi.unstubAllEnvs(); if (server) { await server.close(); server = undefined } })
test.each(['http://example.com', 'ftp://127.0.0.1', 'https://name:secret@example.com', 'https://example.com/?token=secret', 'https://example.com/#secret', 'invalid'])('refuses unsafe endpoint %s before dialing', endpoint => {
  expect(() => new ApiClient({ OPENGYM_URL: endpoint, OPENGYM_TOKEN: 'synthetic', OPENGYM_UID: 'test-uid' })).toThrow()
})
test('requires profile, endpoint and credential explicitly', () => {
  for (const field of ['OPENGYM_URL', 'OPENGYM_UID', 'OPENGYM_TOKEN']) {
    const env = { OPENGYM_URL: 'http://127.0.0.1:1234', OPENGYM_UID: 'test-uid', OPENGYM_TOKEN: 'synthetic', [field]: '' }
    expect(() => new ApiClient(env)).toThrow(/OPENGYM_URL, OPENGYM_TOKEN and OPENGYM_UID/)
  }
})
test('agent token is minted in-process and test HTTP ignores every proxy variable', async () => {
  server = await target({ _rev: 7, _wid: 'epoch', routines: [], workouts: [] })
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) vi.stubEnv(key, 'http://127.0.0.1:1')
  const client = new ApiClient(server.env)
  expect((await client.checkProfile()).id).toBe('test-uid')
  expect((await client.request('GET', '/api/data')).rev).toBe(7)
  await expect(client.request('GET', '/api/account/devices')).rejects.toMatchObject({ code: 'API_REFUSED', status: 403 })
})
test('does not follow an HTTP redirect or expose invalid-response contents', async () => {
  server = await target(null, [], { transportFixture: true })
  const statuses: number[] = []
  const client = new ApiClient(server.env, async (url, init) => {
    expect(init.redirect).toBe('error')
    const response = await directFetch(url, init)
    statuses.push(response.status)
    return response
  })
  await expect(client.request('GET', '/__m01_redirect')).rejects.toMatchObject({ code: 'API_REFUSED', status: 302 })
  const failure = await client.request('GET', '/__m01_invalid').catch(error => error)
  expect(failure).toMatchObject({ code: 'API_UNAVAILABLE', message: 'The openGym API returned an invalid response.' })
  for (const secret of [server.token, server.api, 'private invalid JSON'])
    expect(JSON.stringify({ ...failure, message: failure.message })).not.toContain(secret)
  expect(statuses).toEqual([302, 200])
  const stats = await directFetch(server.api + '/__m01_stats', { method: 'GET' })
  expect(await stats.json()).toEqual({ redirect: 1, invalid: 1, followed: 0 })
})
test('connection errors are sanitized without endpoint, token or underlying path details', async () => {
  const client = new ApiClient({ OPENGYM_URL: 'http://127.0.0.1:1234', OPENGYM_TOKEN: 'synthetic-private', OPENGYM_UID: 'test-uid' }, async () => { throw new Error('synthetic-private /private/data') })
  await expect(client.checkProfile()).rejects.toMatchObject({ code: 'API_UNAVAILABLE', message: 'The openGym API could not be reached.' })
})
