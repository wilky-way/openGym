import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const components = new URL('../src/components/', import.meta.url)
describe('W10 deleted media components', () => {
  it.each(['CustomMedia', 'CustomMediaField', 'WorkoutMedia', 'WorkoutThumb'])('omits the media-only %s module', name => {
    expect(existsSync(new URL(`${name}.tsx`, components))).toBe(false)
    expect(existsSync(new URL(`${name}.ts`, components))).toBe(false)
  })
})
