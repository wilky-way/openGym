import { test, expect, afterEach } from 'bun:test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import http from 'node:http'
import fc from 'fast-check'
import { ROUTE_POLICY, DELETED_ROUTES } from '@opengym/contract/http/api'
import { createApp, appNotifications } from '../src/app'
import { createAuth } from '../src/auth'
import { loadConfig } from '../src/config'
import { openStore, putUser, putInvite, putSub, getUser } from '../src/storage'
import { DataService } from '../src/data'
import { createNotifications } from '../src/notifications'
import { createBackoff, createWindow } from '../src/rate-limit'
import { errorResponse } from '../src/http'
import { bootAddress } from '../src/security-headers'
import { startServer } from '../src/index'
import { scratchDir, user } from './helpers'
import { softPasskey } from './passkey-helpers'

const CLOCK = Date.parse('2026-10-01T20:05:00Z')
const snapshot = {
  'content-security-policy': "frame-ancestors 'none'",
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
}
const snapshotOf = (response: Response) => Object.fromEntries(Object.keys(snapshot).map(key => [key, response.headers.get(key)]))
function fixture() {
  const dataDir = scratchDir(), store = openStore(dataDir), log: string[] = [], clock = { t: CLOCK }
  const config = loadConfig({ DATA_DIR: dataDir, PORT: '0', HOST: '127.0.0.1', ORIGIN: 'http://localhost:8080' })
  const auth = createAuth(store.db, config, { now: () => clock.t, log: line => log.push(line) })
  putUser(store.db, user('s11-admin', 0, { admin: 1 }))
  const notifications = createNotifications(auth, { log: line => log.push(line), send: async () => { throw new Error('synthetic-transport-secret') } })
  const services = { auth, notifications, data: new DataService(store.db, dataDir, { now: () => clock.t, log: line => log.push(line) }), log: (line: string) => log.push(line), writable: () => true }
  const app = createApp(config, services)
  const token = () => auth.mint(getUser(store.db, 's11-admin')!)
  const req = (method: string, path: string, body?: string, headers: Record<string, string> = {}) => app.request(path, {
    method, headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers }, ...(body === undefined ? {} : { body }),
  })
  afterEach(() => { appNotifications(app)?.close(); auth.auditLog.close(); store.close() })
  return { dataDir, store, config, services, auth, app, log, token, req, advance: () => { clock.t += 7200001 } }
}

// Contract-complete route inventory: deleted, future progression, auth and data/library/admin/push.
test('security-header snapshot matches every nginx route class and every contract route', async () => {
  const nginx = readFileSync(join(import.meta.dir, '../../../packages/parity/fixtures/oracle/web/nginx.conf.template'), 'utf8')
  const actual = Object.fromEntries([...nginx.matchAll(/add_header (X-Frame-Options|X-Content-Type-Options|Referrer-Policy|Content-Security-Policy) "([^"]+)" always;/g)].map(m => [m[1]!.toLowerCase(), m[2]]))
  expect(actual).toEqual(snapshot)
  const h = fixture()
  for (const route of [...Object.keys(ROUTE_POLICY), ...DELETED_ROUTES, 'OPTIONS /api/data', 'HEAD /api/health', 'GET /missing']) {
    const [method, target] = route.split(' '), path = target!.replace(':id', 'synthetic').replace(':hash', 'synthetic')
    for (const authenticated of [false, true]) {
      const response = await h.req(method!, path, ['GET', 'HEAD', 'OPTIONS'].includes(method!) ? undefined : '[]', authenticated ? { Authorization: 'Bearer ' + h.token() } : {})
      expect(snapshotOf(response), route).toEqual(snapshot)
    }
  }
  const csrf = await h.req('PUT', '/api/data', '{}', { 'Sec-Fetch-Site': 'cross-site' })
  expect(csrf.status).toBe(403)
  expect(snapshotOf(csrf)).toEqual(snapshot)
  const capped = createApp({ ...h.config, maxBodyBytes: 32 }, h.services)
  const oversized = await capped.request('/api/register/options', { method: 'POST', body: JSON.stringify({ name: 'x'.repeat(64) }) })
  expect(oversized.status).toBe(413); expect(snapshotOf(oversized)).toEqual(snapshot)
  let throttled: Response | undefined
  for (let i = 0; i < 61; i++) throttled = await h.req('POST', '/api/login/options')
  expect(throttled!.status).toBe(429); expect(snapshotOf(throttled!)).toEqual(snapshot)
  const errorApp = createApp(h.config, { routes: app => { app.get('/throw', () => { throw new Error('synthetic-secret') }) }, log: line => h.log.push(line) })
  expect(snapshotOf(await errorApp.request('/throw'))).toEqual(snapshot)
})

// Dial the socket directly, ignoring every HTTP_PROXY / ALL_PROXY environment variable.
function wire(port: number, path: string, method = 'GET', body?: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path, method, agent: false,
      headers: body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body), 'Content-Type': 'application/json' } }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => resolve(new Response(method === 'HEAD' ? null : Buffer.concat(chunks), { status: response.statusCode!, headers: response.headers as Record<string, string> })))
    })
    request.on('error', reject); request.end(body)
  })
}
test('listener snapshot covers static, media, redirect, missing, health refusal and body timeout', async () => {
  const h = fixture(), staticDir = scratchDir()
  writeFileSync(join(staticDir, 'index.html'), '<p>synthetic</p>')
  writeFileSync(join(staticDir, 'app.js'), 'void 0')
  writeFileSync(join(staticDir, 'icon.png'), 'synthetic-image')
  writeFileSync(join(staticDir, 'font.woff2'), 'synthetic-font')
  mkdirSync(join(staticDir, 'exercise-media', 'clip'), { recursive: true })
  writeFileSync(join(staticDir, 'exercise-media', 'x.svg'), '<svg/>')
  writeFileSync(join(staticDir, 'exercise-media', 'clip', '0001.mp4'), 'synthetic-media')
  const server = startServer({ ...h.config, staticDir, bodyTimeoutMs: 50 }, { ...h.services, writable: () => false }, () => {})
  afterEach(() => server.stop(true))
  for (const path of ['/', '/app.js', '/icon.png', '/font.woff2', '/exercise-media/clip/0001.mp4', '/exercise-media/x.svg', '/exercise-media/missing.svg', '/exercise%2Dmedia/missing.svg', '/exercise-media%2Fmissing.svg', '/exercise%2Dmedia/x.svg', '/missing.js', '/private/no.json', '/client-route', '/api/health']) {
    const response = await wire(server.port!, path)
    expect(snapshotOf(response), path).toEqual(snapshot)
    if (decodeURIComponent(path).startsWith('/exercise-media/')) expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin')
    if (path === '/api/health') expect(response.status).toBe(503)
    if (path === '/client-route') { expect(response.status).toBe(302); expect(response.headers.get('Location')).toBe('/') }
    if (['/icon.png', '/font.woff2', '/exercise-media/clip/0001.mp4'].includes(path)) {
      expect(response.status).toBe(200); expect(response.headers.get('Cache-Control')).toContain('immutable')
    }
  }
  // A stalled real socket exercises the listener-level timeout response outside Hono.
  const timeoutResponse = await new Promise<Response>((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port: server.port!, path: '/api/register/options', method: 'POST', agent: false,
      headers: { 'Content-Length': '100', 'Content-Type': 'application/json' } }, response => {
      response.resume(); response.on('end', () => resolve(new Response(null, { status: response.statusCode!, headers: response.headers as Record<string,string> })))
    })
    request.on('error', reject); request.write('{')
  })
  expect(timeoutResponse.status).toBe(408)
  expect(snapshotOf(timeoutResponse)).toEqual(snapshot)
})

test('rate-limit key floods preserve caps, eviction, locked counters and expiry', () => {
  let now = CLOCK
  const window = createWindow({ max: 1, maxKeys: 64, now: () => now })
  const backoff = createBackoff({ free: 2, maxKeys: 64, forgetMs: 100, maxMs: 1000, baseMs: 1000, now: () => now })
  window.take('locked'); window.take('locked')
  backoff.fail('locked'); backoff.fail('locked'); backoff.fail('locked')
  for (let i = 0; i < 20000; i++) {
    window.take('flood-' + i); backoff.fail('flood-' + i)
    expect(window.size).toBeLessThanOrEqual(64)
    expect(backoff.size).toBeLessThanOrEqual(64)
  }
  expect(window.take('locked')).toBeGreaterThan(0)
  expect(backoff.retryAfter('locked')).toBe(1)
  expect(window.size).toBe(64); expect(backoff.size).toBe(64)
  now += 60001; window.sweep(); backoff.sweep()
  expect(window.size).toBe(0); expect(backoff.size).toBe(0)
  const kept = createBackoff({ maxKeys: 8, keep: () => true, now: () => now })
  for (let i = 0; i < 10000; i++) {
    const wait = kept.fail('kept-' + i)
    if (i >= 8) expect(wait).toBeGreaterThan(0)
    expect(kept.size).toBeLessThanOrEqual(8)
  }
  kept.clear('kept-0'); expect(kept.fail('admitted')).toBe(0); expect(kept.size).toBe(8)
  for (const cap of [0, -1, 1.5, NaN, Infinity]) expect(() => createWindow({ maxKeys: cap })).toThrow('maxKeys')
})

// These legacy POSTs deliberately ignore a body. Valid requests may still succeed.
const bodyless = new Set(['POST /api/login/options', 'POST /api/logout', 'POST /api/logout/all', 'POST /api/pair/create', 'POST /api/push/test', 'POST /api/admin/audit/clear'])
test('malformed JSON on every body-consuming route is 4xx; all declared routes never 500', async () => {
  const h = fixture()
  const bodies = ['{', 'null', '[]', '"text"', '1', ...fc.sample(fc.oneof(fc.string(), fc.integer(), fc.array(fc.jsonValue(), { maxLength: 3 })), { seed: 110013, numRuns: 20 }).map(value => JSON.stringify(value))]
  for (const route of Object.keys(ROUTE_POLICY)) {
    const [method, target] = route.split(' '), path = target!.replace(':id', 'synthetic')
    for (const body of bodies) {
      h.advance()
      const response = await h.req(method!, method === 'GET' ? path + '?uid=' + encodeURIComponent(body) + '&limit=' + encodeURIComponent(body) : path, method === 'GET' ? undefined : body, { Authorization: 'Bearer ' + h.token() })
      expect(response.status, route + ' ' + body).toBeLessThan(500)
      if (bodyless.has(route)) expect(response.status, route + ' ignores body').toBe(200)
      if (method !== 'GET' && !bodyless.has(route)) {
        expect(response.status, route + ' ' + body).toBeGreaterThanOrEqual(400)
      }
    }
  }
})

test('seeded nested JSON field fuzz reaches authenticated route handlers without 500', async () => {
  const h = fixture()
  const fields = ['id', 'name', 'cid', 'credential', 'code', 'seconds', 'subscription', 'state', 'definition', 'baseRev', 'active', 'exIdx', 'startedAt']
  const values = [null, [], {}, { toString: null, valueOf: null }, ...fc.sample(fc.jsonValue({ maxDepth: 3 }), { seed: 111013, numRuns: 40 })]
  for (const route of Object.keys(ROUTE_POLICY).filter(key => !key.startsWith('GET ') && !bodyless.has(key))) {
    const [method, target] = route.split(' ')
    for (const value of values) {
      h.advance()
      const body = Object.fromEntries(fields.map(key => [key, value]))
      const response = await h.req(method!, target!.replace(':id', 'synthetic'), JSON.stringify(body), { Authorization: 'Bearer ' + h.token() })
      expect(response.status, route + ' ' + JSON.stringify(value)).toBeLessThan(500)
    }
  }
})

test('independent field fuzz preserves valid envelopes and reaches nested push/presence fields', async () => {
  const h = fixture(), poison = { toString: null, valueOf: null }
  const values = [null, [], {}, poison, ...fc.sample(fc.jsonValue({ maxDepth: 3 }), { seed: 112013, numRuns: 25 })]
  const templates: Record<string, Record<string, unknown>> = {
    'POST /api/register/options': { name: 'synthetic', code: '' },
    'POST /api/pair/redeem': { code: '' },
    'POST /api/account/passkeys/rename': { id: 'synthetic', name: 'synthetic' },
    'POST /api/account/devices/rename': { id: 'synthetic', name: 'synthetic' },
    'POST /api/account/devices/revoke': { id: 'synthetic' },
    'POST /api/device-link/options': { code: '' },
    'POST /api/admin/user/disable': { id: 'synthetic', disabled: true },
    'POST /api/admin/user/delete': { id: 'synthetic' },
    'POST /api/admin/invites/new': { note: 'synthetic' },
    'POST /api/admin/invites/revoke': { code: 'synthetic' },
    'POST /api/push/subscribe': { subscription: { endpoint: 'https://example.com/push', keys: { p256dh: 'synthetic-key', auth: 'synthetic-auth' } } },
    'POST /api/push/unsubscribe': { endpoint: 'https://example.com/push' },
    'POST /api/push/rest-timer': { seconds: 1, deviceId: 'synthetic' },
    'POST /api/push/rest-timer/cancel': { deviceId: 'synthetic' },
    'POST /api/activity': { active: true, name: 'synthetic', exIdx: 1, exTotal: 1, setsDone: 0, setsTotal: 1, startedAt: CLOCK },
    'PUT /api/data': { state: { workouts: [], routines: [] }, baseRev: 0, baseWid: null },
    'PUT /api/programmes/library/synthetic': { definition: {}, expectedVersionId: null, minLevel: 'Valid' },
    'POST /api/programmes/validate': { definition: {} },
  }
  for (const [route, template] of Object.entries(templates)) {
    const [method, path] = route.split(' ')
    for (const field of Object.keys(template)) for (const value of values) {
      h.advance()
      const current = h.services.data.rev('s11-admin')
      const envelope = route === 'PUT /api/data' ? { ...template, baseRev: current.rev, baseWid: current.wid ?? null } : template
      const response = await h.req(method!, path!, JSON.stringify({ ...envelope, [field]: value }), { Authorization: 'Bearer ' + h.token() })
      expect(response.status, route + ' field=' + field + ' value=' + JSON.stringify(value)).toBeLessThan(500)
    }
  }
  for (const field of ['endpoint', 'p256dh', 'auth']) for (const value of values) {
    h.advance()
    const subscription = { endpoint: field === 'endpoint' ? value : 'https://example.com/push',
      keys: { p256dh: field === 'p256dh' ? value : 'synthetic-key', auth: field === 'auth' ? value : 'synthetic-auth' } }
    const response = await h.req('POST', '/api/push/subscribe', JSON.stringify({ subscription }), { Authorization: 'Bearer ' + h.token() })
    expect(response.status, 'push field=' + field + ' value=' + JSON.stringify(value)).toBeLessThan(500)
  }
})

test('malformed nested state stamps return 400 with no document/history write', async () => {
  const h = fixture(), poison = { toString: null, valueOf: null }
  const states = [
    { resetAt: poison, workouts: [] },
    { workouts: [{ id: 'synthetic', _ts: poison }] },
    { routines: [{ id: 'synthetic', _ts: poison }] },
    { _ts: poison, workouts: [] },
  ]
  const before = JSON.stringify(h.store.db.query('SELECT * FROM state_docs').all())
  for (const state of states) {
    const response = await h.req('PUT', '/api/data', JSON.stringify({ state }), { Authorization: 'Bearer ' + h.token() })
    expect(response.status, JSON.stringify(state)).toBe(400)
    expect(JSON.stringify(h.store.db.query('SELECT * FROM state_docs').all())).toBe(before)
    expect(h.store.db.query('SELECT COUNT(*) AS n FROM state_doc_history').get()).toEqual({ n: 0 })
  }
})

test('captured logs across registration, login, proof, pairing, revoke and transport failures contain no secrets', async () => {
  const h = fixture(), key = softPasskey('s11-log-authenticator'), secrets: string[] = ['synthetic-cookie-secret', 'synthetic-bearer-secret', 'synthetic-transport-secret', 'synthetic-push-key', 'synthetic-push-secret']
  const request = async (method: string, path: string, body?: unknown, headers: Record<string,string> = {}) => {
    const response = await h.req(method, path, body === undefined ? undefined : JSON.stringify(body), {
      Cookie: 'irrelevant=synthetic-cookie-secret', Authorization: 'Bearer synthetic-bearer-secret', ...headers,
    })
    return { status: response.status, headers: response.headers, body: await response.json() as any }
  }
  putInvite(h.store.db, { code: 'S11INVITE', note: '', created_by: null, created: null, used_by: null, used_at: null, revoked: 0, ord: 0 })
  secrets.push('S11INVITE')
  const registration = await request('POST', '/api/register/options', { name: 'synthetic', code: 'S11INVITE' })
  secrets.push(registration.body.cid, registration.body.options.challenge, key.id)
  const registered = await request('POST', '/api/register/verify', { cid: registration.body.cid, credential: key.attestation(registration.body.options.challenge) })
  expect(registered.status).toBe(200)
  const cookie = registered.headers.getSetCookie()[0]!.split(';')[0]!
  secrets.push(cookie, cookie.slice(cookie.indexOf('=') + 1))
  const login = await request('POST', '/api/login/options')
  secrets.push(login.body.cid, login.body.options.challenge)
  const loggedIn = await request('POST', '/api/login/verify', { cid: login.body.cid, credential: key.assertion(login.body.options.challenge) })
  expect(loggedIn.status).toBe(200)
  const headers = { Cookie: cookie }
  const pair = await request('POST', '/api/pair/create', {}, headers)
  expect(pair.status).toBe(200); secrets.push(pair.body.code)
  const redeemed = await request('POST', '/api/pair/redeem', { code: pair.body.code })
  expect(redeemed.status).toBe(200); secrets.push(redeemed.body.token)
  const proof = await request('POST', '/api/login/options')
  const link = await request('POST', '/api/account/device-link', { cid: proof.body.cid, credential: key.assertion(proof.body.options.challenge) }, headers)
  expect(link.status).toBe(200); secrets.push(link.body.code, proof.body.cid, proof.body.options.challenge)
  const linkedKey = softPasskey('s11-log-linked-authenticator')
  const linkedOptions = await request('POST', '/api/device-link/options', { code: link.body.code })
  expect(linkedOptions.status).toBe(200)
  secrets.push(linkedOptions.body.cid, linkedOptions.body.options.challenge, linkedKey.id)
  const linked = await request('POST', '/api/device-link/verify', { code: link.body.code, cid: linkedOptions.body.cid, credential: linkedKey.attestation(linkedOptions.body.options.challenge) })
  expect(linked.status).toBe(200)
  const linkedCookie = linked.headers.getSetCookie()[0]!.split(';')[0]!
  secrets.push(linkedCookie, linkedCookie.slice(linkedCookie.indexOf('=') + 1))
  expect((await request('POST', '/api/device-link/options', { code: 'invalid' })).status).toBe(400)
  expect((await request('POST', '/api/login/verify', { cid: 'invalid', credential: { id: 'synthetic-passkey-secret' } })).status).toBe(400)
  secrets.push('synthetic-passkey-secret')
  const devices = await request('GET', '/api/account/devices', undefined, headers)
  expect((await request('POST', '/api/account/devices/revoke', { id: devices.body.current }, headers)).status).toBe(200)
  expect((await request('POST', '/api/logout/all', {}, { Authorization: 'Bearer ' + redeemed.body.token, Cookie: '' })).status).toBe(200)
  putSub(h.store.db, { user_id: 's11-admin', endpoint: 'https://example.com/push', p256dh: 'synthetic-push-key', auth: 'synthetic-push-secret', device_id: null, created: null, ord: 0 })
  await h.services.notifications.push.sendPush('s11-admin', { title: 'synthetic', body: 'synthetic', tag: 'synthetic' })
  errorResponse(new Error(secrets.join(' ')), line => h.log.push(line))
  expect(h.log).toContain('server error'); expect(h.log).toContain('push send failed')
  const audit = h.store.db.query('SELECT * FROM audit_events').all()
  expect(audit.length).toBeGreaterThan(0)
  for (const secret of secrets.filter(secret => secret !== 'S11INVITE')) expect(JSON.stringify(audit)).not.toContain(secret)
  expect(h.log.join('\n')).not.toMatch(/Bearer |gymsid=|clientDataJSON|attestationObject|signature/)
  for (const secret of secrets) { expect(typeof secret).toBe('string'); expect(h.log.join('\n')).not.toContain(secret) }
  const diagnostic: string[] = []
  loadConfig({ DEFAULT_LANG: 'synthetic-cookie-secret' }, [], line => diagnostic.push(line))
  expect(diagnostic.join('\n')).not.toContain('synthetic-cookie-secret')
  expect(bootAddress('synthetic-cookie-secret\n', 'https://user:synthetic-bearer-secret@example.com/?token=synthetic-cookie-secret')).toBe('rpID=[invalid], origin=https://example.com')
})
