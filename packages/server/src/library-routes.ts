import type { GymApp } from './app'
import type { AuthService } from './auth'
import { ApiError, json } from './http'
import { LIMITS, type Level } from '@opengym/contract/http/api'
import { validateDefinition, LEVELS } from './library-validation'
import { assertLibraryId, definitionJson, getLibraryEntry, LibraryNotReady, listLibrary, listLibraryVersions, profileState, putLibraryEntry } from './storage/library'

export function installLibrary(app: GymApp, auth: AuthService): void {
  // Reverify after awaiting a body: disable/revocation during receipt must win.
  const profile = (request: Request): string => {
    const session = auth.sessionOf(request)
    if (!session) throw new ApiError(401, 'not signed in')
    return session.user.id
  }
  app.get('/api/programmes/library', c => json(200, listLibrary(auth.db, profile(c.req.raw))))
  app.get('/api/programmes/library/:id/versions', c => {
    const id = assertLibraryId(c.req.param('id')), uid = profile(c.req.raw)
    const versions = listLibraryVersions(auth.db, uid, id)
    if (!versions) throw new ApiError(404, 'not found')
    return json(200, { versions })
  })
  app.get('/api/programmes/library/:id', c => {
    const id = assertLibraryId(c.req.param('id')), uid = profile(c.req.raw)
    const version = c.req.query('version')
    const result = getLibraryEntry(auth.db, uid, id, version)
    if (!result) throw new ApiError(404, 'not found')
    return json(200, result)
  })
  app.put('/api/programmes/library/:id', async c => {
    const id = assertLibraryId(c.req.param('id'))
    profile(c.req.raw)
    const body = await c.get('body').readJson(), uid = profile(c.req.raw)
    if (!Object.hasOwn(body, 'definition') || !(body.expectedVersionId === null || typeof body.expectedVersionId === 'string') ||
      body.minLevel !== undefined && !LEVELS.includes(body.minLevel as Level)) throw new ApiError(400, 'bad request', { code: 'bad-request' })
    try {
      return json(200, putLibraryEntry(auth.db, uid, id, { definition: body.definition, expectedVersionId: body.expectedVersionId as string | null,
        minLevel: body.minLevel as Level | undefined, origin: auth.sessionOf(c.req.raw)?.device.kind === 'agent' ? 'mcp' : 'api', now: auth.now() }))
    } catch (error) {
      if (error instanceof LibraryNotReady) return json(422, { error: error.message, ...error.extra, ...error.validation })
      throw error
    }
  })
  app.post('/api/programmes/validate', async c => {
    profile(c.req.raw)
    const body = await c.get('body').readJson(), uid = profile(c.req.raw)
    if (!Object.hasOwn(body, 'definition')) throw new ApiError(400, 'bad request', { code: 'bad-request' })
    if (Buffer.byteLength(definitionJson(body.definition)) > LIMITS.maxDefinitionBytes) throw new ApiError(413, 'too large', { code: 'too-large' })
    return json(200, validateDefinition(body.definition, profileState(auth.db, uid).customEx))
  })
}
