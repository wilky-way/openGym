import { createHash } from 'node:crypto'
import { call, expect, jsonOf, type Ctx, type GoldenScenario } from './helpers'
import { DELETED_ROUTES } from '../../../contract/http/api'

/** Random per-run values the normaliser maps to placeholders (replayed as the same identity). */
export const ROUTE_IDENTITY_FIELDS: Record<string, string> = {
  'POST /api/pair/create#/code': 'pair-code',
  'POST /api/pair/redeem#/code': 'pair-code',
  'POST /api/admin/invites/new#/invite/code': 'invite-code',
  'POST /api/admin/invites/revoke#/code': 'invite-code',
  'GET /api/admin/invites#/invites/0/code': 'invite-code',
  'POST /api/register/options#/cid': 'cid',
  'POST /api/register/options#/options/challenge': 'challenge',
  'POST /api/register/options#/options/user/id': 'webauthn-user',
  'POST /api/login/options#/cid': 'cid',
  'POST /api/login/options#/options/challenge': 'challenge',
  'POST /api/account/passkeys/options#/cid': 'cid',
  'POST /api/account/passkeys/options#/options/challenge': 'challenge',
  'POST /api/account/device-link#/code': 'device-code',
  'POST /api/device-link/options#/cid': 'cid',
  'POST /api/device-link/options#/options/challenge': 'challenge',
  'GET /api/push/public-key#/key': 'vapid-public-key',
}

export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
export const PNG_SHA = createHash('sha256').update(PNG_1X1).digest('hex')

/** Health, config, identity, logout and session revocation (routes only; invariants are in data/stamping). */
export const routesSession: GoldenScenario = {
  id: 'routes-session', seed: 20261010, invs: [],
  routes: ['GET /api/health', 'GET /api/config', 'GET /api/me', 'POST /api/logout', 'POST /api/logout/all'],
  async run(ctx: Ctx) {
    expect((await call(ctx, 'GET', '/api/health', { anonymous: true })).status === 200, 'health answers anonymously')
    const anonConfig = jsonOf(await call(ctx, 'GET', '/api/config', { anonymous: true }))
    expect(anonConfig.signedIn === undefined, 'signedIn absent for anonymous callers')
    // This legacy snapshot's /api/config carries no `coach` or `signedIn` key for either caller; the
    // contract's `signedIn` is therefore a new-server field, not a legacy behaviour (see api-test-map.md).
    const signedConfig = jsonOf(await call(ctx, 'GET', '/api/config'))
    expect(signedConfig.coach === undefined && signedConfig.signedIn === undefined, 'legacy config has no session presence key')
    expect((await call(ctx, 'GET', '/api/me', { anonymous: true })).status === 401, '/api/me is 401 anonymously')
    expect((await call(ctx, 'GET', '/api/me', { bearer: true })).status === 200, 'Bearer session reads /api/me')
    expect((await call(ctx, 'POST', '/api/logout', { anonymous: true })).status === 200, 'logout is idempotent for anonymous callers')
    // logout/all bumps the session version: the old session stops working.
    expect((await call(ctx, 'POST', '/api/logout/all')).status === 200, 'logout/all accepted')
    expect((await call(ctx, 'GET', '/api/me')).status === 401, 'pre-logout-all session is revoked')
  }
}

/** Passkey and device-link options, plus the refusals that need no signature (negative paths only). */
export const routesPasskeyNegative: GoldenScenario = {
  id: 'routes-passkey-negative', seed: 20261011, invs: [],
  routes: [
    'POST /api/register/options', 'POST /api/register/verify', 'POST /api/login/options', 'POST /api/login/verify',
    'GET /api/account/passkeys', 'POST /api/account/passkeys/options', 'POST /api/account/passkeys/verify',
    'POST /api/account/passkeys/rename', 'DELETE /api/account/passkeys', 'POST /api/account/device-link',
    'POST /api/device-link/options', 'POST /api/device-link/verify'
  ],
  async run(ctx: Ctx) {
    expect((await call(ctx, 'GET', '/api/account/passkeys')).status === 200, 'passkey list for a session')
    expect((await call(ctx, 'GET', '/api/account/passkeys', { anonymous: true })).status === 401, 'passkey list is 401 anonymously')
    const reg = await call(ctx, 'POST', '/api/register/options', { body: { name: 'Synthetic phone' }, anonymous: true })
    expect(reg.status === 200 && jsonOf<{ cid: string }>(reg).cid !== undefined, 'register options issue a challenge')
    expect((await call(ctx, 'POST', '/api/register/verify', { anonymous: true, body: { cid: 'unknown', credential: {} } })).status >= 400, 'register verify refuses an unknown challenge')
    expect((await call(ctx, 'POST', '/api/login/options', { anonymous: true, body: {} })).status === 200, 'login options issue a challenge')
    expect((await call(ctx, 'POST', '/api/login/verify', { anonymous: true, body: { cid: 'unknown', credential: {} } })).status >= 400, 'login verify refuses an unknown challenge')
    expect((await call(ctx, 'POST', '/api/account/passkeys/options', { body: { cid: 'unknown', credential: {} } })).status >= 400, 'passkey options need a step-up proof')
    expect((await call(ctx, 'POST', '/api/account/passkeys/verify', { body: { cid: 'unknown', credential: {} } })).status >= 400, 'passkey verify refuses an unknown challenge')
    expect((await call(ctx, 'POST', '/api/account/passkeys/rename', { body: { id: 'missing', name: 'x' } })).status >= 400, 'rename of an unknown passkey refused')
    expect((await call(ctx, 'DELETE', '/api/account/passkeys', { body: { cid: 'unknown', credential: {} } })).status >= 400, 'passkey delete needs a step-up proof')
    expect((await call(ctx, 'POST', '/api/account/device-link', { body: { cid: 'unknown', credential: {} } })).status >= 400, 'device link needs a step-up proof')
    expect((await call(ctx, 'POST', '/api/device-link/options', { anonymous: true, body: { code: 'NOPE0000' } })).status >= 400, 'unknown device-link code refused')
    expect((await call(ctx, 'POST', '/api/device-link/verify', { anonymous: true, body: { code: 'NOPE0000', cid: 'x', credential: {} } })).status >= 400, 'device-link verify refuses an unknown code')
  }
}

/** Pairing code issue, owner-authenticated Bearer token and single-use redeem. */
export const routesPairing: GoldenScenario = {
  id: 'routes-pairing', seed: 20261012, invs: [],
  routes: ['POST /api/pair/create', 'POST /api/pair/redeem', 'GET /api/me'],
  async run(ctx: Ctx) {
    expect((await call(ctx, 'POST', '/api/pair/create', { anonymous: true })).status === 401, 'pair create needs a session')
    const created = jsonOf<{ code: string }>(await call(ctx, 'POST', '/api/pair/create'))
    expect(/^[A-HJ-NP-Z2-9]{8}$/.test(created.code), 'pair code is 8 characters from the unambiguous alphabet')
    const redeemed = await call(ctx, 'POST', '/api/pair/redeem', { anonymous: true, body: { code: created.code } })
    expect(redeemed.status === 200, 'pair code redeems once')
    const { token } = jsonOf<{ token: string }>(redeemed)
    const me = await call(ctx, 'GET', '/api/me', { anonymous: true, headers: { Authorization: `Bearer ${token}` } })
    expect(me.status === 200 && jsonOf<{ user: { id: string } }>(me).user.id === ctx.uid, 'redeemed Bearer authenticates the pairing owner')
    expect((await call(ctx, 'POST', '/api/pair/redeem', { anonymous: true, body: { code: created.code } })).status >= 400, 'pair code is single-use')
    expect((await call(ctx, 'POST', '/api/pair/redeem', { anonymous: true, body: { code: 'ZZZZZZZZ' } })).status >= 400, 'unknown pair code refused')
  }
}

/** Presence, push routes (negative/local paths only: nothing is sent to a push service). */
export const routesPushPresence: GoldenScenario = {
  id: 'routes-push-presence', seed: 20261013, invs: [],
  routes: [
    'GET /api/push/public-key', 'POST /api/push/subscribe', 'GET /api/push/status', 'POST /api/push/unsubscribe',
    'POST /api/push/test', 'POST /api/push/rest-timer', 'POST /api/push/rest-timer/cancel', 'POST /api/activity'
  ],
  async run(ctx: Ctx) {
    expect(typeof jsonOf<{ key: string }>(await call(ctx, 'GET', '/api/push/public-key', { anonymous: true })).key === 'string', 'VAPID public key served')
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/synthetic-1', keys: { p256dh: 'BPh2eGFrZS1wdWJsaWMta2V5LW1hdGVyaWFs', auth: 'c3ludGhldGljYXV0aA' } }
    expect((await call(ctx, 'POST', '/api/push/subscribe', { body: { subscription: { endpoint: 'http://fcm.googleapis.com/x', keys: sub.keys } } })).status === 400, 'non-https endpoint refused')
    expect((await call(ctx, 'POST', '/api/push/subscribe', { body: { subscription: sub, deviceId: 'dev-1' } })).status === 200, 'push subscription stored')
    expect(jsonOf<{ subscribed: boolean }>(await call(ctx, 'GET', `/api/push/status?endpoint=${encodeURIComponent(sub.endpoint)}`)).subscribed === true, 'status reports the subscription')
    // A rest timer is armed far in the future and cancelled before it can fire: nothing is sent.
    expect((await call(ctx, 'POST', '/api/push/rest-timer', { body: { seconds: 3600, deviceId: 'dev-1' } })).status === 200, 'rest timer armed')
    expect((await call(ctx, 'POST', '/api/push/rest-timer/cancel', { body: { deviceId: 'dev-1' } })).status === 200, 'rest timer cancelled')
    // Test push for a user with no subscription: refused locally, nothing leaves the server.
    // Legacy: a test push to a user with no subscription is 200 and sends nothing.
    expect((await call(ctx, 'POST', '/api/push/test', { as: ctx.profile.db.users[1]!.id, body: {} })).status === 200, 'test push with no subscriptions sends nothing')
    expect((await call(ctx, 'POST', '/api/activity', { body: { active: true, name: 'Synthetic session', exIdx: 0, exTotal: 1, setsDone: 0, setsTotal: 3 } })).status === 200, 'live activity recorded')
    expect((await call(ctx, 'POST', '/api/push/unsubscribe', { body: { endpoint: sub.endpoint } })).status === 200, 'unsubscribe')
    expect(jsonOf<{ subscribed: boolean }>(await call(ctx, 'GET', `/api/push/status?endpoint=${encodeURIComponent(sub.endpoint)}`)).subscribed === false, 'status after unsubscribe')
  }
}

/** Media is deleted by the GM ruling; all four former routes answer 404. */
export const routesMedia: GoldenScenario = {
  id: 'routes-media', seed: 20261014, invs: [],
  routes: ['PUT /api/media/:hash', 'GET /api/media/:hash', 'POST /api/media/missing', 'POST /api/media/sweep'],
  async run(ctx: Ctx) {
    for (const key of this.routes) {
      const [method, path] = key.split(' ') as [string, string]
      const response = await call(ctx, method, path.replace(':hash', PNG_SHA), method === 'GET' ? {} : { body: {} })
      expect(response.status === 404 && jsonOf<{ error: string }>(response).error === 'not found', `${key} is deleted: 404 not found`)
    }
  }
}

/** Admin routes for the synthetic admin, refusal for a non-admin user. */
export const routesAdmin: GoldenScenario = {
  id: 'routes-admin', seed: 20261015, invs: [],
  routes: [
    'GET /api/admin/users', 'GET /api/admin/user', 'POST /api/admin/user/disable', 'POST /api/admin/user/delete',
    'GET /api/admin/invites', 'POST /api/admin/invites/new', 'POST /api/admin/invites/revoke', 'GET /api/admin/audit', 'POST /api/admin/audit/clear'
  ],
  async run(ctx: Ctx) {
    const other = ctx.profile.db.users[1]!.id
    const denied = await call(ctx, 'GET', '/api/admin/users', { as: other })
    expect(denied.status === 403, `non-admin refused, got ${denied.status} ${Buffer.from(denied.body.data, 'utf8').toString().slice(0, 120)}`)
    const users = jsonOf<{ users: { id: string }[] }>(await call(ctx, 'GET', '/api/admin/users'))
    expect(users.users.length >= 2, 'admin lists users')
    expect((await call(ctx, 'GET', `/api/admin/user?id=${other}`)).status === 200, 'admin reads a user')
    expect((await call(ctx, 'POST', '/api/admin/user/disable', { body: { id: other, disabled: true } })).status === 200, 'admin disables a user')
    expect((await call(ctx, 'POST', '/api/admin/user/disable', { body: { id: other, disabled: false } })).status === 200, 'admin re-enables a user')
    // Read before any invite exists: audit messages echo invite codes, which are per-run random.
    expect((await call(ctx, 'GET', '/api/admin/audit?limit=5')).status === 200, 'audit page read')
    const invite = jsonOf<{ invite: { code: string } }>(await call(ctx, 'POST', '/api/admin/invites/new', { body: { note: 'synthetic' } }))
    expect(typeof invite.invite.code === 'string', 'invite created')
    expect((await call(ctx, 'GET', '/api/admin/invites')).status === 200, 'invites listed')
    expect((await call(ctx, 'POST', '/api/admin/invites/revoke', { body: { code: invite.invite.code } })).status === 200, 'invite revoked')
    expect((await call(ctx, 'POST', '/api/admin/audit/clear')).status === 200, 'audit cleared')
    expect((await call(ctx, 'POST', '/api/admin/user/delete', { body: { id: other } })).status === 200, 'admin deletes a user')
  }
}

/** Every legacy password/Coach/native route answers 404 {error:'not found'} (contract DELETED_ROUTES). */
export const routesDeleted: GoldenScenario = {
  id: 'routes-deleted', seed: 20261016, invs: [],
  routes: DELETED_ROUTES.filter(key => !key.includes('/api/media/')),
  async run(ctx: Ctx) {
    for (const key of this.routes) {
      const [method, path] = key.split(' ') as [string, string]
      // GET has no body; every other method sends an empty JSON object.
      const r = await call(ctx, method, path, method === 'GET' ? {} : { body: {} })
      expect(r.status === 404 && jsonOf<{ error: string }>(r).error === 'not found', `${key} is 404 not found`)
    }
  }
}

/** Origin checks: a cross-origin write is refused before its handler runs. */
export const routesCsrf: GoldenScenario = {
  id: 'routes-csrf', seed: 20261017, invs: [],
  routes: ['POST /api/activity'],
  async run(ctx: Ctx) {
    expect((await call(ctx, 'POST', '/api/activity', { body: { active: false }, headers: { Origin: 'https://evil.example' } })).status === 403, 'cross-origin write refused')
    expect((await call(ctx, 'POST', '/api/activity', { body: { active: false } })).status === 200, 'same-origin write accepted')
  }
}

export const routeScenarios: GoldenScenario[] = [
  routesSession, routesPasskeyNegative, routesPairing, routesPushPresence, routesMedia, routesAdmin, routesDeleted, routesCsrf
]
