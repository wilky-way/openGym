import { readFileSync, existsSync } from 'node:fs'
import { parse } from '@babel/parser'
import { describe, expect, it } from 'vitest'
import { LIBRARY_ID_PATTERN, LIBRARY_DOT_ID_PATTERN } from '../src/lib/programme-library'
const pinned = new URL('./fixtures/library-id-rule.txt', import.meta.url)
const integrated = new URL('../../server/src/storage/library.ts', import.meta.url)
const serverRules = (source: string) => {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] })
  const patterns: string[] = []
  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'FunctionDeclaration' && node.id?.name !== 'assertLibraryId') return
    if (node.type === 'RegExpLiteral') patterns.push(node.pattern)
    if (Array.isArray(node)) node.forEach(visit)
    else for (const [key, value] of Object.entries(node)) if (!['loc', 'comments'].includes(key)) visit(value)
  }
  visit(ast)
  return patterns
}
describe('library entry IDs use the server opaque namespace', () => {
  it('mirrors both exact library patterns and checks the actual server source', () => {
    const client = [LIBRARY_ID_PATTERN.source, LIBRARY_DOT_ID_PATTERN.source]
    expect(serverRules(readFileSync(pinned, 'utf8'))).toEqual(client)
    if (existsSync(integrated)) expect(serverRules(readFileSync(integrated, 'utf8')).slice(0, 2)).toEqual(client)
  })
  it.each(['synthetic-id', '_leading', 'constructor', '__proto__', 'a'.repeat(128)])('allows opaque id %s', id => {
    expect(LIBRARY_ID_PATTERN.test(id) && !LIBRARY_DOT_ID_PATTERN.test(id)).toBe(true)
  })
  it.each(['', '.', '..', '...', '../private', 'a/b', 'a\\b', 'space id', '日本語', 'a:b', 'a'.repeat(129)])('rejects non-library id %s', id => {
    expect(LIBRARY_ID_PATTERN.test(id) && !LIBRARY_DOT_ID_PATTERN.test(id)).toBe(false)
  })
})
