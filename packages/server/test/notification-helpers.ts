import { afterEach, test as bunTest } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAuth } from '../src/auth'
import { loadConfig, type Environment } from '../src/config'
import { createNotifications } from '../src/notifications'
import { startServer } from '../src/index'
import { openStore, putUser, putSub, commitStateDoc } from '../src/storage'
import { scratchDir, user } from './helpers'
import { SECRET, mint } from './auth-helpers'
import type { PushOptions } from '../src/push'

export const T0 = Date.parse('2026-09-07T20:05:00Z')
export const test = (name: string, fn: (t: { after: typeof afterEach }) => void | Promise<unknown>) => bunTest(name, () => fn({ after: afterEach }))
export const keys = { p256dh: 'p', auth: 'a' }
export const cookie = { Cookie: `gymsid=${mint('u_test_1', 30, 0, T0)}` }
export const other = { Cookie: `gymsid=${mint('u_test_2', 30, 0, T0)}` }
const fixtures: {advance: (ms: number) => Promise<void>}[] = []
afterEach(() => { fixtures.length = 0 })
export function fixture(subs: any[] = [], options: PushOptions = {}, env: Environment = {}, ids = ['u_test_1', 'u_test_2']) {
  const dataDir = scratchDir(), store = openStore(dataDir), clock = { t: T0 }, lines: string[] = []
  for (const [i, id] of ids.entries()) putUser(store.db, user(id, i))
  for (const [i, s] of subs.entries()) putSub(store.db, {
    endpoint: s.endpoint, user_id: s.userId, p256dh: s.keys.p256dh, auth: s.keys.auth,
    device_id: s.deviceId || null, created: s.created || new Date(T0).toISOString(), ord: i,
  })
  const config = loadConfig({ INVITE_ONLY: '0', PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080',
    REMINDER_TICK_MS: '1000000', AUDIT_LOG: '0', ...env })
  const auth = createAuth(store.db, config, { secret: SECRET, now: () => clock.t })
  const timers = new Map<number, { fn: () => void; at: number }>(), scheduled: number[] = []
  let sequence = 0
  const sent: any[] = []
  const notifications = createNotifications(auth, {
    send: async (sub, body, requestOptions) => {
      sent.push({ sub, body: JSON.parse(body), options: requestOptions })
      // No outbound sockets: emulate the legacy localhost failure for routing assertions.
      if (new URL(sub.endpoint).hostname === 'localhost') throw new Error('refusing to connect to a private address')
    },
    scheduler: { set: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, at: clock.t + ms }); scheduled.push(ms); return id },
      clear: h => { timers.delete(h as number) } },
    log: s => lines.push(s), ...options,
  })
  const server = startServer(config, { auth, notifications, now: auth.now, log: s => lines.push(s) }, () => {})
  notifications.close() // Stop periodic wall-clock scheduling; ticks and timer scheduler are explicitly driven below.
  const h = {
    dataDir, api: `http://127.0.0.1:${server.port}`, port: server.port!, clock, store, auth, notifications, sent, scheduled,
    get log() { return lines.join('\n') },
    db: () => JSON.parse(readFileSync(join(dataDir, 'db.json'), 'utf8')),
    write: (S: unknown, uid = ids[0]!) => commitStateDoc(store.db, uid, JSON.stringify({ _rev: 1, ...S as object }), clock.t, 5),
    at: async (ms: number) => { clock.t = ms; await h.flush() },
    advance: async (ms: number) => { clock.t += ms; await h.flush() },
    flush: async () => {
      for (const [id, timer] of timers) if (timer.at <= clock.t) { timers.delete(id); timer.fn() }
      for (let i = 0; i < 10; i++) await Promise.resolve()
    },
    tick: () => notifications.reminders.tick(),
  }
  afterEach(async () => { await server.stop(true); store.close() })
  fixtures.push(h)
  return h
}
export const wait = async (ms: number) => { for (const h of fixtures) await h.advance(ms) }
export const post = (h: ReturnType<typeof fixture>, path: string, body?: unknown, hdr: HeadersInit = cookie) =>
  fetch(h.api + path, { method: 'POST', headers: hdr, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
export const status = (h: ReturnType<typeof fixture>, endpoint: string, hdr = cookie) =>
  fetch(`${h.api}/api/push/status?endpoint=${encodeURIComponent(endpoint)}`, { headers: hdr }).then(r => r.json())
export const readDb = (h: ReturnType<typeof fixture>) => h.db()
