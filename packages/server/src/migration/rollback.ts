import fs from 'node:fs'
import { accountsText, sha256 } from '../storage/mirror'
import { profilesWithState, readStateDoc } from '../storage/state'
import { setMeta, getMeta } from '../storage/repos'
import { atomicWrite } from '../storage/durable'
import { openMigration } from './importer'
import { containedFile, type MigrationOptions } from './safety'

/** Run with the API stopped. Ownership changes only after every output has been read back equal. */
export function prepareRollback(options: MigrationOptions) {
  const { db, data } = openMigration(options)
  try {
    const run = () => {
      for (const id of profilesWithState(db)) {
        const doc = JSON.parse(readStateDoc(db, id)!.json) as { programmes?: { offloaded?: object } }
        if (doc.programmes?.offloaded) {
          const p = doc.programmes as { offloaded: Record<string, { at: number }>; installed?: Record<string, { at: number }>; definitions?: { id: string }[] }
          for (const [did, marker] of Object.entries(p.offloaded)) {
            if (!p.definitions?.some(d => d.id === did) || !p.installed || !Object.hasOwn(p.installed, did) || !(p.installed[did]!.at > marker.at)) throw new Error('run library:reinstall before code rollback')
          }
        }
      }
      const projected = accountsText(db)
      const original = getMeta(db, 'import_accounts_original')
      const accountBytes = original !== null && getMeta(db, 'import_accounts_projection') === sha256(projected) ? original : projected
      const files = profilesWithState(db).map(id => ({ name: `state-${id}.json`, text: readStateDoc(db, id)!.json }))
      files.push({ name: 'db.json', text: accountBytes }, { name: 'db.json.bak', text: accountBytes })
      // Check all destinations before exporting any file.
      for (const f of files) containedFile(data, f.name)
      if (options.apply) {
        for (const f of files) atomicWrite(containedFile(data, f.name), f.text)
        for (const f of files) if (fs.readFileSync(containedFile(data, f.name), 'utf8') !== f.text) throw new Error('rollback byte verification failed')
        // The stopped server's per-profile stale set is in memory. The durable account
        // flag is cleared only after both account mirrors and every state verify.
        setMeta(db, 'accounts_mirror_stale', '0')
        setMeta(db, 'write_owner', 'legacy')
      }
      return { dryRun: !options.apply, verified: !!options.apply, writeOwner: options.apply ? 'legacy' : 'sqlite', files: files.map(f => ({ name: f.name, bytes: Buffer.byteLength(f.text), sha256: sha256(f.text) })) }
    }
    return options.apply ? db.transaction(run).immediate() : run()
  } finally { db.close() }
}
