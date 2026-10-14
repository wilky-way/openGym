import type { AuthService } from './auth'
import { createPush, deviceIdOf, type PushOptions } from './push'
import { createPresence } from './presence'
import { createReminders, record } from './reminders'
import { listSubs, listAllSubs, putSub, deleteSub } from './storage'
import { ApiError, json } from './http'
import { testPush } from './push-messages'
import type { GymApp, AppEnv } from './app'
import type { Context } from 'hono'

export function createNotifications(auth: AuthService, options: PushOptions = {}) {
  const push = createPush(auth, options), presence = createPresence(auth.now)
  const reminders = createReminders(auth, push, presence, options.log)
  let reminderTimer: ReturnType<typeof setInterval> | undefined, presenceTimer: ReturnType<typeof setInterval> | undefined
  function start() {
    if (reminderTimer) return
    reminderTimer = setInterval(() => { void reminders.tick() }, auth.config.reminderTickMs).unref()
    presenceTimer = setInterval(presence.sweep, 30000).unref()
  }
  function close() { clearInterval(reminderTimer); clearInterval(presenceTimer); reminderTimer = undefined; push.close() }
  return { push, presence, reminders, start, close, livePresence: presence.livePresence, dropPresence: presence.dropPresence }
}
export type Notifications = ReturnType<typeof createNotifications>
export function installNotifications(app: GymApp, auth: AuthService, service: Notifications) {
  const { push, presence, reminders } = service
  const uid = (c: Context<AppEnv>) => {
    const s = c.get('session')
    if (!s) throw new ApiError(401, 'not signed in')
    return s.user.id
  }
  app.get('/api/push/public-key', () => json(200, { key: push.vapid.publicKey }))
  app.post('/api/push/subscribe', async c => {
    const id = uid(c), body = await c.get('body').readJson()
    const sub = record(body.subscription), keys = record(sub.keys)
    if (!sub.endpoint || !keys.p256dh || !keys.auth) throw new ApiError(400, 'invalid subscription')
    let p256dh: string, authKey: string
    try { p256dh = String(keys.p256dh); authKey = String(keys.auth) }
    catch { throw new ApiError(400, 'invalid subscription') }
    const bad = push.guard.pushEndpointError(sub.endpoint)
    if (bad) throw new ApiError(400, bad)
    auth.db.transaction(() => {
      const prev = listAllSubs(auth.db).find(s => s.endpoint === sub.endpoint)
      if (prev && prev.user_id !== id) throw new ApiError(409, 'subscription belongs to another account')
      deleteSub(auth.db, String(sub.endpoint))
      const mine = listSubs(auth.db, id)
      if (mine.length >= 20) for (const s of mine.slice(0, mine.length - 20 + 1)) deleteSub(auth.db, s.endpoint)
      const ord = Math.max(-1, ...listAllSubs(auth.db).map(s => s.ord)) + 1
      putSub(auth.db, { user_id: id, endpoint: String(sub.endpoint), p256dh, auth: authKey,
        device_id: deviceIdOf(body.deviceId) || prev?.device_id || null, created: prev?.created || new Date(auth.now()).toISOString(), ord })
    }).immediate()
    push.revive(String(sub.endpoint))
    push.persist()
    return json(200, { ok: true })
  })
  app.get('/api/push/status', c => {
    const row = listSubs(auth.db, uid(c)).find(s => s.endpoint === (c.req.query('endpoint') || ''))
    return json(200, row ? { subscribed: true, deviceId: row.device_id || null } : { subscribed: false })
  })
  app.post('/api/push/unsubscribe', async c => {
    const id = uid(c), body = await c.get('body').readJson()
    for (const s of listSubs(auth.db, id)) if (s.endpoint === body.endpoint) deleteSub(auth.db, s.endpoint)
    push.persist()
    return json(200, { ok: true })
  })
  app.post('/api/push/test', async c => {
    const id = uid(c)
    await push.sendPush(id, testPush(reminders.readStateCached(id)?.lang))
    return json(200, { ok: true })
  })
  app.post('/api/push/rest-timer', async c => {
    const id = uid(c), body = await c.get('body').readJson(), raw = body.seconds
    const n = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN
    if (!(n >= 1)) throw new ApiError(400, 'seconds required')
    push.scheduleRestTimer(id, deviceIdOf(body.deviceId), Math.min(3600, Math.round(n)), reminders.readStateCached(id)?.lang)
    return json(200, { ok: true })
  })
  app.post('/api/push/rest-timer/cancel', async c => {
    const id = uid(c), body = await c.get('body').readJson()
    push.cancelRestTimer(id, deviceIdOf(body.deviceId))
    return json(200, { ok: true })
  })
  app.post('/api/activity', async c => {
    const id = uid(c), body = await c.get('body').readJson()
    presence.activity(id, body)
    return json(200, { ok: true })
  })
}
