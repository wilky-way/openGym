import { it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyTreeFile } from '../legacy-verify'
it('checks the Git blob and executable mode independently of mutable manifest hashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-tree-')), file = join(root, 'source')
  const original = 'synthetic oracle\n', blob = createHash('sha1').update(`blob ${Buffer.byteLength(original)}\0`).update(original).digest('hex')
  try {
    writeFileSync(file, original); chmodSync(file, 0o644)
    expect(() => verifyTreeFile(file, '100644', blob)).not.toThrow()
    chmodSync(file, 0o755)
    expect(() => verifyTreeFile(file, '100644', blob)).toThrow('mode changed')
    chmodSync(file, 0o644); writeFileSync(file, 'changed oracle\n')
    expect(() => verifyTreeFile(file, '100644', blob)).toThrow('Git blob changed')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
