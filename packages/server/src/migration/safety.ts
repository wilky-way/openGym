import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { Database, constants } from 'bun:sqlite'
import { migrate } from '../storage/db'

export interface MigrationOptions {
  /** Explicit deployment path; unset means no machine-specific protected root. */
  liveDataDir?: string
  /** Test seam resolves a synthetic protected root. */
  protectedRoot?: () => string
  data: string; scratch?: string; apply?: boolean; live?: boolean; confirm?: string
  archive?: string; reconcile?: boolean; now?: number; profile?: string; includeNew?: boolean; originals?: boolean
}
// Resolve every existing ancestor before containment checks, including a missing final component.
export function realPath(file: string): string {
  const absolute = path.resolve(file)
  if (fs.existsSync(absolute)) return fs.realpathSync.native(absolute)
  return path.join(realPath(path.dirname(absolute)), path.basename(absolute))
}
const inside = (root: string, file: string) => file === root || file.startsWith(root + path.sep)
export const confirmationToken = (data: string): string => 'opengym:' + createHash('sha256').update(realPath(data)).digest('hex').slice(0, 16)
export function authorize(options: MigrationOptions): string {
  // Refuse the named live path before resolving it (resolution itself must not touch live data).
  const liveHome = options.liveDataDir ? path.resolve(options.liveDataDir) : null
  if (!options.live && liveHome !== null && inside(liveHome, path.resolve(options.data))) throw new Error('live data requires --live and --confirm')
  if (!options.live && options.scratch && liveHome !== null && inside(liveHome, path.resolve(options.scratch))) throw new Error('live data cannot be scratch')
  rejectAliases(options.data)
  if (options.scratch) rejectAliases(options.scratch)
  const data = realPath(options.data)
  // A live path is never permitted to masquerade as a scratch directory.
  const protectedRoot = options.protectedRoot ? options.protectedRoot() : liveHome ? realPath(liveHome) : null
  if (!options.live && (liveHome !== null && inside(liveHome, data) || protectedRoot !== null && inside(protectedRoot, data))) throw new Error('live data requires --live and --confirm')
  let scratch = false
  if (options.scratch) {
    const root = realPath(options.scratch)
    const temporary = [realPath(os.tmpdir()), '/private/tmp', '/tmp'].some(t => inside(t, root) && root !== t)
    scratch = temporary && !(liveHome !== null && inside(liveHome, root)) && !(protectedRoot !== null && inside(protectedRoot, root)) && inside(root, data)
    if (!scratch) throw new Error('scratch must be a dedicated temporary directory containing --data')
  }
  if (!scratch && (!options.live || options.confirm !== confirmationToken(data))) throw new Error('outside scratch requires --live and matching --confirm token')
  // Metadata only: protected file contents are never opened, even for a scratch invocation.
  if (!options.live) {
    const protectedFiles = protectedRoot ? fileIdentities(protectedRoot) : new Set<string>()
    for (const identity of fileIdentities(data, true)) if (protectedFiles.has(identity)) throw new Error('protected inode refused')
  }
  return data
}
const identity = (s: fs.Stats) => `${s.dev}:${s.ino}`
function fileIdentities(root: string, refuseLinks = false): Set<string> {
  const found = new Set<string>()
  function walk(file: string): void {
    let stat: fs.Stats
    try { stat = fs.lstatSync(file) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
    if (stat.isSymbolicLink()) { if (refuseLinks) throw new Error('symlink refused'); return }
    if (stat.isDirectory()) for (const name of fs.readdirSync(file)) walk(path.join(file, name))
    else { if (refuseLinks && stat.nlink > 1) throw new Error('hardlink refused'); found.add(identity(stat)) }
  }
  walk(root)
  return found
}
// Refuse symlinks at every level of files consumed or replaced. No source ever escapes DATA_DIR.
export function containedFile(data: string, relative: string): string {
  const target = path.resolve(data, relative)
  if (!inside(data, target)) throw new Error('path escapes data directory')
  let current = data
  for (const part of path.relative(data, target).split(path.sep)) {
    current = path.join(current, part)
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink()) throw new Error('symlink refused')
      if (!stat.isDirectory() && stat.nlink > 1) throw new Error('hardlink refused')
    }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  }
  return target
}

/** Pin and recheck the inode before any SQLite pragma, migration, chmod or transaction writes. */
function withCheckedFile<T>(options: MigrationOptions, file: string, writable: boolean, create: boolean, use: (fd: number, recheck: () => void) => T): T {
  const data = authorize(options)
  containedFile(data, path.relative(data, file))
  const before = create ? null : fs.lstatSync(file)
  const fd = fs.openSync(file, (writable ? fs.constants.O_RDWR : fs.constants.O_RDONLY) | fs.constants.O_NOFOLLOW | (create ? fs.constants.O_CREAT | fs.constants.O_EXCL : 0), 0o600)
  try {
    const opened = fs.fstatSync(fd)
    const recheck = () => {
      const current = fs.lstatSync(containedFile(data, path.relative(data, file)))
      const pinned = fs.fstatSync(fd)
      if (!pinned.isFile() || pinned.nlink !== 1 || current.nlink !== 1 || identity(current) !== identity(opened) || identity(pinned) !== identity(opened) || (before && identity(before) !== identity(opened))) throw new Error('database changed between check and open')
      authorize(options)
      for (const suffix of ['-wal', '-shm', '-journal']) containedFile(data, path.relative(data, file + suffix))
    }
    recheck()
    return use(fd, recheck)
  } finally { fs.closeSync(fd) }
}

export function readCheckedFile(options: MigrationOptions, file: string): Buffer {
  return withCheckedFile(options, file, false, false, (fd, recheck) => {
    const bytes = fs.readFileSync(fd)
    recheck()
    return bytes
  })
}

export function checkedDatabase(options: MigrationOptions, file: string, writable: boolean, create = false): Database {
  return withCheckedFile(options, file, writable, create, (fd, recheck) => {
    let db: Database | undefined
    try {
      // Bun's strict-bindings options cannot include SQLITE_OPEN_NOFOLLOW. Check the
      // actual SQLite file handle too: path-only checks miss a swap-and-restore (ABA).
      db = new Database(file, { readonly: !writable, readwrite: writable, create: false, strict: true })
      recheck()
      // SQLite's POSIX VFS compares its own opened inode with the current pathname.
      const moved = new Int32Array(2) // Bun requires pointer-sized storage; SQLite writes one int.
      if (db.fileControl(constants.SQLITE_FCNTL_HAS_MOVED, moved) !== 0 || moved[0] !== 0) throw new Error('SQLite database inode changed between check and open')
      if (writable) {
        db.run('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
        migrate(db)
        fs.fchmodSync(fd, 0o600)
        for (const suffix of ['-wal', '-shm']) {
          const target = containedFile(path.dirname(file), path.basename(file + suffix))
          if (fs.existsSync(target)) withCheckedFile(options, target, true, false, sidecarFd => fs.fchmodSync(sidecarFd, 0o600))
        }
      }
      return db
    } catch (error) { db?.close(); throw error }
  })
}

/** Only macOS system aliases are permitted on operator-supplied directory paths. */
function rejectAliases(file: string): void {
  const parts = path.resolve(file).split(path.sep).filter(Boolean)
  let current = path.parse(path.resolve(file)).root
  for (const part of parts) {
    current = path.join(current, part)
    try {
      if (!fs.lstatSync(current).isSymbolicLink()) continue
      const target = fs.readlinkSync(current)
      if ((current === '/tmp' || current === '/var') && target === 'private' + current) continue
      throw new Error('directory symlink alias refused')
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}
