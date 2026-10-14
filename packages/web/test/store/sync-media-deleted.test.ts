import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
it('waives owed-media sync paths by the media-deleted ruling', () => {
  const source = readFileSync(new URL('../../src/store/sync-engine.ts', import.meta.url), 'utf8')
  expect(source).not.toMatch(/pendingRefCount|settleMedia|mediaStore|referencedHashes|loadPending|stashedMediaHashes/)
})
