import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { describe, it, expect } from 'vitest'
import inertEdges from './W12-inert-index-edges.json'
/** Only proven inert edges use AST coverage; every behavior edge has an output mutation receipt. */
describe('W12 inert index forwarding', () => {
  it.each(inertEdges)('$id remains forwarded: $reason', row => {
    const source = readFileSync(new URL('../src/sheets/sheets-exercises.tsx', import.meta.url), 'utf8')
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] })
    const calls: any[] = []
    function walk(value: any): void {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) { value.forEach(walk); return }
      if (value.type === 'CallExpression' && value.callee.type === 'Identifier' && value.callee.name === row.helper) calls.push(value)
      for (const [key, child] of Object.entries(value)) if (!['loc','start','end','comments','tokens'].includes(key)) walk(child)
    }
    walk(ast)
    const call = calls[Number(row.id.split('#')[1]) - 1]
    expect(call.arguments[row.argument - 1]?.callee?.name).toBe('indexOf')
  })
})
