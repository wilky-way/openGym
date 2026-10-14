import http from 'node:http'
import https from 'node:https'

export type Environment = Record<string, string | undefined>
export type Fetcher = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'> & { headers?: Headers }>
export const error = (code: string, message: string) => Object.assign(new Error(message), { code })
/** Shared by HTTP and local diagnostics; redact before any output caps. */
export function redactCredentials<T>(value: T, credentials: Iterable<string> = []): T {
  if (value === undefined) return value
  // v2/JWT/session payloads and signatures remain secrets when echoed separately.
  // Short protocol/version/counter components are not credentials.
  const secrets = [...new Set([...credentials].flatMap(token => [token, ...token.split(/[.:]/).filter(part => part.length >= 8)]))]
    .filter(Boolean).sort((a,b) => b.length - a.length)
  const text = (value: string) => {
    for (const secret of secrets) value = value.replaceAll(secret, '[redacted]')
    return value.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
      .replace(/\b((?:set-)?cookie\s*:\s*)([^\r\n]*)/gi, (_, prefix: string, cookies: string) =>
        prefix + cookies.replace(/([^\s=;,]+)\s*=\s*("[^"]*"|[^;\s,]*)/g, '$1=[redacted]'))
  }
  let json = JSON.stringify(value, (key, item) => {
    if (typeof item !== 'string') return item
    if (/^(?:authorization|cookie|set-cookie)$/i.test(key)) return '[redacted]'
    return text(item)
  })
  // Property names may contain credentials as well.
  for (const secret of secrets) json = json.replaceAll(JSON.stringify(secret).slice(1,-1), '[redacted]')
  return JSON.parse(json) as T
}
/** Direct sockets: proxy environment variables cannot redirect credentials or local test traffic. */
export const directFetch: Fetcher = (url, init) => new Promise((resolve, reject) => {
  const target = new URL(url)
  const request = (target.protocol === 'https:' ? https : http).request(target, {
    method: init.method, headers: init.headers as Record<string, string>, agent: false,
  }, response => {
    // Never follow redirects with an agent credential.
    const chunks: Buffer[] = []
    let bytes = 0
    response.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > 6 * 1024 * 1024) response.destroy(new Error('response too large'))
      else chunks.push(chunk)
    })
    response.on('error', reject)
    response.on('end', () => resolve({ status: response.statusCode ?? 500, ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300,
      headers: new Headers(response.rawHeaders.reduce((pairs: [string, string][], value, i, all) => { if (i % 2 === 0) pairs.push([value, all[i + 1]!]); return pairs }, [])),
      json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }))
  })
  const abort = () => request.destroy(new Error('request aborted'))
  if (init.signal?.aborted) abort()
  else init.signal?.addEventListener('abort', abort, { once: true })
  request.on('close', () => init.signal?.removeEventListener('abort', abort))
  request.on('error', reject)
  request.end(typeof init.body === 'string' ? init.body : undefined)
})

export class ApiClient {
  readonly base: string
  readonly profile: string
  private token: string
  private credentials = new Set<string>()
  constructor(readonly env: Environment, readonly fetcher: Fetcher = directFetch) {
    if (!env.OPENGYM_TOKEN || !env.OPENGYM_URL || !env.OPENGYM_UID) throw error('CONFIG_REQUIRED', 'Set OPENGYM_URL, OPENGYM_TOKEN and OPENGYM_UID for this MCP profile.')
    let url: URL
    try { url = new URL(env.OPENGYM_URL) } catch { throw error('CONFIG_REQUIRED', 'OPENGYM_URL is invalid.') }
    if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol) ||
      url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw error('CONFIG_REQUIRED', 'Use HTTPS or a loopback HTTP API URL without credentials or query parameters.')
    this.base = url.href.replace(/\/$/, '')
    this.profile = env.OPENGYM_UID
    this.token = env.OPENGYM_TOKEN
    this.credentials.add(this.token)
  }
  /** Also protects diagnostics built locally from authenticated HTTP definitions. */
  redactCredentials<T>(value: T): T {
    return redactCredentials(value, this.credentials)
  }
  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Awaited<ReturnType<Fetcher>>
    try { res = await this.fetcher(this.base + path, { method, headers: { Authorization: 'Bearer ' + this.token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(15000) }) }
    catch { throw error('API_UNAVAILABLE', 'The openGym API could not be reached.') }
    if (!res.ok) {
      // Keep the legacy generic codes/messages, but let library callers recover
      // known domain codes without exposing arbitrary server bodies or messages.
      let apiCode: string | undefined
      let details: Record<string, unknown> | undefined
      try {
        let body = await res.json() as { code?: unknown; issues?: unknown; warnings?: unknown }
        if (path.startsWith('/api/progression/')) {
          body = this.redactCredentials(body)
          const codes = ['REV_CONFLICT','CYCLE_NOT_ACTIVE','PAST_WEEK','TRAINING_NOW','INVALID_RULES','NOT_FOUND','INVALID_LOAD','INVALID_DEFINITION','UNSUPPORTED_REPS','UNSUPPORTED_ASSISTED']
          if (typeof body?.code === 'string' && codes.includes(body.code)) apiCode = body.code
          // The 409's state and arbitrary server error text never cross the MCP boundary.
          const keys = new Set(['code','path','fix','message','ruleId','ref','week','day','session','slot'])
          const safe = (value: unknown, depth = 0): unknown => {
            if (depth > 4) return null
            if (typeof value === 'string') return value.slice(0,2000)
            if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
            if (Array.isArray(value)) return value.slice(0,100).map(v => safe(v,depth+1))
            if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => keys.has(k)).map(([k,v]) => [k,safe(v,depth+1)]))
            return null
          }
          details = this.redactCredentials({status:res.status,...(apiCode ? {code:apiCode} : {}),
            ...(Array.isArray(body?.issues) ? {issues:safe(body.issues)} : {}),...(Array.isArray(body?.warnings) ? {warnings:safe(body.warnings)} : {})})
          for (const key of ['issues','warnings']) {
            const rows = details[key]
            if (Array.isArray(rows)) while (Buffer.byteLength(JSON.stringify(rows)) > 12 * 1024) { rows.pop(); details.diagnosticsTruncated = true }
          }
        } else if (typeof body?.code === 'string' && ['version-conflict', 'active-definition', 'private-downgrade', 'not-ready'].includes(body.code)) apiCode = body.code
      } catch { /* Refusal bodies may be empty. */ }
      if (details) throw Object.assign(error(apiCode ?? (res.status === 409 ? 'REV_CONFLICT' : 'API_REFUSED'), `The openGym API refused the request (${res.status}). ${JSON.stringify(details)}`), {status:res.status,apiCode,...details})
      throw Object.assign(res.status === 409 ? error('REV_CONFLICT', 'The profile changed. Read the program again before applying this action.') : error('API_REFUSED', `The openGym API refused the request (${res.status}).`), { status: res.status, apiCode })
    }
    try { const result = await res.json() as T; return path.startsWith('/api/progression/') ? this.redactCredentials(result) : result } catch { throw error('API_UNAVAILABLE', 'The openGym API returned an invalid response.') }
  }
  async checkProfile(): Promise<{ id: string; name: string; created: string | null }> {
    const me = await this.request<{ user?: { id: string; name: string; created?: string }; token?: string }>('GET', '/api/me')
    if (me.user?.id !== this.profile) throw error('PROFILE_MISMATCH', 'The API token belongs to a different profile than this MCP reader.')
    if (typeof me.token === 'string' && me.token) { this.token = me.token; this.credentials.add(me.token) }
    return { id: me.user.id, name: me.user.name, created: me.user.created || null }
  }
}
