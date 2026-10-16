import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
describe('W12 deleted custom exercise media', () => {
  it('provides no custom media renderers, file inputs or upload/sync producers', () => {
    const source = readFileSync(new URL('../src/sheets/sheets-exercises.tsx', import.meta.url), 'utf8')
    expect(source).not.toMatch(/import .*\/(CustomMediaField|media-refs|media-sync)/)
    expect(source).not.toMatch(/<(CustomMedia|CustomMediaField)\b/)
    expect(source).not.toMatch(/type=["']file["']/)
    expect(source).not.toMatch(/syncMedia\(/)
  })
})
