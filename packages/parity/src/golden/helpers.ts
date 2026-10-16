import type { TranscriptRecorder } from '../transcript'
import { fixtureDocs, jsonBody, type Bytes, type Json, type ParityResponse, type ParityTarget, type SyntheticProfile, type StoredDocs } from '../types'

/** One recorder per scenario; `uid` is the synthetic user the scenario signs in as. */
export interface Ctx { rec: TranscriptRecorder; target: ParityTarget; uid: string; profile: SyntheticProfile }

export interface GoldenScenario {
  id: string
  /** Legacy `METHOD /api/...` keys this scenario exercises (routes it asserts on). */
  routes: string[]
  /** INV numbers from SYNC-CONTRACT §5 this scenario exercises on the wire. */
  invs: number[]
  seed: number
  run(ctx: Ctx): Promise<void>
}

export function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`golden expectation failed: ${message}`)
}

export interface CallOptions {
  /** Sign in as `uid` via the session cookie (default) or a Bearer token. */
  bearer?: boolean
  /** Session uid override (for cross-user checks); defaults to ctx uid. */
  as?: string
  headers?: Record<string, string>
  /** JSON body, or a raw UTF-8 string sent verbatim (malformed/oversized bodies). */
  body?: Json | { raw: string }
  anonymous?: boolean
}

export async function call(ctx: Ctx, method: string, path: string, options: CallOptions = {}): Promise<ParityResponse> {
  const body: Bytes | undefined = options.body === undefined ? undefined
    : typeof options.body === 'object' && options.body !== null && 'raw' in options.body ? { encoding: 'utf8', data: (options.body as { raw: string }).raw }
    : jsonBody(options.body as Json)
  const headers = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  return ctx.rec.request({
    method, path, headers, ...(body ? { body } : {}),
    ...(options.anonymous ? {} : { session: { uid: options.as ?? ctx.uid, bearer: options.bearer === true } })
  })
}

export function jsonOf<T = Record<string, unknown>>(response: ParityResponse): T {
  return JSON.parse(Buffer.from(response.body.data, response.body.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8')) as T
}

export const put = (ctx: Ctx, body: Json, options: CallOptions = {}) => call(ctx, 'PUT', '/api/data', { ...options, body })
export const getData = (ctx: Ctx) => call(ctx, 'GET', '/api/data')
export const getRev = (ctx: Ctx) => call(ctx, 'GET', '/api/data/rev')

/** Current revision and write id as the server reports them. */
export async function revOf(ctx: Ctx): Promise<{ rev: number; wid?: string }> {
  return jsonOf<{ rev: number; wid?: string }>(await getRev(ctx))
}

/** Restores authored (UTF-8) fixture documents through the recorder. */
export const restore = (ctx: Ctx, docs: Record<string, string>) => ctx.rec.restoreDocs(fixtureDocs(docs))

/** The raw stored document (every bookkeeping field), read without recording a request. */
export async function rawStored(ctx: Ctx): Promise<Record<string, any> | null> {
  const raw = (await ctx.target.storedDocs())[ctx.uid]
  return raw === undefined ? null : JSON.parse(raw.toString('utf8'))
}

/** The stored document for the scenario's user, after the last write. */
export async function storedOf(ctx: Ctx): Promise<Record<string, unknown> | null> {
  const doc = (await ctx.rec.request({ method: 'GET', path: '/api/data', session: { uid: ctx.uid } }))
  const state = jsonOf<{ state: Record<string, unknown> | null }>(doc).state
  return state
}
