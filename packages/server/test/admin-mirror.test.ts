import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { startAdmin, ADMIN, VICTIM } from './admin-helpers'
import { CLOCK } from './auth-helpers'
import { accountsText, getInvite, getMeta, getUser, listAudit } from '../src/storage'

for (const action of ['disable', 'enable', 'delete', 'invite-create', 'invite-revoke'] as const) {
  test(`committed admin ${action} returns 200 and audits when db.json.bak fails; next mirror clears stale`, async () => {
    const warnings: string[] = []
    const h = startAdmin({ presence: { log: line => warnings.push(line) } })
    if (action === 'enable') await h.post('/api/admin/user/disable', { id: VICTIM, disabled: true })
    const revokeCode = action === 'invite-revoke'
      ? (await h.post('/api/admin/invites/new', { note: 'to revoke' })).body.invite.code as string : ''
    const before = listAudit(h.sqlite).length
    const backup = path.join(h.dataDir, 'db.json.bak')
    fs.unlinkSync(backup)
    fs.mkdirSync(backup) // The primary mirror succeeds, but backup rename fails after SQLite commits.

    let ev: string, fields: Record<string, unknown>
    if (action === 'disable' || action === 'enable') {
      const disabled = action === 'disable'
      expect(await h.post('/api/admin/user/disable', { id: VICTIM, disabled })).toEqual({
        status: 200, body: { ok: true, id: VICTIM, disabled },
      })
      expect(getUser(h.sqlite, VICTIM)!.disabled).toBe(disabled ? 1 : 0)
      ev = disabled ? 'admin.user.disable' : 'admin.user.enable'
      fields = { tgt: VICTIM, tname: 'Mallory' }
    } else if (action === 'delete') {
      expect(await h.del(VICTIM)).toEqual({ status: 200, body: { ok: true, id: VICTIM } })
      expect(getUser(h.sqlite, VICTIM)).toBeNull()
      ev = 'admin.user.delete'; fields = { msg: 'Mallory' }
    } else if (action === 'invite-create') {
      const result = await h.post('/api/admin/invites/new', { note: 'synthetic guest' })
      expect(result.status).toBe(200)
      const invite = result.body.invite
      expect(invite.code).toMatch(/^[A-F0-9]{16}$/)
      expect(invite).toEqual({ code: invite.code, note: 'synthetic guest', createdBy: ADMIN, created: new Date(CLOCK).toISOString() })
      expect(getInvite(h.sqlite, invite.code)).toMatchObject({ note: invite.note, created_by: ADMIN })
      ev = 'admin.invite.create'; fields = { msg: '[redacted invite]' }
    } else {
      expect(await h.post('/api/admin/invites/revoke', { code: revokeCode })).toEqual({ status: 200, body: { ok: true } })
      expect(getInvite(h.sqlite, revokeCode)).toBeNull()
      ev = 'admin.invite.revoke'; fields = { msg: '[redacted invite]' }
    }
    expect(getMeta(h.sqlite, 'accounts_mirror_stale')).toBe('1')
    expect(warnings).toEqual(['accounts mirror write failed'])
    expect(listAudit(h.sqlite)).toHaveLength(before + 1)
    const events = (await h.get('/api/admin/audit')).body.events
    expect(events[0]).toEqual({ id: before + 1, ts: CLOCK, ev, ok: true, uid: ADMIN, name: 'Adminna', ...fields })
    expect(fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8')).toBe(accountsText(h.sqlite))
    expect(fs.statSync(backup).isDirectory()).toBe(true)

    fs.rmdirSync(backup)
    expect((await h.post('/api/admin/invites/new', { note: 'recovery' })).status).toBe(200)
    expect(getMeta(h.sqlite, 'accounts_mirror_stale')).toBe('0')
    expect(fs.readFileSync(backup, 'utf8')).toBe(accountsText(h.sqlite))
    expect(warnings).toEqual(['accounts mirror write failed'])
  })
}
