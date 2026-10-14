import { test, expect } from 'bun:test'
import { DELETED_ROUTES } from '@opengym/contract/http/api'
import { start } from './helpers'
import { json } from '../src/http'

test('every deleted route remains JSON 404, including attempts to remount it', async () => {
  const h = start({}, { routes: app => app.post('/api/login/password', () => json(200, { incorrect: true })) })
  for (const key of DELETED_ROUTES) {
    const [method, path] = key.split(' ')
    const response = await fetch(`${h.api}${path}`, { method, headers: { Origin: 'https://evil.example' } })
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('{"error":"not found"}')
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull() // Release regressions configured-origin allowlist
  }
  expect((await fetch(`${h.api}/api/health`, { method: 'HEAD' })).status).toBe(404)
  expect((await fetch(`${h.api}/api/health/`)).status).toBe(404)
})
