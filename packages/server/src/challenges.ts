import { randomBytes } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import { getMeta, setMeta } from './storage/repos'
export type OwnershipProof = {
  uid: string; sv: number; generation: number; credentialId: string; publicKey: string; deviceId: string
  /** Only legacy tokens can migrate to a successor device; persist their hash, never the token. */
  predecessorHash?: string
}
// Auxiliary auth state lives in meta; no frozen-schema migration or session-token change.
export const challengeGeneration = (db: Database, uid: string): number =>
  Number(getMeta(db, `challenge_generation:${uid}`) ?? '0')
/** Caller holds the revocation/removal transaction, so invalidation commits atomically. */
export function invalidateChallenges(db: Database, uid: string): void {
  setMeta(db, `challenge_generation:${uid}`, String(challengeGeneration(db, uid) + 1))
}
export type Challenge = (
  | { kind: 'login' }
  | { kind: 'register'; uid: string; name: string; code: string }
  | { kind: 'add'; uid: string; ownership: OwnershipProof; proof: 'passkey' }
  | { kind: 'link'; uid: string; lh: string; ownership: OwnershipProof }
) & { challenge: string }
export const CHALLENGE_TTL_MS = 5 * 60000
export const MAX_CHALLENGES = 20000
/** One-shot, route-bound and bounded. Sweeping is lazy, avoiding a service-owned timer. */
export function createChallenges(now: () => number = Date.now, max = MAX_CHALLENGES) {
  const rows = new Map<string, Challenge & { exp: number }>()
  let swept = now()
  return {
    put(data: Challenge): string {
      if (now() - swept >= 60000) {
        for (const [k, c] of rows) if (c.exp < now()) rows.delete(k)
        swept = now()
      }
      while (rows.size >= max) rows.delete(rows.keys().next().value!)
      const cid = randomBytes(16).toString('base64url')
      rows.set(cid, { ...data, exp: now() + CHALLENGE_TTL_MS })
      return cid
    },
    take(cid: unknown): Challenge | null {
      if (typeof cid !== 'string') return null
      const c = rows.get(cid)
      rows.delete(cid)
      return c && c.exp >= now() ? c : null
    },
  }
}
