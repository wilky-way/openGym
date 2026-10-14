import { readZip, crc32, ZipError } from '@opengym/core/zip'

/** Legacy readZip omitted CRC verification; cutover explicitly rejects corrupt backup payloads. */
export async function readMigrationArchive(blob: Blob): Promise<Map<string, string>> {
  const entries = await readZip(blob)
  const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer)
  // Match central-directory CRC to the actual entry data; also check local CRC when no descriptor exists.
  let end = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  if (end < 0) throw new ZipError('not-zip', 'not-zip')
  let at = view.getUint32(end + 16, true)
  const checks = new Map<string, number>()
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  for (let n = 0; n < view.getUint16(end + 10, true); n++) {
    const length = view.getUint16(at + 28, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + length))
    if (checks.has(name)) throw new ZipError('duplicate-name', 'duplicate-name')
    const local = view.getUint32(at + 42, true), flags = view.getUint16(local + 6, true)
    const expected = view.getUint32(at + 16, true)
    if (!(flags & 8) && view.getUint32(local + 14, true) !== expected) throw new ZipError('crc-mismatch', 'crc-mismatch')
    checks.set(name, expected)
    at += 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  const out = new Map<string, string>()
  for (const e of entries) {
    if (!/^(db\.json|state-[A-Za-z0-9_-]+\.json|audit\.log)$/.test(e.name)) throw new Error('archive accepts legacy JSON and audit only; keep secret, vapid and uploads in DATA_DIR')
    if (e.size > 5 * 1024 * 1024 && e.name !== 'audit.log') throw new Error('archive JSON exceeds 5 MiB')
    const payload = new Uint8Array(await e.blob.arrayBuffer())
    if (crc32(payload) !== checks.get(e.name)) throw new ZipError('crc-mismatch', 'crc-mismatch')
    out.set(e.name, decoder.decode(payload))
  }
  if (!out.has('db.json')) throw new Error('archive has no db.json')
  return out
}
