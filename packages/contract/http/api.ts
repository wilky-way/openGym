/**
 * openGym rewrite — frozen HTTP contract (v1, 2026-10-12).
 *
 * Source of truth for every route the Bun + Hono server exposes and the React client calls.
 * Derived from the legacy server at df8bfa03 (api/server.js, api/media.js, api/openapi.yaml;
 * inventory in ../sync/SYNC-CONTRACT.md and EXECUTION.md §2). Paths, status codes and body
 * fields match legacy byte-for-byte unless a line says `CHANGED:` or `NEW:`.
 *
 * Rules for units building against this file:
 *  - Do not edit it. A needed change goes to the integration owner as a contract-change request
 *    (EXECUTION.md §2.6); the version below bumps and dependants re-run their gates.
 *  - `UNSURE:` marks a field the inventory could not pin. Build it as written, keep a test named
 *    `contract-unsure:<route>` that records the legacy behaviour from the parity recorder, and
 *    raise it at integration rather than guessing a different shape.
 *  - Every JSON response carries `Content-Type: application/json` and `Cache-Control: no-store`
 *    (legacy server.js:687-691). Every request body must parse to a JSON object; empty body = {}.
 */
import type { GetDataResponse, PutDataRequest, PutDataOk, ConflictResponse, TrainingCloseProof } from '../domain/state-doc'
export type { GetDataResponse, PutDataRequest, PutDataOk, ConflictResponse } from '../domain/state-doc'
import type { ProgrammeDefinition } from '../domain/programme-model'
import type { ProgressionValidateResult, EvaluateResult, ApplyRequest, ApplyResult } from '../domain/progression'

export const CONTRACT_VERSION = '1.7.11' // W36 durable training activity/close envelopes.

// ───────────────────────────── errors ─────────────────────────────

/** Every non-2xx JSON body. `code` is present where legacy sends one (machine-switchable). */
export interface ApiError {
  error: string
  code?: ErrorCode
  /** 429 `locked` and media `busy`; mirrored in the `Retry-After` header (seconds). */
  retryAfter?: number
  /** Atomic training refusal; unknown is loss of knowledge, never idle. */
  guardStatus?: 'active' | 'unknown'
  /** media 413 extras */
  maxMB?: number; usedMB?: number; quotaMB?: number; maxSec?: number
}

export type ErrorCode =
  | 'INVALID_LOAD' | 'INVALID_DEFINITION' | 'UNSUPPORTED_REPS' | 'UNSUPPORTED_ASSISTED'
  // auth / account
  | 'challenge-expired' | 'invite' | 'disabled' | 'unknown-credential' | 'pair-invalid'
  | 'link-invalid' | 'passkey-limit' | 'credential-exists' | 'not-found' | 'last-way-in'
  | 'passkey' | 'passkey-required' | 'locked' | 'busy'
  // media
  | 'bad-request' | 'hash-mismatch' | 'timeout' | 'media-too-large' | 'media-quota'
  | 'media-too-long' | 'media-type' | 'media-invalid' | 'media-missing' | 'storage-full'
  // NEW: programme library (§ library below)
  | 'version-conflict' | 'not-ready' | 'active-definition' | 'private-downgrade' | 'too-large'
  // NEW: devices + progression
  | 'device-revoked' | 'REV_CONFLICT' | 'CYCLE_NOT_ACTIVE' | 'PAST_WEEK' | 'TRAINING_NOW' | 'INVALID_RULES' | 'NOT_FOUND'

/** Fixed error strings the client matches on today. Keep the exact text. */
export const ERR = {
  notSignedIn: 'not signed in',            // 401
  forbidden: 'forbidden',                  // 403 admin
  crossOrigin: 'cross-origin request refused', // 403 CSRF
  notFound: 'not found',                   // 404 unknown route
  badRequest: 'bad request',               // 400 unparseable URL
  invalidJson: 'invalid json',             // 400
  bodyTooLarge: 'body too large',          // 413
  stateRequired: 'state required',         // 400 PUT /api/data
  invalidState: 'invalid state',           // 400 PUT /api/data
  stateUnreadable: 'state unreadable',     // 503 GET/PUT /api/data (CHANGED: now documented)
  conflict: 'conflict',                    // 409 PUT /api/data
  serverError: 'server error',             // 500
  tooMany: 'too many attempts, try again later', // 429 locked
} as const

// ───────────────────────────── limits ─────────────────────────────

export const LIMITS = {
  maxBodyBytes: 5 * 1024 * 1024,          // MAX_BODY; >5 MiB → 413; drain to 2x then close
  bodyTimeoutMs: 300_000,                 // BODY_TIMEOUT_MS; trickled body → socket closed (must fire under Bun; test required)
  headersTimeoutMs: 60_000,
  mediaIdleMs: 60_000,                    // media PUT idle → 408 timeout, Connection: close
  sessionDaysDefault: 90,
  challengeTtlMs: 5 * 60_000, maxChallenges: 20_000,
  pairCodeTtlMs: 5 * 60_000, deviceLinkTtlMs: 10 * 60_000,
  maxPasskeys: 20, maxPushSubsPerUser: 20, widKeep: 50,
  /** NEW: library */
  maxDefinitionBytes: 5 * 1024 * 1024,
} as const

// ───────────────────────────── auth ─────────────────────────────

/**
 * Session token: `${uid}:${expiryMs}:${sv}.${base64url(HMAC-SHA256(secret, payload))}`.
 * Same string as cookie value and Bearer value. Valid iff HMAC ok (timing-safe), exp >= now,
 * user exists, !disabled, sv === (user.sv || 0). Secret = trimmed DATA/secret (64 hex).
 * Cookie: `__Host-gymsid` when ORIGIN is https else `gymsid`; legacy `gymsid` accepted inbound;
 * `Path=/; Max-Age=<days*86400>; HttpOnly; [Secure;] SameSite=Lax`. Duplicate differing values
 * under one name → signed out. Cookie wins over Bearer.
 * CSRF (non-GET/HEAD/OPTIONS): Bearer → pass; Sec-Fetch-Site present → same-origin|none only;
 * else no Origin → pass; else Origin must equal ORIGIN (trailing slash ignored). Exempt routes are
 * flagged `csrf: 'exempt'` below.
 * CHANGED: the Capacitor `APP_ORIGINS` list and the Private-Network-Access preflight header are
 * removed with the native shells. Bearer + pairing stay for paired clients. Agent credentials are
 * issued by the operator mint as kind:agent; paired credentials must not be used by agent launchers.
 * Agent devices have an explicit server allowlist for identity/own renewal, health/config, profile
 * data/revision/activity reads, programme library and progression. They cannot access auth bootstrap,
 * pairing, passkeys, devices, invites/admin, logout, or browser push/presence (403 forbidden), even
 * when their owner is an administrator. New routes require explicit agent capability admission.
 *
 * NEW — per-device tokens (DECISIONS "Native shell": pairing, no Tailscale dependency). Every session belongs
 * to a row in `devices` (kind browser | paired | agent | native). Token v2:
 *   `v2.${did}.${expiryMs}.${base64url(HMAC-SHA256(secret, 'v2.' + did + '.' + expiryMs))}`
 * Valid iff HMAC ok, exp >= now, device exists, !device.revokedAt, owning user valid (exists, !disabled),
 * and device.sv === user.sv (sign-out-everywhere still revokes all). Legacy 3-field tokens stay accepted
 * (mapped to a synthetic `legacy:<sha256(token)[0..16]>` device row created on first use) until they expire.
 * Renewal with DEVICE_TOKENS=1: `/api/me` on a legacy token returns a v2 token for a device row created at that
 * moment (stable did from then on) and records sha256(legacy token) as a predecessor of that device; revoking
 * the device rejects every predecessor hash. A device never gets a second id by renewing.
 * Minting v2 is behind `DEVICE_TOKENS=1`, OFF through cutover A so a rollback to wilky-a2f2daca keeps every
 * session valid; switched on after A is stable (EXECUTION §5). Renewal via /api/me returns the same format
 * the device already uses. Device ids: 16-char base64url. The server URL is never in the token.
 * Exposure beyond the tailnet (relay, later): `EXPOSURE=public` forces INVITE_ONLY, refuses `FIRST_USER_ADMIN`,
 * requires TLS at the edge, ignores proxy IP headers unless TRUST_PROXY, and tightens the auth-bootstrap
 * buckets. The only unauthenticated POSTs are the auth bootstrap routes in CSRF_EXEMPT plus logout and
 * device-link options/verify; all are rate-limited. No other route accepts an unauthenticated write.
 */
export type Auth = 'none' | 'session' | 'admin'
export interface User { id: string; name: string; admin: boolean }

// ───────────────────────────── route table ─────────────────────────────

export interface RouteSpec<Req, Res> {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  auth: Auth
  csrf: 'required' | 'exempt' | 'n/a'
  /** rate bucket names: burst = 60/min/addr; fails:<kind> = 20 free then 30s doubling→15m;
   * acct = 5 free then 1m doubling→1h; media-upload 600/h/uid; media-sweep 10/h/uid */
  rate?: string[]
  req: Req
  res: Res
}

export type Routes = {
  // health / config / identity
  'GET /api/health': RouteSpec<void, { ok: true; users: number; writable: true } /* 503 {ok:false,writable:false} */>
  'GET /api/config': RouteSpec<void, ConfigResponse>
  'GET /api/me': RouteSpec<void, { user: User; token?: string /* Bearer past half-life only */ }>

  // passkey sign-up / sign-in
  'POST /api/register/options': RouteSpec<{ name: string; code?: string }, { cid: string; options: unknown /* PublicKeyCredentialCreationOptionsJSON */ }>
  'POST /api/register/verify': RouteSpec<{ cid: string; credential: unknown }, { user: User } /* + Set-Cookie */>
  'POST /api/login/options': RouteSpec<void, { cid: string; options: unknown }>
  'POST /api/login/verify': RouteSpec<{ cid: string; credential: unknown }, { user: User }>
  'POST /api/logout': RouteSpec<void, { ok: true }>
  'POST /api/logout/all': RouteSpec<void, { ok: true } /* sv++, drops pairings + device links */>

  // pairing (Bearer tokens for paired clients; agent devices cannot create or redeem codes)
  'POST /api/pair/create': RouteSpec<void, { code: string /* 8 chars A-Z2-9 minus O/0/I/1 */ }>
  'POST /api/pair/redeem': RouteSpec<{ code: string }, { token: string; user: User }>

  // passkey management (Proof = passkey step-up: {cid, credential} from a `login` challenge)
  'GET /api/account/passkeys': RouteSpec<void, PasskeyState>
  'POST /api/account/passkeys/options': RouteSpec<Proof, { cid: string; options: unknown }>
  'POST /api/account/passkeys/verify': RouteSpec<{ cid: string; credential: unknown; name?: string }, { ok: true } & PasskeyState>
  'POST /api/account/passkeys/rename': RouteSpec<{ id: string; name: string }, { ok: true } & PasskeyState>
  'DELETE /api/account/passkeys': RouteSpec<Proof /* + query ?id= */, { ok: true } & PasskeyState>
  'POST /api/account/device-link': RouteSpec<Proof, { code: string; expires: number }>
  // NEW: device registry (revocable per-device sessions)
  'GET /api/account/devices': RouteSpec<void, { devices: DeviceRow[]; current: string }>
  'POST /api/account/devices/rename': RouteSpec<{ id: string; name: string }, { ok: true }>
  'POST /api/account/devices/revoke': RouteSpec<{ id: string }, { ok: true } /* revoking `current` also clears its cookie */>
  'POST /api/device-link/options': RouteSpec<{ code: string }, { cid: string; options: unknown; id: string; name: string }>
  'POST /api/device-link/verify': RouteSpec<{ code: string; cid: string; credential: unknown; name?: string }, { user: User }>

  // whole-doc sync — behaviour in ../sync/SYNC-CONTRACT.md §3–§5 (normative)
  'GET /api/data': RouteSpec<void, GetDataResponse>
  'GET /api/data/rev': RouteSpec<void, { rev: number; wid?: string }>
  'GET /api/data/activity': RouteSpec<void, TrainingActivityResponse>
  'PUT /api/data': RouteSpec<PutDataRequest, PutDataOk /* 409 ConflictResponse; 423 TRAINING_NOW with guardStatus */>

  // push + presence
  'GET /api/push/public-key': RouteSpec<void, { key: string }>
  'POST /api/push/subscribe': RouteSpec<{ subscription: { endpoint: string; keys: { p256dh: string; auth: string } }; deviceId?: string }, { ok: true }>
  'GET /api/push/status': RouteSpec<void /* ?endpoint= */, { subscribed: true; deviceId: string | null } | { subscribed: false }>
  'POST /api/push/unsubscribe': RouteSpec<{ endpoint: string }, { ok: true }>
  'POST /api/push/test': RouteSpec<void, { ok: true }>
  'POST /api/push/rest-timer': RouteSpec<{ seconds: number | string; deviceId?: string }, { ok: true }>
  'POST /api/push/rest-timer/cancel': RouteSpec<{ deviceId?: string }, { ok: true }>
  'POST /api/activity': RouteSpec<ActivityBody, { ok: true }>


  // admin
  'GET /api/admin/users': RouteSpec<void, { users: AdminUserRow[]; invite_only: boolean; now: number }>
  'GET /api/admin/user': RouteSpec<void /* ?id= */, AdminUserDetail>
  'POST /api/admin/user/disable': RouteSpec<{ id: string; disabled: boolean }, { ok: true; id: string; disabled: boolean }>
  'POST /api/admin/user/delete': RouteSpec<{ id: string }, { ok: true; id: string }>
  'GET /api/admin/invites': RouteSpec<void, { invites: Invite[]; invite_only: boolean }>
  'POST /api/admin/invites/new': RouteSpec<{ note?: string }, { invite: Invite }>
  'POST /api/admin/invites/revoke': RouteSpec<{ code: string }, { ok: true }>
  'GET /api/admin/audit': RouteSpec<void /* ?limit&before&cat */, AuditPage>
  'POST /api/admin/audit/clear': RouteSpec<void, { ok: true }>

  // NEW: programme library (definitions live outside the state doc; EXECUTION.md §1.3)
  'GET /api/programmes/library': RouteSpec<void, { items: LibrarySummary[]; etag: string }>
  'GET /api/programmes/library/:id': RouteSpec<void /* ?version=<n|versionId> */, LibraryEntry>
  'GET /api/programmes/library/:id/versions': RouteSpec<void, { versions: LibraryVersionSummary[] }>
  'PUT /api/programmes/library/:id': RouteSpec<LibraryPutRequest, LibraryEntry /* 409 version-conflict, 422 not-ready, 413 too-large */>
  'POST /api/programmes/validate': RouteSpec<{ definition: unknown }, ValidateResult>

  // NEW: progression engine (../domain/progression.ts). validate/preview are pure (no doc write).
  'POST /api/progression/validate': RouteSpec<{ definition: unknown }, ProgressionValidateResult>
  'POST /api/progression/preview': RouteSpec<ProgressionPreviewRequest, EvaluateResult>
  'POST /api/progression/apply': RouteSpec<ApplyRequest, ApplyResult /* 409 REV_CONFLICT {error:'conflict', code}, 422 INVALID_RULES, 423 TRAINING_NOW */>
}

export interface DeviceRow {
  id: string; name: string; kind: 'browser' | 'paired' | 'agent' | 'native' | 'legacy'
  created: number; lastSeen: number | null; revokedAt: number | null
}

/** Preview: either a library/installed definition by id or an inline (draft) definition; optional
 * hypothetical logs appended to the real ones ("what would week N look like if I hit these"). */
export interface ProgressionPreviewRequest {
  source: { definitionId: string; versionId?: string } | { definition: unknown }
  cycleId?: string
  weeks: number[]
  asOf?: string
  hypotheticalLogs?: unknown[]
}

/** Routes deleted with Coach / password login / native shells / media uploads. Must answer 404 {error:'not found'}. */
export const DELETED_ROUTES = [
  'PUT /api/media/:hash', 'GET /api/media/:hash', 'POST /api/media/missing', 'POST /api/media/sweep',
  'GET /api/coach/disclosure', 'GET /api/coach/status', 'POST /api/coach/plan', 'POST /api/coach/review',
  'POST /api/coach/debrief', 'GET /api/coach/cohort', 'POST /api/coach/cohort/share',
  'POST /api/coach/pending/resolve', 'POST /api/coach/forget', 'GET /api/admin/coach',
  'POST /api/admin/coach/config', 'POST /api/admin/coach/test', 'POST /api/admin/coach/models',
  'POST /api/admin/coach/connect', 'POST /api/admin/coach/disconnect', 'GET /api/coach/account',
  'POST /api/login/password', 'POST /api/register/password', 'GET /api/account/password',
  'POST /api/account/password', 'DELETE /api/account/password', 'POST /api/account/email',
  'DELETE /api/account/email', 'POST /api/admin/user/password-reset', 'POST /api/login/password-reset',
] as const

export const CSRF_EXEMPT = [
  'POST /api/register/options', 'POST /api/register/verify', 'POST /api/login/options',
  'POST /api/login/verify', 'POST /api/pair/redeem',
] as const

// ───────────────────────────── bodies ─────────────────────────────

/** CHANGED: no `password_login`, no `coach` key. UNSURE: the legacy client uses the *presence*
 * of `coach` (even null) as a "made for a signed-in session" cache signal (server.js:1934-1944).
 * The rewrite replaces it with `signedIn`. The new client must not look for `coach`. */
export interface ConfigResponse {
  invite_only: boolean
  allow_guest: boolean
  default_lang?: string
  media?: { imageMB: number; gifMB: number; videoMB: number; videoSec: number; quotaMB: number; workouts: true }
  /** NEW: replaces the `coach` presence signal. Present only when the caller is signed in. */
  signedIn?: true
}

export interface Proof { cid: string; credential: unknown }
export interface PasskeyState {
  passkeys: { id: string; name: string | null; created: string | null; lastUsed: string | null; transports: string[] }[]
  /** CHANGED: always false (password login removed); kept so legacy UI code paths type-check. */
  password: false
  lastWayIn: boolean
}

// GetDataResponse / PutDataRequest / PutDataOk / ConflictResponse: defined once in ../domain/state-doc.ts.

export interface ActivityBody {
  active: boolean; name?: string; exIdx?: number; exTotal?: number; setsDone?: number; setsTotal?: number
  startedAt?: number; reason?: 'hidden' | 'navigated' | 'closed' | 'discarded' | 'editor-closed'
  /** Exact ordinary session id/start; owning-device close additionally binds profile. */
  sessionId?: string; profileId?: string
  /** Saved-workout identity plus the distinct editor incarnation; never rewrite saved id/start. */
  editingWorkoutId?: string; editorInstanceId?: string
}
export interface TrainingActivityResponse {
  status: 'active' | 'idle' | 'unknown'
  /** Only trusted browser/paired devices see their own proof (null if none/corrupt).
   * Agent/legacy carriers omit this property entirely; no workout or credential is exposed. */
  own?: TrainingCloseProof | null
}

export interface MediaUsage { bytes: number; count: number; quotaBytes: number }
export const MEDIA_HEADERS = {
  'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Robots-Tag': 'noindex', 'Access-Control-Expose-Headers': 'Content-Length',
} as const

export interface AdminUserRow {
  id: string; name: string; created: string; disabled: boolean; admin: boolean; invitedBy: string | null
  workouts: number; lastWorkout: string | null; lastSync: number | null; hasPush: boolean
  /** presence snapshot or null (server.js:796, 2423). UNSURE: inner fields — pin from F3 transcript */
  live: { [k: string]: unknown } | null
}
export interface AdminUserDetail {
  user: { id: string; name: string; created: string; disabled: boolean; admin: boolean; invitedBy: string | null }
  unit: string; lastSync: number | null
  routines: { id: string; name: string; emoji?: string; count: number }[]
  bodyweight: unknown[]; workouts: unknown[] // newest first, `media` stripped. UNSURE: element shapes beyond StateDoc
}
export interface Invite { code: string; note: string; createdBy: string; created: string; usedBy?: string; usedAt?: string; usedByName?: string | null }
export interface AuditEvent { id: number; ts: number; ev: string; ok: boolean; uid?: string; name?: string; tgt?: string; tname?: string; msg?: string; act?: string; ip?: string }
export interface AuditPage { events: AuditEvent[]; total: number; nextBefore: number | null; enabled: boolean; ip_mode: 'off' | 'net' | 'full'; retention: { max: number; days: number }; now: number }

// ───────────────────────────── NEW: library ─────────────────────────────

export type Level = 'Invalid' | 'Valid' | 'Complete' | 'Ready'

export interface LibrarySummary {
  id: string; name: string; level: Level; private: boolean
  versionN: number; versionId: string; bytes: number; updatedAt: string
  sourceKind?: string; daysPerWeek?: number; lengthWeeks?: number; goal?: string
  /** true when an active|paused cycle references this id (it is then also installed in the doc) */
  inUse: boolean
}
export interface LibraryEntry { definition: ProgrammeDefinition; versionId: string; n: number; level: Level }
export interface LibraryVersionSummary { n: number; versionId: string; parentVersionId: string | null; level: Level; publishedAt: string; bytes: number }

/**
 * Publish/replace one library definition. versionId = 'sha256:' + hex(sha256(canonicalJson(definition)))
 * where canonicalJson sorts keys recursively (library only — never used for the state doc).
 * Preconditions: expectedVersionId must equal the current head (null when creating) else 409
 * version-conflict; level >= minLevel else 422 not-ready (+ issues); an active|paused cycle on
 * this id → 409 active-definition; private:true → false refused (403 private-downgrade).
 * UNSURE: minLevel. Server default 'Valid' so the 83 existing definitions (0 Ready) can be
 * migrated; the MCP publish tool passes 'Ready' (PROGRAM-API). The runtime tool registry defines the supported surface.
 */
export interface LibraryPutRequest { definition: ProgrammeDefinition; expectedVersionId: string | null; minLevel?: Level }

export interface Issue { code: string; location: { path?: string; week?: number; day?: string; session?: string | number; slot?: string | number }; fix: string; requiredFor: Exclude<Level, 'Invalid'> }
export interface ValidateResult { level: Level; nextLevel: Level | null; issues: Issue[]; counts: { byCode: Record<string, number>; byLevel: Record<string, number> } }

// ───────────────────────────── route policy (executable; S01/S03 build middleware from this) ─────────────────────────────
/**
 * auth/csrf/rate for every kept + new route. Values are legacy (server.js:651-655, 950-962, route table) except
 * NEW routes. Buckets: burst = AUTH_BURST 60/min/addr; fails:<kind> = ADDR_FAILS 20 free → 30 s doubling → 15 min,
 * forget 1 h, key kind|addr; acct = ACCOUNT_FAILS 5 free → 1 min doubling → 1 h, forget 24 h; media-upload 600/h/uid;
 * media-sweep 10/h/uid; inflight 2/uid. `proof` = passkey step-up body required. EXPOSURE=public halves burst (30/min)
 * and fails:* free attempts (10) — NEW, the only public-mode numeric changes.
 */
export type Policy = { auth: Auth; csrf: 'required' | 'exempt' | 'n/a'; rate?: readonly string[]; proof?: true }
export const ROUTE_POLICY = {
  'GET /api/health': { auth: 'none', csrf: 'n/a' },
  'GET /api/config': { auth: 'none', csrf: 'n/a' },
  'GET /api/me': { auth: 'session', csrf: 'n/a' },
  'POST /api/register/options': { auth: 'none', csrf: 'exempt' },
  'POST /api/register/verify': { auth: 'none', csrf: 'exempt' },
  'POST /api/login/options': { auth: 'none', csrf: 'exempt' },
  'POST /api/login/verify': { auth: 'none', csrf: 'exempt' },
  'POST /api/logout': { auth: 'none', csrf: 'required' },
  'POST /api/logout/all': { auth: 'session', csrf: 'required' },
  'POST /api/pair/create': { auth: 'session', csrf: 'required' },
  'POST /api/pair/redeem': { auth: 'none', csrf: 'exempt' },
  'GET /api/account/passkeys': { auth: 'session', csrf: 'n/a' },
  'POST /api/account/passkeys/options': { auth: 'session', csrf: 'required', rate: ['burst'], proof: true },
  'POST /api/account/passkeys/verify': { auth: 'session', csrf: 'required' },
  'POST /api/account/passkeys/rename': { auth: 'session', csrf: 'required' },
  'DELETE /api/account/passkeys': { auth: 'session', csrf: 'required', rate: ['burst'], proof: true },
  'POST /api/account/device-link': { auth: 'session', csrf: 'required', rate: ['burst'], proof: true },
  'POST /api/device-link/options': { auth: 'none', csrf: 'required', rate: ['burst', 'fails:link'] },
  'POST /api/device-link/verify': { auth: 'none', csrf: 'required', rate: ['burst', 'fails:link'] },
  'GET /api/account/devices': { auth: 'session', csrf: 'n/a' },
  'POST /api/account/devices/rename': { auth: 'session', csrf: 'required' },
  'POST /api/account/devices/revoke': { auth: 'session', csrf: 'required', rate: ['burst'] }, // NEW; no proof: revoking is protective
  'GET /api/data': { auth: 'session', csrf: 'n/a' },
  'GET /api/data/rev': { auth: 'session', csrf: 'n/a' },
  'GET /api/data/activity': { auth: 'session', csrf: 'n/a' },
  'PUT /api/data': { auth: 'session', csrf: 'required' },
  'GET /api/push/public-key': { auth: 'none', csrf: 'n/a' },
  'POST /api/push/subscribe': { auth: 'session', csrf: 'required' },
  'GET /api/push/status': { auth: 'session', csrf: 'n/a' },
  'POST /api/push/unsubscribe': { auth: 'session', csrf: 'required' },
  'POST /api/push/test': { auth: 'session', csrf: 'required' },
  'POST /api/push/rest-timer': { auth: 'session', csrf: 'required' },
  'POST /api/push/rest-timer/cancel': { auth: 'session', csrf: 'required' },
  'POST /api/activity': { auth: 'session', csrf: 'required' },
  'GET /api/admin/users': { auth: 'admin', csrf: 'n/a' },
  'GET /api/admin/user': { auth: 'admin', csrf: 'n/a' },
  'POST /api/admin/user/disable': { auth: 'admin', csrf: 'required' },
  'POST /api/admin/user/delete': { auth: 'admin', csrf: 'required' },
  'GET /api/admin/invites': { auth: 'admin', csrf: 'n/a' },
  'POST /api/admin/invites/new': { auth: 'admin', csrf: 'required' },
  'POST /api/admin/invites/revoke': { auth: 'admin', csrf: 'required' },
  'GET /api/admin/audit': { auth: 'admin', csrf: 'n/a' },
  'POST /api/admin/audit/clear': { auth: 'admin', csrf: 'required' },
  'GET /api/programmes/library': { auth: 'session', csrf: 'n/a' },
  'GET /api/programmes/library/:id': { auth: 'session', csrf: 'n/a' },
  'GET /api/programmes/library/:id/versions': { auth: 'session', csrf: 'n/a' },
  'PUT /api/programmes/library/:id': { auth: 'session', csrf: 'required' },
  'POST /api/programmes/validate': { auth: 'session', csrf: 'required' },
  'POST /api/progression/validate': { auth: 'session', csrf: 'required' },
  'POST /api/progression/preview': { auth: 'session', csrf: 'required' },
  'POST /api/progression/apply': { auth: 'session', csrf: 'required' },
} as const satisfies Record<keyof Routes, Policy>

/**
 * Request validation rule (Codex review #7): handlers validate a parsed body WITHOUT replacing it. zod (or any
 * schema) runs on the parsed object for a yes/no + error mapping; the handler keeps using the original object, so
 * key order and unknown fields survive. Legacy coercions and error precedence are per route and win over schema
 * strictness: e.g. PUT /api/data `baseRev: "4"` is NOT a 400 — it reaches the conflict check and 409s
 * (strict `!==`), and `text()` fields coerce numbers to strings. F3 transcripts pin each route's precedence.
 */
