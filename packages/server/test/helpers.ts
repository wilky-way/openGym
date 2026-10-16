import { afterEach } from 'bun:test'
import { mkdtempSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { startServer } from '../src/index'
import { loadConfig, type Environment } from '../src/config'
import type { AppServices } from '../src/app'

const resources: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const dispose of resources.splice(0).reverse()) await dispose() })
export function start(env: Environment = {}, services: AppServices = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'gym-s01-'))
  const log: string[] = []
  const config = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', INVITE_ONLY: '0', ...env }, [], line => log.push(line))
  const server = startServer(config, { log: line => log.push(line), ...services }, line => log.push(line))
  resources.push(async () => { await server.stop(true); chmodSync(dataDir, 0o700); rmSync(dataDir, { recursive: true, force: true }) })
  return { server, config, dataDir, log, api: `http://127.0.0.1:${server.port}` }
}
export function raw(port: number, target: string, method = 'GET', headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    let response = ''
    const extra = Object.entries(headers).map(([key, value]) => `${key}: ${value}\r\n`).join('')
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`${method} ${target} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n${extra}\r\n`))
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('raw request timeout')) }, 3000)
    socket.on('data', chunk => response += chunk)
    socket.on('error', reject)
    socket.on('close', () => { clearTimeout(timeout); resolve(response) })
  })
}

// Shared fixtures for storage tests. Everything runs on temporary directories; no live data is touched.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { UserRow } from '../src/storage'

const dirs: string[] = []

/** A fresh temporary data directory, removed after the test. */
export function scratchDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-s02-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

export function user(id: string, ord = 0, extra: Partial<UserRow> = {}): UserRow {
  return {
    id, name: `name-${id}`, created: '2026-10-01T00:00:00.000Z', admin: 0, disabled: 0, sv: 0,
    invited_by: null, last_pull: null, last_reminder: null, last_nudge: null, ord, x: '{}', ...extra,
  }
}

/** A state document text in the legacy key order: _rev and _wid first, then the content. */
export function stateText(rev: number, wid: string, body = 'x'): string {
  return JSON.stringify({ _rev: rev, _wid: wid, _ts: 1_700_000_000_000 + rev, body })
}
