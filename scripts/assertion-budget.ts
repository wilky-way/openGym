import { parse } from '@babel/parser'
export interface TestMapping { legacy: string; ported: string; waiver?: { reason: string; assertions: number } }
export interface Unit { packages: string[]; tests: TestMapping[]; legacyTests?: string[]; newTestsOnlyReason?: string; extra?: string[][] }
export function assertionCount(source: string): number {
  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] })
  let count = 0
  function visit(n: unknown) {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(visit); return }
    const node = n as Record<string, unknown>
    if (node.type === 'CallExpression') {
      const callee = node.callee as { type?: string; name?: string; object?: {name?: string} }
      if ((callee.type === 'Identifier' && ['expect', 'assert'].includes(callee.name ?? '')) || (callee.type === 'MemberExpression' && callee.object?.name === 'assert')) count++
    }
    Object.entries(node).filter(([k]) => !['loc', 'comments', 'tokens'].includes(k)).forEach(([, v]) => visit(v))
  }
  visit(ast); return count
}
export function checkAssertionBudget(old: number, next: number, waiver: TestMapping['waiver'], doc: string, label = 'test') {
  const allowance = waiver?.assertions ?? 0
  if (waiver && (!Number.isInteger(allowance) || allowance < 0 || !waiver.reason.trim() || !doc.includes(waiver.reason))) throw new Error('Waiver needs a nonnegative assertion budget and its reason in package PORTING-WAIVERS.md')
  if (next + allowance < old) throw new Error(`${label}: ${next} assertions < legacy ${old} (waiver ${allowance})`)
}
export function checkMappingCoverage(unit: Unit, legacyInventory: Set<string>, waiverDocs: string, id: string) {
  if (!Array.isArray(unit.legacyTests)) throw new Error(`${id}: explicit legacyTests inventory is required; renamed ports cannot infer coverage from filenames`)
  const expected = new Set(unit.legacyTests), mapped = new Set(unit.tests.map(pair => pair.legacy))
  if (expected.size !== unit.legacyTests.length || mapped.size !== unit.tests.length) throw new Error(`${id}: duplicate legacy inventory or mapping`)
  if (!expected.size && (!unit.newTestsOnlyReason?.trim() || !waiverDocs.includes(unit.newTestsOnlyReason))) throw new Error(`${id}: empty legacy inventory needs a reviewed reason in package PORTING-WAIVERS.md`)
  for (const legacy of expected) {
    if (!legacyInventory.has(legacy)) throw new Error(`${id}: unknown legacy inventory test: ${legacy}`)
    if (!mapped.has(legacy)) throw new Error(`${id}: unmapped legacy inventory test: ${legacy}`)
  }
  for (const legacy of mapped) if (!expected.has(legacy)) throw new Error(`${id}: mapping outside declared legacy inventory: ${legacy}`)
}
