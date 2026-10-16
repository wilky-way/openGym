import { onTestFinished } from 'vitest'
import { startOracle, mintSession, PINNED_NOW, decodeBytes, type Oracle, type SyntheticProfile } from '../src'
export async function startDataOracle(uid: string): Promise<Oracle> {
  const profile: SyntheticProfile = { seed: 1, now: PINNED_NOW, db: { users: [{ id: uid, name: 'Synthetic', created: new Date(PINNED_NOW).toISOString() }], creds: [], subs: [], invites: [] }, docs: {} }
  const oracle = await startOracle(profile)
  onTestFinished(() => oracle.stop())
  return oracle
}
export const headers = (uid: string) => ({ Cookie: `gymsid=${mintSession(uid, PINNED_NOW)}`, 'Content-Type': 'application/json' })

/** Legacy-style response access, always through the owned oracle transport. */
export async function oracleResponse(oracle: Oracle, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
  const response = await oracle.request({ method: options.method ?? 'GET', path, headers: options.headers, ...(options.body !== undefined ? { body: { encoding: 'utf8', data: options.body } as const } : {}) })
  const headers = new Headers()
  for (const [key, values] of Object.entries(response.headers)) for (const value of values) headers.append(key, value)
  return new Response(new Uint8Array(decodeBytes(response.body)), { status: response.status, headers })
}
