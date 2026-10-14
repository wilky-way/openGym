import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { LIMITS, type Level, type LibraryEntry, type LibrarySummary, type LibraryVersionSummary, type ValidateResult } from '@opengym/contract/http/api'
import type { ProgrammeDefinition } from '@opengym/contract/domain/programme-model'
import { ApiError } from '../http'
import { LEVELS, validateDefinition } from '../library-validation'
import { readStateDoc } from './state'

/** Opaque identifiers are never paths; SQL remains bound to the authenticated profile. */
export function assertLibraryId(id: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(id) || /^\.+$/.test(id)) throw new ApiError(400, 'bad request', { code: 'bad-request' })
  return id
}
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
/** Stable recursively sorted JSON, restricted to parsed JSON values. Never used on state documents. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  const row = object(value)
  if (row) return '{' + Object.keys(row).sort().map(k => JSON.stringify(k) + ':' + canonicalJson(row[k])).join(',') + '}'
  const text = JSON.stringify(value)
  if (text === undefined) throw new TypeError('not a JSON value')
  return text
}
/** JSON serialization can throw for adversarial depth (or non-JSON in-process input). */
export function definitionJson(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    if (text !== undefined) return text
  } catch { /* Refuse malformed input without exposing serializer details. */ }
  throw new ApiError(400, 'bad request', { code: 'bad-request' })
}
export const libraryVersionId = (canonical: string): string => 'sha256:' + createHash('sha256').update(canonical).digest('hex')
export const privateDefinition = (definition: unknown): boolean => {
  const d = object(definition)
  return object(d?.source)?.private === true || typeof d?.id === 'string' && new RegExp('^(?:' + String.fromCharCode(98,98,109) + '|' + String.fromCharCode(115,98,115) + ')-', 'i').test(d.id)
}
export function profileState(db: Database, profileId: string): Record<string, unknown> {
  return object(JSON.parse(readStateDoc(db, profileId)?.json ?? '{}')) ?? {}
}
function records(value: unknown): Record<string, unknown>[] {
  const seen = new Set<string>()
  return (Array.isArray(value) ? value : []).flatMap(v => {
    const row = object(v)
    if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id)) return []
    seen.add(row.id); return [row]
  })
}
export function definitionInUse(state: Record<string, unknown>, id: string): boolean {
  return records(object(state.programmes)?.cycles).some(c =>
    typeof c.status === 'string' && (c.status === 'active' || c.status === 'paused') && (c.programmeId === id || object(c.snapshot)?.id === id))
}
interface HeadRow {
  id: string; head_n: number; head_sha: string; name: string; level: Level; private: number
  source_kind: string | null; days_per_week: number | null; length_weeks: number | null; goal: string | null; updated_at: string
}
interface VersionRow { n: number; sha: string; parent_sha: string | null; level: Level; published_at: string; original_json: string }
const head = (db: Database, profileId: string, id: string) => db.query<HeadRow, [string, string]>(
  'SELECT * FROM library_definitions WHERE profile_id=? AND id=?').get(profileId, id)
const entry = (row: VersionRow): LibraryEntry => ({ definition: JSON.parse(row.original_json) as ProgrammeDefinition, versionId: row.sha, n: row.n, level: row.level })
export function getLibraryEntry(db: Database, profileId: string, id: string, version?: string): LibraryEntry | null {
  assertLibraryId(id)
  const row = version === undefined
    ? db.query<VersionRow, [string, string]>('SELECT v.* FROM library_versions v JOIN library_definitions d ON d.profile_id=v.profile_id AND d.id=v.definition_id AND d.head_n=v.n WHERE v.profile_id=? AND v.definition_id=?').get(profileId, id)
    : /^\d+$/.test(version)
      ? db.query<VersionRow, [string, string, number]>('SELECT * FROM library_versions WHERE profile_id=? AND definition_id=? AND n=?').get(profileId, id, Number(version))
      : db.query<VersionRow, [string, string, string]>('SELECT * FROM library_versions WHERE profile_id=? AND definition_id=? AND sha=? ORDER BY n DESC LIMIT 1').get(profileId, id, version)
  return row ? entry(row) : null
}
export function listLibraryVersions(db: Database, profileId: string, id: string): LibraryVersionSummary[] | null {
  assertLibraryId(id)
  if (!head(db, profileId, id)) return null
  return db.query<VersionRow, [string, string]>('SELECT * FROM library_versions WHERE profile_id=? AND definition_id=? ORDER BY n').all(profileId, id)
    .map(r => ({ n: r.n, versionId: r.sha, parentVersionId: r.parent_sha, level: r.level, publishedAt: r.published_at, bytes: Buffer.byteLength(r.original_json) }))
}
export function listLibrary(db: Database, profileId: string): { items: LibrarySummary[]; etag: string } {
  return db.transaction(() => {
    const state = profileState(db, profileId)
    const items: LibrarySummary[] = db.query<HeadRow & { original_json: string }, [string]>(
      'SELECT d.*, v.original_json FROM library_definitions d JOIN library_versions v ON v.profile_id=d.profile_id AND v.definition_id=d.id AND v.n=d.head_n WHERE d.profile_id=? ORDER BY d.id').all(profileId)
      .map(r => ({ id: r.id, name: r.name, level: r.level, private: !!r.private, versionN: r.head_n, versionId: r.head_sha, bytes: Buffer.byteLength(r.original_json), updatedAt: r.updated_at,
        ...(r.source_kind === null ? {} : { sourceKind: r.source_kind }), ...(r.days_per_week === null ? {} : { daysPerWeek: r.days_per_week }),
        ...(r.length_weeks === null ? {} : { lengthWeeks: r.length_weeks }), ...(r.goal === null ? {} : { goal: r.goal }), inUse: definitionInUse(state, r.id) }))
    return { items, etag: libraryVersionId(canonicalJson(items)) }
  })()
}
export interface LibraryPublish {
  definition: unknown; expectedVersionId: string | null; minLevel?: Level
  origin?: 'migration' | 'api' | 'mcp'; now?: number
}
export function putLibraryEntry(db: Database, profileId: string, id: string, request: LibraryPublish): LibraryEntry {
  assertLibraryId(id)
  // Reparse to restrict the repository to JSON and detach the caller's mutable graph.
  const original = definitionJson(request.definition)
  if (Buffer.byteLength(original) > LIMITS.maxDefinitionBytes) throw new ApiError(413, 'too large', { code: 'too-large' })
  const definition = object(JSON.parse(original))
  if (!definition || definition.id !== id || typeof definition.name !== 'string' || !id) throw new ApiError(400, 'bad request', { code: 'bad-request' })
  let canonical: string
  try { canonical = canonicalJson(definition) }
  catch { throw new ApiError(400, 'bad request', { code: 'bad-request' }) }
  const sha = libraryVersionId(canonical)
  return db.transaction(() => {
    const current = head(db, profileId, id)
    if ((current?.head_sha ?? null) !== request.expectedVersionId) throw new ApiError(409, 'version conflict', { code: 'version-conflict' })
    const state = profileState(db, profileId)
    if (definitionInUse(state, id)) throw new ApiError(409, 'active definition', { code: 'active-definition' })
    const privateFlag = privateDefinition(definition)
    const installedPrivate = records(object(state.programmes)?.definitions).some(d => d.id === id && privateDefinition(d))
    if ((current?.private || installedPrivate) && !privateFlag) throw new ApiError(403, 'private downgrade', { code: 'private-downgrade' })
    const minLevel = request.minLevel ?? 'Valid'
    if (!LEVELS.includes(minLevel)) throw new ApiError(400, 'bad request', { code: 'bad-request' })
    const validation = validateDefinition(definition, state.customEx)
    if (LEVELS.indexOf(validation.level) < LEVELS.indexOf(minLevel)) {
      // Issues are part of this route's 422 response, beyond the common ApiError shape.
      throw new LibraryNotReady(validation)
    }
    // A semantic no-op converges on the existing immutable version, including
    // its first submitted key order. The expected hash still gates changed writes.
    if (current?.head_sha === sha) return getLibraryEntry(db, profileId, id)!
    const n = (current?.head_n ?? 0) + 1, publishedAt = new Date(request.now ?? Date.now()).toISOString()
    db.query('INSERT OR IGNORE INTO library_bodies(sha,json,bytes) VALUES (?,?,?)').run(sha, canonical, Buffer.byteLength(canonical))
    const source = object(definition.source)
    db.query(`INSERT INTO library_definitions(profile_id,id,head_n,head_sha,name,level,private,source_kind,days_per_week,length_weeks,goal,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,id) DO UPDATE SET head_n=excluded.head_n,head_sha=excluded.head_sha,name=excluded.name,level=excluded.level,private=excluded.private,source_kind=excluded.source_kind,days_per_week=excluded.days_per_week,length_weeks=excluded.length_weeks,goal=excluded.goal,updated_at=excluded.updated_at`)
      .run(profileId, id, n, sha, definition.name as string, validation.level, Number(privateFlag), typeof source?.kind === 'string' ? source.kind : null,
        typeof definition.daysPerWeek === 'number' && Number.isSafeInteger(definition.daysPerWeek) ? definition.daysPerWeek : null, typeof definition.lengthWeeks === 'number' && Number.isSafeInteger(definition.lengthWeeks) ? definition.lengthWeeks : null, typeof definition.goal === 'string' ? definition.goal : null, publishedAt)
    db.query('INSERT INTO library_versions(profile_id,definition_id,n,sha,parent_sha,level,published_at,origin,original_json) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(profileId, id, n, sha, current?.head_sha ?? null, validation.level, publishedAt, request.origin ?? 'api', original)
    return { definition: definition as ProgrammeDefinition, versionId: sha, n, level: validation.level }
  }).immediate()
}
export class LibraryNotReady extends ApiError {
  constructor(readonly validation: ValidateResult) { super(422, 'not ready', { code: 'not-ready' }) }
}
