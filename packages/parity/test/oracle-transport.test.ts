import { expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import type { Socket } from 'node:net'
import { decodeBytes, startOracle, syntheticProfile } from '../src'
import * as transport from '../src/http-transport'

it('oracle transport: 240 sequential and 240 concurrent requests use fresh sockets and drain every response', async () => {
  const profile = syntheticProfile(93), uid = 'synthetic_u_1'
  const doc = JSON.parse(profile.docs[uid]!) as Record<string, unknown>
  doc.transportTail = 'é 🏋 '.repeat(32768) + 'end-of-synthetic-body'
  profile.docs[uid] = JSON.stringify(doc)
  const oracle = await startOracle(profile)
  const sockets = new Set<Socket>()
  const direct = transport.directRequest
  const spy = vi.spyOn(transport, 'directRequest').mockImplementation((port, request, headers, authorize) => direct(port, request, headers, async socket => {
    expect(sockets.has(socket)).toBe(false)
    sockets.add(socket)
    await authorize?.(socket)
  }))
  try {
    const send = async (i: number) => {
      const data = i % 3 === 0, admin = i % 3 === 1
      const response = await oracle.request({ method: data || admin ? 'GET' : 'POST',
        path: data ? '/api/data' : admin ? '/api/admin/users' : '/api/admin/audit/clear',
        session: { uid: data || admin ? uid : 'synthetic_u_2', bearer: true },
        ...(!data && !admin ? { body: { encoding: 'utf8' as const, data: '{}' } } : {}) })
      expect(response.status).toBe(data || admin ? 200 : 403)
      const json = JSON.parse(decodeBytes(response.body).toString())
      if (data) expect(json.state.transportTail).toBe(doc.transportTail)
      else if (admin) expect(json.users.map((user: { id: string }) => user.id)).toEqual(profile.db.users.map(user => user.id))
      else expect(json).toEqual({ error: 'forbidden' })
    }
    for (let i = 0; i < 240; i++) await send(i)
    for (let i = 0; i < 240; i += 24) await Promise.all(Array.from({ length: 24 }, (_, j) => send(i + j)))
    expect(spy).toHaveBeenCalledTimes(480)
    expect(sockets.size).toBe(480)
  } finally { spy.mockRestore(); await oracle.stop() }
}, 30000)

it('direct transport: truncated bodies and socket failures propagate without retries', async () => {
  let hits = 0
  const server = createServer((_req, res) => {
    hits++
    res.writeHead(200, { 'Content-Length': '100' })
    res.write('partial')
    setTimeout(() => res.destroy(), 10)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  try {
    await expect(transport.directRequest(address.port, { method: 'GET', path: '/' })).rejects.toThrow()
    expect(hits).toBe(1)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
  await expect(transport.directRequest(address.port, { method: 'GET', path: '/' })).rejects.toThrow()
  expect(hits).toBe(1)
})

it('oracle transport: the announced ephemeral IPv4 endpoint belongs exclusively to the oracle', async () => {
  const oracle = await startOracle(syntheticProfile(95))
  const foreign = createServer((_req, res) => res.end('foreign listener'))
  try {
    const url = new URL(oracle.baseUrl)
    expect(url.hostname).toBe('127.0.0.1')
    await expect(new Promise<void>((resolve, reject) => {
      foreign.once('error', reject); foreign.listen(Number(url.port), '127.0.0.1', resolve)
    })).rejects.toMatchObject({ code: 'EADDRINUSE' })
    const health = await oracle.request({ method: 'GET', path: '/api/health' })
    expect(health.status).toBe(200)
    expect(health.headers).not.toHaveProperty('x-parity-oracle-nonce')
  } finally { if (foreign.listening) await new Promise<void>(resolve => foreign.close(() => resolve())); await oracle.stop() }
})

it('oracle transport: startup verifies identity before exposing a target', async () => {
  const spy = vi.spyOn(transport, 'directRequest').mockResolvedValue({ status: 200, headers: {}, body: { encoding: 'utf8', data: 'foreign health' } })
  try {
    await expect(startOracle(syntheticProfile(96))).rejects.toThrow('Oracle harness identity mismatch')
    expect(spy).toHaveBeenCalledTimes(1)
  } finally { spy.mockRestore() }
})

it('oracle transport: every exchange rejects another run nonce and Tailscale headers before parity', async () => {
  const first = await startOracle(syntheticProfile(97)), second = await startOracle(syntheticProfile(98))
  let spy: ReturnType<typeof vi.spyOn> | undefined
  try {
    const rawFirst = await transport.directRequest(Number(new URL(first.baseUrl).port), { method: 'GET', path: '/api/health' })
    const rawSecond = await transport.directRequest(Number(new URL(second.baseUrl).port), { method: 'GET', path: '/api/health' })
    const firstNonce = rawFirst.headers['x-parity-oracle-nonce']![0]!, secondNonce = rawSecond.headers['x-parity-oracle-nonce']![0]!
    expect(firstNonce).toBeTruthy(); expect(firstNonce).not.toBe(secondNonce)
    spy = vi.spyOn(transport, 'directRequest')
    spy.mockResolvedValueOnce({ status: 200, headers: { 'x-parity-oracle-nonce': [secondNonce] }, body: { encoding: 'utf8', data: 'foreign' } })
    await expect(first.request({ method: 'GET', path: '/api/health' })).rejects.toThrow('Oracle harness identity mismatch')
    spy.mockResolvedValueOnce({ status: 401, headers: { 'x-parity-oracle-nonce': [firstNonce], 'tailscale-version': ['synthetic-foreign-service'] }, body: { encoding: 'utf8', data: 'auth required\n' } })
    await expect(first.request({ method: 'GET', path: '/api/health' })).rejects.toThrow('Oracle harness rejected foreign Tailscale listener')
    expect(spy).toHaveBeenCalledTimes(2)
  } finally { spy?.mockRestore(); await Promise.all([first.stop(), second.stop()]) }
})

it('oracle and server-under-test transport: inherited proxy variables receive zero foreign hits', async () => {
  let hits = 0
  const proxy = createServer((_req, res) => { hits++; res.end('synthetic proxy') })
  proxy.on('connect', (_req, socket) => { hits++; socket.destroy() })
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve))
  const address = proxy.address()
  if (!address || typeof address === 'string') throw new Error('No proxy port')
  try {
    const env = { ...process.env }
    for (const name of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) env[name] = `http://127.0.0.1:${address.port}`
    env.NO_PROXY = ''; env.no_proxy = ''
    // Bun reads proxy configuration at process startup. A new harness parent must
    // inherit the poisoned environment; changing this test process's env is too late.
    const module = fileURLToPath(new URL('../src/index.ts', import.meta.url))
    const source = `import { startOracle, syntheticProfile, directRequest } from ${JSON.stringify(module)};
      const oracle = await startOracle(syntheticProfile(99));
      try {
        for (const [method, path] of [['GET', '/api/me'], ['POST', '/api/admin/audit/clear']]) {
          const response = await oracle.request({ method, path, session: { uid: 'synthetic_u_2', bearer: true }, ...(method === 'POST' ? {body:{encoding:'utf8',data:'{}'}} : {}) });
          if (response.status !== (method === 'GET' ? 200 : 403)) throw new Error('Unexpected synthetic status');
        }
        const response = await directRequest(Number(new URL(oracle.baseUrl).port), { method: 'GET', path: '/api/health' });
        if (response.status !== 200) throw new Error('Direct server-under-test request failed');
        console.log('direct requests: 4');
      } finally { await oracle.stop(); }`
    const child = await promisify(execFile)(process.execPath, ['-e', source], { env, timeout: 20000 })
    expect(child.stdout.trim()).toBe('direct requests: 4')
    expect(hits).toBe(0)
    const vitest = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url))
    const twins = await promisify(execFile)(process.execPath, ['--bun', vitest, 'run', 'test/server-data-rev.test.ts', 'test/server-data-rev-endpoint.test.ts', 'test/server-data-wid.test.ts', 'test/server-data-reset.test.ts', '--maxWorkers=1'], { env, cwd: fileURLToPath(new URL('../', import.meta.url)), timeout: 20000 })
    expect(twins.stdout).toContain('6 passed')
    expect(hits).toBe(0)
    // A previous-style fetch in the exact same fresh-parent environment must hit
    // the counting proxy, proving the regression actually enables proxy routing.
    const control = await promisify(execFile)(process.execPath, ['-e', "const response = await fetch('http://127.0.0.1:1/synthetic-control'); await response.arrayBuffer(); console.log(response.status)"], { env, timeout: 20000 })
    expect(control.stdout.trim()).toBe('200')
    expect(hits).toBe(1)
  } finally { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())) }
})

it('oracle transport: a foreign connected peer receives no HTTP bytes or Bearer before ownership rejection', async () => {
  const oracle = await startOracle(syntheticProfile(100))
  let hits = 0, bytes = 0
  const foreign = createServer((_req, res) => { hits++; res.end('foreign') })
  foreign.on('connection', socket => socket.on('data', chunk => { bytes += chunk.length }))
  await new Promise<void>(resolve => foreign.listen(0, '127.0.0.1', resolve))
  const address = foreign.address()
  if (!address || typeof address === 'string') throw new Error('No foreign port')
  const direct = transport.directRequest
  const spy = vi.spyOn(transport, 'directRequest').mockImplementation((_port, request, headers, authorize) => direct(address.port, request, headers, authorize))
  try {
    await expect(oracle.request({ method: 'POST', path: '/api/data', session: { uid: 'synthetic_u_1', bearer: true }, body: { encoding: 'utf8', data: '{}' } })).rejects.toThrow('not owned by the child')
    expect(hits).toBe(0); expect(bytes).toBe(0)
  } finally { spy.mockRestore(); foreign.closeAllConnections(); await new Promise<void>(resolve => foreign.close(() => resolve())); await oracle.stop() }
})

it('oracle transport: child crash and same-port reuse between liveness check and dial leak zero bytes', async () => {
  const oracle = await startOracle(syntheticProfile(101))
  let hits = 0, bytes = 0
  const foreign = createServer((_req, res) => { hits++; res.end('foreign') })
  foreign.on('connection', socket => socket.on('data', chunk => { bytes += chunk.length }))
  const direct = transport.directRequest
  const spy = vi.spyOn(transport, 'directRequest').mockImplementation(async (port, request, headers, authorize) => {
    const exited = new Promise<void>(resolve => oracle.child.once('exit', () => resolve()))
    oracle.child.kill('SIGKILL'); await exited
    await new Promise<void>((resolve, reject) => { foreign.once('error', reject); foreign.listen(port, '127.0.0.1', resolve) })
    return direct(port, request, headers, authorize)
  })
  try {
    await expect(oracle.request({ method: 'POST', path: '/api/data', session: { uid: 'synthetic_u_1', bearer: true }, body: { encoding: 'utf8', data: '{}' } })).rejects.toThrow('Oracle is stopped')
    expect(hits).toBe(0); expect(bytes).toBe(0)
  } finally { spy.mockRestore(); foreign.closeAllConnections(); await new Promise<void>(resolve => foreign.close(() => resolve())); await oracle.stop() }
})

it('direct transport: keeps redirect bodies, binary bytes, duplicate cookies and application headers', async () => {
  let hits = 0
  const bytes = Buffer.from([0xff, 0x00, 0xfe])
  const server = createServer((_req, res) => {
    hits++
    res.writeHead(302, { Location: 'http://127.0.0.1:1/must-not-follow', 'Set-Cookie': ['a=1; HttpOnly', 'b=2; HttpOnly'], 'X-Future-Header': ['first', 'second'], 'Content-Length': bytes.length })
    res.end(bytes)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  try {
    const response = await transport.directRequest(address.port, { method: 'GET', path: '/' })
    expect(response.status).toBe(302)
    expect(decodeBytes(response.body)).toEqual(bytes)
    expect(response.headers['set-cookie']).toEqual(['a=1; HttpOnly', 'b=2; HttpOnly'])
    expect(response.headers['x-future-header']).toEqual(['first, second'])
    expect(response.headers['content-length']).toEqual(['3'])
    expect(hits).toBe(1)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})


it('direct transport: DELETE bodies use byte-accurate framing and reach the application', async () => {
  const body = Buffer.from('é 🏋 synthetic body')
  let received: Buffer | undefined, length: string | undefined
  const server = createServer((req, res) => {
    length = req.headers['content-length']
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(Buffer.from(chunk)))
    req.on('end', () => { received = Buffer.concat(chunks); res.end('received') })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  try {
    const response = await transport.directRequest(address.port, { method: 'DELETE', path: '/', body: { encoding: 'utf8', data: body.toString() } })
    expect(response.status).toBe(200)
    expect(length).toBe(String(body.length))
    expect(received).toEqual(body)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
})


it.each(['Expect', 'expect'])('oracle transport: %s cannot flush Bearers before socket authorization', async key => {
  const oracle = await startOracle(syntheticProfile(102))
  let hits = 0, bytes = 0, connections = 0
  const foreign = createServer((_req, res) => { hits++; res.end('foreign') })
  foreign.on('connection', socket => { connections++; socket.on('data', chunk => { bytes += chunk.length }) })
  await new Promise<void>(resolve => foreign.listen(0, '127.0.0.1', resolve))
  const address = foreign.address()
  if (!address || typeof address === 'string') throw new Error('No foreign port')
  const direct = transport.directRequest
  const spy = vi.spyOn(transport, 'directRequest').mockImplementation((_port, request, headers, authorize) => direct(address.port, request, headers, authorize))
  try {
    await expect(oracle.request({ method: 'POST', path: '/api/data', headers: { [key]: '100-continue' }, session: { uid: 'synthetic_u_1', bearer: true }, body: { encoding: 'utf8', data: '{}' } })).rejects.toThrow('rejects Expect headers before socket authorization')
    expect(hits).toBe(0); expect(bytes).toBe(0); expect(connections).toBe(0)
  } finally { spy.mockRestore(); foreign.closeAllConnections(); await new Promise<void>(resolve => foreign.close(() => resolve())); await oracle.stop() }
})
