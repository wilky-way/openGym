import { expect, test } from 'bun:test'
import { authServer, bearer, DAY } from './auth-helpers'
import { createApp } from '../src/app'
import { RequestBody } from '../src/http'
import { getUser } from '../src/storage'
import { getDevice, listDevices } from '../src/storage/devices'
import { dataServer } from './data-helpers'
import { raw } from './helpers'

// Exercise real handlers, including anonymous bootstrap handlers: possessing an
// agent credential must never mint a browser/paired carrier or manage identity.
const identityRoutes = [
  'POST /api/register/options', 'POST /api/register/verify',
  'POST /api/login/options', 'POST /api/login/verify',
  'POST /api/logout', 'POST /api/logout/all',
  'POST /api/pair/create', 'POST /api/pair/redeem',
  'GET /api/account/passkeys', 'POST /api/account/passkeys/options',
  'POST /api/account/passkeys/verify', 'POST /api/account/passkeys/rename',
  'DELETE /api/account/passkeys', 'POST /api/account/device-link',
  'POST /api/device-link/options', 'POST /api/device-link/verify',
  'GET /api/account/devices', 'POST /api/account/devices/rename',
  'POST /api/account/devices/revoke',
  'GET /api/admin/users', 'GET /api/admin/user',
  'POST /api/admin/user/disable', 'POST /api/admin/user/delete',
  'GET /api/admin/invites', 'POST /api/admin/invites/new',
  'POST /api/admin/invites/revoke', 'GET /api/admin/audit',
  'POST /api/admin/audit/clear',
]

for (const transport of ['bearer', 'cookie'] as const) {
  test(`agent ${transport} cannot access any identity/admin route, even for an admin owner`, async () => {
    const h = authServer({ DEVICE_TOKENS: '1' })
    h.db.query('UPDATE users SET admin=1 WHERE id=?').run('u_phone')
    const token = h.auth.mint(getUser(h.db, 'u_phone')!, 'agent')
    const headers = transport === 'bearer' ? bearer(token) : { Cookie: 'gymsid=' + token }
    for (const key of identityRoutes) {
      const [method, path] = key.split(' ') as [string, string]
      const response = await fetch(h.api + path, { method, headers,
        ...(method === 'GET' ? {} : { body: '{}' }) })
      expect({ route: key, status: response.status }).toEqual({ route: key, status: 403 })
      expect(await response.json()).toEqual({ error: 'forbidden' })
      expect(response.headers.getSetCookie()).toHaveLength(0)
    }
    expect(listDevices(h.db, 'u_phone')).toHaveLength(1)
    expect(getUser(h.db, 'u_phone')).toMatchObject({ admin: 1, disabled: 0, sv: 0 })
  })
}

test('agent cannot redeem a valid browser-created pairing, and refusal does not consume it', async () => {
  const h = authServer({ DEVICE_TOKENS: '1' }), u = getUser(h.db, 'u_phone')!
  const browser = h.auth.mint(u, 'browser'), agent = h.auth.mint(u, 'agent')
  const { code } = await (await h.post('/api/pair/create', bearer(browser))).json()
  const refused = await h.post('/api/pair/redeem', bearer(agent), { code })
  expect(refused.status).toBe(403)
  expect(listDevices(h.db, u.id)).toHaveLength(2)
  const redeemed = await h.post('/api/pair/redeem', {}, { code })
  expect(redeemed.status).toBe(200)
  const token = (await redeemed.json()).token
  expect(h.auth.sessionOf(new Request('http://gym/', { headers: bearer(token) }))?.device.kind).toBe('paired')
  expect((await h.me(bearer(token))).status).toBe(200)
})

test('agent identity renewal retains its own device id/kind and cannot upgrade authority', async () => {
  const h = authServer({ DEVICE_TOKENS: '1' }), u = getUser(h.db, 'u_phone')!
  const agent = h.auth.mint(u, 'agent'), id = agent.split('.')[1]!
  h.clock.t += 6 * DAY
  const response = await h.me(bearer(agent))
  expect(response.status).toBe(200)
  const renewed = (await response.json()).token
  expect(renewed).toBeString()
  expect(renewed).not.toBe(agent)
  expect(renewed.split('.')[1]).toBe(id)
  expect(getDevice(h.db, id)?.kind).toBe('agent')
  expect(listDevices(h.db, u.id)).toHaveLength(1)
  expect((await h.post('/api/pair/create', bearer(renewed))).status).toBe(403)
})

test('browser and paired devices retain their identity/admin permissions', async () => {
  const h = authServer({ DEVICE_TOKENS: '1' })
  h.db.query('UPDATE users SET admin=1 WHERE id=?').run('u_phone')
  for (const kind of ['browser', 'paired'] as const) {
    const token = h.auth.mint(getUser(h.db, 'u_phone')!, kind)
    expect((await fetch(h.api + '/api/admin/users', { headers: bearer(token) })).status).toBe(200)
    expect((await fetch(h.api + '/api/account/devices', { headers: bearer(token) })).status).toBe(200)
    expect((await h.post('/api/pair/create', bearer(token))).status).toBe(200)
    expect((await h.post('/api/logout', bearer(token))).status).toBe(200)
  }
})

test('agent data reads and conditional writes remain available', async () => {
  const h = dataServer(), token = h.auth.mint(getUser(h.db, 'u1')!, 'agent')
  // W36 composition: data authority remains usable only after a trusted device
  // establishes idle. Capability admission must not bypass an unknown guard.
  const browser = h.auth.mint(getUser(h.db, 'u1')!, 'browser')
  const seed = h.data.get('u1')
  expect((await fetch(h.api + '/api/data', { method: 'PUT', headers: bearer(browser),
    body: JSON.stringify({ state: { unit: 'lb', routines: [], workouts: [], active: null }, baseRev: seed.rev, baseWid: seed.state?._wid ?? null }) })).status).toBe(200)
  const read = await fetch(h.api + '/api/data', { headers: bearer(token) })
  expect(read.status).toBe(200)
  const got = await read.json()
  const put = await fetch(h.api + '/api/data', { method: 'PUT', headers: bearer(token),
    body: JSON.stringify({ state: { unit: 'lb', routines: [], workouts: [] }, baseRev: got.rev, baseWid: got.state?._wid ?? null }) })
  expect(put.status).toBe(200)
  expect((await fetch(h.api + '/api/data/rev', { headers: bearer(token) })).status).toBe(200)
})

test('agent capabilities fail closed for newly mounted routes absent from policy', async () => {
  const h = authServer(), token = h.auth.mint(getUser(h.db, 'u_phone')!, 'agent')
  let invoked = false
  const app = createApp(h.config, { auth: h.auth, routes: a => {
    a.post('/api/future-token-mint', () => { invoked = true; return new Response('unexpected') })
  } })
  expect((await app.request('/api/future-token-mint', { method: 'POST', headers: bearer(token) })).status).toBe(403)
  expect(invoked).toBe(false)
})

test('capability is rechecked after body receipt before dispatching an identity mutation', async () => {
  const h = authServer(), token = h.auth.mint(getUser(h.db, 'u_phone')!, 'browser')
  const request = new Request('http://gym/api/account/devices/rename', { method: 'POST', headers: bearer(token) })
  let started!: () => void, release!: () => void
  const reading = new Promise<void>(r => { started = r }), ready = new Promise<void>(r => { release = r })
  class DelayedBody extends RequestBody {
    override async receipt() { started(); await ready }
    override async readJson() { return { id: token.split('.')[1], name: 'Changed' } }
  }
  const app = createApp(h.config, { auth: h.auth })
  const pending = app.fetch(request, { body: new DelayedBody(request, 1000) })
  await reading
  h.db.query("UPDATE devices SET kind='agent' WHERE id=?").run(token.split('.')[1]!)
  release()
  expect((await pending).status).toBe(403)
  expect(getDevice(h.db, token.split('.')[1]!)?.name).toBe('')
})

test('base paths and raw target aliases cannot bypass the agent identity boundary', async () => {
  const h = authServer({ BASE_PATH: '/gym' })
  h.db.query('UPDATE users SET admin=1 WHERE id=?').run('u_phone')
  const token = h.auth.mint(getUser(h.db, 'u_phone')!, 'agent')
  // Network-path requests use legacy URL parsing; encoded names must not be
  // decoded into an identity handler with a different authorization key.
  for (const path of ['/gym/api/admin/users', '//other/gym/api/admin/users',
    '/gym/api/%61dmin/users', '/gym/api/admin%2fusers', '/gym//api/admin/users']) {
    const response = await raw(Number(new URL(h.api).port), path, 'GET', bearer(token))
    expect(response.split('\r\n')[0]).not.toContain(' 200 ')
  }
  expect((await fetch(h.api + '/gym/api/me', { headers: bearer(token) })).status).toBe(200)
})
