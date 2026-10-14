import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Icon from '../src/components/Icon'
import { glyphOf, DEFAULT_GLYPH } from '../src/lib/glyphs'

describe('icon and glyph own dictionary lookups', () => {
  it('ignores inherited names from saved routine glyphs', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])
      expect(glyphOf(name)).toBe(DEFAULT_GLYPH)
  })
  it('renders inherited icon names as an empty result without crashing', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])
      expect(renderToStaticMarkup(<Icon name={name} />)).toBe('')
  })
  it('retains known icons, legacy emoji and variation-selector fallback', () => {
    expect(renderToStaticMarkup(<Icon name="house" />)).toContain('data-icon="house"')
    expect(glyphOf('house')).toBe('house')
    expect(glyphOf('💪')).toBe('arm')
    expect(glyphOf('💪️')).toBe('arm')
    expect(glyphOf(null)).toBe(DEFAULT_GLYPH)
  })
})
