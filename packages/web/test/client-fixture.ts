import { createBrowserPlatform } from '../src/platform/browser'
import { configureClientIO } from '../src/lib/client-io'
export function configureTestClient() {
  const platform = createBrowserPlatform()
  platform.kv.remove('gym_server_url'); platform.kv.remove('gym_device_token')
  configureClientIO(platform)
  return platform
}
