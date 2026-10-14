import { ApiError } from './http'
const numeric = (value: unknown) => {
  try { return Number(value) } catch { throw new ApiError(400, 'bad request') }
}
const text = (v: unknown) => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
export interface LivePresence {
  name: string; exIdx: number; exTotal: number; setsDone: number; setsTotal: number
  startedAt: number; updatedAt: number
  [key: string]: unknown
}
export function createPresence(now: () => number = Date.now) {
  const rows = new Map<string, LivePresence & { hiddenAt?: number }>()
  function livePresence(uid: string): LivePresence | null {
    const p = rows.get(uid)
    if (!p) return null
    if (now() - p.updatedAt >= 70000 || (p.hiddenAt !== undefined && now() - p.hiddenAt >= 45000)) {
      rows.delete(uid); return null
    }
    const { hiddenAt: _hidden, ...live } = p
    return live
  }
  function activity(uid: string, body: Record<string, unknown>): void {
    if (body.active) rows.set(uid, {
      name: text(body.name).slice(0, 60), exIdx: numeric(body.exIdx) || 0, exTotal: numeric(body.exTotal) || 0,
      setsDone: numeric(body.setsDone) || 0, setsTotal: numeric(body.setsTotal) || 0,
      startedAt: numeric(body.startedAt) || now(), updatedAt: now(),
    })
    else if (body.reason === 'hidden') {
      const p = rows.get(uid)
      if (p && p.hiddenAt === undefined) p.hiddenAt = now()
    } else rows.delete(uid)
  }
  return { activity, livePresence, dropPresence: (uid: string) => { rows.delete(uid) },
    sweep: () => { for (const uid of rows.keys()) livePresence(uid) } }
}
