// Backend + WebAuthn helpers (ported from the vanilla app).
import { t } from '@opengym/core/i18n-core'
import type { Routes } from '@opengym/contract/http/api'
import { clientPlatform, clientCapabilities } from './client-io'
import { appBase } from './app-base'
import { apiConnection, apiFetch, configureApiConnection } from './api-connection'
export { configureApiConnection } from './api-connection'

export let IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test((clientCapabilitiesUserAgent()))
export let IS_ANDROID = /Android/.test((clientCapabilitiesUserAgent()))
export let BIO = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN'
export let VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
// The same phrases in the UI language. They go into translated sentences ("confirm with {0}"),
// so the English constants above left an English phrase in the middle of every other language.
// Functions, not constants: the pack is loaded after this module is.
export const bio = () => (IS_APPLE ? t('Face ID / Touch ID') : IS_ANDROID ? t('fingerprint or face unlock') : t('your fingerprint, face or PIN'))
export const vault = () => (IS_APPLE ? t('iCloud Keychain') : IS_ANDROID ? t('Google Password Manager') : t('your password manager'))
// PublicKeyCredential is the WebAuthn-specific capability signal. Do not also gate the UI on
// clientCapabilities().credentials: some browsers expose WebAuthn while that generic Credential Management
// API check produces a false negative (notably Chrome on iOS). The real create/get calls still run
// only after the user chooses a passkey action and surface any genuine browser error there.
export const webauthnOK = () => clientCapabilities().webauthnOK()

// Optional host configuration; browser requests default to same-origin cookies.
export function setRemoteAuth(base: string, token: string | null) { return configureApiConnection({ baseUrl: base, token }) }


export { appBase }

// How long one request may take before it counts as no answer at all. A black-holed connection
// (captive portal, half-open socket, a phone between two networks) never settles on its own, and
// the store runs one push and one pull at a time: a single hung request used to hold every later
// sync behind it, silently, for as long as the socket hung. A GET is small; a PUT carries the
// whole profile over what may be a slow uplink. A caller that knows its request is slow on
// purpose (the admin's provider test) passes its own `timeout`; 0 means none.
const TIMEOUT_GET_MS = 20000
const TIMEOUT_MS = 60000

const failure = (message: string, code?: string, status?: number) => Object.assign(new Error(message), { code, status })

export async function api<T = JsonObject>(path: string, opts?: ApiOptions): Promise<T> {
  const { timeout, ...init } = opts || {}

  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  // A configured host uses its absolute base; browser deployments preserve their subpath.
  const url = path
  const ms = timeout != null ? timeout : (init.method || 'GET').toUpperCase() === 'GET' ? TIMEOUT_GET_MS : TIMEOUT_MS
  return request<T>(url, Object.assign({}, init, { headers }), ms)
}

// One exchange, bounded by `ms`. No status on the timeout, like a fetch that failed outright: to
// the store both mean the server could not be reached, and the device says it is offline instead
// of waiting forever.
async function request<T = JsonObject>(url: string, init: RequestInit, ms: number): Promise<T> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    if (ms > 0) timer = setTimeout(() => { if (ctl) ctl.abort(); reject(failure(t('The server did not answer in time.'), 'timeout')) }, ms)
  })
  const answer = exchange<T>(url, ctl ? Object.assign({}, init, { signal: ctl.signal }) : init)
  answer.catch(() => {})   // it may still settle after the timeout has answered; nobody is listening then
  try { return await Promise.race([answer, expired]) }
  finally { clearTimeout(timer) }
}

// API routes answer JSON. A login page or app index.html is an invalid response.
// An auth proxy's login page, a proxy that sends /api/* to the app's index.html. Reading it as {}
// made a push look accepted by a server "from before revisions" — the change was marked synced
// and dropped from the queue. It is an error, with the status it came with.
async function exchange<T>(url: string, init: RequestInit): Promise<T> {
  const r = await apiFetch(url, init)
  let data
  let parsed = true
  try { data = await r.json() } catch { parsed = false }
  const body = parsed && data && typeof data === 'object' ? data : null
  // The body rides along on the error: a 409 from /api/data carries the server's document.
  if (!r.ok) throw Object.assign(new Error((body && body.error) || ('HTTP ' + r.status)), { status: r.status, data: body || {} })
  if (!body) throw failure(t('The server answered with something other than openGym data.'), 'bad-response', r.status)
  return body as T
}

// A same-origin keepalive exchange survives page teardown; remote callers use api().
export function beacon(path: string, body: unknown): boolean {
  try {
    const platform = clientPlatform()
    if (platform.server.baseUrl() || apiConnection().token) return false
    // Dispatch before page teardown; settlement cannot be observed by the closing tab.
    void platform.transport.fetch(path, {method: 'POST', keepalive: true,
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)}).catch(() => {})
    return true
  } catch { return false }
}

// "Failed to fetch" is all the browser says when pairing never got an answer (#329), and it says
// the same for a wrong address and for a reverse proxy that answered the CORS preflight itself
// without letting the app's origin in (a Traefik `headers` middleware with an allow-list, which
// never passes the OPTIONS on to openGym). A no-cors request needs no preflight and tells the two
// apart: it settles when the server is there at all. Its answer cannot be read, nor needs to be.
const PROBE_MS = 5000
const hostOfBase = (base: string) => {
  try { const u = new URL(base); return u.host + u.pathname.replace(/\/$/, '') } catch { return base || '' }
}
// What /api/health says when it can be read (the configured transport reads it when CORS allows):
// 'opengym', 'front' when something in front of openGym answered in its place (a redirect, a
// 401/403 or an HTML page: an SSO login, forward-auth, a proxy rule), 'other' for an answer that
// is just not openGym's (another app's JSON, a proxy's plain "404 page not found"), and null
// when nothing readable came back.
async function healthAnswer(base: string, ms: number) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const res = await Promise.race([
      apiFetch(base + '/api/health', { method: 'GET', headers: { Accept: 'application/json' }, ...(ctl ? { signal: ctl.signal } : {}) }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { if (ctl) ctl.abort(); reject(new Error('timeout')) }, ms) }),
    ])
    const text = await res.text()
    let body = null
    try { body = JSON.parse(text) } catch { body = null }
    if (res.ok && body && typeof body === 'object' && body.ok === true) return 'opengym'
    const type = (res.headers && typeof res.headers.get === 'function' && res.headers.get('content-type')) || ''
    const html = /html/i.test(type) || /^\s*</.test(text || '')
    if ((res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403 || res.status === 407 || html) return 'front'
    return 'other'
  } catch {
    return null
  } finally { clearTimeout(timer) }
}
async function whyUnreachable(base: string, ms: number) {
  let reached = false
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      apiFetch(base + '/api/health', { mode: 'no-cors', cache: 'no-store', ...(ctl ? { signal: ctl.signal } : {}) }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { if (ctl) ctl.abort(); reject(new Error('timeout')) }, ms) }),
    ])
    reached = true
  } catch { /* not reachable either */ }
  finally { clearTimeout(timer) }
  // Something answered. Whether it is openGym needs a readable answer: the configured transport
  // reads /api/health when CORS allows. A login page or a proxy rule answering in openGym's place
  // is not a wrong address, and a page that is simply not openGym's is (#329). No readable
  // answer at all leaves the CORS explanation.
  const answer = reached ? await healthAnswer(base, ms) : null
  if (answer === 'front') {
    return failure(t('That address answers, but a login page or proxy rule replied instead of openGym. Let /api/ through to openGym unchanged. See “Pairing and CORS” in docs/SELF_HOSTING.md.'), 'proxy-answered')
  }
  if (answer === 'other') {
    return failure(t('That address answers, but it isn’t an openGym server. Check the URL.'), 'not-opengym')
  }
  if (reached) {
    const origin = new URL(clientPlatform().nav.href()).origin
    return failure(t('Your server was reached, but it refused the app’s request (CORS). If a reverse proxy such as Traefik adds CORS headers, let requests from {0} through to openGym unchanged. See “Pairing and CORS” in docs/SELF_HOSTING.md.', origin), 'cors')
  }
  // An address typed without a scheme is tried as https://. A home server on plain http gives
  // that try nothing to talk to, while the phone's browser, which tries http, opens it (#428).
  let u = null
  try { u = new URL(base) } catch { /* said as it is below */ }
  if (u && u.protocol === 'https:' && looksLocal(u.hostname)) {
    return failure(t('Could not reach {0} over https://. If your server runs on plain http (common at home), type http://{0} instead.', hostOfBase(base)), 'unreachable')
  }
  return failure(t('Could not reach {0}. Check the address and that this phone can reach it.', hostOfBase(base)), 'unreachable')
}

// Classifies private network addresses and local hostnames.
export function looksLocal(hostname: unknown) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!h) return false
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(h)
  if (v4) {
    const a = +v4[1]!, b = +v4[2]!
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)
  }
  if (h.includes(':')) return h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h)
  return !h.includes('.') || /\.(local|lan|home|home\.arpa|internal|localdomain)$/.test(h)
}

// Redeem at the supplied server before configuring the connection, without an existing bearer.
export async function pairRedeem(serverBase: string, code: string, { probeMs = PROBE_MS } = {}) {
  let data
  try {
    data = await request(serverBase + '/api/pair/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
    }, TIMEOUT_GET_MS)
  } catch (caught) {
    const e = caught as ClientError
    // A wrong, spent or expired code is the one refusal a person can fix, and the server says it
    // in English only ('invalid or expired code'), so it is said here in the UI language.
    if (e && e.status === 400) throw failure(t('That code didn’t work. Codes last 5 minutes and work once, so grab a fresh one.'), 'pair-invalid', 400)
    // The server answered (any status) or did not answer in time: that error says it already.
    if (e && (e.status != null || e.code)) throw e
    throw await whyUnreachable(serverBase, probeMs)
  }
  // Anything that is not a pairing would be saved as one — and the client would then send every
  // change to a server that never gave it a token.
  if (!data.token || !data.user) throw failure(t('The server answered with something other than openGym data.'), 'bad-response', 200)
  return data
}

const bufToB64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uToBuf = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer

function toCreationOptions(o: JsonObject): PublicKeyCredentialCreationOptions {
  o.challenge = b64uToBuf(o.challenge)
  o.user.id = b64uToBuf(o.user.id)
  ;(o.excludeCredentials || []).forEach((c: JsonObject) => { c.id = b64uToBuf(c.id) })
  return o as PublicKeyCredentialCreationOptions
}
function toRequestOptions(o: JsonObject): PublicKeyCredentialRequestOptions {
  o.challenge = b64uToBuf(o.challenge)
  ;(o.allowCredentials || []).forEach((c: JsonObject) => { c.id = b64uToBuf(c.id) })
  return o as PublicKeyCredentialRequestOptions
}
function credToJSON(input: Credential | null) {
  if (!input) throw new Error('No passkey returned')
  const cred = input as PublicKeyCredential
  const r = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse
  const out = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: bufToB64u(r.clientDataJSON) } as Record<string, unknown>
  }
  if (r.attestationObject) {
    out.response.attestationObject = bufToB64u(r.attestationObject)
    out.response.transports = r.getTransports ? r.getTransports() : ['internal']
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bufToB64u(r.authenticatorData)
    out.response.signature = bufToB64u(r.signature)
    out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null
  }
  return out
}
// A passkey sign-in or sign-up the server refused, in the UI language. The routes send a stable
// `code` beside their English message; an answer without one (an older server, a verify error)
// is shown as it came.
export function passkeyError(e: ClientError | null | undefined, fallback: string) {
  switch (e?.data?.code) {
    case 'invite': return t('That invite code is not valid.')
    case 'unknown-credential': return t('This server doesn’t know that passkey. Make a profile first.')
    case 'disabled': return t('This account has been disabled.')
    case 'challenge-expired': return t('That took a little too long. Give it another go.')
  }
  return e?.message || fallback
}
export async function passkeyRegister(name: string, code?: string) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, code: code || '' }) })
  const cred = await clientCapabilities().credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
// One passkey ceremony, not yet sent anywhere: /api/login/verify turns it into a sign-in, and
// the account routes take it as proof that the owner is here (#118, #95). `signal` calls the
// prompt off — a sheet that asked for it and was closed meanwhile (components/PasswordAuth.jsx,
// ProveOwner) — which then rejects with an AbortError.
export async function passkeyAssertion({ signal }: {signal?: AbortSignal} = {}) {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await clientCapabilities().credentials.get({ publicKey: toRequestOptions(options), ...(signal ? { signal } : {}) })
  return { cid, credential: credToJSON(cred) }
}
export async function passkeyLogin() {
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify(await passkeyAssertion()) })
  return res.user
}
// A creation ceremony on options the server has already handed out: another passkey for a
// signed-in profile, or one made with a code from another device (#95, components/Passkeys.jsx).
// The options come in an earlier step so the prompt opens straight from the tap that asks for it.
// They are copied first — the conversion writes buffers into them, and a prompt dismissed by
// mistake is tried again with the same ones.
export async function createPasskey(options: JsonObject) {
  const cred = await clientCapabilities().credentials.create({ publicKey: toCreationOptions(JSON.parse(JSON.stringify(options))) })
  return credToJSON(cred)
}


// JSON is preserved verbatim at the transport boundary. Route callers may select a contract response.
export type JsonObject = Record<string, any>
export type ApiOptions = RequestInit & { timeout?: number }
export interface ClientError { message?: string; name?: string; code?: string; status?: number; data?: JsonObject }
function clientCapabilitiesUserAgent(): string { try { return clientCapabilities().userAgent() } catch { return '' } }
export function refreshApiCapabilities(): void {
  IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(clientCapabilitiesUserAgent())
  IS_ANDROID = /Android/.test(clientCapabilitiesUserAgent())
  BIO = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN'
  VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
}
/** Typed, additive route entry point; api(path, opts) retains the legacy API. */
export function apiRoute<R extends keyof Routes>(route: R, body: Routes[R]['req'], query = ''): Promise<Routes[R]['res']> {
  const space = route.indexOf(' '), method = route.slice(0, space), path = route.slice(space + 1)
  if (path.includes(':')) throw new Error('Parameterized route requires api(path, opts) with its resolved id')
  return api<Routes[R]['res']>(path + query, {method, ...(body === undefined ? {} : {body: JSON.stringify(body)})})
}
