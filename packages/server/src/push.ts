import webpush, { type PushSubscription, type RequestOptions, type VapidKeys } from 'web-push'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthService } from './auth'
import { atomicWrite, deleteSub, listSubs, writeAccountsMirror, type SubRow } from './storage'
import { createPushGuard } from './push-address'
import { restTimerPush, type PushPayload } from './push-messages'

export const deviceIdOf = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : undefined
export interface Scheduler {
  set: (fn: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}
const scheduler: Scheduler = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h as ReturnType<typeof setTimeout>) }
export interface PushOptions {
  send?: (subscription: PushSubscription, body: string, options: RequestOptions) => Promise<unknown>
  persist?: () => void
  scheduler?: Scheduler
  log?: (message: string) => void
}
export function loadVapid(dataDir: string): VapidKeys {
  const file = join(dataDir, 'vapid.json')
  let keys: unknown
  try { keys = JSON.parse(readFileSync(file, 'utf8')) }
  catch { keys = webpush.generateVAPIDKeys(); atomicWrite(file, JSON.stringify(keys), 0o600) }
  if (!keys || typeof keys !== 'object' || !('publicKey' in keys) || !('privateKey' in keys)
    || typeof keys.publicKey !== 'string' || typeof keys.privateKey !== 'string') throw new Error('invalid vapid.json')
  // Validate existing keys without replacing them or changing web-push's global singleton.
  webpush.getVapidHeaders('https://push.example', 'mailto:admin@localhost', keys.publicKey, keys.privateKey, 'aes128gcm')
  return { publicKey: keys.publicKey, privateKey: keys.privateKey }
}
export function createPush(auth: AuthService, options: PushOptions = {}) {
  const { db, config } = auth, log = options.log ?? console.warn
  const vapid = loadVapid(config.dataDir), guard = createPushGuard(config.allowedPrivateIps, log)
  const transport = options.send ?? webpush.sendNotification
  const persist = options.persist ?? (() => writeAccountsMirror(db, config.dataDir))
  const timers = new Map<string, unknown>(), clock = options.scheduler ?? scheduler
  // A failed mirror save is retried on the next send; SQLite already holds the pruned rows.
  let dirty = false
  const dead = new Set<string>()
  const report = (message: string) => { try { log(message) } catch { /* best effort */ } }
  async function sendPush(uid: string, payload: PushPayload, deviceId?: string): Promise<void> {
    let subs = listSubs(db, uid).filter(s => !dead.has(s.endpoint))
    if (deviceId) subs = subs.filter(s => !s.device_id || s.device_id === deviceId)
    const body = JSON.stringify(payload)
    let next = 0
    const prune = (sub: SubRow) => { dead.add(sub.endpoint); dirty = true }
    const worker = async () => {
      while (next < subs.length) {
        const sub = subs[next++]!
        const bad = guard.pushEndpointError(sub.endpoint)
        if (bad) { report('push endpoint refused'); prune(sub); continue }
        try {
          await transport({ endpoint: new URL(sub.endpoint).href, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body,
            { urgency: 'high', timeout: 10000, agent: guard.agent,
              vapidDetails: { subject: config.vapidSubject, ...vapid } })
        } catch (error) {
          const e = error as { statusCode?: number; body?: string; message?: string }
          report('push send failed')
          if ([403, 404, 410].includes(e?.statusCode ?? 0)) prune(sub)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, subs.length) }, worker))
    if (dirty) try {
      for (const endpoint of dead) deleteSub(db, endpoint)
      persist(); dead.clear(); dirty = false
    } catch { report('push: could not save db.json') }
  }
  const restKey = (uid: string, deviceId?: string) => `${uid}:${deviceId || ''}`
  function scheduleRestTimer(uid: string, deviceId: string | undefined, sec: number, lang?: unknown) {
    const k = restKey(uid, deviceId)
    if (timers.has(k)) clock.clear(timers.get(k))
    timers.set(k, clock.set(() => {
      timers.delete(k)
      void sendPush(uid, restTimerPush(lang), deviceId).catch(() => report('push rest timer failed'))
    }, sec * 1000))
  }
  function cancelRestTimer(uid: string, deviceId?: string) {
    for (const [k, t] of timers) if (deviceId ? k === restKey(uid, deviceId) : k.startsWith(uid + ':')) {
      clock.clear(t); timers.delete(k)
    }
  }
  function close() { for (const t of timers.values()) clock.clear(t); timers.clear(); guard.agent.destroy() }
  return { vapid, guard, sendPush, scheduleRestTimer, cancelRestTimer, persist, close,
    // A re-subscribe heals a dead row, including an earlier failed prune save.
    revive: (endpoint: string) => { dead.delete(endpoint) } }
}
export type PushService = ReturnType<typeof createPush>
