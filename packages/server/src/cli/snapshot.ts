import { Database } from 'bun:sqlite'
import { mkdirSync, realpathSync } from 'node:fs'
import { resolve, relative, sep, join, dirname } from 'node:path'
import { createBackup, verifyBackup } from '../storage/backup'

/** No store boot, migrations, mirror repair or source checkpoint. SQLite sees committed WAL. */
export function snapshotCommand(args: readonly string[]): void {
  const [command, source, destination, ...extra] = args
  if (extra.length || !source || !['create', 'verify'].includes(command || '') || (command === 'create' ? !destination : !!destination)) throw new Error('usage: backup create SOURCE_DB NEW_DIRECTORY | backup verify SNAPSHOT_DB')
  if (command === 'verify') {
    const result = verifyBackup(resolve(source))
    if (!result.ok) throw new Error('backup verification failed: ' + result.problems.join('; '))
    console.log(JSON.stringify({ ok: true, docs: result.docs }))
    return
  }
  const file = realpathSync(source), target = resolve(destination!)
  // Canonicalize the existing parent: aliases cannot place a snapshot inside source DATA.
  const parent = realpathSync(dirname(target)), canonicalTarget = join(parent, target.split(sep).at(-1)!)
  const contains = (a: string, b: string) => { const r = relative(a, b); return !r || r !== '..' && !r.startsWith('..' + sep) && !r.startsWith(sep) }
  if (contains(dirname(file), canonicalTarget) || contains(canonicalTarget, dirname(file))) throw new Error('source and snapshot directories must not overlap')
  const db = new Database(file, { readonly: true })
  try {
    db.run('PRAGMA busy_timeout=5000')
    // Exclusive directory reservation prevents competing backup writers/overwrites.
    mkdirSync(canonicalTarget, { mode: 0o700 })
    const copy = join(canonicalTarget, 'opengym.db')
    createBackup(db, copy)
    const result = verifyBackup(copy)
    if (!result.ok) throw new Error('new backup verification failed: ' + result.problems.join('; '))
    console.log(JSON.stringify({ ok: true, docs: result.docs }))
  } finally { db.close() }
}
