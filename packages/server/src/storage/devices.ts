import type { Database } from 'bun:sqlite'
import type { DeviceRow } from '@opengym/contract/http/api'
import { getMeta, setMeta } from './repos'

export interface StoredDevice {
  id: string
  user_id: string
  kind: DeviceRow['kind']
  name: string
  sv: number
  created: number
  last_seen: number | null
  revoked_at: number | null
}
export const getDevice = (db: Database, id: string) =>
  db
    .query<StoredDevice, [string]>('SELECT * FROM devices WHERE id=?')
    .get(id) ?? null
export const listDevices = (db: Database, uid: string) =>
  db
    .query<
      StoredDevice,
      [string]
    >('SELECT * FROM devices WHERE user_id=? ORDER BY created,id')
    .all(uid)
export function putDevice(db: Database, d: StoredDevice): void {
  db.query(
    'INSERT INTO devices(id,user_id,kind,name,sv,created,last_seen,revoked_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(
    d.id,
    d.user_id,
    d.kind,
    d.name,
    d.sv,
    d.created,
    d.last_seen,
    d.revoked_at,
  )
}
export function touchDevice(db: Database, id: string, now: number): void {
  db.query(
    'UPDATE devices SET last_seen=? WHERE id=? AND (last_seen IS NULL OR last_seen <= ?)',
  ).run(now, id, now - 600000)
}
export function revokeDevice(
  db: Database,
  id: string,
  uid: string,
  now: number,
): boolean {
  return (
    db
      .query(
        'UPDATE devices SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=?',
      )
      .run(now, id, uid).changes > 0
  )
}
export const deviceResponse = (d: StoredDevice): DeviceRow => ({
  id: d.id,
  name: d.name,
  kind: d.kind,
  created: d.created,
  lastSeen: d.last_seen,
  revokedAt: d.revoked_at,
})
// The frozen schema reserves meta for auxiliary indexes. Only hashes, never bearer tokens, are persisted.
export const predecessorDevice = (db: Database, hash: string): string | null =>
  getMeta(db, `device_predecessor:${hash}`)
export const putPredecessor = (db: Database, hash: string, did: string): void =>
  setMeta(db, `device_predecessor:${hash}`, did)
