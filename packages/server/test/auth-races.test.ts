import { test, expect } from 'bun:test'
import { authServer, bearer, cookie } from './auth-helpers'
import { createApp } from '../src/app'
import { RequestBody } from '../src/http'
import { getUser, putUser, listAudit } from '../src/storage'
import { getDevice, revokeDevice } from '../src/storage/devices'
import { clientIp } from '../src/auth-address'

test('device mutations reverify after body reads: revocation, sv bump and disable stop the pending request', async () => {
  for (const mutation of ['revoke', 'sv', 'disable'])
    for (const route of ['rename', 'revoke']) {
      const h = authServer({ DEVICE_TOKENS: '1' }),
        u = getUser(h.db, 'u_phone')!,
        actor = h.auth.mint(u),
        other = h.auth.mint(u)
      const request = new Request('http://gym/api/account/devices/' + route, {
        method: 'POST',
        headers: bearer(actor),
      })
      let reading!: () => void, release!: () => void
      const started = new Promise<void>((r) => (reading = r)),
        ready = new Promise<void>((r) => (release = r))
      class DelayedBody extends RequestBody {
        override async readJson(): Promise<Record<string, unknown>> {
          reading()
          await ready
          return { id: other.split('.')[1], name: 'Changed' }
        }
      }
      const app = createApp(h.config, { auth: h.auth })
      const pending = app.fetch(request, {
        body: new DelayedBody(request, 1000),
      })
      await started
      if (mutation === 'revoke')
        revokeDevice(h.db, actor.split('.')[1]!, u.id, h.clock.t)
      else
        putUser(h.db, {
          ...u,
          sv: mutation === 'sv' ? 1 : 0,
          disabled: mutation === 'disable' ? 1 : 0,
        })
      release()
      const response = await pending
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: 'not signed in' })
      expect(getDevice(h.db, other.split('.')[1]!)?.revoked_at).toBeNull()
      expect(getDevice(h.db, other.split('.')[1]!)?.name).toBe('')
    }
})

test('audit write failure does not consume pairing without returning token or break logout', async () => {
  const h = authServer(),
    code = (await (await h.post('/api/pair/create', cookie('u_phone'))).json())
      .code
  h.db.run(
    "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'synthetic fault'); END",
  )
  const redeem = await h.post('/api/pair/redeem', {}, { code })
  expect(redeem.status).toBe(200)
  const result = await redeem.json()
  expect((await h.me(bearer(result.token))).status).toBe(200)
  expect((await h.post('/api/pair/redeem', {}, { code })).status).toBe(400)
  expect((await h.post('/api/logout', cookie('u_phone'))).status).toBe(200)
  expect((await h.post('/api/logout/all', cookie('u_phone'))).status).toBe(200)
})

test('auth audit honors net/full/off IP modes and ignores untrusted proxy fields', async () => {
  for (const mode of ['off', 'net', 'full']) {
    const h = authServer({ AUDIT_IP: mode })
    await h.post('/api/logout', {
      ...cookie('u_phone'),
      'X-Forwarded-For': '8.8.8.8',
    })
    expect(listAudit(h.db)[0]?.ip).toBe(
      mode === 'off' ? null : mode === 'net' ? '127.0.0.0/24' : '127.0.0.1',
    )
  }
  const h = authServer({ AUDIT_IP: 'full', TRUST_PROXY: '1' })
  await h.post('/api/logout', {
    ...cookie('u_phone'),
    'X-Forwarded-For': '8.8.8.8, 1.1.1.1',
  })
  expect(listAudit(h.db)[0]?.ip).toBe('8.8.8.8')
  h.config.audit.ip = 'net'
  expect(
    clientIp(new Request('http://gym/'), h.config, '2001:db8:abcd:1234::1'),
  ).toBe('2001:db8:abcd::/48')
  expect(
    clientIp(
      new Request('http://gym/', {
        headers: { 'X-Forwarded-For': 'malicious value' },
      }),
      h.config,
    ),
  ).toBeNull()
})

test('admin denial and unavailable pairing retain legacy audit details', async () => {
  const h = authServer(),
    app = createApp(h.config, {
      auth: h.auth,
      routes: (a) => a.get('/api/admin/users', () => new Response('admin')),
    })
  expect(
    (await app.request('/api/admin/users', { headers: cookie('u_phone') }))
      .status,
  ).toBe(403)
  expect(listAudit(h.db)[0]).toMatchObject({
    ev: 'admin.denied',
    ok: 0,
    uid: 'u_phone',
  })
  const code = (
    await (await h.post('/api/pair/create', cookie('u_phone'))).json()
  ).code
  putUser(h.db, { ...getUser(h.db, 'u_phone')!, disabled: 1 })
  expect((await h.post('/api/pair/redeem', {}, { code })).status).toBe(400)
  expect(listAudit(h.db)[0]).toMatchObject({
    ev: 'auth.pair.fail',
    uid: 'u_phone',
    msg: 'user-unavailable',
  })
})
