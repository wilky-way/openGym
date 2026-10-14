import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
describe('Settings — exercise animations (deleted media surface)', () => {
 it('omits the deleted animation setting and its media preference writes', () => {
  const source = readFileSync(new URL('../src/views/SettingsB.tsx', import.meta.url),'utf8')
  expect(source).not.toContain("title={t('Exercise animations')}")
  expect(source).not.toContain('s.gifSize =')
 })
})
