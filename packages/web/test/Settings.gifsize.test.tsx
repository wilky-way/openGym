import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
describe('Settings — exercise animations (catalogue media)', () => {
 it('restores the animation setting and persists its preference', () => {
  const source = readFileSync(new URL('../src/views/SettingsB.tsx', import.meta.url),'utf8')
  expect(source).toContain("title={t('Exercise animations')}")
  expect(source).toContain('s.gifSize =')
 })
})
