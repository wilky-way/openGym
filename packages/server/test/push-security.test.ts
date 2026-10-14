import { test, expect, spyOn } from 'bun:test'
import https from 'node:https'
import net from 'node:net'
import dns from 'node:dns'
import { createPushGuard } from '../src/push-address'
import { fixture, post, status, keys, cookie, other, wait, T0 } from './notification-helpers'
import { createApp } from '../src/app'
import { loadVapid } from '../src/push'
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createECDH } from 'node:crypto'
import webpush from 'web-push'
import { parse as parseUrl } from 'node:url'
import { scratchDir } from './helpers'

test('parser disagreement is refused at subscribe and stored-send boundaries; transport gets canonical href only', async () => {
  const endpoints = ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1'].map(ip => `https://${ip}%2eexample.com/x`)
  const h = fixture(endpoints.map(endpoint => ({ userId: 'u_test_1', endpoint, keys })))
  for (const endpoint of endpoints) {
    expect(new URL(endpoint).hostname).not.toBe(parseUrl(endpoint).hostname)
    const r = await post(h, '/api/push/subscribe', { subscription: { endpoint, keys } })
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'endpoint has an ambiguous hostname' })
  }
  await post(h, '/api/push/test')
  expect(h.sent).toHaveLength(0)
  expect(h.db().subs).toHaveLength(0)
  const raw = 'HTTPS://PUSH.EXAMPLE:443/a/../x?q=a b'
  expect((await post(h, '/api/push/subscribe', { subscription: { endpoint: raw, keys } })).status).toBe(200)
  expect(h.db().subs[0].endpoint).toBe(raw)
  expect(await status(h, raw)).toEqual({ subscribed: true, deviceId: null })
  expect(await status(h, new URL(raw).href)).toEqual({ subscribed: false })
  await post(h, '/api/push/test')
  expect(h.sent[0].sub.endpoint).toBe(new URL(raw).href)
  await post(h, '/api/push/unsubscribe', { endpoint: new URL(raw).href })
  expect(h.db().subs).toHaveLength(1)
  await post(h, '/api/push/unsubscribe', { endpoint: raw })
  expect(h.db().subs).toHaveLength(0)
})

test('socket guard alone stops real web-push parser tricks and alternate IP spellings before any loopback connection', async () => {
  let hits = 0
  const target = net.createServer(socket => { hits++; socket.destroy() })
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
  const guard = createPushGuard()
  try {
    const port = (target.address() as net.AddressInfo).port
    for (const host of ['127.0.0.1%2eexample.com', '127.0.0.1', '2130706433', '0177.0.0.1', '0x7f000001',
      '[::ffff:127.0.0.1]', '[::ffff:7f00:1]']) {
      const endpoint = `https://${host}:${port}/x`
      // Deliberately call web-push directly: endpoint precheck and canonical send are bypassed.
      const error = await webpush.sendNotification({ endpoint, keys }, null,
        { agent: guard.agent, timeout: 500 }).catch(e => e)
      expect(error.code).toBe('EPUSHBLOCKED')
    }
    expect(hits).toBe(0)
  } finally { guard.agent.destroy(); await new Promise<void>(resolve => target.close(() => resolve())) }
})

test('all DNS answers are checked even for scalar callers and rebinding never reaches a local listener', async () => {
  let hits = 0, resolves = 0
  const target = net.createServer(socket => { hits++; socket.destroy() })
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
  const resolver = ((_: string, options: dns.LookupOptions, cb: Function) => {
    expect(options.all).toBe(true)
    cb(null, (resolves++ === 0 ? ['8.8.8.8'] : ['8.8.8.8', '127.0.0.1']).map(address => ({ address, family: 4 })))
  }) as unknown as typeof dns.lookup
  const guard = createPushGuard('', () => {}, resolver)
  try {
    expect(guard.pushEndpointError('https://rebind.example/x')).toBeNull()
    await new Promise<void>(resolve => guard.guardedLookup('rebind.example', {}, (err, address) => {
      expect(err).toBeNull(); expect(address).toBe('8.8.8.8'); resolve()
    }))
    const error = await webpush.sendNotification({ endpoint: `https://rebind.example:${(target.address() as net.AddressInfo).port}/x`, keys },
      null, { agent: guard.agent, timeout: 500 }).catch(e => e)
    expect(error.code).toBe('EPUSHBLOCKED')
    expect(resolves).toBe(2)
    expect(hits).toBe(0)
  } finally { guard.agent.destroy(); await new Promise<void>(resolve => target.close(() => resolve())) }
})

test('connected peer guard destroys unsafe sockets regardless of hostname and honours private exceptions', () => {
  for (const peer of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '100.100.1.1', 'fd7a:115c:a1e0::1',
    'fe80::1', '::ffff:7f00:1', 'fec0::1', 'ff02::1', '64:ff9b:1::a00:1', undefined]) {
    const guard = createPushGuard()
    const socket = new net.Socket()
    Object.defineProperty(socket, 'remoteAddress', { value: peer })
    let code: string | undefined
    const destroy = spyOn(socket, 'destroy').mockImplementation(error => { code = (error as NodeJS.ErrnoException)?.code; return socket })
    const connect = spyOn(https.Agent.prototype, 'createConnection').mockReturnValue(socket)
    try {
      guard.agent.createConnection({ host: 'push.example', lookup: (() => { throw new Error('request lookup override used') }) })
      expect(connect.mock.calls[0]![0].lookup).toBe(guard.guardedLookup)
      socket.emit('connect')
      expect(code).toBe('EPUSHBLOCKED')
    } finally { connect.mockRestore(); destroy.mockRestore(); socket.destroy(); guard.agent.destroy() }
  }
  const guard = createPushGuard('127.0.0.1'), socket = new net.Socket()
  Object.defineProperty(socket, 'remoteAddress', { value: '::ffff:127.0.0.1' })
  const connect = spyOn(https.Agent.prototype, 'createConnection').mockReturnValue(socket)
  try { guard.agent.createConnection({ host: 'push.example' }); socket.emit('connect'); expect(socket.destroyed).toBe(false) }
  finally { connect.mockRestore(); socket.destroy(); guard.agent.destroy() }
})

test('local-use IPv6 is blocked by endpoint, all-answer lookup and socket rules with exact allowlist exceptions', async () => {
  for (const ip of ['fec0::1', 'ff02::1', '64:ff9b:1::a00:1']) {
    for (const allowed of ['', ip]) {
      const guard = createPushGuard(allowed, () => {}, ((_: string, _options: unknown, cb: Function) =>
        cb(null, [{ address: ip, family: 6 }])) as unknown as typeof dns.lookup)
      try {
        expect(guard.isPrivateAddr(ip)).toBe(!allowed)
        expect(guard.pushEndpointError(`https://[${ip}]/x`)).toBe(allowed ? null : 'endpoint must not point at a private address')
        const error = await new Promise<any>(resolve => guard.guardedLookup('push.example', { all: true }, err => resolve(err)))
        expect(error?.code ?? null).toBe(allowed ? null : 'EPUSHBLOCKED')
      } finally { guard.agent.destroy() }
    }
  }
})

function localTlsCredentials() {
  const dir = scratchDir(), key = join(dir, 'key.pem'), cert = join(dir, 'cert.pem')
  const generated = Bun.spawnSync(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
    '-out', cert, '-days', '1', '-subj', '/CN=push.example'], { stdout: 'ignore', stderr: 'pipe' })
  expect(generated.exitCode).toBe(0)
  return { key: readFileSync(key), cert: readFileSync(cert) }
}

test('real TLS connected-peer guard destroys an unexpected loopback route before transmitting any push request', async () => {
  let connections = 0, requests = 0
  const target = https.createServer(localTlsCredentials(), (_req, res) => { requests++; res.end() })
  const accepted = new Promise<void>(resolve => target.once('connection', () => { connections++; resolve() }))
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
  const original = https.Agent.prototype.createConnection
  // Simulate an unexpected transport route after hostname validation. Only the superclass
  // connection target is changed; the real guard's connect handler and TLS stack run normally.
  const redirect = spyOn(https.Agent.prototype, 'createConnection').mockImplementation(function(this: https.Agent, options, callback) {
    return original.call(this, { ...options, host: '127.0.0.1', rejectUnauthorized: false }, callback)
  })
  const guard = createPushGuard()
  try {
    const error = await webpush.sendNotification({ endpoint: `https://push.example:${(target.address() as net.AddressInfo).port}/x`, keys },
      null, { agent: guard.agent, timeout: 500 }).catch(e => e)
    expect(error.code).toBe('EPUSHBLOCKED')
    await accepted
    expect(connections).toBe(1)
    expect(requests).toBe(0)
  } finally { redirect.mockRestore(); guard.agent.destroy(); await new Promise<void>(resolve => target.close(() => resolve())) }
})

test('real web-push does not follow a local HTTPS redirect to a blocked private destination', async () => {
  const credentials = localTlsCredentials()
  let targetHits = 0, sourceHits = 0
  const target = net.createServer(socket => { targetHits++; socket.destroy() })
  await new Promise<void>(resolve => target.listen(0, '::1', resolve))
  const destination = `https://[::1]:${(target.address() as net.AddressInfo).port}/private`
  const source = https.createServer(credentials, (_req, res) => {
    sourceHits++; res.writeHead(302, { Location: destination }); res.end()
  })
  await new Promise<void>(resolve => source.listen(0, '127.0.0.1', resolve))
  const guard = createPushGuard('127.0.0.1')
  guard.agent.options.rejectUnauthorized = false // Synthetic, self-signed local listener only.
  try {
    expect(guard.pushEndpointError(destination)).toBe('endpoint must not point at a private address')
    const endpoint = `https://127.0.0.1:${(source.address() as net.AddressInfo).port}/push`
    const error = await webpush.sendNotification({ endpoint, keys }, null, { agent: guard.agent, timeout: 500 }).catch(e => e)
    expect(error.statusCode).toBe(302)
    expect(sourceHits).toBe(1)
    expect(targetHits).toBe(0)
  } finally {
    guard.agent.destroy()
    await Promise.all([new Promise<void>(resolve => source.close(() => resolve())), new Promise<void>(resolve => target.close(() => resolve()))])
  }
})

test('allowlisted named DNS target connects with the original hostname and validates the connected peer', async () => {
  const target = net.createServer(socket => socket.destroy())
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
  let answersChecked = 0, connected = 0
  const resolver = ((host: string, options: dns.LookupOptions, cb: Function) => {
    expect(host).toBe('push.example'); expect(options.all).toBe(true); answersChecked++
    cb(null, [{ address: '127.0.0.1', family: 4 }])
  }) as unknown as typeof dns.lookup
  const guard = createPushGuard('127.0.0.1', () => {}, resolver)
  try {
    const req = https.request(`https://push.example:${(target.address() as net.AddressInfo).port}/x`, { agent: guard.agent })
    req.on('socket', socket => socket.on('connect', () => { connected++; expect(socket.remoteAddress).toBe('127.0.0.1') }))
    const error = await new Promise<any>(resolve => { req.on('error', resolve); req.end() })
    expect(error.code).not.toBe('EPUSHBLOCKED')
    expect(answersChecked).toBe(1); expect(connected).toBe(1)
  } finally { guard.agent.destroy(); await new Promise<void>(resolve => target.close(() => resolve())) }
})

test('DNS rebinding is rejected at the HTTPS socket for scalar and mixed all-address answers', async () => {
  for (const answers of [['127.0.0.1'], ['169.254.169.254'], ['::ffff:7f00:1'], ['fd12::1'], ['8.8.8.8', '10.1.2.3']]) {
    let resolves = 0
    const resolver = ((_: string, options: dns.LookupOptions, cb: Function) => {
      resolves++
      const rows = answers.map(address => ({ address, family: net.isIP(address) }))
      if (options.all) cb(null, rows)
      else cb(null, rows[0]!.address, rows[0]!.family)
    }) as unknown as typeof dns.lookup
    const guard = createPushGuard('', () => {}, resolver)
    expect(guard.pushEndpointError('https://rebind.example/x')).toBeNull()
    // Exercise the actual Agent's socket path. Any private answer must abort before connect.
    const error = await new Promise<Error & { code?: string }>(resolve => {
      const req = https.request('https://rebind.example/x', { agent: guard.agent, timeout: 500 }, r => {
        r.destroy(); resolve(new Error('unexpected response'))
      })
      req.on('error', resolve)
      req.on('timeout', () => req.destroy(new Error('guard did not reject DNS result')))
      req.end()
    })
    expect(error.code).toBe('EPUSHBLOCKED')
    expect(resolves).toBeGreaterThan(0)
    guard.agent.destroy()
  }
})
test('guard rejects a public-first mixed answer, propagates DNS errors, and honours allowlist during lookup', async () => {
  async function check(addresses: string[], allowed = '', err: Error | null = null) {
    const guard = createPushGuard(allowed, () => {}, ((_: string, _o: unknown, cb: Function) =>
      cb(err, addresses.map(address => ({ address, family: net.isIP(address) })))) as unknown as typeof dns.lookup)
    return await new Promise<any>(resolve => guard.guardedLookup('push.example', { all: true }, (e, rows) => {
      guard.agent.destroy(); resolve({ error: e, rows })
    }))
  }
  expect((await check(['8.8.8.8', '10.1.2.3'])).error.code).toBe('EPUSHBLOCKED')
  expect((await check(['10.1.2.3'], '10.0.0.0/8')).error).toBeNull()
  expect((await check(['10.1.2.3'], '10.0.0.0/8')).rows).toEqual([{ address: '10.1.2.3', family: 4 }])
  const failed = new Error('ENOTFOUND')
  expect((await check([], '', failed)).error).toBe(failed)
})
test('real web-push honours the guarded Agent and opens no localhost socket', async () => {
  let hits = 0
  const target = net.createServer(s => { hits++; s.destroy() })
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve))
  try {
    const endpoint = `https://localhost:${(target.address() as net.AddressInfo).port}/x`
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys()
    const realKeys = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') }
    let transportCode: string | undefined
    const h = fixture([{ userId: 'u_test_1', endpoint, keys: realKeys }], { send: async (sub, body, options) => {
      try { return await webpush.sendNotification(sub, body, options) }
      catch (error) { transportCode = (error as NodeJS.ErrnoException).code; throw error }
    } })
    expect((await post(h, '/api/push/test')).status).toBe(200)
    expect(h.log).toContain('push send failed')
    expect(transportCode).toBe('EPUSHBLOCKED')
    expect(hits).toBe(0)
  } finally { target.close() }
})
test('subscribe rejects invalid URLs and credentials, caps at 20 oldest-first, and retains only push keys', async () => {
  const h = fixture()
  for (const [endpoint, error] of [['x', 'endpoint is not a valid URL'], ['http://push.example/x', 'endpoint must be an https:// URL'],
    ['https://user:pass@push.example/x', 'endpoint must not carry credentials'], ['https://2130706433/x', 'endpoint must not point at a private address']]) {
    const r = await post(h, '/api/push/subscribe', { subscription: { endpoint, keys } })
    expect(r.status).toBe(400); expect(await r.json()).toEqual({ error })
  }
  for (let i = 0; i < 22; i++) expect((await post(h, '/api/push/subscribe', {
    subscription: { endpoint: `https://push.example/${i}`, keys: { p256dh: i + 1, auth: true, extra: 'junk' }, extra: 'junk' },
  })).status).toBe(200)
  expect(h.db().subs.length).toBe(20)
  expect(h.db().subs[0].endpoint).toBe('https://push.example/2')
  expect(h.db().subs[19].keys).toEqual({ p256dh: '22', auth: 'true' })
  await post(h, '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/2', keys } })
  expect(h.db().subs.length).toBe(20)
  expect(h.db().subs[19].endpoint).toBe('https://push.example/2')
  await post(h, '/api/push/unsubscribe', { endpoint: 'https://push.example/2' }, other)
  expect(h.db().subs.length).toBe(20)
  await post(h, '/api/push/unsubscribe', { endpoint: 'https://push.example/2' })
  expect(h.db().subs.length).toBe(19)
})
test('dead 403/404/410 subscriptions are pruned, transient failures stay, and six workers bound sends', async () => {
  let active = 0, peak = 0
  const subs = Array.from({ length: 20 }, (_, i) => ({ userId: 'u_test_1', endpoint: `https://push.example/${i}`, keys }))
  const h = fixture(subs, { send: async (sub, _body, options) => {
    active++; peak = Math.max(peak, active)
    expect(options.urgency).toBe('high'); expect(options.timeout).toBe(10000)
    expect(options.agent).toBe(h.notifications.push.guard.agent)
    expect(options.vapidDetails!.publicKey).toBe(h.notifications.push.vapid.publicKey)
    await Promise.resolve(); active--
    throw { statusCode: [403, 404, 410, 500][Number(sub.endpoint.split('/').pop()) % 4] }
  } })
  expect((await post(h, '/api/push/test')).status).toBe(200)
  expect(peak).toBe(6)
  expect(h.db().subs.length).toBe(5)
})
test('rest timer fields validate before clamping; replacement, maximum and legacy cancel use pinned scheduler', async () => {
  const h = fixture([{ userId: 'u_test_1', endpoint: 'https://push.example/x', keys }])
  for (const seconds of [undefined, null, {}, [], true, 0, -1, 'x', '']) {
    const r = await post(h, '/api/push/rest-timer', { seconds })
    expect(r.status).toBe(400); expect(await r.json()).toEqual({ error: 'seconds required' })
  }
  await post(h, '/api/push/rest-timer', { seconds: '1.6', deviceId: 'dev_phone000' })
  expect(h.scheduled.at(-1)).toBe(2000)
  await post(h, '/api/push/rest-timer', { seconds: 4000, deviceId: 'dev_phone000' })
  expect(h.scheduled.at(-1)).toBe(3600000)
  await wait(2000); expect(h.sent.length).toBe(0)
  await post(h, '/api/push/rest-timer/cancel', {})
  await wait(3600000); expect(h.sent.length).toBe(0)
  for (const path of ['/api/activity', '/api/push/test', '/api/push/subscribe', '/api/push/rest-timer']) {
    expect((await post(h, path, {}, {})).status).toBe(401)
    expect((await post(h, path, {}, { ...cookie, Origin: 'https://bad.example' })).status).toBe(403)
  }
})
test('VAPID comes from a persistent 0600 file and admin receives shared presence callbacks', async () => {
  const h = fixture(), expected = h.notifications.push.vapid
  expect(loadVapid(h.dataDir)).toEqual(expected)
  expect(statSync(join(h.dataDir, 'vapid.json')).mode & 0o777).toBe(0o600)
  expect(await fetch(h.api + '/api/push/public-key').then(r => r.json())).toEqual({ key: expected.publicKey })
  let admin: any
  createApp(h.auth.config, { auth: h.auth, notifications: h.notifications, routes: (_app, callbacks) => { admin = callbacks } })
  await post(h, '/api/activity', { active: true, name: 'Synthetic', startedAt: T0 })
  expect(admin.livePresence('u_test_1').name).toBe('Synthetic')
  admin.dropPresence('u_test_1')
  expect(h.notifications.livePresence('u_test_1')).toBeNull()
  writeFileSync(join(h.dataDir, 'vapid.json'), '{invalid')
  const regenerated = loadVapid(h.dataDir)
  expect(regenerated.publicKey).not.toBe(expected.publicKey)
  expect(loadVapid(h.dataDir)).toEqual(regenerated)
})
