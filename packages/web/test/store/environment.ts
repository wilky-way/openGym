import type { Platform } from '@opengym/contract/platform/adapters'
import { createBrowserPlatform } from '../../src/platform/browser'
import { browserRestNotification } from '../../src/platform/timer-alerts'
import { configureUI } from '../../src/store/useUI'

export function installUIEnvironment(api: (...args: any[]) => Promise<unknown>): Platform {
  const browser = createBrowserPlatform()
  const platform: Platform = { ...browser,
    info: { ...browser.info, canWebPush: true },
    transport: { async fetch(path, options) { await api(path, options); return new Response('{}') } },
  }
  configureUI({ platform, deviceId: () => 'synthetic-device', notifyRestOver: browserRestNotification(platform) })
  return platform
}
