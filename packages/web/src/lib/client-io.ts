import type { Platform } from '@opengym/contract/platform/adapters'
import { createBrowserClientCapabilities, type ClientCapabilities } from '../platform/client'
let current: Platform | null = null
let caps: ClientCapabilities | null = null
/** Called once at boot; a native shell supplies its own capabilities. */
export function configureClientIO(platform: Platform, capabilities: ClientCapabilities = createBrowserClientCapabilities(platform)): void {
  current = platform; caps = capabilities
}
export function clientPlatform(): Platform {
  if (!current) throw new Error('Client Platform has not been configured')
  return current
}
export function clientCapabilities(): ClientCapabilities {
  if (!caps) throw new Error('Client capabilities have not been configured')
  return caps
}
