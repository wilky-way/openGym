import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const components = new URL('../src/components/', import.meta.url)
describe('deleted media components', () => {
  it.each(['Media', 'CustomMedia', 'CustomMediaField', 'WorkoutMedia', 'WorkoutThumb'])('omits the media-only %s module', name => {
    expect(existsSync(new URL(`${name}.tsx`, components))).toBe(false)
    expect(existsSync(new URL(`${name}.ts`, components))).toBe(false)
  })
  it('removes the explorer thumbnail and media imports', () => {
    const source = readFileSync(new URL('MuscleExplorer.tsx', components), 'utf8')
    expect(source).not.toMatch(/<Thumb\b/)
    expect(source).not.toMatch(/from ['"][^'"]*(?:Media|media)/)
  })
})
