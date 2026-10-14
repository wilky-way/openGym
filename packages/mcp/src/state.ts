import { AsyncLocalStorage } from 'node:async_hooks'
import { ApiClient, redactCredentials, type Environment, type Fetcher, error } from './http-client'

// The legacy state is deliberately open: unknown synced keys must survive verbatim.
export type LegacyState = Record<string, any>
interface Context { state: LegacyState | null; user: { id: string; name: string; created: string | null }; client?: ApiClient }
const context = new AsyncLocalStorage<Context>()
const redaction = new AsyncLocalStorage<{ client?: ApiClient; credentials: string[] }>()
/** Local tools reuse retained initial/renewed credentials without doing HTTP. */
export function redactToolCredentials<T>(value: T): T {
  const scope = redaction.getStore(), client = scope?.client ?? currentClient()
  return client ? client.redactCredentials(value) : redactCredentials(value, scope?.credentials)
}
export function withToolRedaction<T>(run: () => T, options: { env?: Environment; fetcher?: Fetcher } = {}): T {
  const env = options.env ?? process.env
  const key = JSON.stringify([env.OPENGYM_URL, env.OPENGYM_TOKEN, env.OPENGYM_UID])
  const client = cachedClient?.key === key && cachedClient.fetcher === options.fetcher ? cachedClient.client : undefined
  const fail = (failure: unknown): never => {
    if (failure instanceof Error) {
      const safe = redactToolCredentials({ ...failure, message: failure.message, name: failure.name })
      throw Object.assign(new Error(safe.message), safe)
    }
    throw redactToolCredentials(failure)
  }
  return redaction.run({ client, credentials: env.OPENGYM_TOKEN ? [env.OPENGYM_TOKEN] : [] }, () => {
    try {
      const result = run()
      return result instanceof Promise ? result.then(redactToolCredentials, fail) as T : redactToolCredentials(result)
    } catch (failure) { return fail(failure) }
  })
}
let seed: Context | undefined
let cachedClient: { key: string; fetcher: Fetcher | undefined; client: ApiClient } | undefined
let cached: { client: ApiClient; rev: number; wid: string | null; state: LegacyState | null } | undefined
export function clientFor(env: Environment = process.env, fetcher?: Fetcher): ApiClient {
  const key = JSON.stringify([env.OPENGYM_URL, env.OPENGYM_TOKEN, env.OPENGYM_UID])
  if (!cachedClient || key !== cachedClient.key || fetcher !== cachedClient.fetcher) {
    cachedClient = { key, fetcher, client: new ApiClient({ ...env }, fetcher) }; cached = undefined
  }
  Object.assign(cachedClient.client.env, env)
  return cachedClient.client
}
export function invalidate(client: ApiClient): void { if (cached?.client === client) cached = undefined }
export async function withRemoteState<T>(run: () => T | Promise<T>, options: { env?: Environment; fetcher?: Fetcher } = {}): Promise<T> {
  const client = clientFor(options.env, options.fetcher)
  const scope = redaction.getStore(); if (scope) scope.client = client
  const user = await client.checkProfile()
  const revision = await client.request<{ rev: number; wid?: string }>('GET', '/api/data/rev')
  if (!Number.isSafeInteger(revision.rev) || revision.rev < 0 || revision.wid !== undefined && typeof revision.wid !== 'string') throw error('API_UNAVAILABLE', 'The openGym API returned an invalid revision.')
  // The data API uses revision zero without a wid for absent and unreadable documents.
  // A cached absence cannot distinguish those states, so revalidate it every call.
  if (!cached || cached.state === null || cached.client !== client || cached.rev !== revision.rev || cached.wid !== (revision.wid || null)) {
    const got = await client.request<{ rev: number; state: LegacyState | null }>('GET', '/api/data')
    if (!Number.isSafeInteger(got.rev) || got.rev < 0 || got.state !== null && (!got.state || typeof got.state !== 'object' || Array.isArray(got.state))) throw error('API_UNAVAILABLE', 'The openGym API returned an invalid state.')
    const state = got.state ? Object.assign(defaultsShape(), got.state, { _rev: got.rev }) : null
    cached = { client, rev: got.rev, wid: state?._wid || null, state }
  }
  // One caller cannot contaminate another tool's cached doc or mutable programme helpers.
  return context.run({ user, client, state: structuredClone(cached.state) }, run)
}
export function getState(): any {
  const value = context.getStore() ?? seed
  if (!value) throw error('CONFIG_REQUIRED', 'Read tools must run through authenticated HTTP state.')
  return value.state
}
export function getUser() {
  const value = context.getStore() ?? seed
  if (!value) throw error('CONFIG_REQUIRED', 'Set OPENGYM_UID for this MCP profile.')
  return value.user
}
export function currentClient(): ApiClient | undefined { return context.getStore()?.client }
export function _seedStateForTests(state: LegacyState | null): void {
  seed = { state, user: { id: 'test-uid', name: 'Test', created: '2026-07-26T00:00:00.000Z' } }
}
function defaultsShape(): LegacyState {
  return { unit: 'kg', restSec: 90, sound: true, lang: 'en', theme: 'dark', accent: 'lime', body: 'male', targetW: null,
    bodyweight: [], routines: [], week: {}, dayPlan: {}, exWeights: {}, workouts: [], customEx: [], gifSize: 'full', reminder: { on: false, time: '08:00', tz: null } }
}
