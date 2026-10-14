import type {Platform} from '@opengym/contract/platform/adapters'
import {configureBrowserServer, SERVER_URL_KEY, DEVICE_TOKEN_KEY} from './browser'
/** Injectable browser client capabilities. Network/storage are always Platform-owned. */
export interface ClientCapabilities {
  connection: {configure(baseUrl: string, token: string | null): Promise<void>; token(): string | null}
  userAgent(): string
  webauthnOK(): boolean
  credentials: { create(options: CredentialCreationOptions): Promise<Credential | null>; get(options: CredentialRequestOptions): Promise<Credential | null> }
  push: { supported(): boolean; permission(): NotificationPermission | 'unsupported'; requestPermission(): Promise<NotificationPermission>; ready(): Promise<ServiceWorkerRegistration>; shareDeviceId(id: string): Promise<void> }
  randomId(): string
  copyText(text: string): Promise<boolean>
  barcodeDetector(): { detect(source: CanvasImageSource): Promise<{rawValue: string; format: string}[]> } | null
  canvas(): HTMLCanvasElement
  image(file: Blob): Promise<ImageBitmap | HTMLImageElement>
}
const DEVICE_CACHE = 'opengym-device'
const DEVICE_URL = '/opengym-device-id'
export function createBrowserClientCapabilities(platform: Platform): ClientCapabilities {
  return {
    connection: {
      configure(baseUrl, token) {
        const previousBase = platform.kv.get(SERVER_URL_KEY)
        configureBrowserServer(platform.kv, baseUrl)
        const restore = (error: unknown): never => {
          if (previousBase === null) platform.kv.remove(SERVER_URL_KEY)
          else platform.kv.set(SERVER_URL_KEY, previousBase)
          throw error
        }
        try { return platform.server.setDeviceToken(token).catch(restore) }
        catch (error) { return Promise.reject().catch(() => restore(error)) }
      },
      token: () => platform.kv.get(DEVICE_TOKEN_KEY),
    },
    userAgent: () => typeof navigator === 'undefined' ? '' : navigator.userAgent,
    webauthnOK: () => typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined',
    credentials: { create: o => navigator.credentials.create(o), get: o => navigator.credentials.get(o) },
    push: {
      supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:',
      permission: () => Notification.permission,
      requestPermission: () => Notification.requestPermission(),
      ready: () => navigator.serviceWorker.ready,
      async shareDeviceId(id) { try { await (await caches.open(DEVICE_CACHE)).put(DEVICE_URL, new Response(id)) } catch {} },
    },
    randomId: () => (crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')).replace(/-/g, ''),
    async copyText(text) {
      try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true } } catch {}
      let area: HTMLTextAreaElement | undefined
      try {
        area = document.createElement('textarea'); area.value = text; area.setAttribute('readonly', '')
        area.style.position = 'fixed'; area.style.opacity = '0'; document.body.appendChild(area)
        area.select(); area.setSelectionRange(0, text.length); return !!document.execCommand('copy')
      } catch { return false } finally { area?.remove() }
    },
    barcodeDetector() {
      type Detector = new (options: {formats: string[]}) => {detect(source: CanvasImageSource): Promise<{rawValue: string; format: string}[]>}
      const Ctor = (window as unknown as {BarcodeDetector?: Detector}).BarcodeDetector
      try { return Ctor ? new Ctor({formats: ['qr_code']}) : null } catch { return null }
    },
    canvas: () => document.createElement('canvas'),
    async image(file) {
      if (typeof createImageBitmap === 'function') return createImageBitmap(file)
      return new Promise((resolve, reject) => {
        const img = new Image(), url = URL.createObjectURL(file)
        img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')) }; img.src = url
      })
    },
  }
}
