import {parse} from '@babel/parser'
import {readFileSync, readdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
type Node = {type?: string; name?: string; value?: unknown; [key: string]: any}
const directory = fileURLToPath(new URL('../packages/contract/core-api/', import.meta.url))
const signatures = new Map<string, Map<string, number>>()
function visit(node: unknown, fn: (n: Node) => void) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {node.forEach(n => visit(n, fn)); return}
  const n = node as Node; if (n.type) fn(n)
  for (const [key, value] of Object.entries(n)) if (!['loc', 'start', 'end', 'comments'].includes(key)) visit(value, fn)
}
// The frozen declarations define the public trailing-index convention. Building
// this inventory avoids a hand-maintained list that silently misses new helpers.
for (const file of readdirSync(directory).filter(f => f.endsWith('.d.ts'))) {
  const exports = new Map<string, number>()
  const ast = parse(readFileSync(directory + file, 'utf8'), {sourceType: 'module', plugins: [['typescript', {dts: true}]]})
  visit(ast, n => {
    const name = n.type === 'TSDeclareFunction' ? n.id?.name : n.type === 'VariableDeclarator' ? n.id?.name : undefined
    const params = n.type === 'TSDeclareFunction' ? n.params : n.id?.typeAnnotation?.typeAnnotation?.params
    if (!name || !Array.isArray(params)) return
    const position = params.findIndex(p => p.typeAnnotation?.typeAnnotation?.type === 'TSTypeReference' && p.typeAnnotation.typeAnnotation.typeName?.name === 'ExerciseIndex')
    if (position >= 0) exports.set(name, position)
  })
  signatures.set(file.slice(0, -5), exports)
}
export function exerciseIndexErrors(file: string, source: string, parsed?: unknown): string[] {
  if (!/^packages\/(?:web|server)\/src\//.test(file) || /(?:\.test\.tsx?$|\/test\/)/.test(file)) return []
  const ast = parsed ?? parse(source, {sourceType: 'module', plugins: ['typescript', 'jsx']})
  const named = new Map<string, {name: string; position: number}>(), namespaces = new Map<string, Map<string, number>>()
  visit(ast, n => {
    if (n.type !== 'ImportDeclaration' || n.importKind === 'type') return
    const module = String(n.source.value).replace(/^@opengym\/core\//, '').replace(/^.*packages\/core\/src\//, '').replace(/\.[cm]?[jt]s$/, '')
    if (!String(n.source.value).startsWith('@opengym/core/') && !String(n.source.value).includes('core/src/')) return
    const exports = signatures.get(module); if (!exports) return
    for (const spec of n.specifiers) {
      if (spec.type === 'ImportNamespaceSpecifier') namespaces.set(spec.local.name, exports)
      if (spec.type === 'ImportSpecifier' && spec.importKind !== 'type') {
        const name = spec.imported.name ?? spec.imported.value, position = exports.get(name)
        if (position !== undefined) named.set(spec.local.name, {name, position})
      }
    }
  })
  const errors: string[] = []
  visit(ast, n => {
    if (!['CallExpression', 'OptionalCallExpression'].includes(n.type ?? '')) return
    let callee = n.callee
    while (['TSAsExpression', 'TSNonNullExpression', 'TSInstantiationExpression', 'ParenthesizedExpression'].includes(callee?.type)) callee = callee.expression
    let target = callee?.type === 'Identifier' ? named.get(callee.name) : undefined
    if (['MemberExpression', 'OptionalMemberExpression'].includes(callee?.type) && callee.object.type === 'Identifier') {
      const name = callee.computed ? callee.property.value : callee.property.name
      const position = namespaces.get(callee.object.name)?.get(name)
      if (position !== undefined) target = {name, position}
    }
    if (!target) return
    const arg = n.arguments[target.position]
    if (!arg || arg.type === 'SpreadElement' || arg.type === 'Identifier' && arg.name === 'undefined' || arg.type === 'UnaryExpression' && arg.operator === 'void') {
      errors.push(`${file}:${n.loc?.start.line ?? 0}: ${target.name} must receive an explicit ExerciseIndex (argument ${target.position + 1})`)
    }
  })
  return errors
}
