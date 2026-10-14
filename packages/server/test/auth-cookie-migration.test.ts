import { test, expect } from 'bun:test'
import { authServer, bearer, mint } from './auth-helpers'
import { getUser } from '../src/storage'
import { getDevice } from '../src/storage/devices'
import { createApp } from '../src/app'
import { RequestBody } from '../src/http'

const secure = { ORIGIN: 'https://gym.example', DEVICE_TOKENS: '1' }
test('secure plain v1 cookie is accepted once, upgraded to Host, and cleared on the first authenticated request', async () => {
  for (const deviceTokens of ['0', '1']) {
    const h = authServer({ ...secure, DEVICE_TOKENS: deviceTokens }), old = mint('u_phone', 1)
    // Migration applies beyond /api/me and does not require a half-life renewal.
    const first = await fetch(h.api + '/api/account/devices', { headers: { Cookie: 'gymsid=' + old } })
    expect(first.status).toBe(200)
    const cookies = first.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toMatch(/^__Host-gymsid=.+; Path=\/; Max-Age=864000; HttpOnly; Secure; SameSite=Lax$/)
    expect(cookies[1]).toBe('gymsid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax')
    const host = cookies[0]!.split(';')[0]!
    expect(host).toBe('__Host-gymsid=' + old)
    const current = (await first.json()).current
    expect(getDevice(h.db, current)).not.toBeNull()
    expect((await h.me({ Cookie: host })).status).toBe(200)
    const renamed = await h.post('/api/account/devices/rename', { Cookie: host }, { id: current, name: 'Synthetic migrated device' })
    expect(renamed.status).toBe(200)
    expect(getDevice(h.db, current)?.name).toBe('Synthetic migrated device')
    const revoked = await h.post('/api/account/devices/revoke', { Cookie: host }, { id: current })
    expect(revoked.status).toBe(200)
    expect((await h.me({ Cookie: host })).status).toBe(401)
    expect((await h.me({ Cookie: 'gymsid=' + old })).status).toBe(401)
    // Revoking the migrated device also rejects Host and agent presentations.
    expect((await h.me({ Cookie: '__Host-gymsid=' + old })).status).toBe(401)
    expect((await h.me(bearer(old))).status).toBe(401)
  }
})

test('secure plain v2 cookie is rejected even beside a valid bearer, while Host cookie precedence is unchanged', async () => {
  const h = authServer(secure), u = getUser(h.db, 'u_phone')!
  const a = h.auth.mint(u), b = h.auth.mint(u)
  for (const headers of [{ Cookie: 'gymsid=' + a }, { Cookie: 'gymsid=' + a, ...bearer(b) }]) {
    const r = await h.me(headers)
    expect(r.status).toBe(401)
    expect(await r.json()).toEqual({ error: 'not signed in' })
    expect(r.headers.getSetCookie()).toHaveLength(0)
  }
  const preferred = await h.me({ Cookie: '__Host-gymsid=' + a + '; gymsid=' + b })
  expect(preferred.status).toBe(200)
  expect(preferred.headers.getSetCookie()).toHaveLength(0)
  expect((await h.me({ Cookie: '__Host-gymsid=bad; gymsid=' + mint(u.id), ...bearer(a) })).status).toBe(401)
  expect((await h.me({ Cookie: '__Host-gymsid=' + a + '; __Host-gymsid=' + b })).status).toBe(401)
})

test('one-time migration permits post-body authentication rechecks and does not reissue after logout', async () => {
  const h = authServer(secure), old = mint('u_phone', 1)
  const first = await fetch(h.api + '/api/account/devices', { headers: { Cookie: '__Host-gymsid=' + old } })
  const id = (await first.json()).current
  const rename = await h.post('/api/account/devices/rename', { Cookie: 'gymsid=' + old }, { id, name: 'Synthetic migrated' })
  expect(rename.status).toBe(200)
  expect(rename.headers.getSetCookie()[0]).toStartWith('__Host-gymsid=' + old + ';')
  expect(getDevice(h.db, id)?.name).toBe('Synthetic migrated')
  const fresh = mint('u_test_1', 1)
  const logout = await h.post('/api/logout', { Cookie: 'gymsid=' + fresh })
  expect(logout.status).toBe(200)
  expect(logout.headers.getSetCookie()).toEqual([
    '__Host-gymsid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    'gymsid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
  ])
  expect((await h.me({ Cookie: 'gymsid=' + fresh })).status).toBe(401)
})

test('unprefixed v2 cookies remain valid on an insecure local listener', async () => {
  const h = authServer({ DEVICE_TOKENS: '1' }), token = h.auth.mint(getUser(h.db, 'u_phone')!)
  const r = await h.me({ Cookie: 'gymsid=' + token })
  expect(r.status).toBe(200)
  expect(r.headers.getSetCookie()).toHaveLength(0)
})

for (const trigger of ['logout', 'revoke'] as const) {
  test(`a pairing created during default-v1 Host migration is invalidated by subsequent ${trigger}`, async () => {
    const h = authServer({ ...secure, DEVICE_TOKENS: '0' }), old = mint('u_phone', 8)
    const created = await h.post('/api/pair/create', { Cookie: 'gymsid=' + old })
    expect(created.status).toBe(200)
    const { code } = await created.json(), host = created.headers.getSetCookie()[0]!.split(';')[0]!
    expect(host).toBe('__Host-gymsid=' + old)
    const devices = await fetch(h.api + '/api/account/devices', { headers: { Cookie: host } })
    const current = (await devices.json()).current
    const revoked = trigger === 'logout'
      ? await h.post('/api/logout', { Cookie: host })
      : await h.post('/api/account/devices/revoke', { Cookie: host }, { id: current })
    expect(revoked.status).toBe(200)
    const count = h.db.query('SELECT * FROM devices').all().length
    const redeemed = await h.post('/api/pair/redeem', {}, { code })
    expect(redeemed.status).toBe(400)
    expect(await redeemed.json()).toEqual({ error: 'invalid or expired code', code: 'pair-invalid' })
    expect(h.db.query('SELECT * FROM devices').all()).toHaveLength(count)
  })
}

test('a pending body-read migration consumes plain v1 once while preserving that request authentication rechecks', async () => {
  const h = authServer(secure), old = mint('u_phone', 8)
  const listing = await fetch(h.api + '/api/account/devices', { headers: { Cookie: '__Host-gymsid=' + old } })
  const id = (await listing.json()).current
  let reading!: () => void, release!: () => void
  const started = new Promise<void>(resolve => reading = resolve), held = new Promise<void>(resolve => release = resolve)
  class DelayedBody extends RequestBody {
    override async readJson(): Promise<Record<string, unknown>> {
      reading(); await held; return { id, name: 'Synthetic pending migration' }
    }
  }
  const request = new Request('https://gym.example/api/account/devices/rename', { method: 'POST', headers: { Cookie: 'gymsid=' + old } })
  const pending = createApp(h.config, { auth: h.auth }).fetch(request, { body: new DelayedBody(request, 1000) })
  await started
  expect((await h.me({ Cookie: 'gymsid=' + old })).status).toBe(401)
  release()
  const migrated = await pending
  expect(migrated.status).toBe(200)
  expect(migrated.headers.getSetCookie()[0]).toStartWith('__Host-gymsid=' + old + ';')
  expect(getDevice(h.db, id)?.name).toBe('Synthetic pending migration')
})
