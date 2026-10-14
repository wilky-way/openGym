import { test, expect } from 'bun:test'
import { writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { join } from 'node:path'
import { scratchDir, user } from './helpers'
import { loadConfig } from '../src/config'
import { startRuntime } from '../src/runtime'
import { putUser, openStore } from '../src/storage'
import { createAuth } from '../src/auth'
import { startServer } from '../src/index'
import { staticHandler } from '../src/static'
import { createNotifications } from '../src/notifications'

test('production runtime composes storage, auth, admin, data and passkeys and closes audit before storage', async () => {
  const dir = scratchDir(), store = openStore(dir)
  putUser(store.db, user('synthetic-admin', 0, { admin: 1 }))
  putUser(store.db, user('synthetic-athlete', 1))
  const config = loadConfig({ DATA_DIR: dir, HOST: '127.0.0.1', PORT: '0' })
  const auth = createAuth(store.db, config), token = auth.mint(user('synthetic-admin', 0, { admin: 1 }), 'agent')
  const athlete = auth.mint(user('synthetic-athlete', 1), 'agent')
  auth.auditLog.close(); store.close()
  const server = startRuntime(config, () => {})
  try {
    const request = (path: string, method = 'GET', body?: object, bearer = token) => wire(server.port!, path, method, body, bearer)
    expect(await (await request('/api/health')).json()).toMatchObject({ ok: true, users: 2 })
    expect((await request('/api/admin/users')).status).toBe(200)
    expect((await request('/api/account/passkeys')).status).toBe(200)
    expect((await request('/api/data')).status).toBe(200)
    const activity = await request('/api/activity', 'POST', { active: true, name: 'Synthetic runtime workout' }, athlete)
    expect(activity.status).toBe(200)
    expect((await (await request('/api/admin/users')).json()).users.find((u: { id: string }) => u.id === 'synthetic-athlete').live.name).toBe('Synthetic runtime workout')
    const disable = await request('/api/admin/user/disable', 'POST', { id: 'synthetic-athlete', disabled: true })
    expect(disable.status).toBe(200)
    expect((await (await request('/api/admin/users')).json()).users.find((u: { id: string }) => u.id === 'synthetic-athlete').live).toBeNull()
  } finally { await server.stop(true); await server.stop(true) }
  // A close hook is exercised directly; stopping the runtime must cancel the admin sweep.
  const second = openStore(scratchDir()), a = createAuth(second.db, config)
  let cancelled = false
  let notificationsClosed = false
  const close = a.auditLog.close
  a.auditLog.close = () => { cancelled = true; close() }
  const notifications = createNotifications(a), closeNotifications = notifications.close
  notifications.close = () => { notificationsClosed = true; closeNotifications() }
  const shell = startServer(config, { auth: a, notifications }, () => {})
  await shell.stop(true)
  expect(cancelled).toBe(true)
  expect(notificationsClosed).toBe(true)
  second.close()
})

test('static serving is optional, reserves api and confines public assets including symlinks', async () => {
  const dir = scratchDir(), outside = scratchDir()
  writeFileSync(join(dir, 'index.html'), '<html>synthetic shell</html>')
  writeFileSync(join(dir, 'app.js'), 'console.log("synthetic")')
  writeFileSync(join(outside, 'secret.txt'), 'not public')
  mkdirSync(join(dir, 'exercise-media'))
  writeFileSync(join(dir, 'exercise-media', 'fixture.svg'), '<svg/>')
  symlinkSync(join(outside, 'secret.txt'), join(dir, 'escape.txt'))
  writeFileSync(join(dir, '.env'), 'not public')
  mkdirSync(join(dir, 'private')); writeFileSync(join(dir, 'private', 'secret.json'), '{"private":true}')
  symlinkSync(join(dir, 'private', 'secret.json'), join(dir, 'alias.json'))
  const serve = staticHandler(dir), request = (path: string, method = 'GET') => serve(new Request('http://localhost' + path, { method }))
  expect(await request('/')!.text()).toContain('synthetic shell')
  expect(request('/app.js')!.headers.get('Cache-Control')).toBe('no-cache, must-revalidate')
  expect(request('/exercise-media/fixture.svg')!.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin')
  expect(await request('/app.js', 'HEAD')!.text()).toBe('')
  for (const path of ['/escape.txt', '/alias.json', '/private/secret.json', '/data/db.json', '/.env', '/%2e%2e%2fsecret.txt', '/%5csecret.txt', '/missing.js', '/app.js.map', '/legacy/index.html', '/tests/fixture.json', '/%ZZ']) expect(request(path)!.status).toBe(404)
  expect(request('/missing?x=1')!.headers.get('Location')).toBe('/?x=1')
  expect(request('/api/unknown')).toBeUndefined()
  expect(request('/api/health')).toBeUndefined()
  expect(request('//other/api/health')).toBeUndefined()
  expect(request('/', 'PUT')).toBeUndefined()
  const server = startRuntime(loadConfig({ DATA_DIR: scratchDir(), STATIC_DIR: dir, PORT: '0', HOST: '127.0.0.1' }), () => {})
  try { expect((await wire(server.port!, '//other/api/health')).status).toBe(200) }
  finally { await server.stop(true) }
})

test('production runtime refuses overlapping static and data roots including aliases', () => {
  const dir = scratchDir(), data = join(dir, 'storage')
  mkdirSync(data)
  const config = loadConfig({ DATA_DIR: data, STATIC_DIR: dir, PORT: '0', HOST: '127.0.0.1' })
  expect(() => startRuntime(config, () => {})).toThrow('must not overlap')
  expect(() => startRuntime({ ...config, staticDir: data }, () => {})).toThrow('must not overlap')
  const alias = join(scratchDir(), 'alias'); symlinkSync(dir, alias)
  expect(() => startRuntime({ ...config, staticDir: alias }, () => {})).toThrow('must not overlap')
})

test('runtime auth receives the real listener peer and ignores untrusted forwarded addresses', async () => {
  const dir = scratchDir(), server = startRuntime(loadConfig({ DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', AUDIT_IP: 'full' }), () => {})
  try {
    await new Promise<void>((done, fail) => {
      const req = httpRequest({ host: '127.0.0.1', port: server.port, path: '/api/pair/redeem', method: 'POST', agent: false, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.10' } }, response => {
        expect(response.statusCode).toBe(400); response.resume(); response.on('end', done)
      }); req.on('error', fail); req.end(JSON.stringify({ code: 'BADCODE' }))
    })
    const store = openStore(dir)
    try { expect(store.db.query<{ ip: string }, []>("SELECT ip FROM audit_events WHERE ev='auth.pair.fail'").get()?.ip).toBe('127.0.0.1') }
    finally { store.close() }
  } finally { await server.stop(true) }
})

function wire(port: number, path: string, method = 'GET', body?: object, token?: string): Promise<Response> {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, agent: false, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, response => {
      let text = ''; response.on('data', bytes => text += bytes); response.on('end', () => done(new Response(text, { status: response.statusCode! })))
    }); req.on('error', fail); req.end(body ? JSON.stringify(body) : undefined)
  })
}

test('concurrent graceful stop callers await the same shutdown while a request remains pending', async () => {
  const server = startRuntime(loadConfig({ DATA_DIR: scratchDir(), PORT: '0', HOST: '127.0.0.1' }), () => {})
  const socket = connect(server.port!, '127.0.0.1')
  socket.on('error', () => {})
  socket.resume()
  const body = JSON.stringify({ code: 'BADCODE' })
  let stopped: Promise<void> | undefined
  try {
    await new Promise<void>(done => socket.once('connect', done))
    socket.write(`POST /api/pair/redeem HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body.slice(0, 8)}`)
    const deadline = Date.now() + 3000
    while (!server.pendingRequests && Date.now() < deadline) await Bun.sleep(1)
    expect(server.pendingRequests).toBeGreaterThan(0)
    stopped = server.stop(false)
    const concurrent = server.stop(false)
    expect(concurrent).toBe(stopped)
    let finished = false
    void concurrent.then(() => { finished = true })
    // Let the scheduled shutdown and pending I/O run for a complete event-loop turn.
    await new Promise<void>(done => setImmediate(done))
    expect(finished).toBe(false)
    socket.write(body.slice(8))
    await concurrent
    expect(finished).toBe(true)
  } finally { socket.destroy(); await (stopped ?? server.stop(true)) }
})
