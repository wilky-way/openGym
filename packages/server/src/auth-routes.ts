import { ROUTE_POLICY } from '@opengym/contract/http/api'
import type { GymApp } from './app'
import type { AuthService, Session } from './auth'
import { cookieHeaders } from './auth'
import { ApiError, json } from './http'
import { deviceResponse, listDevices } from './storage/devices'

// Agent devices carry coaching/data authority, never the owner's identity or
// administrator authority. Keep this allowlist explicit: a newly mounted route
// must not silently become another way to mint a less restricted credential.
// Keys use the same undecoded, base-path-relative routing as ROUTE_POLICY.
const agentRoutes: ReadonlySet<string> = new Set([
  'GET /api/health', 'GET /api/config', 'GET /api/me',
  'GET /api/data', 'GET /api/data/rev', 'GET /api/data/activity', 'PUT /api/data',
  'GET /api/programmes/library', 'GET /api/programmes/library/:id',
  'GET /api/programmes/library/:id/versions', 'PUT /api/programmes/library/:id',
  'POST /api/programmes/validate', 'POST /api/progression/validate',
  'POST /api/progression/preview', 'POST /api/progression/apply',
])
const agentCapability = (session: Session | null, key: string): void => {
  if (session?.device.kind === 'agent' && !agentRoutes.has(key))
    throw new ApiError(403, 'forbidden')
}

const cookieResponse = (body: unknown, headers: Headers): Response => {
  const response = json(200, body)
  for (const cookie of headers.getSetCookie())
    response.headers.append('Set-Cookie', cookie)
  return response
}
const text = (value: unknown) =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : ''
export function installAuth(app: GymApp, auth: AuthService): void {
  const required = (s: Session | null): Session => {
    if (!s) throw new ApiError(401, 'not signed in')
    return s
  }
  app.use('*', async (c, next) => {
    // This raw Request pathname also drives Hono routing. Never decode an auth policy key.
    const key = c.get('routeKey')
    const policy = ROUTE_POLICY[key as keyof typeof ROUTE_POLICY]
    const session = auth.sessionOf(c.req.raw)
    c.set('session', session)
    agentCapability(session, key)
    if (policy?.auth === 'session' || policy?.auth === 'admin')
      required(session)
    if (policy?.auth === 'admin' && !auth.publicUser(session!.user).admin) {
      auth.audit('admin.denied', session!, false, null, c.req.raw)
      throw new ApiError(403, 'forbidden')
    }
    const rates: readonly string[] =
      policy && 'rate' in policy ? (policy.rate ?? []) : []
    const bootstrap = policy?.auth === 'none' && c.req.raw.method === 'POST'
    if (bootstrap || rates.includes('burst'))
      auth.limit(
        c.req.raw,
        key === 'POST /api/pair/redeem'
          ? 'pair'
          : rates.find((r) => r.startsWith('fails:'))?.slice(6),
      )
    if (session?.legacyCookie && !auth.migrateCookie(session, c.req.raw)) required(null)
    if (policy) await c.get('body').receipt()
    // The body can arrive after a disable/revocation. Never dispatch with its old session.
    const current = auth.sessionOf(c.req.raw)
    c.set('session', current)
    agentCapability(current, key)
    if (policy?.auth === 'session' || policy?.auth === 'admin') required(current)
    if (policy?.auth === 'admin' && !auth.publicUser(current!.user).admin) throw new ApiError(403, 'forbidden')
    await next()
    if (session?.legacyCookie) {
      // Route cookies (sign-in/logout/self-revoke) take precedence; never resurrect a
      // session the handler just cleared. Re-check after awaited handlers before renewal.
      const routeCookies = c.res.headers.getSetCookie().some(value => /^(?:__Host-)?gymsid=/.test(value))
      const issue = !routeCookies && !!auth.sessionOf(c.req.raw)
      // Upgrade cookie scope without changing the device id returned/renamed by this handler.
      if (issue) for (const value of cookieHeaders(auth.config, session.token).getSetCookie())
        c.res.headers.append('Set-Cookie', value)
    }
  })
  app.get('/api/me', (c) => {
    const s = required(c.get('session'))
    const token =
      s.bearer && s.exp - auth.now() < (auth.config.sessionDays * 86400000) / 2
        ? auth.renew(s)
        : undefined
    return json(200, {
      user: auth.publicUser(s.user),
      ...(token ? { token } : {}),
    })
  })
  app.post('/api/logout', (c) => {
    const s = c.get('session')
    if (s) {
      auth.logout(s)
      auth.audit('auth.logout', s, true, null, c.req.raw)
    }
    return cookieResponse({ ok: true }, cookieHeaders(auth.config))
  })
  app.post('/api/logout/all', (c) => {
    const s = required(c.get('session'))
    auth.logoutAll(s)
    auth.audit('auth.logout.all', s, true, null, c.req.raw)
    return cookieResponse({ ok: true }, cookieHeaders(auth.config))
  })
  app.post('/api/pair/create', (c) => {
    const s = required(c.get('session')),
      code = auth.createPair(s)
    auth.audit('auth.pair.create', s, true, null, c.req.raw)
    return json(200, { code })
  })
  app.post('/api/pair/redeem', async (c) => {
    const body = await c.get('body').readJson()
    auth.checkFailure(c.req.raw, 'pair')
    const result = auth.redeem(text(body.code).trim().toUpperCase(), c.req.raw)
    if (!result) {
      auth.failed(c.req.raw, 'pair')
      return json(400, {
        error: 'invalid or expired code',
        code: 'pair-invalid',
      })
    }
    const s = auth.sessionOf(
      new Request('http://auth/', {
        headers: { Authorization: 'Bearer ' + result.token },
      }),
    )
    if (s) auth.audit('auth.pair.ok', s, true, null, c.req.raw)
    return json(200, result)
  })
  app.get('/api/account/devices', (c) => {
    const s = required(c.get('session'))
    return json(200, {
      devices: listDevices(auth.db, s.user.id).map(deviceResponse),
      current: s.device.id,
    })
  })
  app.post('/api/account/devices/rename', async (c) => {
    const body = await c.get('body').readJson()
    const s = required(auth.sessionOf(c.req.raw))
    const id = text(body.id),
      name = text(body.name).trim().slice(0, 40)
    if (!id || !name) throw new ApiError(400, 'bad request')
    if (
      !auth.db
        .query('UPDATE devices SET name=? WHERE id=? AND user_id=?')
        .run(name, id, s.user.id).changes
    )
      throw new ApiError(404, 'not found')
    return json(200, { ok: true })
  })
  app.post('/api/account/devices/revoke', async (c) => {
    const body = await c.get('body').readJson()
    const s = required(auth.sessionOf(c.req.raw)),
      id = text(body.id)
    if (!id) throw new ApiError(400, 'bad request')
    if (!auth.revokeDevice(id, s.user.id))
      throw new ApiError(404, 'not found')
    return id === s.device.id
      ? cookieResponse({ ok: true }, cookieHeaders(auth.config))
      : json(200, { ok: true })
  })
}
