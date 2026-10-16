import { randomBytes } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import type { GymApp } from './app'
import type { AuthService, Session } from './auth'
import { ApiError, json } from './http'
import { deleteInvite, deleteUser, getInvite, getUser, listInvites, listSubs, listUsers,
  putInvite, readStateDoc, stateMirrorFile, type InviteRow, type UserRow } from './storage'

import { saveAccountsMirror, type AccountsMirrorOptions } from './accounts-mirror'

export interface AdminServices extends AccountsMirrorOptions {
  /** S05 owns the ephemeral activity registry. */
  livePresence?: (uid: string) => Record<string, unknown> | null
  dropPresence?: (uid: string) => void
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const records = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.filter(record) : []
const text = (v: unknown): string => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
// IDs are opaque. Decode happens at the URL boundary, never at the repository/filesystem.
const opaque = (id: string): string => {
  if (id && !/^[A-Za-z0-9_-]+$/.test(id)) throw new ApiError(400, 'bad request')
  return id
}
function inviteRecord(i: InviteRow): Record<string, unknown> {
  return { code: i.code, note: i.note, ...(i.created_by !== null ? { createdBy: i.created_by } : {}),
    ...(i.created !== null ? { created: i.created } : {}), ...(i.used_by !== null ? { usedBy: i.used_by } : {}),
    ...(i.used_at !== null ? { usedAt: i.used_at } : {}), ...(i.revoked ? { revoked: true } : {}) }
}

export function installAdmin(app: GymApp, auth: AuthService, services: AdminServices = {}): void {
  const { db, config } = auth
  const required = (s: Session | null): Session => {
    if (!s) throw new ApiError(401, 'not signed in')
    if (!auth.publicUser(s.user).admin) throw new ApiError(403, 'forbidden')
    return s
  }
  function state(uid: string): Record<string, unknown> {
    const row = readStateDoc(db, uid)
    if (!row) return {}
    const doc: unknown = JSON.parse(row.json)
    return record(doc) ? doc : {}
  }
  const summary = (u: UserRow) => ({ id: u.id, name: u.name, created: u.created || null,
    disabled: !!u.disabled, admin: auth.publicUser(u).admin, invitedBy: u.invited_by || null })
  // Legacy Math.max coercion is deliberate for old, never-validated documents.
  const lastSync = (u: UserRow, s: Record<string, unknown>) => Math.max(Number(s._ts || 0), u.last_pull || 0) || null
  const target = (id: unknown): UserRow => {
    const u = typeof id === 'string' ? getUser(db, opaque(id)) : null
    if (!u) throw new ApiError(404, 'no such user')
    return u
  }
  // Revalidate after a body await: another request may have disabled/deleted the actor.
  const actor = (request: Request) => required(auth.sessionOf(request))
  app.get('/api/admin/users', c => {
    required(c.get('session'))
    const users = listUsers(db).map(u => {
      const s = state(u.id), workouts = records(s.workouts), last = workouts[workouts.length - 1]
      return { ...summary(u), workouts: workouts.length, lastWorkout: last ? last.d : null,
        lastSync: lastSync(u, s), hasPush: listSubs(db, u.id).length > 0, live: services.livePresence?.(u.id) ?? null }
    })
    return json(200, { users, invite_only: config.inviteOnly, now: auth.now() })
  })
  app.get('/api/admin/user', c => {
    required(c.get('session'))
    const u = target(new URL(c.req.url).searchParams.get('id')), s = state(u.id)
    return json(200, { user: summary(u), unit: s.unit || 'kg', lastSync: lastSync(u, s),
      routines: records(s.routines).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: records(r.ex).length })),
      bodyweight: records(s.bodyweight), workouts: records(s.workouts).reverse().map(({ media: _media, ...w }) => w) })
  })
  app.post('/api/admin/user/disable', async c => {
    const body = await c.get('body').readJson(), admin = actor(c.req.raw), u = target(body.id)
    if (auth.publicUser(u).admin) throw new ApiError(400, 'cannot disable an admin')
    const disabled = !!body.disabled
    db.transaction(() => {
      db.query('UPDATE users SET disabled=?, sv=sv+? WHERE id=?').run(disabled ? 1 : 0, disabled ? 1 : 0, u.id)
      if (disabled) db.query('DELETE FROM device_links WHERE user_id=?').run(u.id)
    }).immediate()
    if (disabled) services.dropPresence?.(u.id)
    saveAccountsMirror(db, config.dataDir, services)
    auth.auditLog.write(disabled ? 'admin.user.disable' : 'admin.user.enable', { user: admin.user, target: u }, c.req.raw)
    return json(200, { ok: true, id: u.id, disabled })
  })
  app.post('/api/admin/user/delete', async c => {
    const body = await c.get('body').readJson(), admin = actor(c.req.raw), u = target(body.id)
    if (u.id === admin.user.id) throw new ApiError(400, 'you cannot delete your own account')
    if (auth.publicUser(u).admin && listUsers(db).filter(v => auth.publicUser(v).admin).length <= 1)
      throw new ApiError(400, 'cannot delete the last admin')
    db.transaction(() => {
      // FK cascades remove credentials, subscriptions, links, devices, state/history and library versions.
      // Invite used_by is deliberately not a foreign key: used invites stay burned.
      deleteUser(db, u.id)
      db.query('DELETE FROM meta WHERE key=?').run('mirror_wid:' + u.id)
      db.run('DELETE FROM library_bodies WHERE sha NOT IN (SELECT sha FROM library_versions) AND sha NOT IN (SELECT head_sha FROM library_definitions)')
    }).immediate()
    services.dropPresence?.(u.id)
    try { unlinkSync(stateMirrorFile(config.dataDir, u.id)) } catch { /* legacy: already gone */ }
    saveAccountsMirror(db, config.dataDir, services)
    auth.auditLog.write('admin.user.delete', { user: admin.user, msg: u.name }, c.req.raw)
    return json(200, { ok: true, id: u.id })
  })
  app.get('/api/admin/invites', c => {
    required(c.get('session'))
    return json(200, { invites: listInvites(db).map(i => ({ ...inviteRecord(i),
      usedByName: i.used_by ? getUser(db, i.used_by)?.name || null : null })), invite_only: config.inviteOnly })
  })
  app.post('/api/admin/invites/new', async c => {
    const body = await c.get('body').readJson(), admin = actor(c.req.raw)
    let code: string
    do { code = randomBytes(8).toString('hex').toUpperCase() } while (getInvite(db, code))
    const invite = { code, note: text(body.note).slice(0, 60), createdBy: admin.user.id, created: new Date(auth.now()).toISOString() }
    putInvite(db, { code, note: invite.note, created_by: invite.createdBy, created: invite.created,
      used_by: null, used_at: null, revoked: 0, ord: Math.max(-1, ...listInvites(db).map(i => i.ord)) + 1 })
    saveAccountsMirror(db, config.dataDir, services)
    auth.auditLog.write('admin.invite.create', { user: admin.user, msg: '[redacted invite]' }, c.req.raw)
    return json(200, { invite })
  })
  app.post('/api/admin/invites/revoke', async c => {
    const body = await c.get('body').readJson(), admin = actor(c.req.raw), inv = getInvite(db, opaque(text(body.code).toUpperCase()))
    if (!inv) throw new ApiError(404, 'no such code')
    if (inv.used_by) throw new ApiError(400, 'already used, cannot revoke')
    deleteInvite(db, inv.code)
    saveAccountsMirror(db, config.dataDir, services)
    auth.auditLog.write('admin.invite.revoke', { user: admin.user, msg: '[redacted invite]' }, c.req.raw)
    return json(200, { ok: true })
  })
  app.get('/api/admin/audit', c => {
    required(c.get('session'))
    return json(200, auth.auditLog.page(new URL(c.req.url).searchParams))
  })
  app.post('/api/admin/audit/clear', c => {
    const admin = required(c.get('session'))
    auth.auditLog.clear({ user: admin.user }, c.req.raw)
    return json(200, { ok: true })
  })
}
