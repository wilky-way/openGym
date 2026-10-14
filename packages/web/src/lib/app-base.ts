import { clientPlatform } from './client-io'
export function appBase(loc: {pathname?: string} | null = new URL(clientPlatform().nav.href())): string {
 const path = loc?.pathname || '/'; return path.slice(0, path.lastIndexOf('/') + 1) || '/'
}
