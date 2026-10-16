import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const components = new URL('../src/components/', import.meta.url)
describe('catalogue-only media components', () => {
  it.each(['Media', 'CustomMedia', 'CustomMediaField', 'WorkoutMedia', 'WorkoutThumb'])('keeps only the builtin catalogue module for %s', name => {
    expect(existsSync(new URL(`${name}.tsx`, components))).toBe(name === 'Media')
    expect(existsSync(new URL(`${name}.ts`, components))).toBe(false)
  })
  it('uses the builtin explorer thumbnail without custom media producers', () => {
    const source = readFileSync(new URL('MuscleExplorer.tsx', components), 'utf8')
    expect(source).toMatch(/<Thumb\b/)
    expect(source).toMatch(/import \{ Thumb \} from ['"]\.\/Media['"]/)
    expect(source).not.toMatch(/from ['"][^'"]*(?:CustomMedia|media-refs|media-sync)/)
    expect(source).not.toMatch(/<CustomMedia(?:Field)?\b/)
  })
})
