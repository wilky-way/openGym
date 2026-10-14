import { clientPlatform, clientCapabilities } from './client-io'
// Web Push subscribe/unsubscribe — requires a signed-in profile (subscriptions are stored
// server-side per user, same as everything else under /api).
import { api } from './api'
type Valid = () => boolean
const check = (valid: Valid) => { if (!valid()) throw new Error('Push action target changed') }

// main.jsx registers the service worker on https only, so on any other origin there is no
// worker and `navigator.serviceWorker.ready` never settles — the toggle looked usable and hung.
export const pushSupported = () => clientPlatform().info.canWebPush && clientCapabilities().push.supported()
export const pushPermission = () => pushSupported() ? clientCapabilities().push.permission() : 'unsupported'

const urlBase64ToUint8Array = (b64: string) => {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}
const bytesToUrlBase64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// One token per browser profile, made up here and never shown: it tells the server which of
// the account's subscriptions belong to this device, so a rest-timer alert goes to the phone
// that started the rest and not to every tab of the account. Nothing identifying in it.
const DEVICE_KEY = 'gym_device'
// The shape the server keeps, mirrored from deviceIdOf in api/server.js: anything else it treats
// as no id at all. A stored value outside it (set by hand, or left by some other build) went out
// as it was, so the row kept no id, the boot sync saw that and sent it again, on every boot, and
// the rest timer's alert went to every device. Such a value is replaced like a missing one.
const DEVICE_ID_RULE = /^[A-Za-z0-9_-]{8,64}$/
export function deviceId() {
  try {
    let id = clientPlatform().kv.get(DEVICE_KEY)
    if (!id || !DEVICE_ID_RULE.test(id)) {
      id = clientCapabilities().randomId()
      clientPlatform().kv.set(DEVICE_KEY, id)
    }
    return id
  } catch { return undefined }
}

// The worker re-registers a subscription the push service rotated (public/sw.js,
// pushsubscriptionchange), usually with no page open, and it cannot read localStorage. It finds
// the device id here instead, in a cache of its own that its activate sweep leaves alone. Left
// every time this browser holds a subscription the server should have, so a browser subscribed
// before the worker looked for it has it by its next boot.
async function shareDeviceId(valid: Valid) { check(valid); const id = deviceId(); if (id) await clientCapabilities().push.shareDeviceId(id); check(valid) }

// The worker is registered at boot; on https it is there within a moment, but a promise that
// never settles must not hang a settings screen or the boot path — give it a bounded wait.
async function readyWorker(ms = 8000): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try { return await Promise.race([clientCapabilities().push.ready(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Service worker not ready')), ms) })]) }
  finally { clearTimeout(timer) }
}

const register = (sub: PushSubscription, valid: Valid) => { check(valid); return api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), deviceId: deviceId() }) }) }

export async function enablePush(valid: Valid = () => true) {
  check(valid)
  if (!pushSupported()) throw new Error('Push notifications are not supported in this browser')
  const perm = await clientCapabilities().push.requestPermission()
  check(valid)
  if (perm !== 'granted') throw new Error('Notifications permission was not granted')
  const reg = await readyWorker()
  check(valid)
  const { key } = await api('/api/push/public-key')
  check(valid)
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
  check(valid)
  await shareDeviceId(valid)
  await register(subscription, valid)
  check(valid)
}

export async function disablePush(valid: Valid = () => true) {
  check(valid)
  if (!pushSupported()) return
  const reg = await readyWorker()
  check(valid)
  const sub = await reg.pushManager.getSubscription()
  check(valid)
  if (!sub) return
  await sub.unsubscribe()
  check(valid)
  await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
}

/* Brings the server's copy of this browser's subscription back in line with the browser's.
   Called once per signed-in boot and when Settings opens. The browser keeps its subscription
   through anything that happens on the server — a row pruned after a dead send, a rebuilt
   db.json, a regenerated VAPID key — and the toggle used to read "on" from the browser's side
   while nothing was ever going to arrive. Resolves to whether the server now holds it:
   - no permission or no subscription here → false, nothing to do;
   - the server already has this endpoint under this browser's device id → true, no write;
   - the server has it under no device id or another one → sent again with this one, true;
   - the server lost it → re-registered, true;
   - the server's key changed → the old subscription is useless; unsubscribe, subscribe against
     the new key, register, true.
   Network failures propagate — the caller decides what "unknown" means for it. */
export async function syncPushSubscription(valid: Valid = () => true) {
  check(valid)
  if (!pushSupported() || clientCapabilities().push.permission() !== 'granted') return false
  const reg = await readyWorker()
  check(valid)
  let sub = await reg.pushManager.getSubscription()
  check(valid)
  if (!sub) return false
  await shareDeviceId(valid)
  const { key } = await api('/api/push/public-key')
  check(valid)
  const mine = sub.options?.applicationServerKey
  if (mine && key && bytesToUrlBase64(mine) !== key.replace(/=+$/, '')) {
    await sub.unsubscribe().catch(() => {})
    check(valid)
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
    check(valid)
    await register(sub, valid)
    check(valid)
    return true
  }
  // A row the server stores under no device id, or another one, is sent again with this
  // browser's: the same endpoint and keys, and the server's upsert keeps the row's created date.
  // Without the id the server cannot tell this browser's rest-timer alert from the account's, and
  // sends it to every device. Such rows come from before device ids, or from the worker re-sending
  // a rotated subscription with no id to hand, and the check used to stop at "subscribed". An api
  // from before this answer sends no deviceId at all (not null): it cannot say, and a re-send it
  // never reports back would be a db.json write on every boot.
  const { subscribed, deviceId: storedAs } = await api('/api/push/status?endpoint=' + encodeURIComponent(sub.endpoint))
  check(valid)
  const id = deviceId()
  if (!subscribed || (id && storedAs !== undefined && storedAs !== id)) await register(sub, valid)
  check(valid)
  return true
}

export const sendTestPush = (valid: Valid = () => true) => { check(valid); return api('/api/push/test', { method: 'POST', body: '{}' }) }
