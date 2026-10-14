import type { Database } from 'bun:sqlite'
import type { AuditEvent, AuditPage } from '@opengym/contract/http/api'
import type { ServerConfig } from './config'
import { appendAudit, pruneAudit, getMeta, setMeta, type AuditRow } from './storage/repos'

export interface AuditFields {
  user?: { id: string; name: string }
  uid?: string
  name?: string
  target?: { id: string; name: string }
  ok?: boolean
  msg?: string | null
  act?: string
}
const DAY = 86400000
export function auditEvent(row: AuditRow): AuditEvent {
  const event: AuditEvent = { id: row.id, ts: row.ts, ev: row.ev, ok: !!row.ok }
  for (const key of ['uid', 'name', 'tgt', 'tname', 'msg', 'act', 'ip'] as const)
    if (row[key] !== null) event[key] = row[key]
  return event
}
/** SQLite is the audit truth; sequence is durable metadata and is never cleared. */
export function createAudit(db: Database, config: ServerConfig, options: {
  now: () => number
  ip: (request: Request) => string | null
  log?: (message: string) => void
  /** Inject a scheduler for deterministic idle-retention tests; return its cancellation function. */
  every?: (callback: () => void, ms: number) => () => void
}) {
  const { now } = options
  function compact(): void {
    pruneAudit(db, { minTs: config.audit.days ? now() - config.audit.days * DAY : undefined, maxRows: Number.isFinite(config.audit.max) ? Math.ceil(config.audit.max) : 0 })
  }
  const report = (message: string) => { try { options.log?.(message) } catch { /* best effort */ } }
  if (config.audit.enabled) try {
    db.transaction(() => {
      // An imported log may have ids above its metadata. Seed before pruning, as legacy boot does.
      const high = db.query<{ id: number }, []>('SELECT COALESCE(MAX(id), 0) AS id FROM audit_events').get()!.id
      if (high > Number(getMeta(db, 'audit_seq') ?? '0')) setMeta(db, 'audit_seq', String(high))
    }).immediate()
    // Retention failure must not roll back imported high-water metadata.
    compact()
  } catch { report('audit compact failed') }
  const safelyCompact = () => { try { compact() } catch { report('audit compact failed') } }
  const every = options.every ?? ((callback: () => void, ms: number) => {
    const timer = setInterval(callback, ms)
    timer.unref()
    return () => clearInterval(timer)
  })
  const close = config.audit.enabled ? every(safelyCompact, 3600000) : () => {}
  function write(ev: string, fields: AuditFields = {}, request?: Request): void {
    if (!config.audit.enabled) return
    try {
      appendAudit(db, {
        ts: now(), ev, ok: fields.ok === false ? 0 : 1,
        uid: fields.user?.id ?? (fields.uid || null),
        name: fields.user ? String(fields.user.name || '').slice(0, 40) : fields.name ? String(fields.name).slice(0, 40) : null,
        tgt: fields.target?.id ?? null,
        tname: fields.target ? String(fields.target.name || '').slice(0, 40) : null,
        msg: fields.msg ? String(fields.msg).slice(0, 120) : null,
        act: fields.act ? String(fields.act).slice(0, 40) : null,
        ip: request ? options.ip(request) : null,
      })
    } catch { report('audit write failed'); return }
    // The append is already durable: a failed compaction must never erase it or reuse its id.
    try {
      const count = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM audit_events').get()!.n
      if (config.audit.max && count > config.audit.max * 1.25) safelyCompact()
    } catch { report('audit compact failed') }
  }
  function page(q: URLSearchParams): AuditPage {
    const limit = Math.max(1, Math.min(200, +q.get('limit')! || 100))
    const before = +q.get('before')! || Infinity
    const cat = q.get('cat') || ''
    // Retention before category and cursor; idle age expiry is enforced without a write.
    let rows = db.query<AuditRow, []>('SELECT * FROM audit_events ORDER BY id DESC').all()
    if (config.audit.days) rows = rows.filter(row => row.ts >= now() - config.audit.days * DAY)
    if (config.audit.max && rows.length > config.audit.max) rows = rows.slice(0, Math.ceil(config.audit.max))
    if (cat === 'fail') rows = rows.filter(row => !row.ok)
    else if (cat) rows = rows.filter(row => row.ev.startsWith(cat + '.'))
    const events = rows.filter(row => row.id < before).slice(0, limit).map(auditEvent)
    return { events, total: rows.length, nextBefore: events.length === limit ? events[events.length - 1]!.id : null,
      enabled: config.audit.enabled, ip_mode: config.audit.ip, retention: { max: config.audit.max, days: config.audit.days }, now: now() }
  }
  function clear(fields: AuditFields, request?: Request): void {
    db.transaction(() => {
      db.run('DELETE FROM audit_events')
      write('admin.audit.clear', fields, request)
    }).immediate()
  }
  return { write, page, compact, clear, close }
}
