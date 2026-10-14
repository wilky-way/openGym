import { test, expect } from 'bun:test'
import { start } from './helpers'
import transcripts from './transcripts/shell.json'

/** Synthetic HTTP transcripts were recorded and compared against legacy Node 22.
 * Ordinary server tests replay these frozen fixtures using Bun only. */
test('health/config/404 transcripts replay byte-for-byte against Bun Hono', async () => {
  const h = start({ INVITE_ONLY: '1', ALLOW_GUEST: '0', DEFAULT_LANG: 'en-US' }, { userCount: () => 1 })
  for (const transcript of transcripts) {
    const response = await fetch(`${h.api}${transcript.path}`, { method: transcript.method })
    expect(response.status).toBe(transcript.status)
    expect(await response.text()).toBe(transcript.body)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
  }
  expect(h.log[0]).toBe(`gym-api on :${h.server.port} (rpID=localhost, origin=http://localhost:8080)`)
})
