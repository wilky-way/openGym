import { nudgeMinute, NUDGE_LATEST_MINUTE, NUDGE_LOOKBACK_DAYS, NUDGE_MAX_MISSES, toneOf } from '@opengym/core/nudge'
import { effectiveRoutineIds } from '@opengym/core/history'
import { queueLiveOn } from '@opengym/core/queue'
import { excusedOn } from '@opengym/core/day-notes'
import type { AuthService } from './auth'
import type { PushService } from './push'
import type { createPresence } from './presence'
import { readStateDoc, listUsers, listSubs } from './storage'
import { dayReminderPush, nudgePush, type PushRoutine } from './push-messages'

export const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const records = (v: unknown) => Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Record<string, unknown>[] : []
export function userNow(tz: string, ms: unknown) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms as string | number))
    const g = (type: string) => parts.find(p => p.type === type)?.value
    const date = `${g('year')}-${g('month')}-${g('day')}`
    return { date, hhmm: `${g('hour')}:${g('minute')}`, weekday: new Date(date + 'T12:00:00Z').getUTCDay() }
  } catch { return null }
}
// Server queue fallback names the apply date in the user's zone; core's fallback is local.
export function serverState(state: unknown): Record<string, unknown> {
  const S = record(state), q = record(S.queue), reminder = record(S.reminder)
  let queue = S.queue
  if (Array.isArray(q.ids) && typeof q.startsOn !== 'string') {
    const ms = q.since || 0, tz = String(reminder.tz || 'UTC')
    queue = { ...q, startsOn: userNow(tz, ms)?.date || new Date(ms as string | number).toISOString().slice(0, 10) }
  }
  // Queue completion reads raw persisted workouts in legacy. A null row may throw
  // only when that queue path is evaluated; tick catches it without consuming today.
  return { ...S, routines: records(S.routines), workouts: S.workouts || [], week: S.week || {}, dayPlan: S.dayPlan || {}, queue }
}
/** Legacy server consumes only the first planned routine. Core remains unchanged. */
export function serverRoutineId(state: unknown, iso: string): string | null {
  const S = record(state)
  if (record(S.dayPlan)[iso] === 'rest') return null
  return effectiveRoutineIds(serverState(S), iso, iso)[0] || null
}
export function serverNudgeFor(state: unknown, iso: string): string | null {
  const raw = record(state), S = { ...raw, workouts: records(raw.workouts), routines: records(raw.routines) }
  const dayBefore = (d: string) => new Date(Date.parse(d + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)
  const logged = (d: string) => S.workouts.some(w => w.d === d)
  // Compatibility R2 adapter: scalar misses differ from core list misses on malformed
  // falsy IDs. Compose core primitives without changing the core nudge module.
  const missed = (d: string): string | null => {
    if (logged(d) || excusedOn(S, d)) return null
    const rid = serverRoutineId(S, d)
    if (!rid) return null
    if (queueLiveOn(serverState(S), d, d) && logged(dayBefore(d))) return null
    return rid
  }
  const rid = missed(iso)
  if (!rid) return null
  const last = S.workouts.reduce((m, w) => typeof w.d === 'string' && w.d < iso && w.d > m ? w.d : m, '')
  let d = dayBefore(iso), misses = 0
  for (let i = 0; i < NUDGE_LOOKBACK_DAYS && d > last; i++) {
    if (missed(d) && ++misses >= NUDGE_MAX_MISSES) return null
    d = dayBefore(d)
  }
  return rid
}
const minute = (v: unknown) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(v || ''))
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}
export function nudgeWindowOpen(time: unknown, hhmm: unknown): boolean {
  const at = nudgeMinute(time)
  return at !== null && minute(hhmm) >= at && minute(hhmm) <= NUDGE_LATEST_MINUTE
}
export function createReminders(auth: AuthService, push: PushService, presence: ReturnType<typeof createPresence>, log: (s: string) => void = console.warn) {
  const cache = new Map<string, { json: string; S: Record<string, unknown>; hitAt: number }>()
  function readStateCached(uid: string): Record<string, unknown> | null {
    const now = auth.now()
    for (const [id, hit] of cache) if (now - hit.hitAt > auth.config.stateCacheTtlMs) cache.delete(id)
    const row = readStateDoc(auth.db, uid)
    if (!row) { cache.delete(uid); return null }
    const hit = cache.get(uid)
    cache.delete(uid)
    const next = hit?.json === row.json ? { ...hit, hitAt: now } : { json: row.json, S: record(JSON.parse(row.json)), hitAt: now }
    cache.set(uid, next)
    while (cache.size > 64) cache.delete(cache.keys().next().value!)
    return next.S
  }
  async function tick(): Promise<void> {
    const pending: Promise<void>[] = []
    for (const user of listUsers(auth.db)) {
      if (!listSubs(auth.db, user.id).length) continue
      try {
        const S = readStateCached(user.id), reminder = record(S?.reminder)
        if (!S || !reminder.on) continue
        const now = userNow(String(reminder.tz || 'UTC'), auth.now())
        if (!now) continue
        const routine = (rid: string) => (S.routines as (PushRoutine & { id?: unknown } | null)[] | undefined)?.find(r => r?.id === rid)
        const at = nudgeMinute(reminder.time)
        if (reminder.nudge && user.last_nudge !== now.date && at !== null && minute(now.hhmm) >= at
          && minute(now.hhmm) <= NUDGE_LATEST_MINUTE && !presence.livePresence(user.id)) {
          const rid = serverNudgeFor(S, now.date)
          if (rid) {
            const r = routine(rid)
            log('nudge firing')
            auth.db.query('UPDATE users SET last_nudge=? WHERE id=?').run(now.date, user.id)
            push.persist()
            pending.push(push.sendPush(user.id, nudgePush(S.lang, toneOf(reminder), r, now.date)))
          }
        }
        const late = minute(now.hhmm) - minute(reminder.time)
        if (!(late >= 0 && late <= 15) || user.last_reminder === now.date) continue
        if ((S.workouts as Record<string, unknown>[] || []).some(w => w?.d === now.date) || excusedOn(S, now.date)) continue
        const rid = serverRoutineId(S, now.date)
        if (!rid) continue
        const r = routine(rid)
        log('reminder firing')
        auth.db.query('UPDATE users SET last_reminder=? WHERE id=?').run(now.date, user.id)
        push.persist()
        pending.push(push.sendPush(user.id, dayReminderPush(S.lang, r)))
      } catch { log('reminder tick failed') }
    }
    await Promise.all(pending)
  }
  return { tick, readStateCached, cacheSize: () => cache.size }
}
