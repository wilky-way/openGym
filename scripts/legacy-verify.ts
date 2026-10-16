// Public bounded snapshot verification; independent of historical full-archive proofs.
import { readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { verifyFrozenPublicOracle } from './verify-public-oracle'
export function verifyTreeFile(file: string, mode: string, blob: string) {
  const bytes = readFileSync(file), stat = statSync(file)
  const actualMode = (stat.mode & 0o111) ? '100755' : '100644'
  if (!stat.isFile() || mode !== actualMode) throw new Error(`Frozen oracle mode changed: ${file}`)
  const actualBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  if (actualBlob !== blob) throw new Error(`Frozen oracle Git blob changed: ${file}`)
}
export function verifyLegacy() {
  const count = verifyFrozenPublicOracle()
  console.log(`legacy: ${count} bounded public oracle files verified; not the historical full archive`)
}
if (import.meta.main) verifyLegacy()
