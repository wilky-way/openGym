import { test, expect, spyOn } from 'bun:test'
import { createAuth } from '../src/auth'
import { loadConfig } from '../src/config'
import { startServer } from '../src/index'
import { createNotifications } from '../src/notifications'
import { openStore, putUser, putSub, commitStateDoc } from '../src/storage'
import { scratchDir, user } from './helpers'

test('server boot starts periodic notifications and stop clears intervals and pending rest timers', async () => {
  const dataDir = scratchDir(), store = openStore(dataDir)
  const now = Date.parse('2026-09-07T20:05:00Z')
  const config = loadConfig({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir,
    REMINDER_TICK_MS: '1000', AUDIT_LOG: '0' })
  const auth = createAuth(store.db, config, { now: () => now })
  putUser(store.db, user('u1'))
  putSub(store.db, { user_id: 'u1', endpoint: 'https://push.example/u1', p256dh: 'p', auth: 'a',
    device_id: null, created: new Date(now).toISOString(), ord: 0 })
  commitStateDoc(store.db, 'u1', JSON.stringify({ _rev: 1, workouts: [], routines: [{ id: 'r1' }],
    week: { 1: 'r1' }, reminder: { on: true, time: '20:05', tz: 'UTC' } }), now, 5)
  const pendingRest = new Map<object, () => void>(), sent: any[] = []
  const notifications = createNotifications(auth, {
    send: async (_sub, body) => { sent.push(JSON.parse(body)) },
    scheduler: { set: fn => { const handle = {}; pendingRest.set(handle, fn); return handle },
      clear: handle => { pendingRest.delete(handle as object) } },
    log: () => {},
  })
  const intervals = new Map<object, { fn: () => void; ms: number; unref: boolean }>()
  const intervalSpy = spyOn(globalThis, 'setInterval').mockImplementation(((fn: any, ms?: number) => {
    const row = { fn, ms: ms!, unref: false }
    const handle = { unref() { row.unref = true; return handle } }
    intervals.set(handle, row)
    return handle as any
  }) as typeof setInterval)
  const clearSpy = spyOn(globalThis, 'clearInterval').mockImplementation((handle: any) => { intervals.delete(handle) })
  const sweepSpy = spyOn(notifications.presence, 'sweep')
  let server: ReturnType<typeof startServer> | undefined
  try {
    server = startServer(config, { auth, notifications }, () => {})
    expect([...intervals.values()].map(row => row.ms).sort((a, b) => a - b)).toEqual([1000, 30000])
    expect([...intervals.values()].every(row => row.unref)).toBe(true)
    notifications.start()
    expect(intervals.size).toBe(2)
    ;[...intervals.values()].find(row => row.ms === 1000)!.fn()
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(sent.map(body => body.tag)).toEqual(['day-reminder'])
    ;[...intervals.values()].find(row => row.ms === 30000)!.fn()
    expect(sweepSpy).toHaveBeenCalledTimes(1)
    notifications.push.scheduleRestTimer('u1', undefined, 60)
    expect(pendingRest.size).toBe(1)
    await server.stop(true)
    expect(intervals.size).toBe(0)
    expect(pendingRest.size).toBe(0)
    expect(sent).toHaveLength(1)
  } finally {
    await server?.stop(true)
    notifications.close()
    intervalSpy.mockRestore(); clearSpy.mockRestore(); sweepSpy.mockRestore()
    store.close()
  }
})
