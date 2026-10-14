// `bun run backup:create <dest>` and `bun run backup:verify <file>`. The data directory comes from DATA_DIR
// (default ./data, as in the legacy server) and is opened with the same boot path, so a refused store
// cannot be backed up as if it were healthy.
import path from 'node:path'
import { createBackup, verifyBackup, openStore, DB_FILE } from '../storage'

const [command, target] = process.argv.slice(2)
const dataDir = path.resolve(process.env.DATA_DIR || './data')

if (command === 'create' && target) {
  const store = openStore(dataDir)
  try {
    const manifest = createBackup(store.db, path.resolve(target))
    console.log(`backup:create ok — ${manifest.docs.length} document(s) → ${target}`)
  } finally { store.close() }
} else if (command === 'verify' && target) {
  const result = verifyBackup(path.resolve(target))
  if (result.ok) console.log(`backup:verify ok — ${result.docs} document(s) checked`)
  else {
    for (const p of result.problems) console.error(`backup:verify FAILED — ${p}`)
    if (result.problems.some(p => p.startsWith('manifest unreadable'))) {
      // A crash between the backup's rename and its manifest write leaves a copy without one: take a new backup.
      console.error('backup:verify — no usable manifest; a crash after the copy was renamed can leave one out. Create a new backup.')
    }
    process.exit(1)
  }
} else {
  console.error(`usage: backup:create <dest> | backup:verify <file>   (data dir ${path.join(dataDir, DB_FILE)})`)
  process.exit(2)
}
