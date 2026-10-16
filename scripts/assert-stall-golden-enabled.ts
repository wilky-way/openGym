import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
type Node = {type?: string; name?: string; value?: unknown; id?: Node; init?: Node; callee?: Node; object?: Node; property?: Node; arguments?: Node[]; [key: string]: unknown}
export function assertStallGoldenEnabled(source: string): void {
  const ast = parse(source, {sourceType:'module',plugins:['typescript']})
  let extension = false, enabledSuite = false, evaluated = false
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const node = value as Node
    if (node.type === 'VariableDeclarator' && node.id?.name === 'stallExtensions') extension = node.init?.type === 'Identifier' && node.init.name === 'p3Extensions'
    if (node.type === 'CallExpression') {
      const callee = node.callee
      if (callee?.type === 'MemberExpression' && ['describe','it','test'].includes(callee.object?.name ?? '') && ['skip','todo','skipIf','runIf','only'].includes(callee.property?.name ?? '')) throw new Error('Stall golden must run unconditionally')
      const title = node.arguments?.[0]?.value
      if (callee?.type === 'Identifier' && callee.name === 'describe' && typeof title === 'string' && title.includes('P3-MUST-ENABLE')) enabledSuite = true
      if (callee?.type === 'Identifier' && callee.name === 'evaluate') {
        if (node.arguments?.[1]?.type !== 'Identifier' || node.arguments[1].name !== 'stallExtensions') throw new Error('Every stall golden evaluate call must use the actual stallExtensions')
        evaluated = true
      }
    }
    for (const [key, child] of Object.entries(node)) if (!['loc','comments','tokens'].includes(key)) visit(child)
  }
  visit(ast)
  if (!extension || !enabledSuite || !evaluated) throw new Error('Stall golden must execute evaluate with the actual p3Extensions')
}
if (import.meta.main) {
  assertStallGoldenEnabled(readFileSync('packages/core/test/progression-stall.golden.test.ts','utf8'))
  console.log('Real stall golden is enabled with p3Extensions; execution is verified by core tests')
}
