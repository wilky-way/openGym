import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { describe, expect, it } from 'vitest'

// Semantically inert edges keep the explicit forwarding contract. Their output-equivalence
// Exercise each index forwarding edge with output assertions and deletion probes.
const inert: [string, string, number][] = [
  ['session-start', 'dbLoadFor', 76],
  ['session-routines', 'setsFromRows', 76],
  ['session-routines', 'defaultConfig', 76],
  ['session-repeat', 'setsFromRows', 39],
]
interface Call { name: string; line: number; last: unknown }
function calls(value: unknown, found: Call[] = []): Call[] {
  if (!value || typeof value !== 'object') return found
  if (Array.isArray(value)) { value.forEach(v => calls(v, found)); return found }
  const node = value as Record<string, unknown>
  if (node.type === 'CallExpression') {
    const callee = node.callee as { name?: string }
    const loc = node.loc as { start: { line: number } }
    const args = node.arguments as { name?: string }[]
    found.push({ name: callee.name || '', line: loc.start.line, last: args.at(-1)?.name })
  }
  for (const [key, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) calls(child, found)
  return found
}
describe('inert index forwarding edges', () => {
  it.each(inert)('%s %s at line %i retains its explicit index', (module, name, line) => {
    const source = readFileSync(new URL(`../src/${module}.ts`, import.meta.url), 'utf8')
    const found = calls(parse(source, { sourceType: 'module', plugins: ['typescript'] }))
      .filter(c => c.name === name && c.line === line)
    expect(found.length).toBeGreaterThan(0)
    expect(found.every(c => c.last === 'index')).toBe(true)
  })
})
