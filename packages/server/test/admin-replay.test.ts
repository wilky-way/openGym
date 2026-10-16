import { test, expect } from 'bun:test'
import transcript from './fixtures/admin-transcript.json'
import { startAdmin, as } from './admin-helpers'

// Captured on Node 22.23.3 against frozen legacy; the ordinary server gate replays with Bun only.
// Regenerate/verify separately: bun test scripts/parity/S06-record.diff.test.ts.
test('replays all nine admin routes against saved legacy HTTP bodies and JSON key order', async () => {
  const h = startAdmin()
  let code = ''
  const normal = (value: unknown): unknown => {
    if (typeof value === 'string') return code && value === code ? '<invite>' : value
    if (Array.isArray(value)) return value.map(normal)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, normal(v)]))
    return value
  }
  for (const step of transcript) {
    const body = 'body' in step ? JSON.stringify(step.body).replaceAll('<invite>', code) : undefined
    const r = await fetch(h.api + step.route, { method: step.method, headers: as(step.actor), ...(body === undefined ? {} : { body }) })
    const parsed = await r.json()
    if (step.route === '/api/admin/invites/new') code = parsed.invite.code
    const actual = { status: r.status, body: normal(parsed) }
    // I03 security exception: credentials no longer appear in invite audit messages.
    const expected = structuredClone(step.response)
    if (step.route.startsWith('/api/admin/audit') && 'events' in expected.body) for (const event of (expected.body as any).events) {
      if (event.ev === 'admin.invite.create' || event.ev === 'admin.invite.revoke') event.msg = '[redacted invite]'
    }
    expect(actual).toEqual(expected)
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected))
  }
})
