import { readFileSync, existsSync } from 'node:fs'
import { expect, it } from 'vitest'
it('waives ProgressPhotos by name under the media deletion ruling', () => {
  expect(existsSync('src/views/ProgressPhotos.tsx')).toBe(false)
  expect(readFileSync('src/views/Stats.tsx', 'utf8')).not.toContain('/progress-photos')
  expect(readFileSync('src/views/Library.tsx', 'utf8')).not.toMatch(/<Thumb|photo or video|animated exercises|with animations/)
})
