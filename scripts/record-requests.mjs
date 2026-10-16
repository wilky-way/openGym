// Node 22 preload, test-only. Records synthetic fixture request bodies, no headers/tokens.
import { appendFileSync } from 'node:fs'
const original = globalThis.fetch
if (process.env.ORACLE_REQUEST_LOG) globalThis.fetch = async function(input, init) {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input))
  if (url.pathname.startsWith('/api/') && typeof init?.body === 'string') {
    try {
      const body = JSON.parse(init.body)
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const source = new Error().stack?.split('\n').find(line => line.includes('/test/') && !line.includes('record-requests'))?.trim() ?? 'legacy fixture fetch'
        appendFileSync(process.env.ORACLE_REQUEST_LOG, JSON.stringify({method: init.method ?? 'GET', path: url.pathname, source, body}) + '\n', {mode:0o600})
      }
    } catch { /* Invalid JSON is a readBody transport case, not a schema body. */ }
  }
  return original.call(this, input, init)
}
