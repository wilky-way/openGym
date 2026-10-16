import type { KeyValueStore, Navigation, Platform, ServerEndpoint, Transport } from '@opengym/contract/platform/adapters'
import { browserKeyValueStore, browserObjectStore, browserWorkoutJournal } from './storage'
import { configureUx, createBrowserUx } from './ux'
import type { NavReaders } from '../lib/nav'

export const SERVER_URL_KEY = 'gym_server_url'
export const DEVICE_TOKEN_KEY = 'gym_device_token'

function serverOrigin(base: string): string {
  if (!base) return ''
  const url = new URL(base)
  if (base !== base.trim() || url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('API base URL must be an HTTPS origin without credentials, path, query or fragment')
  }
  return url.origin
}

/** Pairing/configuration persists the endpoint per device; no build-time server constant. */
export function configureBrowserServer(kv: KeyValueStore, base: string): void {
  const origin = serverOrigin(base)
  if (origin) kv.set(SERVER_URL_KEY, origin)
  else kv.remove(SERVER_URL_KEY)
}

export function browserServerEndpoint(kv: KeyValueStore): ServerEndpoint {
  const baseUrl = () => serverOrigin(kv.get(SERVER_URL_KEY) ?? '')
  return {
    baseUrl,
    async authHeader(): Promise<Record<string, string>> {
      if (!baseUrl()) return {}
      const token = kv.get(DEVICE_TOKEN_KEY)
      return token ? { Authorization: 'Bearer ' + token } : {}
    },
    async setDeviceToken(token) {
      if (token === null) kv.remove(DEVICE_TOKEN_KEY)
      else kv.set(DEVICE_TOKEN_KEY, token)
    },
  }
}

export function browserTransport(win: Window, server: ServerEndpoint): Transport {
  return {
    async fetch(path, init) {
      const base = server.baseUrl()
      const page = new URL(win.location.href)
      // Same-origin API requests retain the reverse-proxy mount, as legacy appBase() did.
      const mount = page.pathname.slice(0, page.pathname.lastIndexOf('/') + 1) || '/'
      const absolute = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(path)
      const url = new URL(absolute ? path : base ? path : mount + path.replace(/^\//, ''), base || page.origin)
      const endpoint = url.origin === (base || page.origin)
      const headers = new Headers(init?.headers)
      // Third-party requests (e.g. Hevy) keep caller headers but never inherit the device token.
      const anonymous = init?.mode === 'no-cors' || /\/api\/pair\/redeem$/.test(url.pathname)
      if (anonymous) headers.delete('Authorization')
      if (endpoint && !anonymous) for (const [key, value] of Object.entries(await server.authHeader())) headers.set(key, value)
      return win.fetch(url.href, {
        ...init,
        headers,
        credentials: !base && url.origin === page.origin ? 'include' : 'omit',
      })
    },
  }
}

export function browserNavigation(win: Window): Navigation {
  return {
    href: () => win.location.href,
    searchParams: () => new URL(win.location.href).searchParams,
    replaceQuery(params) {
      const url = new URL(win.location.href)
      for (const [key, value] of Object.entries(params)) {
        if (value === null) url.searchParams.delete(key)
        else url.searchParams.set(key, value)
      }
      win.history.replaceState(win.history.state, '', url.href)
    },
    reload: () => win.location.reload(),
  }
}

/** K02's nav module accepts these readers at boot; W00 does not own/re-port that module. */
export function browserNavReaders(win: Window = window): NavReaders & { onSheetEntry(): boolean; currentRoute(): string } {
  const sheetEntry = (): boolean => {
    try { return !!win.history.state?.openGymSheet } catch { return false }
  }
  const currentHash = (): string => String(win.location.hash || '')
  return { sheetEntry, currentHash, onSheetEntry: sheetEntry, currentRoute: currentHash }
}

export interface BrowserPlatformOptions { buildSha?: string }

/** W01 passes this to K01 sha256Hex; core keeps its pure-JS default in every other shell. */
export function browserSha256Options(win: Window = window): { subtle: SubtleCrypto | undefined } {
  return { subtle: win.crypto?.subtle }
}

export function createBrowserPlatform(options: BrowserPlatformOptions = {}): Platform & { workoutJournal: import('@opengym/contract/platform/adapters').WorkoutJournalStorage } {
  if (typeof window === 'undefined') throw new Error('Browser window is unavailable')
  configureUx(createBrowserUx())
  const win = window
  // Best effort once per boot; refusal never blocks workout logging.
  try { void win.navigator.storage?.persist?.().catch(() => {}) } catch { /* unavailable */ }
  const kv = browserKeyValueStore(win), server = browserServerEndpoint(kv)
  const canServiceWorker = 'serviceWorker' in win.navigator && win.location.protocol === 'https:'
  const worker = win.navigator.serviceWorker
  if (worker?.addEventListener) {
    worker.addEventListener('message', event => {
      if (event.data?.type === 'OPENGYM_BUILD_QUERY') {
        const assets = [...win.document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src],link[rel="stylesheet"][href]')].map(element => element instanceof win.HTMLScriptElement ? element.src : element.href).filter(url => new URL(url).origin === win.location.origin)
        event.source?.postMessage({ type: 'OPENGYM_BUILD_REPLY', nonce: event.data.nonce, buildSha: options.buildSha ?? '', assets })
      }
    })
    const announce = () => worker.controller?.postMessage({ type: 'OPENGYM_BUILD_READY' })
    worker.addEventListener('controllerchange', announce)
    announce()
  }
  return {
    kv,
    objects: browserObjectStore(win.indexedDB),
    workoutJournal: browserWorkoutJournal(win.indexedDB),
    server,
    transport: browserTransport(win, server),
    nav: browserNavigation(win),
    info: {
      kind: 'browser',
      canServiceWorker,
      canWebPush: canServiceWorker && 'PushManager' in win && 'Notification' in win,
      canWakeLock: 'wakeLock' in win.navigator,
      buildSha: options.buildSha ?? '',
    },
    async registerServiceWorker(url) {
      if (canServiceWorker) await win.navigator.serviceWorker.register(url)
    },
  }
}
