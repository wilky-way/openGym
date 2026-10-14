import { ERR, CSRF_EXEMPT, type ApiError as ErrorBody } from '@opengym/contract/http/api'

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Omit<ErrorBody, 'error'> & Record<string, unknown> = {}, readonly headers: HeadersInit = {}) {
    super(message)
  }
}
export class ClientGone extends Error {}
export class BodyDeadline extends Error {}

export function json(status: number, body: unknown, extraHeaders: HeadersInit = {}): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value))
  return new Response(JSON.stringify(body), { status, headers })
}
export function errorResponse(error: unknown, log: (message: string) => void = console.error): Response {
  if (error instanceof ApiError) return json(error.status, { error: error.message, ...error.extra }, error.headers)
  if (error instanceof BodyDeadline) return json(408, { error: 'request timeout' }, { Connection: 'close' })
  if (error instanceof ClientGone) {
    log('client went away mid-body')
    return json(400, { error: 'client went away mid-body' }, { Connection: 'close' })
  }
  // Do not log request bodies, auth headers or arbitrary thrown messages.
  log('server error')
  return json(500, { error: ERR.serverError })
}

const exemptions: ReadonlySet<string> = new Set(CSRF_EXEMPT)
export function csrfOk(request: Request, key: string, origin: string): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || exemptions.has(key)) return true
  if ((request.headers.get('authorization') || '').startsWith('Bearer ') && !request.headers.has('cookie')) return true
  const site = request.headers.get('sec-fetch-site')
  if (site) return site === 'same-origin' || site === 'none'
  const from = request.headers.get('origin')
  return !from || from.replace(/\/+$/, '') === origin.replace(/\/+$/, '')
}
export function corsHeaders(request: Request, allowedOrigin: string): Headers {
  const headers = new Headers()
  const origin = request.headers.get('origin')
  if (origin) headers.set('Vary', 'Origin')
  if (origin === allowedOrigin) headers.set('Access-Control-Allow-Origin', origin)
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, CF-Access-Client-Id, CF-Access-Client-Secret')
    headers.set('Access-Control-Max-Age', '86400')
  }
  return headers
}

/** Receive bytes independently of handler timing; parse only when a handler asks for JSON.
 * This preserves auth/CSRF/error precedence while clearing the wire deadline on arrival. */
export class RequestBody {
  complete: boolean
  draining?: Promise<void>
  private reader?: ReadableStreamDefaultReader<Uint8Array>
  private received?: Promise<Uint8Array>
  private result?: Promise<Record<string, unknown>>
  private cancelled = false
  constructor(private request: Request, private maxBytes: number, private onComplete: () => void = () => {}) {
    this.complete = !request.body
  }
  startReceiving(): void {
    this.received ??= this.receive()
    // Early refusal need not read JSON, but a receive failure must still be observed.
    void this.received.catch(() => {})
  }
  /** Await only bytes/limits, never JSON parsing: ignored malformed bodies stay ignored. */
  async receipt(): Promise<void> { if (!this.received) this.startReceiving(); await this.received }
  cancel(): void { this.cancelled = true; void this.reader?.cancel().catch(() => {}) }
  readJson(): Promise<Record<string, unknown>> { return this.result ??= this.parse() }
  private async receive(): Promise<Uint8Array> {
    if (!this.request.body) return new Uint8Array()
    if (this.cancelled) throw new BodyDeadline()
    this.reader = this.request.body.getReader()
    let size = 0
    const chunks: Uint8Array[] = []
    try {
      while (true) {
        const part = await this.reader.read()
        if (this.cancelled) throw new BodyDeadline()
        if (part.done) { this.complete = true; this.onComplete(); break }
        size += part.value.byteLength
        if (size > this.maxBytes) {
          this.draining = this.drain(size)
          throw new ApiError(413, ERR.bodyTooLarge)
        }
        chunks.push(part.value)
      }
    } catch (error) {
      if (error instanceof ApiError || error instanceof BodyDeadline) throw error
      throw new ClientGone()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes
  }
  private async parse(): Promise<Record<string, unknown>> {
    this.startReceiving()
    const bytes = await this.received!
    if (!bytes.byteLength) return {}
    let body: unknown
    try { body = JSON.parse(Buffer.from(bytes).toString('utf8')) } catch { throw new ApiError(400, ERR.invalidJson) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, ERR.invalidJson)
    return body as Record<string, unknown>
  }
  private async drain(size: number): Promise<void> {
    try {
      while (size <= 2 * this.maxBytes && !this.cancelled) {
        const part = await this.reader!.read()
        if (this.cancelled) return
        if (part.done) { this.complete = true; this.onComplete(); return }
        size += part.value.byteLength
      }
      this.cancel()
    } catch { /* connection already closed */ }
  }
}
