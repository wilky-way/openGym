import { Database, constants as sqlite } from 'bun:sqlite'
import { existsSync, lstatSync, readdirSync, realpathSync, openSync, closeSync, fstatSync, fchmodSync, constants, type Stats } from 'node:fs'
import { dirname, join, resolve, basename, parse, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { error } from './http-client'
import { openAt, mkdirAt } from './authoring-fs'

export const DRAFT_BYTES = 5 * 1024 * 1024
export interface Draft {
  draftId: string; rev: number; createdAt: string; updatedAt: string
  origin: { kind: 'scratch' | 'clone' | 'import'; [key: string]: unknown }
  definition: Record<string, any>; customEx?: any[]; decisions: Record<string, any>[]; targetDefinitionId?: string
}
/** Check both the spelled path and its physical target, including not-yet-created descendants. */
export function outsideGit(path: string): string {
  const absolute = resolve(path)
  const walk = (p: string) => {
    for (;;) {
      if (existsSync(p) && readdirSync(p).some(n => n.toLowerCase() === '.git')) throw error('PRIVATE_EXPORT', 'The draft store must be outside every git work tree.')
      const parent = dirname(p); if (parent === p) break; p = parent
    }
  }
  const existing = (p: string): string => {
    if (existsSync(p)) return realpathSync(p)
    const parent = dirname(p)
    if (parent === p) throw error('CONFIG_REQUIRED', 'Cannot resolve the draft store path.')
    // Resolve case variants on case-sensitive hosts as well as macOS.
    const physical = existing(parent)
    const name = existsSync(physical) ? readdirSync(physical).find(n => n.toLowerCase() === basename(p).toLowerCase()) : undefined
    return name ? realpathSync(join(physical, name)) : join(physical, basename(p))
  }
  // Only directories are passed here; missing ancestors are skipped on the lexical walk.
  walk(absolute); const physical = existing(absolute); walk(physical)
  return physical
}
export function authoringDirectory(env: Record<string, string | undefined>, platform = process.platform, home = homedir()): string {
  if (env.OPENGYM_AUTHORING_DIR) return env.OPENGYM_AUTHORING_DIR
  const data = platform === 'darwin' ? join(home, 'Library', 'Application Support')
    : platform === 'win32' ? env.LOCALAPPDATA || join(home, 'AppData', 'Local')
    : env.XDG_DATA_HOME || join(home, '.local', 'share')
  return join(data, 'opengym-authoring')
}
function localDirectory(path: string): string {
  const physical = outsideGit(path)
  for (const candidate of [physical, resolve(path)]) {
    for (let p = candidate;; p = dirname(p)) {
      if (/^(mobile documents|cloudstorage|dropbox(?:[ (.-].*)?|onedrive(?:[ (.-].*)?|google ?drive(?:[ (.-].*)?)$/i.test(basename(p)))
        throw error('PRIVATE_EXPORT', 'The draft store must be outside iCloud, Dropbox, OneDrive and Google Drive sync roots.')
      // macOS system aliases are not user-selected authoring directory links.
      if (!['/var', '/tmp', '/etc'].includes(p)) {
        const stat = optionalStat(p)
        if (stat?.isSymbolicLink()) throw error('PRIVATE_EXPORT', 'The authoring directory and its parents must not be symlinks.')
      }
      if (dirname(p) === p) break
    }
  }
  return physical
}
function optionalStat(path: string): Stats | undefined {
  try { return lstatSync(path) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; return undefined }
}
function sameFile(a: Stats, b: Stats): boolean { return a.dev === b.dev && a.ino === b.ino }
function privateDirectory(path: string): number {
  const root = parse(path).root
  let fd = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW), current = root
  try {
    // Pin each parent while opening/creating its child, including new ancestors.
    for (const name of relative(root, path).split(sep).filter(Boolean)) {
      current = join(current, name)
      if (!optionalStat(current)) {
        try { mkdirAt(fd, name) } catch { /* A concurrent creator is safe only if the no-follow open below succeeds. */ }
      }
      const next = openAt(fd, name, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      closeSync(fd); fd = next
    }
    return fd
  } catch (e) { closeSync(fd); throw e }
}
function privateFile(directoryFd: number, path: string, create = false): number {
  const before = optionalStat(path)
  const regular = (s: Stats) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1
  if (before && !regular(before)) throw error('PRIVATE_EXPORT', 'Draft database files must be regular, unlinked files.')
  let fd: number
  try { fd = openAt(directoryFd, basename(path), constants.O_RDWR | constants.O_NOFOLLOW | (create && !before ? constants.O_CREAT | constants.O_EXCL : 0), 0o600) }
  catch { throw error('PRIVATE_EXPORT', 'Draft database file changed or is unsafe to open.') }
  try {
    const opened = fstatSync(fd), after = lstatSync(path)
    if (!regular(opened) || !regular(after) || !sameFile(opened, after) || before && !sameFile(before, opened))
      throw error('PRIVATE_EXPORT', 'Draft database file changed while opening.')
    fchmodSync(fd, 0o600)
    return fd
  } catch (e) { closeSync(fd); throw e }
}
export function checkedJSON(value: unknown): string {
  let json: string
  try { json = JSON.stringify(value) } catch { throw error('EINVAL', 'Use JSON data only.') }
  if (!json!) throw error('EINVAL', 'Use JSON data only.')
  if (Buffer.byteLength(json) > DRAFT_BYTES) throw error('TOO_LARGE', 'A draft may contain at most 5 MiB.')
  return json
}
export class DraftStore {
  readonly db: Database
  constructor(directory: string, readonly now: () => string = () => new Date().toISOString()) {
    const physical = localDirectory(directory)
    const dirFd = privateDirectory(physical)
    let fd: number | undefined, db: Database | undefined
    try {
      localDirectory(physical)
      const dirStat = lstatSync(physical)
      if (!sameFile(dirStat, fstatSync(dirFd)) || !dirStat.isDirectory()) throw error('PRIVATE_EXPORT', 'Authoring directory changed while opening.')
      fchmodSync(dirFd, 0o700)
      for (const suffix of ['-wal', '-shm', '-journal']) {
        const file = join(physical, 'drafts.db' + suffix)
        if (optionalStat(file)) closeSync(privateFile(dirFd, file))
      }
      const file = join(physical, 'drafts.db')
      fd = privateFile(dirFd, file, true)
      // SQLite also reopens the path: forbid following links at that second open.
      db = new Database(file, sqlite.SQLITE_OPEN_READWRITE | sqlite.SQLITE_OPEN_NOFOLLOW)
      const moved = new Int32Array(2)
      if (!sameFile(fstatSync(fd), lstatSync(file)) || !sameFile(dirStat, lstatSync(physical)) ||
          db.fileControl(sqlite.SQLITE_FCNTL_HAS_MOVED, moved) !== 0 || moved[0])
        throw error('PRIVATE_EXPORT', 'Draft database file changed while opening SQLite.')
      localDirectory(physical)
      db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, rev INTEGER NOT NULL, body TEXT NOT NULL)')
      this.db = db
    } catch (e) { db?.close(); throw e } finally { if (fd !== undefined) closeSync(fd); closeSync(dirFd) }
  }
  close(): void { this.db.close() }
  get(id: string): Draft {
    const row = this.db.query<{body: string}, [string]>('SELECT body FROM drafts WHERE id=?').get(id)
    if (!row) throw error('NOT_FOUND', 'Draft not found.')
    return JSON.parse(row.body)
  }
  list(): Draft[] { return this.db.query<{body: string}, []>('SELECT body FROM drafts ORDER BY id').all().map(r => JSON.parse(r.body)) }
  private write(draft: Draft, create: boolean): Draft {
    const body = checkedJSON(draft)
    const total = this.db.query<{bytes: number}, [string]>('SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) AS bytes FROM drafts WHERE id<>?').get(draft.draftId)!.bytes
    if (total + Buffer.byteLength(body) > 100 * 1024 * 1024) throw error('DRAFT_LIMIT', 'The draft store is limited to 100 MiB.')
    if (create) this.db.query('INSERT INTO drafts(id,rev,body) VALUES(?,?,?)').run(draft.draftId, draft.rev, body)
    else this.db.query('UPDATE drafts SET rev=?,body=? WHERE id=?').run(draft.rev, body, draft.draftId)
    return draft
  }
  create(input: Pick<Draft, 'definition' | 'origin'> & Partial<Pick<Draft, 'targetDefinitionId' | 'customEx'>>): Draft {
    return this.db.transaction(() => {
      if (this.list().length >= 50) throw error('DRAFT_LIMIT', 'At most 50 drafts may be stored.')
      const at = this.now()
      return this.write({ ...input, draftId: 'd_' + randomUUID(), rev: 1, createdAt: at, updatedAt: at, decisions: [] }, true)
    }).immediate()
  }
  expect(id: string, rev: number): Draft {
    const draft = this.get(id)
    if (draft.rev !== rev) throw Object.assign(error('REV_CONFLICT', `Draft changed; current rev is ${draft.rev}.`), { rev: draft.rev })
    return draft
  }
  edit(id: string, rev: number, mutate: (draft: Draft) => void): Draft {
    return this.db.transaction(() => { const draft = this.expect(id, rev); draft.updatedAt = this.now(); mutate(draft); draft.rev++; return this.write(draft, false) }).immediate()
  }
  delete(id: string, rev: number): void {
    this.db.transaction(() => { this.expect(id, rev); this.db.query('DELETE FROM drafts WHERE id=?').run(id) }).immediate()
  }
}
