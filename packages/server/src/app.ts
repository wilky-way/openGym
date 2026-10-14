import { Hono } from 'hono'
import { secureResponse } from './security-headers'
import type { AuthService, Session } from './auth'
import { installAuth } from './auth-routes'
import { installLibrary } from './library-routes'
import { installAdmin, type AdminServices } from './admin-routes'
import { installPasskeys, type PasskeyOptions } from './passkey-routes'
import { DELETED_ROUTES, ERR, ROUTE_POLICY, type ConfigResponse } from '@opengym/contract/http/api'
import type { ServerConfig } from './config'
import { csrfOk, corsHeaders, json, errorResponse, RequestBody } from './http'
import { writableProbe } from './health'
import { installData, type DataService } from './data'
import { installProgression, type ProgressionServices } from './progression'
import { createNotifications, installNotifications, type Notifications } from './notifications'

export interface AppServices {
  passkeys?: PasskeyOptions
  progression?: ProgressionServices
  data?: DataService
  auth?: AuthService
  notifications?: Notifications
  admin?: AdminServices
  /** Repositories supply the user count; authentication supplies verified session presence. */
  userCount?: () => number | Promise<number>
  signedIn?: (request: Request) => boolean | Promise<boolean>
  writable?: () => boolean | Promise<boolean>
  now?: () => number
  log?: (message: string) => void
  routes?: (app: GymApp, presence?: Pick<Notifications, 'livePresence' | 'dropPresence'>) => void
}
export type AppEnv = { Variables: { body: RequestBody; session: Session | null; routeKey: string }; Bindings: { body?: RequestBody } }
export type GymApp = Hono<AppEnv>
const removed: ReadonlySet<string> = new Set(DELETED_ROUTES)
const notifications = new WeakMap<GymApp, Notifications>()
export const appNotifications = (app: GymApp) => notifications.get(app)
// Like legacy's URL.pathname lookup: normalise dot segments, retain percent escapes.
// Hono's default getPath decodes them, letting routing disagree with CSRF/tombstones.
function requestTarget(request: Request): string {
  const url = request.url
  const offset = url.indexOf('/', url.indexOf('://') + 3)
  return offset < 0 ? '/' : url.slice(offset)
}
function requestPath(request: Request): string {
  const target = requestTarget(request)
  // Bun puts the raw target behind its listener origin; legacy parses the target
  // against http://x, so //other/api/health dispatches on /api/health.
  try { return new URL(target, 'http://x').pathname }
  catch { return target.split(/[?#]/)[0]! } // Middleware retains legacy's JSON 400 for invalid targets.
}
function routeKey(request: Request, path: string): string {
  if (/^\/api\/media\/[^/]+$/.test(path)) return `${request.method} /api/media/:hash`
  if (/^\/api\/programmes\/library\/[^/]+\/versions$/.test(path)) return `${request.method} /api/programmes/library/:id/versions`
  if (/^\/api\/programmes\/library\/[^/]+$/.test(path)) return `${request.method} /api/programmes/library/:id`
  return `${request.method} ${path}`
}

export function createApp(config: ServerConfig, services: AppServices = {}): GymApp {
  const app = new Hono<AppEnv>({ strict: true, getPath: requestPath })
  app.use('*', async (c, next) => {
    await next()
    c.res = secureResponse(c.res, c.req.path)
    corsHeaders(c.req.raw, config.origin).forEach((value, key) => c.res.headers.set(key, value))
  })
  const writable = services.writable ?? writableProbe(config.dataDir, services.now, services.log)
  app.use('*', async (context, next) => {
    const request = context.req.raw
    const headers = corsHeaders(request, config.origin)
    headers.forEach((value, key) => context.header(key, value))
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    const path = context.req.path
    try { new URL(requestTarget(request), 'http://x') } catch { return json(400, { error: ERR.badRequest }) }
    if (request.method === 'HEAD') return json(404, { error: ERR.notFound })
    const key = routeKey(request, path)
    // Deleted uploads, passwords and provider routes remain 404 even if a later unit mounts one.
    if (removed.has(key) || path.startsWith('/api/media/')) return json(404, { error: ERR.notFound })
    // Every unsafe method is checked, including new handlers absent from ROUTE_POLICY.
    if (!csrfOk(request, key, config.origin)) return json(403, { error: ERR.crossOrigin })
    const body = context.env?.body ?? new RequestBody(request, config.maxBodyBytes)
    context.set('routeKey', key)
    context.set('body', body)
    body.startReceiving()
    if (!services.auth && Object.hasOwn(ROUTE_POLICY, key)) await body.receipt()
    await next()
  })
  if (services.auth) {
    installAuth(app, services.auth)
    const n = services.notifications ?? createNotifications(services.auth, { log: services.log })
    notifications.set(app, n)
    installNotifications(app, services.auth, n)
    installAdmin(app, services.auth, { livePresence: n.livePresence, dropPresence: n.dropPresence, ...services.admin })
    installPasskeys(app, services.auth, services.passkeys)
  }
  if (services.data) {
    installData(app, services.data, services.auth)
    installProgression(app, services.data, services.auth, {now:services.now ?? services.auth?.now,livePresence:notifications.get(app)?.livePresence,...services.progression})
  }
  app.get('/api/health', async () => {
    if (!await writable()) return json(503, { ok: false, writable: false })
    return json(200, { ok: true, users: await (services.userCount?.() ?? 0), writable: true })
  })
  app.get('/api/config', async context => {
    const response: ConfigResponse = {
      invite_only: config.inviteOnly, allow_guest: config.allowGuest,
      ...(config.defaultLang ? { default_lang: config.defaultLang } : {}),
      ...((services.auth ? !!context.get('session') : await services.signedIn?.(context.req.raw)) ? { signedIn: true as const } : {}),
    }
    return json(200, response)
  })
  services.routes?.(app, notifications.get(app))
  if (services.auth) installLibrary(app, services.auth)
  app.notFound(() => json(404, { error: ERR.notFound }))
  app.onError(error => errorResponse(error, services.log))
  return app
}
