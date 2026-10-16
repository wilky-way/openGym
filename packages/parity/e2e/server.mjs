// Test-only readiness nonce; no production server code is changed.
import '../src/fakedate.mjs'
const serve = Bun.serve.bind(Bun)
Bun.serve = options => serve({ ...options, async fetch(...args) {
  const response = await options.fetch(...args)
  response.headers.set('x-parity-oracle-nonce', process.env.PARITY_ORACLE_NONCE)
  return response
} })
const { startRuntime } = await import('../../server/src/runtime.ts')
const server = startRuntime()
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await server.stop(true); process.exit(0) })
