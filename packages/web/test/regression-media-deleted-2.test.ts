import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
describe('deleted custom exercise media', () => {
  it('provides builtin previews without custom media, file inputs or upload/sync producers', () => {
    const source = readFileSync(new URL('../src/sheets/sheets-exercises.tsx', import.meta.url), 'utf8')
    expect(source).not.toMatch(/import .*\/(CustomMediaField|media-refs|media-sync)/)
    expect(source).not.toMatch(/<(CustomMedia|CustomMediaField)\b/)
    expect(source).not.toMatch(/type=["']file["']/)
    expect(source).not.toMatch(/syncMedia\(/)
    expect(source).toMatch(/import Media, \{ Thumb \} from ['"]\.\.\/components\/Media['"]/)
    expect(source).toMatch(/<Media ex=\{ex\}/)
  })
})
