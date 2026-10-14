// Writes that survive a power cut or a host reset, not only a killed process (port of legacy/api/durable.js).
//
// Every file is written under a temporary name and renamed over the real one, so a crash never leaves a
// half-written file. The bytes are flushed before the rename and the directory after it: without the fsync
// the 200 went out while the rename sat in the page cache, and a reset brought the older file back.
// The temporary name is unique per writer (`<file>.<pid>.<rand>.tmp`, STORAGE-CONTRACT §1), so two
// writers can never truncate each other's partial file.
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

/** fsync of a directory, so a rename inside it is on disk. Best effort: some filesystems refuse. */
export function syncDir(dir: string): void {
  let fd: number | null = null
  try { fd = fs.openSync(dir, 'r'); fs.fsyncSync(fd) }
  catch { /* a filesystem that cannot fsync a directory */ }
  finally { if (fd !== null) try { fs.closeSync(fd) } catch { /* already closed */ } }
}

/** fsync of a file that is already on disk. */
export function syncFile(file: string): void {
  const fd = fs.openSync(file, 'r+')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

/** A temporary name no other writer picks: `<file>.<pid>.<rand>.tmp`. */
export function tempName(file: string): string {
  return `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
}

export interface AtomicHooks {
  /** Test seam: runs after the temporary file is durable and before the rename (kill -9 drills use it). */
  beforeRename?: (tmp: string) => void
}

/** `content` at `file`, durably: temporary file, fsync, rename, fsync of the directory. */
export function atomicWrite(file: string, content: string | Uint8Array, mode = 0o600, hooks: AtomicHooks = {}): void {
  const tmp = tempName(file)
  const fd = fs.openSync(tmp, 'wx', mode)
  let renamed = false
  try {
    try {
      fs.writeFileSync(fd, content)
      fs.fsyncSync(fd)
    } finally { fs.closeSync(fd) }
    try { fs.chmodSync(tmp, mode) } catch { /* a host filesystem that refuses chmod */ }
    hooks.beforeRename?.(tmp)
    fs.renameSync(tmp, file)
    renamed = true
    syncDir(path.dirname(file))
  } finally {
    if (!renamed) try { fs.rmSync(tmp, { force: true }) } catch { /* nothing to clean */ }
  }
}
