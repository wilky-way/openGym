import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { validateRequest, matchRoute, REQUEST_SCHEMAS, type RouteKey } from '../src/validators'
import { ROUTE_POLICY, DELETED_ROUTES } from '../http/api'
const frozen = JSON.parse(readFileSync(new URL('../../../scripts/contract-manifest.json', import.meta.url), 'utf8')) as Record<string, string>
it('every frozen contract file remains byte-identical', () => {
  for (const [file, sha] of Object.entries(frozen)) expect(createHash('sha256').update(readFileSync(new URL(`../${file}`, import.meta.url))).digest('hex'), file).toBe(sha)
})
it('validates every recorded legacy fixture body without replacing or modifying its bytes', () => {
  const rows = readFileSync(new URL('./fixtures/legacy-requests.jsonl', import.meta.url), 'utf8').trim().split('\n')
  expect(rows.length).toBeGreaterThan(500)
  for (const row of rows) {
    const {route, body, source} = JSON.parse(row) as {route: RouteKey; body: Record<string, unknown>; source: string}
    if ((DELETED_ROUTES as readonly string[]).includes(route)) {
      expect(REQUEST_SCHEMAS[route]).toBeUndefined()
      continue // Retain recorded bytes as evidence for the deliberately deleted routes.
    }
    const before = JSON.stringify(body), keys = Object.keys(body)
    expect(validateRequest(route, body), `${route} (${source})`).toEqual({ ok: true })
    expect(JSON.stringify(body)).toBe(before)
    expect(Object.keys(body)).toEqual(keys)
  }
})
it('preserves legacy string revisions, coercible fields, unknown fields and nested key order', () => {
  const body = { extension: { z: 1, a: 2 }, baseRev: '4', state: { routines: [], custom: 'opaque', workouts: [] } }
  const before = JSON.stringify(body)
  expect(validateRequest('PUT /api/data', body)).toEqual({ ok: true })
  expect(JSON.stringify(body)).toBe(before)
  expect(validateRequest('POST /api/register/options', {name: 123})).toEqual({ok:true})
  expect(validateRequest('PUT /api/data', {state: [], baseRev: 'bad'})).toEqual({ok:true}) // handler owns invalid-state precedence
})
it('does not validate bodies ignored by legacy handlers, including scalar and array JSON', () => {
  const routes: RouteKey[] = ['POST /api/login/options', 'POST /api/logout', 'POST /api/logout/all', 'POST /api/pair/create', 'POST /api/push/test', 'POST /api/admin/audit/clear']
  for (const route of routes) for (const body of [undefined, null, [], [1, 'synthetic'], true, 42, 'synthetic', { z: 1, a: 2 }]) {
    const bytes = JSON.stringify(body)
    expect(validateRequest(route, body), route).toEqual({ ok: true })
    expect(JSON.stringify(body)).toBe(bytes)
  }
  expect(validateRequest('PUT /api/data', []).ok).toBe(false)
})
it('covers all routes; JSON envelope and new-route fields fail without returning parsed replacements', () => {
  expect(Object.keys(REQUEST_SCHEMAS)).toEqual(Object.keys(ROUTE_POLICY))
  expect(validateRequest('PUT /api/data', null).ok).toBe(false)
  expect(validateRequest('GET /api/health', undefined)).toEqual({ok:true})
  expect(validateRequest('POST /api/account/devices/revoke', {id: 5}).ok).toBe(false)
  const request = {definition: {}, expectedVersionId: null, minLevel: 'Complete'}
  expect(validateRequest('PUT /api/programmes/library/:id', request)).toEqual({ok:true})
  expect(validateRequest('PUT /api/programmes/library/:id', {definition: {}}).ok).toBe(false)
  expect(validateRequest('POST /api/progression/apply', {cycleId:'synthetic', weeks:[1], expectedRev:0, expectedWid:null, confirmNoActiveSession:true})).toEqual({ok:true})
  expect(validateRequest('POST /api/progression/apply', {cycleId:'synthetic', weeks:[1], expectedRev:0, expectedWid:null, confirmNoActiveSession:true,confirmInventoryAdjustment:true})).toEqual({ok:true})
  expect(validateRequest('POST /api/progression/apply', {cycleId:'synthetic', weeks:[1], expectedRev:0, expectedWid:null, confirmNoActiveSession:true,confirmInventoryAdjustment:'yes'}).ok).toBe(false)
  for (const extra of [{asOf:'2026-01-06'},{hypotheticalLogs:[]},{unknown:true}]) {
    const body={cycleId:'synthetic',weeks:[1],expectedRev:0,expectedWid:null,confirmNoActiveSession:true,...extra},before=JSON.stringify(body)
    expect(validateRequest('POST /api/progression/apply',body).ok).toBe(false)
    expect(JSON.stringify(body)).toBe(before)
  }
  expect(matchRoute('PUT', '/api/programmes/library/synthetic')).toBe('PUT /api/programmes/library/:id')
  expect(matchRoute('POST', '/api/login/password')).toBeUndefined()
})

it('media upload routes are deleted and have no live policy or request schema', () => {
  for (const route of ['PUT /api/media/:hash', 'GET /api/media/:hash', 'POST /api/media/missing', 'POST /api/media/sweep']) {
    expect(DELETED_ROUTES).toContain(route)
    expect(ROUTE_POLICY).not.toHaveProperty(route)
    expect(REQUEST_SCHEMAS).not.toHaveProperty(route)
    const [method, path] = route.split(' ')
    expect(matchRoute(method!, path!.replace(':hash', 'synthetic'))).toBeUndefined()
  }
})
