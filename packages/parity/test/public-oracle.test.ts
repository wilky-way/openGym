import { expect, test } from 'vitest'
import { createHash } from 'node:crypto'
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { frozenPublicOracleManifest, PUBLIC_ORACLE_SCOPE, verifyFrozenPublicOracle, verifyPublicOracle, type PublicOracleManifest } from '../../../scripts/verify-public-oracle'

const hash = (text: string) => createHash('sha256').update(text).digest('hex')
function fixture(run: (root: string, manifest: PublicOracleManifest) => void) {
  const root = mkdtempSync(join(tmpdir(), 'opengym-public-oracle-'))
  try {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/example.js'), 'synthetic\n', { mode: 0o644 })
    run(root, { scope: PUBLIC_ORACLE_SCOPE, source: 'Invented negative-control fixture', files: [{ path: 'src/example.js', sha256: hash('synthetic\n'), mode: '100644' }] })
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test('the independently anchored public bounded snapshot is complete', () => {
  expect(verifyFrozenPublicOracle()).toBe(709)
})
test('rejects changing source and editable manifest together at the frozen entry point', () => {
  const bytes = readFileSync(new URL('../fixtures/oracle-manifest.json', import.meta.url))
  const changed = JSON.parse(bytes.toString()) as PublicOracleManifest
  changed.files[0]!.sha256 = hash('changed')
  expect(() => frozenPublicOracleManifest(bytes)).not.toThrow()
  expect(() => frozenPublicOracleManifest(Buffer.from(JSON.stringify(changed)))).toThrow('anchor changed')
})
test('checks missing files, bytes, executable modes and unexpected files independently', () => {
  fixture((root, manifest) => {
    expect(verifyPublicOracle(root, manifest)).toBe(1)
    chmodSync(join(root, 'src/example.js'), 0o755)
    expect(() => verifyPublicOracle(root, manifest)).toThrow('mode changed')
    chmodSync(join(root, 'src/example.js'), 0o644)
    writeFileSync(join(root, 'src/example.js'), 'changed')
    expect(() => verifyPublicOracle(root, manifest)).toThrow('hash changed')
    writeFileSync(join(root, 'src/example.js'), 'synthetic\n')
    writeFileSync(join(root, 'extra'), '')
    expect(() => verifyPublicOracle(root, manifest)).toThrow('Unexpected')
    rmSync(join(root, 'extra'))
    rmSync(join(root, 'src/example.js'))
    expect(() => verifyPublicOracle(root, manifest)).toThrow('Missing')
  })
})
test('rejects malformed, duplicate and escaping manifest paths', () => {
  fixture((root, manifest) => {
    for (const path of ['', '/absolute', '../escape', 'src/../../escape', 'src//example.js', 'src/./example.js', 'C:\\escape', 'src\\example.js']) {
      expect(() => verifyPublicOracle(root, { ...manifest, files: [{ ...manifest.files[0]!, path }] }), path).toThrow('Malformed')
    }
    expect(() => verifyPublicOracle(root, { ...manifest, files: [...manifest.files, ...manifest.files] })).toThrow('Duplicate')
    expect(() => verifyPublicOracle(root, { ...manifest, files: [] })).toThrow('Malformed')
    expect(() => verifyPublicOracle(root, { ...manifest, scope: 'historical-full-archive' })).toThrow('Malformed')
    for (const patch of [{ sha256: 'invalid' }, { mode: '120000' }]) expect(() => verifyPublicOracle(root, { ...manifest, files: [{ ...manifest.files[0]!, ...patch }] })).toThrow('Malformed')
  })
})
test('rejects symlink files, directories, roots, hardlinks and unexpected empty directories', () => {
  fixture((root, manifest) => {
    symlinkSync('src/example.js', join(root, 'link'))
    expect(() => verifyPublicOracle(root, manifest)).toThrow('symlink')
    rmSync(join(root, 'link'))
    symlinkSync('src', join(root, 'link'))
    expect(() => verifyPublicOracle(root, manifest)).toThrow('symlink')
    rmSync(join(root, 'link'))
    linkSync(join(root, 'src/example.js'), join(root, 'extra'))
    expect(() => verifyPublicOracle(root, manifest)).toThrow()
    rmSync(join(root, 'extra'))
    mkdirSync(join(root, 'empty'))
    expect(() => verifyPublicOracle(root, manifest)).toThrow('Unexpected')
    rmSync(join(root, 'empty'), { recursive: true })
    const alias = `${root}-link`
    try { symlinkSync(root, alias); expect(() => verifyPublicOracle(alias, manifest)).toThrow('symlink') }
    finally { rmSync(alias, { force: true }) }
  })
})
