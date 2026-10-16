import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { describe, expect, it } from 'vitest'

/** Inert: both workout merge sites receive an index built from S.customEx, so every custom
 * index hit is already excluded by mergeImport's known-id set. Builtin ids cannot be new
 * parser-generated `im` ids. Bodyweight merging returns before it reads the index at all.
 * The AST assertions pin the contract edge even though removing it has no UI output effect. */
function calls(): any[] {
  const ast = parse(readFileSync(new URL('../src/sheets-a.tsx', import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['typescript', 'jsx'] })
  const found: any[] = []
  function visit(node: any): void {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'mergeImport') found.push(node)
    for (const [key, child] of Object.entries(node)) if (!['loc', 'comments', 'tokens'].includes(key)) visit(child)
  }
  visit(ast); return found
}
describe('W11 inert import merge index forwarding', () => {
  it('inventories all three merge edges', () => { expect(calls()).toHaveLength(3) })
  it.each([[0, 'CSV/XML summary'], [1, 'Hevy workouts'], [2, 'Hevy bodyweight']])('forwards index at inert edge %s (%s)', (ordinal) => {
    expect(calls()[Number(ordinal)].arguments[2]).toMatchObject({ type: 'CallExpression', callee: { type: 'Identifier', name: 'index' }, arguments: [] })
  })
})
