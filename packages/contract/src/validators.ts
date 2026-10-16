import { z } from 'zod'
import type { Routes } from '../http/api'
import { ROUTE_POLICY } from '../http/api'
export type RouteKey = keyof Routes
/** Legacy coercion, auth and status precedence belong to the route handler. A
 * structural validator must not turn its 409/401/403 into an early 400. Fields
 * below are deliberately unknown, even when the static producer type is narrower.
 * Legacy unknown fields survive; schemas only ever see a deep clone. */
const envelope = z.object({}).passthrough()
const data = z.object({ state: z.unknown(), baseRev: z.unknown(), baseWid: z.unknown(), stamped: z.unknown(), requireIdle: z.unknown(), trainingClose: z.unknown() }).passthrough()
const proof = z.object({ cid: z.unknown(), credential: z.unknown() }).passthrough()
const name = z.object({ name: z.unknown(), code: z.unknown() }).passthrough()
const idName = z.object({ id: z.unknown(), name: z.unknown() }).passthrough()
const code = z.object({ code: z.unknown() }).passthrough()
const subscription = z.object({ subscription: z.unknown(), deviceId: z.unknown() }).passthrough()
const timer = z.object({ seconds: z.unknown(), deviceId: z.unknown() }).passthrough()
const activity = z.object({ active: z.unknown(), name: z.unknown(), exIdx: z.unknown(), startedAt: z.unknown(), reason: z.unknown(), profileId: z.unknown(), sessionId: z.unknown(), editingWorkoutId: z.unknown(), editorInstanceId: z.unknown() }).passthrough()
// These handlers deliberately ignore their bodies, including arrays/scalars/null.
const ignoredBodyRoutes = new Set<RouteKey>([
  'POST /api/login/options', 'POST /api/logout', 'POST /api/logout/all',
  'POST /api/pair/create', 'POST /api/push/test', 'POST /api/admin/audit/clear',
])
const legacySchemas: Partial<Record<RouteKey, z.ZodTypeAny>> = {
  'PUT /api/data': data,
  'POST /api/register/options': name,
  'POST /api/register/verify': proof,
  'POST /api/login/verify': proof,
  'POST /api/pair/redeem': code,
  'POST /api/account/passkeys/options': proof,
  'POST /api/account/passkeys/verify': proof,
  'POST /api/account/passkeys/rename': idName,
  'DELETE /api/account/passkeys': proof,
  'POST /api/account/device-link': proof,
  'POST /api/device-link/options': code,
  'POST /api/device-link/verify': proof,
  'POST /api/push/subscribe': subscription,
  'POST /api/push/unsubscribe': z.object({ endpoint: z.unknown() }).passthrough(),
  'POST /api/push/rest-timer': timer,
  'POST /api/push/rest-timer/cancel': timer,
  'POST /api/activity': activity,
  'POST /api/admin/user/disable': z.object({ id: z.unknown(), disabled: z.unknown() }).passthrough(),
  'POST /api/admin/user/delete': idName,
  'POST /api/admin/invites/new': name,
  'POST /api/admin/invites/revoke': code,
}
const definition = z.object({ definition: z.unknown().refine(v => v !== undefined, 'definition required') }).passthrough()
const newSchemas: Partial<Record<RouteKey, z.ZodTypeAny>> = {
  'GET /api/data/activity': envelope.optional(),
  'POST /api/account/devices/rename': z.object({ id: z.string(), name: z.string() }).passthrough(),
  'POST /api/account/devices/revoke': z.object({ id: z.string() }).passthrough(),
  'PUT /api/programmes/library/:id': z.object({ definition: z.unknown().refine(v => v !== undefined), expectedVersionId: z.string().nullable(), minLevel: z.enum(['Invalid', 'Valid', 'Complete', 'Ready']).optional() }).passthrough(),
  'POST /api/programmes/validate': definition,
  'POST /api/progression/validate': definition,
  'POST /api/progression/preview': z.object({ source: z.union([z.object({ definitionId: z.string(), versionId: z.string().optional() }).passthrough(), definition]), weeks: z.array(z.number().int()), cycleId: z.string().optional(), asOf: z.string().optional(), hypotheticalLogs: z.array(z.unknown()).optional() }).passthrough(),
  // Apply's semantic checks (including training/ownership/revision) belong to P5.
  // Its closed producer shape has no client-controlled asOf or hypothetical logs.
  'POST /api/progression/apply': z.object({ cycleId: z.string(), weeks: z.array(z.number().int()), expectedRev: z.number().int(), expectedWid: z.string().nullable(), confirmNoActiveSession: z.literal(true), confirmInventoryAdjustment: z.boolean().optional(), dryRun: z.boolean().optional() }).strict(),
}
export type ValidationResult = { ok: true } | { ok: false; issues: { path: (string | number)[]; message: string }[] }
export const REQUEST_SCHEMAS = Object.fromEntries(Object.keys(ROUTE_POLICY).map(key => {
  const route = key as RouteKey
  return [route, ignoredBodyRoutes.has(route) ? z.unknown() : newSchemas[route] ?? legacySchemas[route] ?? (route.startsWith('GET ') ? envelope.optional() : envelope)]
})) as Record<RouteKey, z.ZodTypeAny>
/** No parsed data is returned. Handlers must retain their original body. */
export function validateRequest(route: RouteKey, body: unknown): ValidationResult {
  if (ignoredBodyRoutes.has(route)) return { ok: true }
  const result = REQUEST_SCHEMAS[route].safeParse(structuredClone(body))
  return result.success ? { ok: true } : { ok: false, issues: result.error.issues.map(i => ({ path: i.path, message: i.message })) }
}
export function matchRoute(method: string, pathname: string): RouteKey | undefined {
  return (Object.keys(ROUTE_POLICY) as RouteKey[]).find(key => {
    const [verb, path] = key.split(' ')
    return verb === method.toUpperCase() && new RegExp(`^${path?.replace(/:[^/]+/g, '[^/]+')}$`).test(pathname)
  })
}
