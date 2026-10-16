import { isDeepStrictEqual } from 'node:util'
import type { Bytes, ParityRequest, ParityResponse, StoredDocs } from './types'
/** Replace JSON string VALUES only, keeping all other bytes/key order/whitespace intact. */
export function mapJsonStrings(raw: string, transform: (value: string, key: string, pointer: string, start: number, end: number) => string): string {
  JSON.parse(raw) // reject invalid JSON rather than canonicalising it
  let at = 0, out = '', copied = 0
  const space = () => { while (/\s/.test(raw[at] ?? '') && at < raw.length) at++ }
  const string = (): { value: string; start: number; end: number } => {
    const start = at++
    while (at < raw.length) { const c = raw[at++]; if (c === '\\') at++; else if (c === '"') break }
    return { value: JSON.parse(raw.slice(start, at)) as string, start, end: at }
  }
  const visit = (key: string, pointer: string): void => {
    space()
    if (raw[at] === '"') {
      const token = string(), next = transform(token.value, key, pointer, token.start, token.end)
      if (next !== token.value) { out += raw.slice(copied, token.start) + JSON.stringify(next); copied = token.end }
    } else if (raw[at] === '{') {
      at++; space()
      while (raw[at] !== '}') { const field = string().value; space(); at++; visit(field, `${pointer}/${field.replace(/~/g, '~0').replace(/\//g, '~1')}`); space(); if (raw[at] !== ',') break; at++; space() }
      at++
    } else if (raw[at] === '[') {
      at++; space(); let index = 0
      while (raw[at] !== ']') { visit(key, `${pointer}/${index++}`); space(); if (raw[at] !== ',') break; at++; space() }
      at++
    } else { while (at < raw.length && !/[\s,}\]]/.test(raw[at]!)) at++ }
  }
  visit('', ''); return out + raw.slice(copied)
}
/** Latin-1 is a one-byte indexing view, never a decoded document for comparison.
 * Parse string token spans there, decode only valid UTF-8 tokens, then splice Buffers.
 * Invalid UTF-8 anywhere else survives unchanged, even next to a normalised wid. */
export function mapJsonByteStrings(raw: Buffer, transform: (value: string, pointer: string) => string): Buffer {
  const chunks: Buffer[] = []
  let copied = 0
  mapJsonStrings(raw.toString('latin1'), (value, _key, pointer, start, end) => {
    const token = raw.subarray(start, end), text = token.toString('utf8')
    if (!token.equals(Buffer.from(text))) return value
    const decoded = JSON.parse(text) as string, next = transform(decoded, pointer)
    if (next !== decoded) { chunks.push(raw.subarray(copied, start), Buffer.from(JSON.stringify(next))); copied = end }
    return value // scanner output is deliberately discarded
  })
  chunks.push(raw.subarray(copied))
  return Buffer.concat(chunks)
}
/** Transport timing/framing only. Content-Length and every application header are compared. */
export const IGNORED_RESPONSE_HEADERS = new Set(['date', 'connection', 'keep-alive', 'transfer-encoding'])
export const DEFAULT_IDENTITY_FIELDS: Record<string, string> = { _wid: 'wid', wid: 'wid', _wids: 'wid', baseWid: 'wid', token: 'token' }
/** One bijection for a run; first occurrence preserves ancestry/repeats/rewind. */
export class IdentityNormaliser {
  private readonly forward = new Map<string, string>()
  private readonly reverse = new Map<string, string>()
  private readonly counts = new Map<string, number>()
  readonly fields: Record<string, string>
  constructor(extraFields: Record<string, string> = {}) {
    this.fields = { ...extraFields }
    for (const kind of Object.values(this.fields)) if (!/^[a-z][a-z0-9-]*$/.test(kind)) throw new Error('Invalid identity kind')
  }
  private kind(pointer: string, docsOnly: boolean, route: string, extensions = true): string | undefined {
    if (/^\/(?:_wid|_wids\/\d+)$/.test(pointer)) return 'wid'
    if (docsOnly) return undefined
    if (/^\/(?:wid|baseWid|state\/_wid|state\/_wids\/\d+)$/.test(pointer)) return 'wid'
    if (pointer === '/token') return 'token'
    if (!extensions) return undefined
    return this.fields[`${route}#${pointer}`] ?? (/^\/[^/]+$/.test(pointer) ? this.fields[pointer.slice(1)] : undefined)
  }
  private escapeLiteral(value: string): string {
    return value.startsWith('@parity:') ? `@parity:literal:${Buffer.from(value).toString('base64url')}@` : value
  }
  private identity(kind: string, value: string, introduce = true): string {
    if (kind === 'token' && introduce) {
      // Frozen legacy sessions use uid:expiry[:sv].HMAC, not a base64-encoded payload.
      const match = /^[A-Za-z0-9_-]+:\d+(?::\d+)?\.([A-Za-z0-9_-]{43})$/.exec(value)
      if (!match || Buffer.from(match[1]!, 'base64url').toString('base64url') !== match[1]) throw new Error('Malformed introduced session token')
    }
    const escaped = this.escapeLiteral(value)
    if (escaped !== value) return escaped
    if (!value || (kind === 'wid' && !/^[0-9a-f]{16}$/.test(value))) return value
    const key = `${kind}\0${value}`, existing = this.forward.get(key)
    if (existing) return existing
    if (!introduce) return value
    const n = (this.counts.get(kind) ?? 0) + 1, symbol = `@parity:${kind}:${n}@`
    this.counts.set(kind, n); this.forward.set(key, symbol); this.reverse.set(symbol, value)
    return symbol
  }
  json(raw: string, docsOnly = false, introduce = true, route = '', extensions = true): string {
    return mapJsonStrings(raw, (value, _key, pointer) => {
      const kind = this.kind(pointer, docsOnly, route, extensions)
      return kind ? this.identity(kind, value, introduce) : value
    })
  }
  private body(bytes: Bytes, introduce = true, route = '', extensions = true): Bytes {
    if (bytes.encoding === 'base64') return bytes
    try { return { ...bytes, data: this.json(bytes.data, false, introduce, route, extensions) } }
    catch (error) { if (error instanceof SyntaxError) return bytes; throw error }
  }
  private mapHeader(key: string, value: string, transform: (v: string) => string): string {
    if (key.toLowerCase() === 'authorization') return value.replace(/^Bearer (.+)$/, (_, token: string) => `Bearer ${transform(token)}`)
    if (['cookie', 'set-cookie'].includes(key.toLowerCase())) return value.replace(/(^|;\s*)(gymsid|__Host-gymsid)=([^;]*)/g, (_, before: string, name: string, token: string) => `${before}${name}=${transform(token)}`)
    return value
  }
  request(request: ParityRequest): ParityRequest {
    return { ...structuredClone(request), path: this.normalisePath(request.path),
      ...(request.headers ? { headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, this.mapHeader(k, v, token => this.identity('token', token, false))])) } : {}),
      ...(request.body ? { body: this.body(request.body, false, `${request.method.toUpperCase()} ${request.path.split('?')[0]}`) } : {}) }
  }
  response(response: ParityResponse, route = ''): ParityResponse {
    const body = this.body(response.body, true, route, response.status < 400)
    const headers: Record<string, string[]> = {}
    for (const [name, values] of Object.entries(response.headers)) {
      const key = name.toLowerCase()
      if (IGNORED_RESPONSE_HEADERS.has(key)) continue
      headers[key] = [...(headers[key] ?? []), ...values.map(v => this.mapHeader(key, v, token => token ? this.identity('token', token) : token))]
    }
    return { status: response.status, body, headers: Object.fromEntries(Object.keys(headers).sort().map(key => [key, headers[key]!])) }
  }
  docs(docs: StoredDocs, introduce = true): StoredDocs {
    return Object.fromEntries(Object.keys(docs).sort().map(uid => {
      const raw = docs[uid]!
      try { return [uid, mapJsonByteStrings(raw, (value, pointer) => this.kind(pointer, true, '') ? this.identity('wid', value, introduce) : value)] }
      catch (error) { if (error instanceof SyntaxError) return [uid, raw]; throw error }
    }))
  }
  private normalisePath(path: string): string {
    return path.split(/([/?&=])/).map(part => {
      let decoded = part
      try { decoded = decodeURIComponent(part) } catch { /* malformed path stays literal */ }
      if (decoded.startsWith('@parity:')) return this.escapeLiteral(decoded)
      for (const [symbol, value] of this.reverse) if (part === encodeURIComponent(value)) return symbol
      return part
    }).join('')
  }
  materialise(value: string): string {
    const literal = /^@parity:literal:([A-Za-z0-9_-]*)@$/.exec(value)
    if (literal) return Buffer.from(literal[1]!, 'base64url').toString('utf8')
    if (!/^@parity:[a-z][a-z0-9-]*:\d+@$/.test(value)) return value
    const raw = this.reverse.get(value)
    if (raw === undefined) throw new Error(`Unbound transcript identity ${value}`)
    return raw
  }
  private materialiseJson(raw: string, docsOnly = false, route = ''): string {
    try { return mapJsonStrings(raw, (value, _key, pointer) => this.kind(pointer, docsOnly, route) ? this.materialise(value) : value) }
    catch (error) { if (error instanceof SyntaxError) return raw; throw error }
  }
  private materialiseDoc(raw: Buffer): Buffer {
    try { return mapJsonByteStrings(raw, (value, pointer) => this.kind(pointer, true, '') ? this.materialise(value) : value) }
    catch (error) { if (error instanceof SyntaxError) return raw; throw error }
  }
  materialiseDocs(docs: StoredDocs): StoredDocs {
    return Object.fromEntries(Object.entries(docs).map(([uid, raw]) => [uid, this.materialiseDoc(raw)]))
  }
  materialiseRequest(request: ParityRequest): ParityRequest {
    const path = request.path.split(/([/?&=])/).map(part => part.startsWith('@parity:') ? encodeURIComponent(this.materialise(part)) : part).join('')
    return { ...request, path,
      ...(request.body ? { body: request.body.encoding === 'base64' ? request.body : { ...request.body, data: this.materialiseJson(request.body.data, false, `${request.method.toUpperCase()} ${path.split('?')[0]}`) } } : {}),
      ...(request.headers ? { headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, this.mapHeader(k, v, token => this.materialise(token))])) } : {}) }
  }
}
export function assertStoredDocBytes(expected: StoredDocs, actual: StoredDocs, label = 'stored docs'): void {
  if (!isDeepStrictEqual(Object.keys(expected).sort(), Object.keys(actual).sort())) throw new Error(`${label}: document identities differ`)
  for (const uid of Object.keys(expected)) {
    const a = expected[uid]!, b = actual[uid]!
    if (!a.equals(b)) {
      let offset = 0; while (offset < Math.min(a.length, b.length) && a[offset] === b[offset]) offset++
      throw new Error(`${label}: ${uid} differs at byte ${offset} (expected ${a.length} bytes, got ${b.length})`)
    }
  }
}
