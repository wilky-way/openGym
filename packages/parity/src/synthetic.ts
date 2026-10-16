import type { Json, SyntheticProfile } from './types'
export const PINNED_NOW = Date.parse('2026-10-12T12:00:00.000Z')
/** Small deterministic PRNG; seed/version are recorded with every transcript. */
export function syntheticProfile(seed = 20261012, options: { users?: number; workouts?: number; now?: number } = {}): SyntheticProfile {
  if (!Number.isInteger(seed)) throw new Error('Synthetic seed must be an integer')
  const users = options.users ?? 2, workouts = options.workouts ?? 3, now = options.now ?? PINNED_NOW
  if (!Number.isInteger(users) || users < 1 || users > 20 || !Number.isInteger(workouts) || workouts < 0 || workouts > 1000 || !Number.isFinite(now)) throw new Error('Invalid synthetic profile size/clock')
  let state = seed >>> 0 || 1
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x100000000 }
  const db: SyntheticProfile['db'] = { users: [], creds: [], subs: [], invites: [] }, docs: Record<string, string> = {}
  for (let u = 0; u < users; u++) {
    const uid = `synthetic_u_${u + 1}`
    db.users.push({ id: uid, name: `Synthetic ${u + 1}`, created: new Date(now - 86400000).toISOString(), ...(u === 0 ? { admin: true } : {}) })
    const sessions: Json[] = []
    for (let w = 0; w < workouts; w++) {
      const start = now - (workouts - w) * 86400000
      sessions.push({ id: `synthetic_w_${u}_${w}`, d: new Date(start).toISOString().slice(0, 10), name: 'Synthetic session', start, end: start + 3600000,
        entries: [{ id: 'synthetic_ex', sets: [{ r: 5 + Math.floor(random() * 8), w: 20 + Math.floor(random() * 20) * 2.5, done: true }], futureEntry: { keep: true } }] })
    }
    docs[uid] = JSON.stringify({ _ts: now - 10000, _rev: 0, workouts: sessions,
      routines: [{ id: `synthetic_r_${u}`, name: 'Synthetic routine', ex: [{ id: 'synthetic_ex', sets: 3, reps: 8, weight: 40, futureExercise: ['keep'] }] }],
      unit: 'kg', restSec: 90, deleted: { workouts: { synthetic_removed: now - 20000 } }, edited: { restSec: now - 10000 },
      bodyweight: [{ d: '2026-10-01', w: 80 + random(), t: now - 30000 }], futureTop: { z: 1, a: ['retain order'] } })
  }
  return { seed, now, db, docs }
}
