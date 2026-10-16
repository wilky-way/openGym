import { test, expect } from 'bun:test'
import { createHmac } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { authServer, bearer, cookie, mint, SECRET, DAY } from './auth-helpers'
import { getUser, putUser, listAudit, putDeviceLink } from '../src/storage'
import { getDevice, listDevices } from '../src/storage/devices'
import { loadSecret, sign, cookieHeaders, verifySig } from '../src/auth'
import { limitAddress } from '../src/auth-address'
import { loadConfig } from '../src/config'
import { scratchDir } from './helpers'

test('legacy HMAC, pre-versioning cookie, expiry, disabled user and sv verification', async () => {
  const h = authServer(),
    u = getUser(h.db, 'u_phone')!
  const pre = sign(`u_phone:${h.clock.t + DAY}`, SECRET)
  expect((await h.me({ Cookie: `gymsid=${pre}` })).status).toBe(200)
  expect((await h.me(bearer(mint('u_phone', 0)))).status).toBe(200)
  h.clock.t++
  expect((await h.me(bearer(mint('u_phone', 0)))).status).toBe(401)
  expect((await h.me(bearer(mint('absent')))).status).toBe(401)
  expect((await h.me(bearer(mint('u_phone') + 'x'))).status).toBe(401)
  for (const payload of [
    'u_phone:NaN:0',
    'u_phone:Infinity:0',
    `u_phone:${h.clock.t + DAY}:bad`,
    `u_phone:${h.clock.t + DAY}:0:extra`,
  ])
    expect((await h.me(bearer(sign(payload, SECRET)))).status).toBe(401)
  putUser(h.db, { ...u, disabled: 1 })
  expect((await h.me(bearer(mint('u_phone')))).status).toBe(401)
  putUser(h.db, { ...u, sv: 1 })
  expect((await h.me(bearer(mint('u_phone')))).status).toBe(401)
  expect(verifySig('missing', SECRET)).toBeNull()
  expect(verifySig('bad.x', SECRET)).toBeNull()
})

test('secure cookies defeat duplicate shadowing, prefer Host cookies, and migrate and clear both names', async () => {
  const h = authServer({ ORIGIN: 'https://gym.example' }),
    token = mint('u_phone')
  expect(
    (await h.me({ Cookie: `__Host-gymsid=${token}; __Host-gymsid=${token}` }))
      .status,
  ).toBe(200)
  expect(
    (
      await h.me({
        Cookie: `__Host-gymsid=${token}; __Host-gymsid=bad`,
        ...bearer(token),
      })
    ).status,
  ).toBe(401)
  expect(
    (await h.me({ Cookie: `gymsid=${token}; gymsid=bad`, ...bearer(token) }))
      .status,
  ).toBe(401)
  expect(
    (
      await h.me({
        Cookie: `__Host-gymsid=bad; gymsid=${token}`,
        ...bearer(token),
      })
    ).status,
  ).toBe(401)
  expect(
    (await h.me({ Cookie: `__Host-gymsid=${token}; gymsid=bad` })).status,
  ).toBe(200)
  const cookies = cookieHeaders(h.config, token).getSetCookie()
  expect(cookies).toHaveLength(2)
  expect(cookies[0]).toContain('__Host-gymsid=')
  expect(cookies[0]).toContain(
    'Path=/; Max-Age=864000; HttpOnly; Secure; SameSite=Lax',
  )
  expect(cookies[0]).not.toContain('Domain=')
  expect(cookies[1]).toContain('gymsid=; Path=/; Max-Age=0')
  const out = await h.post('/api/logout', { Cookie: `__Host-gymsid=${token}` })
  expect(out.status).toBe(200)
  expect(out.headers.getSetCookie()).toHaveLength(2)
  expect((await h.post('/api/logout')).status).toBe(200)
})

test('v2 device minting, listing, renaming, ownership and individual revocation transcripts', async () => {
  const h = authServer({ DEVICE_TOKENS: '1' }),
    u = getUser(h.db, 'u_phone')!,
    other = getUser(h.db, 'u_test_2')!
  const a = h.auth.mint(u, 'browser'),
    b = h.auth.mint(u, 'agent'),
    c = h.auth.mint(other, 'native')
  expect(a).toMatch(/^v2\.[\w-]{16}\.\d+\.[\w-]{43}$/)
  const list = await fetch(h.api + '/api/account/devices', {
    headers: bearer(a),
  })
  expect(list.status).toBe(200)
  const body = await list.json()
  expect(body.current).toBe(a.split('.')[1])
  expect(body.devices).toHaveLength(2)
  expect(Object.keys(body.devices[0]).sort()).toEqual([
    'created',
    'id',
    'kind',
    'lastSeen',
    'name',
    'revokedAt',
  ])
  expect(body.devices.map((d: { kind: string }) => d.kind).sort()).toEqual([
    'agent',
    'browser',
  ])
  const id = b.split('.')[1]!
  expect(
    (
      await h.post('/api/account/devices/rename', bearer(a), {
        id,
        name: '  Demo  ',
      })
    ).status,
  ).toBe(200)
  expect(getDevice(h.db, id)?.name).toBe('Demo')
  expect(
    (await h.post('/api/account/devices/revoke', bearer(c), { id })).status,
  ).toBe(404)
  expect(
    (
      await h.post('/api/account/devices/rename', bearer(c), {
        id,
        name: 'stolen',
      })
    ).status,
  ).toBe(404)
  expect(
    (await h.post('/api/account/devices/revoke', bearer(a), { id })).status,
  ).toBe(200)
  expect((await h.me(bearer(b))).status).toBe(401)
  expect((await h.me(bearer(a))).status).toBe(200)
  expect((await h.me(bearer(c))).status).toBe(200)
  const revokeCurrent = await h.post('/api/account/devices/revoke', bearer(a), {
    id: a.split('.')[1],
  })
  expect(revokeCurrent.headers.getSetCookie()).toHaveLength(1)
  expect((await h.me(bearer(a))).status).toBe(401)
  expect(
    (
      await h.post('/api/account/devices/revoke', bearer(c), {
        id: { toString: 1 },
      })
    ).status,
  ).toBe(400)
  expect(
    (
      await h.post('/api/account/devices/rename', bearer(c), {
        id: c.split('.')[1],
        name: [],
      })
    ).status,
  ).toBe(400)
})

test('v1 upgrade records predecessor; repeated and v2 renewals keep did; revoke rejects predecessor', async () => {
  const h = authServer({ DEVICE_TOKENS: '1' }),
    old = mint('u_phone', 1)
  const first = await (await h.me(bearer(old))).json(),
    did = first.token.split('.')[1]
  expect(first.token).toStartWith('v2.')
  expect(listDevices(h.db, 'u_phone')).toHaveLength(1)
  const second = await (await h.me(bearer(old))).json()
  expect(second.token.split('.')[1]).toBe(did)
  expect(listDevices(h.db, 'u_phone')).toHaveLength(1)
  h.clock.t += 6 * DAY
  const third = await (await h.me(bearer(second.token))).json()
  expect(third.token.split('.')[1]).toBe(did)
  expect(
    (
      await h.post('/api/account/devices/revoke', bearer(third.token), {
        id: did,
      })
    ).status,
  ).toBe(200)
  h.clock.t -= 6 * DAY
  expect((await h.me(bearer(old))).status).toBe(401)
  expect((await h.me(bearer(third.token))).status).toBe(401)
})

test('v1 synthetic device can be revoked before upgrade, v2 verifies with flag off, and sv kills every format', async () => {
  const h = authServer({ DEVICE_TOKENS: '0' }),
    old = mint('u_phone')
  expect(h.auth.mint(getUser(h.db, 'u_phone')!)).not.toStartWith('v2.')
  await h.me(bearer(old))
  const d = listDevices(h.db, 'u_phone')[0]!
  expect(d.id).toMatch(/^legacy:[a-f0-9]{16}$/)
  expect(
    (await h.post('/api/account/devices/revoke', bearer(old), { id: d.id }))
      .status,
  ).toBe(200)
  expect((await h.me(bearer(old))).status).toBe(401)
  const h2 = authServer({ DEVICE_TOKENS: '1' }),
    u = getUser(h2.db, 'u_phone')!,
    a = h2.auth.mint(u, 'browser'),
    b = h2.auth.mint(u, 'paired')
  h2.config.deviceTokens = false
  expect((await h2.me(bearer(a))).status).toBe(200)
  h2.clock.t += 6 * DAY
  const renewed = await (await h2.me(bearer(a))).json()
  expect(renewed.token.split('.')[1]).toBe(a.split('.')[1])
  putDeviceLink(h2.db, {
    h: 'synthetic-hash',
    user_id: u.id,
    exp: h2.clock.t + DAY,
    created: h2.clock.t,
  })
  expect((await h2.post('/api/logout/all', bearer(b))).status).toBe(200)
  expect((await h2.me(bearer(a))).status).toBe(401)
  expect((await h2.me(bearer(b))).status).toBe(401)
  expect((await h2.me(bearer(renewed.token))).status).toBe(401)
  expect(h2.db.query('SELECT * FROM device_links').all()).toHaveLength(0)
  const mirror = JSON.parse(
    readFileSync(join(h2.config.dataDir, 'db.json'), 'utf8'),
  )
  expect(mirror.users.find((x: { id: string }) => x.id === u.id).sv).toBe(1)
})

test('pairing creates paired v2 device, never accepts caller agent kind, and is one-shot and expires', async () => {
  const h = authServer({ DEVICE_TOKENS: '1' }),
    u = getUser(h.db, 'u_phone')!,
    token = h.auth.mint(u)
  const code = (await (await h.post('/api/pair/create', bearer(token))).json())
    .code
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
  const r = await h.post(
    '/api/pair/redeem',
    {},
    { code: code.toLowerCase(), kind: 'agent' },
  )
  expect(r.status).toBe(200)
  const paired = await r.json()
  expect(getDevice(h.db, paired.token.split('.')[1])?.kind).toBe('paired')
  expect((await h.post('/api/pair/redeem', {}, { code })).status).toBe(400)
  const expired = (
    await (await h.post('/api/pair/create', bearer(token))).json()
  ).code
  h.clock.t += 300001
  expect((await h.post('/api/pair/redeem', {}, { code: expired })).status).toBe(
    400,
  )
  const disabled = (
    await (await h.post('/api/pair/create', bearer(token))).json()
  ).code
  putUser(h.db, { ...u, disabled: 1 })
  expect(
    (await h.post('/api/pair/redeem', {}, { code: disabled })).status,
  ).toBe(400)
  expect(
    (await h.post('/api/pair/redeem', {}, { code: { toString: 1 } })).status,
  ).toBe(400)
})

test('touch writes are limited to ten minutes and malformed v2 tokens cannot authenticate', async () => {
  const h = authServer({ DEVICE_TOKENS: '1' }),
    token = h.auth.mint(getUser(h.db, 'u_phone')!),
    did = token.split('.')[1]!
  const created = getDevice(h.db, did)!.last_seen
  h.clock.t += 599999
  await h.me(bearer(token))
  expect(getDevice(h.db, did)!.last_seen).toBe(created)
  h.clock.t++
  await h.me(bearer(token))
  expect(getDevice(h.db, did)!.last_seen).toBe(h.clock.t)
  for (const payload of [
    `v2.${did}.NaN`,
    `v2.${did}.Infinity`,
    `v2.${did}.${h.clock.t + DAY}.extra`,
    `v2.absent.${h.clock.t + DAY}`,
    `v2.${did}.${h.clock.t - 1}`,
  ])
    expect((await h.me(bearer(sign(payload, SECRET)))).status).toBe(401)
  const u = getUser(h.db, 'u_phone')!
  putUser(h.db, { ...u, disabled: 1 })
  expect((await h.me(bearer(token))).status).toBe(401)
})

test('secret uses durable atomic writer with owner-only mode and accepts trimmed legacy secret', () => {
  const dir = scratchDir(),
    secret = loadSecret(dir)
  expect(secret).toMatch(/^[a-f0-9]{64}$/)
  expect(loadSecret(dir)).toBe(secret)
  expect(statSync(join(dir, 'secret')).mode & 0o777).toBe(0o600)
  expect(
    readFileSync(new URL('../src/auth.ts', import.meta.url), 'utf8'),
  ).toMatch(/atomicWrite\(file,\s*randomBytes\(32\)/)
  expect(
    readFileSync(new URL('../src/auth.ts', import.meta.url), 'utf8'),
  ).not.toContain('writeFileSync')
  expect(
    createHmac('sha256', secret).update('probe').digest('hex'),
  ).toHaveLength(64)
})

test('public exposure enforces TLS, invite-only, no first-user-admin, and bootstrap limits', async () => {
  expect(() => loadConfig({ EXPOSURE: 'public' })).toThrow('HTTPS')
  expect(() =>
    loadConfig({
      EXPOSURE: 'public',
      ORIGIN: 'https://gym.example',
      FIRST_USER_ADMIN: '1',
    }),
  ).toThrow('FIRST_USER_ADMIN')
  const h = authServer({ EXPOSURE: 'public', ORIGIN: 'https://gym.example', DEVICE_TOKENS: '1' })
  expect(h.config.inviteOnly).toBe(true)
  for (let i = 0; i < 11; i++)
    expect(
      (await h.post('/api/pair/redeem', {}, { code: 'WRONG' + i })).status,
    ).toBe(400)
  const limited = await h.post(
    '/api/pair/redeem',
    { 'X-Forwarded-For': '9.8.7.6' },
    { code: 'WRONG' },
  )
  expect(limited.status).toBe(429)
  expect(limited.headers.get('Retry-After')).toBe('30')
  expect((await limited.json()).code).toBe('locked')
  expect(listAudit(h.db).filter((r) => r.ev === 'auth.pair.fail')).toHaveLength(
    10,
  )
  h.clock.t += 60000
  expect((await h.post('/api/pair/redeem', {}, { code: 'WRONG' })).status).toBe(
    400,
  )
  const privateConfig = loadConfig({})
  const req = (xff: string) =>
    new Request('http://x/', { headers: { 'X-Forwarded-For': xff } })
  expect(limitAddress(req('1.2.3.4'), privateConfig, '5.6.7.8')).toBe('5.6.7.8')
  expect(limitAddress(req('1.2.3.4, 5.6.7.8'), { trustProxy: true })).toBe(
    '5.6.7.8',
  )
  expect(limitAddress(req(''), privateConfig, '2001:db8:1:2::abcd')).toBe(
    '2001:db8:1:2::/64',
  )
  expect(limitAddress(req(''), privateConfig, '::ffff:192.0.2.4')).toBe(
    '192.0.2.4',
  )
})

test('auth and CSRF checks share the routed raw path; public bootstrap exemptions cannot be encoded', async () => {
  const h = authServer({ EXPOSURE: 'public', ORIGIN: 'https://gym.example', DEVICE_TOKENS: '1' })
  for (const path of [
    '/api/p%61ir/create',
    '/api/account/dev%69ces/revoke',
    '/api/p%61ir/redeem',
    '/api/me',
  ]) {
    const r = await fetch(h.api + path, {
      method: path === '/api/me' ? 'GET' : 'POST',
      headers: { Origin: 'https://evil.example' },
      body: path === '/api/me' ? undefined : '{}',
    })
    expect([401, 403, 404]).toContain(r.status)
  }
  expect((await h.post('/api/pair/create', {}, { code: 'x' })).status).toBe(401)
  expect(
    (await h.post('/api/logout', { Origin: 'https://evil.example' })).status,
  ).toBe(403)
  expect((await fetch(h.api + '/api/config')).status).toBe(200)
})

test('v2 logout revokes only this device; v1 logout remains cookie-only', async () => {
  const h = authServer({ DEVICE_TOKENS: '1' }),
    u = getUser(h.db, 'u_phone')!,
    a = h.auth.mint(u),
    b = h.auth.mint(u, 'agent')
  expect((await h.post('/api/logout', bearer(a))).status).toBe(200)
  expect((await h.me(bearer(a))).status).toBe(401)
  expect((await h.me(bearer(b))).status).toBe(200)
  const old = mint('u_phone', 8)
  expect((await h.post('/api/logout', bearer(old))).status).toBe(200)
  expect((await h.me(bearer(old))).status).toBe(200)
})

test('public backoff is checked again after concurrent body reads; logout spends bootstrap burst', async () => {
  const h = authServer({ EXPOSURE: 'public', ORIGIN: 'https://gym.example', DEVICE_TOKENS: '1' })
  const results = await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      h.post('/api/pair/redeem', {}, { code: 'WRONG' + i }),
    ),
  )
  expect(results.filter((r) => r.status === 400)).toHaveLength(11)
  expect(results.filter((r) => r.status === 429)).toHaveLength(14)
  h.clock.t += 60000
  for (let i = 0; i < 30; i++)
    expect((await h.post('/api/logout')).status).toBe(200)
  expect((await h.post('/api/logout')).status).toBe(429)
})
