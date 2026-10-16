import { it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverTests } from '../test-discovery'
it('discovers TS and TSX tests with the same include used by every runner and gate', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-discovery-'))
  try {
    for (const file of ['src/x.test.ts', 'test/nested/y.test.tsx', 'outside/z.test.ts', 'test/not-a-test.ts']) {
      mkdirSync(join(root, file, '..'), { recursive: true })
      writeFileSync(join(root, file), '')
    }
    expect(discoverTests(root)).toEqual([join(root, 'src/x.test.ts'), join(root, 'test/nested/y.test.tsx')])
  } finally { rmSync(root, { recursive: true, force: true }) }
})
