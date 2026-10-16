import type { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'
import { stampPut, type StampReport } from '@opengym/core/server-stamp'
import { readStateDoc, writeStateMirror, writeAccountsMirror } from './storage'
import { ApiError, json } from './http'
import type { AuthService, Session } from './auth'
import { assertNotTraining, observeTrainingPut, trainingStatus, ownTrainingMarker } from './training-guard'
import type { GymApp } from './app'

type Doc = Record<string, unknown>
const object = (value: unknown): value is Doc => !!value && typeof value === 'object' && !Array.isArray(value)
const records = (value: unknown[]) => value.filter(object)
export const MAX_STORED_BYTES = 5 * 1024 * 1024
// Measured against the SQLite linked into Bun 1.4.1: 800 total object/array
// containers is valid, 801 is not. S09 uses the same import validation seam.
export const MAX_STATE_CONTAINERS = 800
const forClient = (state: Doc | null): Doc | null => {
  if (!state) return null
  const copy = { ...state }
  delete copy._unstamped
  delete copy._prior
  return copy
}
// Named oracle exception: legacy V8 accepts deeper JSON than SQLite json_valid.
// Count containers (including the root), not scalar leaves or siblings.
export function assertStateDepth(state: object): void {
  const pending: object[] = [state], depths = [1]
  while (pending.length) {
    const value = pending.pop()!, depth = depths.pop()!
    if (depth > MAX_STATE_CONTAINERS) throw new ApiError(400, 'invalid state')
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      const child = (value as Doc)[key]
      if (child && typeof child === 'object') { pending.push(child); depths.push(depth + 1) }
    }
  }
}
export interface DataOptions {
  now?: () => number
  historyKeep?: number
  cacheTtlMs?: number
  log?: (message: string) => void
  mirror?: (profileId: string) => void
  accountsMirror?: () => void
  /** Scratch fault probes may stop the process with the transaction still open. */
  beforeCommit?: () => void
  observe?: (phase: string, milliseconds: number) => void
}
export interface PutResult { ok: true; ts: unknown; rev: number; wid: string }

/** Sole whole-document writer. P5 calls compareAndWrite with baseRev/baseWid and
 * stamped:true; conflict errors carry the current client-safe document. */
export class DataService {
  private readonly now: () => number
  private readonly log: (message: string) => void
  private readonly cache = new Map<string, { rev: number; wid?: string; expires: number }>()
  private generation = ''
  readonly staleMirrors = new Set<string>()
  accountsMirrorStale = false
  constructor(readonly db: Database, readonly dataDir: string, private readonly options: DataOptions = {}) {
    this.now = options.now ?? Date.now
    this.log = options.log ?? console.error
    // Checkpoint small batches on each durable write rather than accumulate a
    // large WAL burst on the request that happens to cross SQLite's 1000-page default.
    this.db.run('PRAGMA wal_autocheckpoint=128')
  }
  private current(profileId: string): Doc | null {
    try {
      const row = readStateDoc(this.db, profileId)
      if (!row) return null
      const value: unknown = JSON.parse(row.json)
      if (!object(value)) throw new Error('invalid stored document')
      return value
    } catch { throw new ApiError(503, 'state unreadable') }
  }
  get(profileId: string): { state: Doc | null; rev: number } {
    const cur = this.current(profileId)
    const now = this.now()
    try {
      const user = this.db.query<{ last_pull: number | null }, [string]>('SELECT last_pull FROM users WHERE id=?').get(profileId)
      if (user && (!user.last_pull || now - user.last_pull >= 600000)) {
        this.db.query('UPDATE users SET last_pull=? WHERE id=?').run(now, profileId)
        if (this.options.accountsMirror) this.options.accountsMirror()
        else writeAccountsMirror(this.db, this.dataDir)
        this.accountsMirrorStale = false
      }
    } catch { this.accountsMirrorStale = true; this.log('pull bookkeeping stale') }
    return { state: forClient(cur), rev: Number(cur?._rev) || 0 }
  }
  rev(profileId: string): { rev: number; wid?: string } {
    // SQLite generation detects writes from other connections and fixture/restore
    // writes on this one. Polls never stat a mirror or fetch the document text.
    const version = this.db.query<{ v: number; n: number }, []>('SELECT (SELECT data_version FROM pragma_data_version) AS v, total_changes() AS n').get()!
    const generation = `${version.v}:${version.n}`
    if (generation !== this.generation) { this.cache.clear(); this.generation = generation }
    const hit = this.cache.get(profileId)
    if (hit && hit.expires > this.now()) {
      this.cache.delete(profileId)
      hit.expires = this.now() + (this.options.cacheTtlMs ?? 600000)
      this.cache.set(profileId, hit)
      return { rev: hit.rev, ...(hit.wid ? { wid: hit.wid } : {}) }
    }
    // json_valid is a database-only validity check: corrupt rows preserve legacy
    // /rev's {rev:0}, while GET/PUT fail closed.
    const row = this.db.query<{ rev: number; wid: string | null; valid: number }, [string]>('SELECT rev, wid, json_valid(json) AS valid FROM state_docs WHERE profile_id=?').get(profileId)
    const value = row?.valid ? { rev: row.rev || 0, ...(row.wid ? { wid: row.wid } : {}) } : { rev: 0 }
    this.cache.delete(profileId)
    this.cache.set(profileId, { ...value, expires: this.now() + (this.options.cacheTtlMs ?? 600000) })
    while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value!)
    return value
  }
  compareAndWrite(profileId: string, body: Record<string, unknown>, session?: Session): PutResult {
    const start = performance.now()
    let afterWrite = start
    const state = body.state
    if (!state || typeof state !== 'object') throw new ApiError(400, 'state required')
    if (!Array.isArray(state) && !Object.keys(state).some(k => k !== '_rev' && k !== '_ts')) throw new ApiError(400, 'state required')
    if (!object(state) || ![state.workouts, state.routines].every(v => v == null || Array.isArray(v))) throw new ApiError(400, 'invalid state')
    for (const key of ['workouts', 'routines']) if (Array.isArray(state[key])) state[key] = records(state[key])
    const result = this.db.transaction((): PutResult => {
      let phase = performance.now()
      const cur = this.current(profileId)
      this.options.observe?.('read_parse', performance.now() - phase)
      const curRev = Number(cur?._rev) || 0
      if ((body.baseRev != null && body.baseRev !== curRev) ||
          (body.baseRev != null && Object.hasOwn(body, 'baseWid') && body.baseWid !== (cur?._wid || null))) {
        throw new ApiError(409, 'conflict', { rev: curRev, state: forClient(cur) })
      }
      if (session?.device.kind === 'agent' || body.requireIdle === true) {
        assertNotTraining(this.db, profileId, this.now())
        if (!Number.isSafeInteger(body.baseRev) || !Object.hasOwn(body,'baseWid') || typeof body.baseWid !== 'string') throw new ApiError(409,'conditional write required',{code:'REV_CONFLICT'})
      }
      if (session) observeTrainingPut(this.db, session, body, this.now())
      delete state.active

      const report: StampReport = {}
      const now = this.now()
      phase = performance.now()
      try {
        assertStateDepth(state)
        if ((Number(cur?.resetAt) || 0) > (Number(state.resetAt) || 0)) {
          state.resetAt = cur!.resetAt
          if (cur!.resetIds && typeof cur!.resetIds === 'object') state.resetIds = cur!.resetIds
          else delete state.resetIds
        }
        // OFFLOAD_RULE gates manifest producers, not consumption. K17 always
        // applies K10's helper before programme stamping/union, even dark.
        stampPut(cur, state, { overRead: body.baseRev != null && body.baseRev === curRev, stamped: body.stamped === true, now, report })
      } catch (error) { if (error instanceof RangeError || error instanceof TypeError) throw new ApiError(400, 'invalid state'); throw error }
      this.options.observe?.('depth_stamp', performance.now() - phase)
      state._rev = curRev + (report.changed ? 2 : 1)
      state._wids = [...(Array.isArray(cur?._wids) ? cur._wids : []), ...(cur?._wid ? [cur._wid] : [])].filter(x => typeof x === 'string').slice(-50)
      const wid = randomBytes(8).toString('hex')
      state._wid = wid
      phase = performance.now()
      let text: string
      try { text = JSON.stringify(state) }
      catch (error) { if (error instanceof RangeError) throw new ApiError(400, 'invalid state'); throw error }
      if (Buffer.byteLength(text, 'utf8') > MAX_STORED_BYTES) throw new ApiError(413, 'body too large')
      this.options.observe?.('serialize', performance.now() - phase)
      phase = performance.now()
      // We already hold the validated text and its server-owned metadata. Avoid
      // parsing the entire document a second time just to recover rev/wid.
      try {
        this.db.query(`INSERT INTO state_docs(profile_id,rev,wid,json,bytes,updated_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(profile_id) DO UPDATE SET rev=excluded.rev,wid=excluded.wid,json=excluded.json,
          bytes=excluded.bytes,updated_at=excluded.updated_at`).run(profileId, state._rev as number, wid, text, Buffer.byteLength(text, 'utf8'), now)
      } catch (error) {
        const failure = error as { code?: string; message?: string }
        if (failure.code === 'SQLITE_CONSTRAINT_CHECK' && failure.message?.includes('json_valid(json)')) throw new ApiError(400, 'invalid state')
        throw error
      }
      this.db.query('INSERT INTO state_doc_history(profile_id,rev,wid,json,written_at) VALUES(?,?,?,?,?)').run(profileId, state._rev as number, wid, text, now)
      const keep = this.options.historyKeep ?? 50
      if (keep > 0) this.db.query(`DELETE FROM state_doc_history WHERE profile_id=? AND rowid NOT IN
        (SELECT rowid FROM state_doc_history WHERE profile_id=? ORDER BY rowid DESC LIMIT ?)`)
        .run(profileId, profileId, keep)
      afterWrite = performance.now()
      this.options.observe?.('sqlite_write', afterWrite - phase)
      this.options.beforeCommit?.()
      return { ok: true, ts: state._ts || null, rev: curRev + 1, wid }
    }).immediate()
    this.options.observe?.('sqlite_commit', performance.now() - afterWrite)
    const mirrorStart = performance.now()
    this.cache.delete(profileId)
    try {
      if (this.options.mirror) this.options.mirror(profileId)
      else writeStateMirror(this.db, this.dataDir, profileId)
      this.staleMirrors.delete(profileId)
    } catch { this.staleMirrors.add(profileId); this.log('state mirror stale') }
    this.options.observe?.('mirror_fsync', performance.now() - mirrorStart)
    this.options.observe?.('service_total', performance.now() - start)
    return result
  }
}
export function installData(app: GymApp, data: DataService, auth?: AuthService): void {
  const required = (profileId: string | undefined): string => {
    if (!profileId) throw new ApiError(401, 'not signed in')
    return profileId
  }
  app.get('/api/data', c => json(200, data.get(required(c.get('session')?.user.id))))
  app.get('/api/data/activity', c => {
    const s = c.get('session')
    const uid = required(s?.user.id)
    return json(200, { status:trainingStatus(data.db, uid, auth?.now() ?? Date.now()), ...(s ? {own:ownTrainingMarker(data.db,s)} : {}) })
  })
  app.get('/api/data/rev', c => json(200, data.rev(required(c.get('session')?.user.id))))
  app.put('/api/data', async c => {
    required(c.get('session')?.user.id)
    const body = await c.get('body').readJson()
    // A device may be revoked while its request body is arriving.
    const session = auth ? auth.sessionOf(c.req.raw) : c.get('session')
    return json(200, data.compareAndWrite(required(session?.user.id), body, session ?? undefined))
  })
}
