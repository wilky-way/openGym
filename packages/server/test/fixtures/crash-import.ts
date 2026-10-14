import fs from 'node:fs'
import path from 'node:path'
import { importLegacy } from '../../src/migration/importer'
import type { MigrationOptions } from '../../src/migration/safety'
const [data, reconcile] = process.argv.slice(2) as [string, string]
const options: MigrationOptions = { data, scratch: data, protectedRoot: () => '/synthetic-protected-opengym', apply: true, reconcile: reconcile === 'true' }
// Pause after account writes inside the import transaction, before its first state write.
Object.defineProperty(options, 'now', { get() {
  fs.writeFileSync(path.join(data, 'import-ready'), 'READY')
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
  return 1791840000000
} })
await importLegacy(options)
