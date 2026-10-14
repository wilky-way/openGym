import { test } from 'bun:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { readdirSync } from 'node:fs'
import { start } from './helpers'
import { json } from '../src/http'

test('a client that hangs up mid-body costs one log line and no stack', async () => {
  const h = start({}, { routes: app => {
    app.put('/api/data', async context => json(200, await context.get('body').readJson()))
  } })
  const aborts = 5
  for (let i = 0; i < aborts; i++) {
    await new Promise<void>(resolve => {
      const socket = net.connect(h.server.port!, '127.0.0.1', () => {
        socket.write('PUT /api/data HTTP/1.1\r\nHost: x\r\nContent-Length: 5000\r\n\r\n{"state":{')
        setTimeout(() => socket.destroy(), 30)
      })
      socket.on('error', () => {})
      socket.on('close', () => resolve())
    })
  }
  for (let i = 0; i < 50 && h.log.filter(line => line.includes('client went away mid-body')).length < aborts; i++) await Bun.sleep(10)
  assert.equal(h.server.pendingRequests, 0)
  assert.deepEqual(h.log.filter(line => /^\s+at /.test(line)), [])
  assert.equal(h.log.filter(line => line.includes('client went away mid-body')).length, aborts)
  assert.deepEqual(readdirSync(h.dataDir), [])
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200)
  // Reads after a disconnected body must not grow server state or strand request timers.
  assert.equal(h.log.filter(line => line === 'server error').length, 0)
})

test('an oversized client disconnect during draining does not strand the response stream', async () => {
  const h = start({}, { routes: app => {
    app.put('/api/data', async context => json(200, await context.get('body').readJson()))
  } })
  await new Promise<void>(resolve => {
    const socket = net.connect(h.server.port!, '127.0.0.1', () => {
      socket.write('PUT /api/data HTTP/1.1\r\nHost: x\r\nContent-Length: 9999999\r\n\r\n')
      socket.write('x'.repeat(6 * 1024 * 1024))
    })
    socket.on('data', () => socket.destroy())
    socket.on('error', () => {})
    socket.on('close', () => resolve())
  })
  for (let i = 0; i < 50 && h.server.pendingRequests; i++) await Bun.sleep(10)
  assert.equal(h.server.pendingRequests, 0)
  assert.equal((await fetch(`${h.api}/api/health`)).status, 200)
  assert.equal(h.log.filter(line => /server error|^\s+at /.test(line)).length, 0)
})
