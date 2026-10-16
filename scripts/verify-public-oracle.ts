import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PUBLIC_ORACLE_SCOPE = 'bounded-public-oracle-v1'
export interface PublicOracleManifest {
  scope: string
  source: string
  files: { path: string; sha256: string; mode: string }[]
}
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** Injectable verifier for independently supplied fixtures; the release entry point also pins the manifest. */
export function verifyPublicOracle(root: string, manifest: PublicOracleManifest): number {
  if (!manifest || manifest.scope !== PUBLIC_ORACLE_SCOPE || typeof manifest.source !== 'string' || !manifest.source.trim() || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Malformed public oracle manifest')
  const expected = new Map<string, PublicOracleManifest['files'][number]>()
  const directories = new Set<string>([''])
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== 'string' || !/^[A-Za-z0-9_.@/-]+$/.test(entry.path) || entry.path.split('/').some(p => !p || p === '.' || p === '..') || !/^[a-f0-9]{64}$/.test(entry.sha256) || !['100644', '100755'].includes(entry.mode)) throw new Error('Malformed or escaping public oracle path/hash/mode')
    if (expected.has(entry.path)) throw new Error(`Duplicate public oracle path: ${entry.path}`)
    expected.set(entry.path, entry)
    const parts = entry.path.split('/')
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'))
  }
  const seen = new Set<string>()
  const walk = (path: string) => {
    const absolute = join(root, path), stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) throw new Error(`Public oracle symlink forbidden: ${path}`)
    if (stat.isDirectory()) {
      if (!directories.has(path)) throw new Error(`Unexpected public oracle directory: ${path}`)
      for (const name of readdirSync(absolute).sort()) walk(path ? `${path}/${name}` : name)
      return
    }
    const entry = expected.get(path)
    if (!entry) throw new Error(`Unexpected public oracle file: ${path}`)
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Public oracle must be an ordinary unlinked file: ${path}`)
    if ((stat.mode & 0o7777) !== (entry.mode === '100755' ? 0o755 : 0o644)) throw new Error(`Public oracle mode changed: ${path}`)
    if (digest(readFileSync(absolute)) !== entry.sha256) throw new Error(`Public oracle hash changed: ${path}`)
    seen.add(path)
  }
  walk('')
  for (const path of expected.keys()) if (!seen.has(path)) throw new Error(`Missing public oracle file: ${path}`)
  return seen.size
}

// Reviewed snapshot anchor: changing both a source and its editable manifest must still fail.
export const PUBLIC_ORACLE_MANIFEST_SHA256 = '3a76b9be788d2c9d09e97797b93d3164ee34dd0e934f379001abafe44f464218'
export function frozenPublicOracleManifest(bytes: Buffer): PublicOracleManifest {
  if (digest(bytes) !== PUBLIC_ORACLE_MANIFEST_SHA256) throw new Error('Public oracle manifest anchor changed')
  return JSON.parse(bytes.toString('utf8')) as PublicOracleManifest
}
export function verifyFrozenPublicOracle(): number {
  const manifestPath = fileURLToPath(new URL('../packages/parity/fixtures/oracle-manifest.json', import.meta.url))
  if (lstatSync(manifestPath).isSymbolicLink()) throw new Error('Public oracle manifest symlink forbidden')
  const bytes = readFileSync(manifestPath)
  return verifyPublicOracle(resolve(manifestPath, '../oracle'), frozenPublicOracleManifest(bytes))
}
if (import.meta.main) console.log(`Public bounded oracle: ${verifyFrozenPublicOracle()} files verified; this is not the historical full archive proof`)
