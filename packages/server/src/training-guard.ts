// Auxiliary metadata only: never persist a running workout or a credential here.
import type { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import type { Session } from './auth'
import { getMeta, setMeta } from './storage/repos'
import { ApiError } from './http'

type Marker = { device: string; session: string | null; lease: string; updatedAt: number; status: 'active' | 'idle'; startedAt?: number; legacy?: boolean; editor?: boolean }
const key = (uid: string) => `training_guard:${uid}`
export const TRAINING_HEARTBEAT_MS = 70000
const trusted = (s: Session) => s.v2 && (s.device.kind === 'browser' || s.device.kind === 'paired')
const startOf = (a: unknown): number | undefined => {
  const start = a && typeof a === 'object' ? (a as {start?:unknown}).start : undefined
  return typeof start === 'number' && Number.isFinite(start) && start > 0 ? start : undefined
}
const editorOf = (a: unknown): boolean => !!(a && typeof a === 'object' && (a as {editingWorkoutId?:unknown}).editingWorkoutId)
const identity = (a: unknown): string | null => {
  const value = a as {id?:unknown;editingWorkoutId?:unknown;editBase?:{sheetInstanceId?:unknown}} | null
  const start = startOf(a), id = value?.id
  if (start === undefined || typeof id !== 'string' || !id || id.length > 500) return null
  if (!editorOf(a)) return createHash('sha256').update(JSON.stringify([id,start])).digest('hex')
  const editor = value?.editingWorkoutId, incarnation = value?.editBase?.sheetInstanceId
  return typeof editor === 'string' && editor.length <= 500 && typeof incarnation === 'string' && incarnation.length > 0 && incarnation.length <= 500
    ? createHash('sha256').update(JSON.stringify([id,start,'editor',editor,incarnation])).digest('hex') : null
}
const unidentified = (a: unknown) => createHash('sha256').update(JSON.stringify(['unidentified',editorOf(a) ? 'editor':'session',startOf(a) ?? null])).digest('hex')
/** Auth renewal binds a v1 predecessor hash to its new device. No peer can inherit it. */
function ownDevices(db: Database, s: Session): Set<string> {
  const devices = new Set([s.device.id])
  if (trusted(s)) for (const row of db.query<{key:string},[string]>("SELECT key FROM meta WHERE value=? AND key LIKE 'device_predecessor:%'").all(s.device.id)) {
    const hash = row.key.slice('device_predecessor:'.length)
    if (/^[a-f0-9]{64}$/.test(hash)) devices.add('legacy:'+hash.slice(0,16))
  }
  return devices
}
function markers(db: Database, uid: string): Marker[] {
  try {
    const value = JSON.parse(getMeta(db, key(uid)) ?? '[]')
    if (!Array.isArray(value) || value.some(m => !m || typeof m.device !== 'string' || !m.device || typeof m.lease !== 'string' || !m.lease || !Number.isFinite(m.updatedAt) || !['idle','active'].includes(m.status) || (m.session !== null && (typeof m.session !== 'string' || !/^[a-f0-9]{64}$/.test(m.session))) || m.status === 'active' && m.session === null || m.editor !== undefined && typeof m.editor !== 'boolean' || m.legacy !== undefined && typeof m.legacy !== 'boolean' || m.startedAt !== undefined && (typeof m.startedAt !== 'number' || !Number.isFinite(m.startedAt) || m.startedAt <= 0)) || new Set(value.map(m=>JSON.stringify([m.device,m.session]))).size !== value.length) throw 0
    return value
  } catch { throw new ApiError(423, 'training status unknown', {code:'TRAINING_NOW',guardStatus:'unknown'}) }
}
export function trainingStatus(db: Database, uid: string, now: number): 'active' | 'idle' | 'unknown' {
  let rows: Marker[]
  try { rows = markers(db, uid) } catch { return 'unknown' }
  if (rows.some(m => m.status === 'active' && now - m.updatedAt < TRAINING_HEARTBEAT_MS)) return 'active'
  // Expiry is loss of knowledge, never evidence that training ended.
  if (!rows.length || rows.some(m => m.status === 'active')) return 'unknown'
  return 'idle'
}
export function assertNotTraining(db: Database, uid: string, now: number): void {
  const status = trainingStatus(db, uid, now)
  if (status !== 'idle') throw new ApiError(423, status === 'active' ? 'training now' : 'training status unknown', {code:'TRAINING_NOW',guardStatus:status})
}
function close(m: Marker, now: number): void {
  // Keep the identity as a tombstone: a delayed heartbeat cannot reopen a closed
  // session, including after clock rollback or another session with the same start.
  m.status = 'idle';m.lease = randomUUID();m.updatedAt = now
}
function activate(rows: Marker[], s: Session, session: string, startedAt: number | undefined, now: number, legacy = false, editor = false): void {
  const prior = rows.find(m=>m.device === s.device.id && m.session === session)
  if (prior?.status === 'idle' && !legacy) return
  if (prior) {
    if (prior.status === 'idle') {prior.status='active';prior.lease=randomUUID()}
    prior.updatedAt=now
    if (legacy) prior.legacy=true
    return
  }
  // Initial idle observations carry no session; remove only this device's sentinel.
  for (let i=rows.length-1;i>=0;i--) if (rows[i]!.device === s.device.id && rows[i]!.session === null) rows.splice(i,1)
  rows.push({device:s.device.id,session,lease:randomUUID(),updatedAt:now,status:'active',startedAt,...(legacy ? {legacy:true}:{}),...(editor ? {editor:true}:{})})
}
/** Called inside the document IMMEDIATE transaction, before active is stripped. */
export function observeTrainingPut(db: Database, s: Session, body: Record<string, unknown>, now: number): void {
  const state = body.state as Record<string,unknown>
  if ((!trusted(s) && s.v2) || !Object.hasOwn(state, 'active')) return
  // Preserve corrupt auxiliary metadata for repair, keeping agents fenced while
  // allowing the device's ordinary workout sync to remain durable.
  let rows: Marker[]
  try { rows = markers(db,s.user.id) } catch { return }
  const active = state.active
  if (active) {
    const session = identity(active)
    activate(rows,s,session ?? unidentified(active),startOf(active),now,!trusted(s) || !session,editorOf(active))
  } else if (trusted(s) && active === null && body.baseRev != null && Object.hasOwn(body,'baseWid')) {
    const proof = body.trainingClose as {lease?:unknown;session?:unknown} | undefined
    const devices = ownDevices(db,s)
    for (const m of rows.filter(m=>devices.has(m.device) && m.status === 'active')) {
      const finished = !m.legacy && !m.editor && Array.isArray(state.workouts) && state.workouts.some((w: unknown)=>identity(w) === m.session)
      if (finished || proof?.lease === m.lease && proof?.session === m.session) close(m,now)
    }
    if (!rows.some(m=>m.device === s.device.id)) rows.push({device:s.device.id,session:null,lease:randomUUID(),updatedAt:now,status:'idle'})
  }
  setMeta(db,key(s.user.id),JSON.stringify(rows))
}
/** Each session has its own row: no heartbeat can replace or close a different session. */
export function heartbeatTraining(db: Database, s: Session, body: Record<string, unknown>, now: number): void {
  if (!trusted(s) && s.v2) return
  const active = {id:body.sessionId,start:body.startedAt,editingWorkoutId:body.editingWorkoutId,editBase:{sheetInstanceId:body.editorInstanceId}}
  const startedAt = startOf(active), session = identity(active)
  if (body.active !== true && startedAt === undefined) return
  db.transaction(() => {
    const rows = markers(db,s.user.id)
    if (trusted(s) && body.active === false && (body.reason === 'discarded' || body.reason === 'editor-closed' && editorOf(active)) && body.profileId === s.user.id && session) {
      const prior = rows.find(m=>m.device === s.device.id && m.session === session && m.status === 'active')
      if (prior) close(prior,now)
    } else if (body.active === true) {
      if (session) activate(rows,s,session,startedAt,now,!trusted(s),editorOf(active))
      else if (editorOf(active) || !trusted(s) || startedAt === undefined) activate(rows,s,unidentified(active),startedAt,now,true,editorOf(active))
      else {
        // Older heartbeats have no id. They may keep a unique known active
        // session fenced, but cannot close it or establish idle. If ambiguous,
        // retain an unknown legacy marker requiring an explicit own lease close.
        const known = rows.filter(m=>m.device === s.device.id && m.startedAt === startedAt && !m.legacy)
        if (known.length === 1) {if (known[0]!.status === 'active') known[0]!.updatedAt = now}
        else activate(rows,s,createHash('sha256').update(JSON.stringify(['legacy',startedAt])).digest('hex'),startedAt,now,true)
      }
    }
    setMeta(db,key(s.user.id),JSON.stringify(rows))
  }).immediate()
}
export function ownTrainingMarker(db: Database, s: Session) {
  if (!trusted(s)) return undefined
  try {
    const devices = ownDevices(db,s)
    const own = markers(db,s.user.id).filter(m=>devices.has(m.device))
    const m = own.find(m=>m.status === 'active') ?? own.at(-1)
    return m ? {lease:m.lease,session:m.session} : null
  } catch { return null }
}
