import { test, expect } from 'bun:test'
import { createApp } from '../src/app'
import { authServer, bearer, cookie } from './auth-helpers'
import { getUser } from '../src/storage'

// Deterministic HTTP transcripts cover every authentication route. Random token and device ids are
// replaced with positional references; credential bytes never enter a durable fixture.
test('auth route transcript: me, pairing, registry, logout and logout-all', async () => {
  const h = authServer({ DEVICE_TOKENS: '1', ORIGIN: 'https://gym.example' })
  const actor = h.auth.mint(getUser(h.db, 'u_phone')!, 'browser'),
    aid = actor.split('.')[1]
  const unauth = await h.me({})
  expect({ status: unauth.status, body: await unauth.json() }).toEqual({
    status: 401,
    body: { error: 'not signed in' },
  })
  const me = await h.me(bearer(actor))
  expect({ status: me.status, body: await me.json() }).toEqual({
    status: 200,
    body: { user: { id: 'u_phone', name: 'name-u_phone', admin: false } },
  })
  const create = await h.post('/api/pair/create', bearer(actor))
  expect(create.status).toBe(200)
  const code = (await create.json()).code
  expect(
    Object.keys(await (await h.post('/api/pair/create', bearer(actor))).json()),
  ).toEqual(['code'])
  const newest = (
    await (await h.post('/api/pair/create', bearer(actor))).json()
  ).code
  const redeem = await h.post('/api/pair/redeem', {}, { code: newest })
  const redeemed = await redeem.json(),
    paired = redeemed.token,
    pid = paired.split('.')[1]
  expect({
    status: redeem.status,
    body: { ...redeemed, token: '<token:paired>' },
  }).toEqual({
    status: 200,
    body: {
      token: '<token:paired>',
      user: { id: 'u_phone', name: 'name-u_phone', admin: false },
    },
  })
  const gone = await h.post('/api/pair/redeem', {}, { code })
  expect({ status: gone.status, body: await gone.json() }).toEqual({
    status: 400,
    body: { error: 'invalid or expired code', code: 'pair-invalid' },
  })
  const listing = await fetch(h.api + '/api/account/devices', {
      headers: bearer(actor),
    }),
    registry = await listing.json()
  const normalDevice = (d: {
    id: string
    kind: string
    name: string
    created: number
    lastSeen: number
    revokedAt: null
  }) => ({ ...d, id: d.id === aid ? '<device:browser>' : '<device:paired>' })
  expect({
    status: listing.status,
    current: registry.current === aid ? '<device:browser>' : '?',
    devices: registry.devices
      .map(normalDevice)
      .sort((a: { kind: string }, b: { kind: string }) =>
        a.kind.localeCompare(b.kind),
      ),
  }).toEqual({
    status: 200,
    current: '<device:browser>',
    devices: [
      {
        id: '<device:browser>',
        name: '',
        kind: 'browser',
        created: h.clock.t,
        lastSeen: h.clock.t,
        revokedAt: null,
      },
      {
        id: '<device:paired>',
        name: '',
        kind: 'paired',
        created: h.clock.t,
        lastSeen: h.clock.t,
        revokedAt: null,
      },
    ],
  })
  for (const [path, body] of [
    ['/api/account/devices/rename', { id: pid, name: 'Phone' }],
    ['/api/account/devices/revoke', { id: pid }],
  ] as const) {
    const r = await h.post(path, bearer(actor), body)
    expect({ status: r.status, body: await r.json() }).toEqual({
      status: 200,
      body: { ok: true },
    })
  }
  const denied = await h.me(bearer(paired))
  expect({ status: denied.status, body: await denied.json() }).toEqual({
    status: 401,
    body: { error: 'not signed in' },
  })
  const all = await h.post('/api/logout/all', bearer(actor))
  expect({
    status: all.status,
    body: await all.json(),
    cookies: all.headers.getSetCookie(),
  }).toEqual({
    status: 200,
    body: { ok: true },
    cookies: [
      '__Host-gymsid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      'gymsid=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    ],
  })
  const out = await h.post('/api/logout')
  expect({
    status: out.status,
    body: await out.json(),
    cookies: out.headers.getSetCookie(),
  }).toEqual({
    status: 200,
    body: { ok: true },
    cookies: all.headers.getSetCookie(),
  })
  const config = await fetch(h.api + '/api/config', {
    headers: cookie('u_test_1'),
  })
  expect(await config.json()).toEqual({
    invite_only: false,
    allow_guest: true,
    signedIn: true,
  })
})

test('shared raw policy key protects dynamic routes and admin routes supplied by later units', async () => {
  const h = authServer()
  const app = createApp(h.config, {
    auth: h.auth,
    routes: (a) => {
      a.get('/api/programmes/library/:id', () => new Response('protected'))
      a.get('/api/admin/users', () => new Response('admin'))
    },
  })
  expect((await app.request('/api/programmes/library/example')).status).toBe(
    401,
  )
  expect(
    (
      await app.request('/api/programmes/library/example', {
        headers: cookie('u_phone'),
      })
    ).status,
  ).toBe(200)
  expect(
    (await app.request('/api/admin/users', { headers: cookie('u_phone') }))
      .status,
  ).toBe(403)
  expect(
    (
      await app.request('/api/programmes/libr%61ry/example', {
        headers: cookie('u_phone'),
      })
    ).status,
  ).toBe(404)
})
