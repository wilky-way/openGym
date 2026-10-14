import type { Platform } from '@opengym/contract/platform/adapters'
import { ux } from './ux'

/** Browser-only capability implementation. Other shells inject their notification adapter. */
export function browserRestNotification(platform: Platform): () => Promise<void> {
  return async () => {
    const win = ux().window as (Window & { Notification?: typeof Notification }) | null
    const doc = ux().document
    const Notice = win?.Notification
    if (!platform.info.canWebPush || !Notice || Notice.permission !== 'granted') return
    if (!doc?.hidden && doc?.visibilityState !== 'hidden') return
    try {
      const reg = await win?.navigator.serviceWorker?.getRegistration?.()
      if (!(await reg?.pushManager?.getSubscription?.())) return
      const opts = { tag: 'rest-timer', icon: 'icon-512.png' }
      if (reg?.showNotification) { void reg.showNotification('Rest’s over. Next set!', opts); return }
      new Notice('Rest’s over. Next set!', opts)
    } catch { /* unsupported/refused notifications never block the timer */ }
  }
}
