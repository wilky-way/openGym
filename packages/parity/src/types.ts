/** Portable, JSON-serialisable transcript types; no live credentials or data. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface SyntheticProfile {
  seed: number
  now: number
  db: { users: { id: string; name: string; created: string; sv?: number; admin?: boolean }[]; creds: Json[]; subs: Json[]; invites: Json[] }
  /** Verbatim JSON, rather than objects that a storage implementation can reorder. */
  docs: Record<string, string>
}
export type StoredDocs = Record<string, Buffer>
export type SerializedDocs = Record<string, Bytes>
export const fixtureDocs = (docs: Record<string, string>): StoredDocs => Object.fromEntries(Object.entries(docs).map(([uid, raw]) => [uid, Buffer.from(raw)]))
export const encodeDocs = (docs: StoredDocs): SerializedDocs => Object.fromEntries(Object.entries(docs).map(([uid, raw]) => [uid, encodeBytes(raw)]))
export const decodeDocs = (docs: SerializedDocs): StoredDocs => Object.fromEntries(Object.entries(docs).map(([uid, raw]) => [uid, decodeBytes(raw)]))
export interface Bytes { encoding: 'utf8' | 'base64'; data: string }
export interface ParityRequest {
  method: string
  path: string
  headers?: Record<string, string>
  body?: Bytes
  session?: { uid: string; sv?: number; bearer?: boolean; expires?: number }
}
export interface ParityResponse { status: number; headers: Record<string, string[]>; body: Bytes }
/** S02/S04 provide authoritative SQLite JSON bytes as Buffers, never a stale JSON mirror. */
export interface ParityTarget {
  request(request: ParityRequest): Promise<ParityResponse>
  storedDocs(): Promise<StoredDocs>
  setTime(now: number): Promise<void>
  /** Test-only rewind/reset fixture hook; production transports do not expose it. */
  restoreDocs?(docs: StoredDocs): Promise<void>
}
export type TranscriptStep =
  | { kind: 'request'; request: ParityRequest; response: ParityResponse; docs?: SerializedDocs }
  | { kind: 'clock'; now: number }
  | { kind: 'restore'; docs: SerializedDocs }
export interface Transcript {
  version: 2
  name: string
  profile: SyntheticProfile
  /** Explicit extensions for route-specific random identities (F3). */
  identityFields: Record<string, string>
  steps: TranscriptStep[]
}
export function jsonBody(body: Json): Bytes { return { encoding: 'utf8', data: JSON.stringify(body) } }
export function decodeBytes(bytes: Bytes): Buffer { return Buffer.from(bytes.data, bytes.encoding === 'base64' ? 'base64' : 'utf8') }
export function encodeBytes(buffer: Uint8Array): Bytes {
  const bytes = Buffer.from(buffer), text = bytes.toString('utf8')
  return bytes.equals(Buffer.from(text)) ? { encoding: 'utf8', data: text } : { encoding: 'base64', data: bytes.toString('base64') }
}
