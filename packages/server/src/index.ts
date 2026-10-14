import { mkdirSync } from 'node:fs'
import { secureResponse, bootAddress } from './security-headers'
import { createApp, appNotifications, type AppServices } from './app'
import { loadConfig, type ServerConfig } from './config'
import { BodyDeadline, RequestBody, corsHeaders, errorResponse } from './http'
import { staticHandler } from './static'

export { createApp } from './app'
export { loadConfig } from './config'
export { ApiError, json, RequestBody } from './http'

export function startServer(config: ServerConfig = loadConfig(), services: AppServices = {}, boot: (message: string) => void = console.log) {
  if (config.exposure === 'public' && !config.deviceTokens) throw new Error('EXPOSURE=public requires DEVICE_TOKENS=1')
  mkdirSync(config.dataDir, { recursive: true })
  const app = createApp(config, services)
  const serveStatic = config.staticDir ? staticHandler(config.staticDir) : undefined
  const server = Bun.serve({
    port: config.port, hostname: config.host,
    // Bun exposes an idle header timeout, not an absolute pre-header deadline.
    // Request transport is handled by the shared HTTP middleware.
    idleTimeout: config.headersTimeoutMs / 1000,
    // The application sends JSON 413 and discards at most twice its cap. Bun's own
    // cap would preempt that response (and its JSON conventions).
    maxRequestBodySize: Number.MAX_SAFE_INTEGER,
    async fetch(request, listener) {
      const asset = serveStatic?.(request)
      if (asset) return secureResponse(asset, new URL(request.url).pathname)
      let timer: ReturnType<typeof setTimeout> | undefined
      const body = new RequestBody(request, config.maxBodyBytes, () => {
        clearTimeout(timer)
        listener.timeout(request, config.headersTimeoutMs / 1000)
      })
      const framed = !!request.headers.get('transfer-encoding') || +(request.headers.get('content-length') || 0) > 0
      const expired = new Promise<never>((_, reject) => {
        if (framed) {
          // Activity cannot extend this deadline. It starts before routing/CSRF.
          listener.timeout(request, 0)
          timer = setTimeout(() => { body.cancel(); reject(new BodyDeadline()) }, config.bodyTimeoutMs)
        }
      })
      let response: Response
      try { response = await Promise.race([app.fetch(request, { body }), expired]) }
      catch (error) { response = errorResponse(error, services.log) }
      if (response.status === 413 && body.draining && !body.complete) {
        // Flush the JSON error while draining. Keep the response stream open until the
        // peer finishes (or exceeds 2x/the deadline), so Connection: close cannot
        // reset a well-behaved client that is still writing its oversized upload.
        const bytes = new Uint8Array(await response.arrayBuffer())
        const draining = body.draining
        let cancelled = false
        response = new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes)
            void draining.then(() => { clearTimeout(timer); if (!cancelled) controller.close() })
          },
          cancel() { cancelled = true; body.cancel(); clearTimeout(timer) },
        }), { status: response.status, headers: response.headers })
      } else clearTimeout(timer)
      if (framed && !body.complete) {
        response.headers.set('Connection', 'close')
        if (response.status !== 413) body.cancel()
      }
      corsHeaders(request, config.origin).forEach((value, key) => response.headers.set(key, value))
      return secureResponse(response, new URL(request.url).pathname)
    },
    error: error => secureResponse(errorResponse(error, services.log)),
  })
  const notifications = appNotifications(app)
  notifications?.start()
  const stop = server.stop.bind(server)
  server.stop = closeActiveConnections => {
    notifications?.close()
    services.auth?.auditLog.close()
    return stop(closeActiveConnections)
  }
  boot(`gym-api on :${server.port} (${bootAddress(config.rpId, config.origin)})`)
  return server
}

if (import.meta.main) startServer(loadConfig(process.env, process.argv.slice(2)))
