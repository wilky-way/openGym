/**
 * Shell adapters — frozen contract v1 (DECISIONS "Native shell": Tauri-ready).
 *
 * packages/core never touches these (it is pure). packages/web reaches the platform ONLY through these
 * interfaces; `lint:boundaries` fails any direct use of localStorage, indexedDB, navigator.serviceWorker,
 * window.location or fetch outside packages/web/src/platform/. v1 ships the browser implementations; a Tauri
 * implementation (Tauri store / SQLite plugin, native notifications) is later work behind the same interfaces.
 */

/** Synchronous small-value store. Browser impl = localStorage (keys and values byte-compatible with legacy:
 *  'gym_state_v1', 'gym_sync', 'gym_stash', 'gym_adopt', …). */
export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void          // throws QuotaError (mapped from QuotaExceededError)
  remove(key: string): void
  /** other-tab/window change notifications (browser: 'storage' event) */
  subscribe(listener: (key: string | null) => void): () => void
}
export class QuotaError extends Error {}

/** Async blob/object store. Browser impl = IndexedDB (media, library cache). */
export interface ObjectStore {
  get(bucket: 'media' | 'library', key: string): Promise<Uint8Array | string | null>
  put(bucket: 'media' | 'library', key: string, value: Uint8Array | string): Promise<void>
  delete(bucket: 'media' | 'library', key: string): Promise<void>
  keys(bucket: 'media' | 'library'): Promise<string[]>
}

/** Where the API lives. Per device, never baked into the build (pairing stores it later). */
export interface ServerEndpoint {
  /** '' = same origin (PWA served by the server/nginx); otherwise absolute https URL with no path query */
  baseUrl(): string
  /** auth carrier: browser same-origin uses the cookie; a native shell or remote base uses a Bearer device token */
  authHeader(): Promise<Record<string, string>>
  setDeviceToken(token: string | null): Promise<void>   // browser impl stores via KeyValueStore; Tauri → keychain later
}

/** All HTTP goes through here (Codex #16). Resolves `path` against server.baseUrl(), adds authHeader(),
 * credentials 'include' for same-origin only. Same semantics as window.fetch otherwise. */
export interface Transport {
  fetch(path: string, init?: RequestInit): Promise<Response>
}

/** URL access without touching window.location from app code (device-link codes arrive as ?link=…). */
export interface Navigation {
  href(): string
  searchParams(): URLSearchParams
  /** remove/replace query params without a reload (history.replaceState in the browser) */
  replaceQuery(params: Record<string, string | null>): void
  reload(): void
}

export interface PlatformInfo {
  kind: 'browser' | 'tauri'
  /** service worker / push are capabilities, not assumptions */
  canServiceWorker: boolean
  canWebPush: boolean
  canWakeLock: boolean
  buildSha: string
}

export interface Platform {
  kv: KeyValueStore
  objects: ObjectStore
  server: ServerEndpoint
  transport: Transport
  nav: Navigation
  info: PlatformInfo
  /** register the SW only when info.canServiceWorker; no-op elsewhere */
  registerServiceWorker(url: string): Promise<void>
}

/** Durable workout payloads and terminal receipts, separate from disposable caches. */
export interface WorkoutJournalStorage {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void | boolean>
  /** Expected payload/receipt enables an atomic causal retirement; newer decisions survive. */
  delete(key: string, expected?: string): Promise<void | boolean>
  /** Recoverable active/finished payload keys; terminal receipts are separate. */
  keys(): Promise<string[]>
  receipts(): Promise<[string, string][]>
}
