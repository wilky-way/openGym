import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { describe, it, expect } from 'vitest'

// Native lifecycle index edges are inert: validation receives allExercises(S),
// canonical alias targets exist in every real index, and routine-only conversion
// does not read exercise metadata. Keep forwarding explicit and mutation-protected.
describe('inert lifecycle forwarding edges', () => {
  it.each(['startProgramme', 'switchProgramme'])('forwards a real index to %s', callee => {
    const ast = parse(readFileSync(new URL('../../src/store/public-actions.ts', import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['typescript'] })
    const calls: any[] = []
    const visit = (node: any) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'CallExpression' && node.callee?.name === callee) calls.push(node)
      if (Array.isArray(node)) node.forEach(visit)
      else for (const [key, value] of Object.entries(node)) if (!['loc', 'comments'].includes(key)) visit(value)
    }
    visit(ast)
    expect(calls).toHaveLength(1)
    expect(calls[0].arguments.at(-1)).toMatchObject({ type: 'Identifier', name: 'index' })
    expect(calls[0].arguments).toHaveLength(callee === 'startProgramme' ? 4 : 5)
  })
})
