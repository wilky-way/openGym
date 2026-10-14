import { clientPlatform, clientCapabilities } from './client-io'
export interface ApiConnectionOptions { baseUrl?: string; token?: string | null }
/** Browser and native shells own their configuration and credential persistence. */
export function configureApiConnection({baseUrl = '', token = null}: ApiConnectionOptions = {}): Promise<void> {
  return clientCapabilities().connection.configure(baseUrl, token)
}
export const apiConnection = () => ({baseUrl: clientPlatform().server.baseUrl(), token: clientCapabilities().connection.token()})
export function apiFetch(path: string, init?: RequestInit): Promise<Response> { const platform = clientPlatform(); return platform.transport.fetch(path, init) }
