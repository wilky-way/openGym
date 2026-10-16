// Shell-independent API connection. A future host can supply its URL, token and transport.
// Browser requests otherwise use the page's origin/subpath and current fetch implementation.
const buildBase = import.meta.env.VITE_API_BASE_URL || ''
let connection = { baseUrl: buildBase.replace(/\/+$/, ''), token: null, fetch: null }

export function configureApiConnection({ baseUrl = '', token = null, fetch: transport = null } = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (base && !/^https?:\/\//i.test(base)) throw new Error('API base URL must use http or https')
  connection = { baseUrl: base, token: token || null, fetch: transport }
}
export const apiConnection = () => connection
export const apiFetch = (...args) => (connection.fetch || globalThis.fetch)(...args)
