import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { files } from './files'
import { assertionCount, checkAssertionBudget, checkMappingCoverage, type Unit } from './assertion-budget'
import { verifyFrozenPublicOracle } from './verify-public-oracle'
export { assertionCount, checkAssertionBudget, checkMappingCoverage } from './assertion-budget'
export type { Unit, TestMapping } from './assertion-budget'

export function loadPublicParityMap(): Record<string, Unit> {
  const map = JSON.parse(readFileSync(new URL('./public-parity-map.json', import.meta.url), 'utf8')) as Record<string, Unit>
  if (!map || Array.isArray(map) || typeof map !== 'object' || !Object.keys(map).length) throw new Error('Missing public parity mappings')
  for (const [id, unit] of Object.entries(map)) {
    if (!unit || !Array.isArray(unit.packages) || !unit.packages.length || unit.packages.some(pkg => !['contract', 'core', 'server', 'web', 'mcp', 'parity'].includes(pkg)) || !Array.isArray(unit.tests)) throw new Error(`Malformed public parity mapping: ${id}`)
  }
  return map
}
export function oraclePath(logical: string): string {
  if (!/^legacy\/(?:frontend|api|mcp)\//.test(logical) || logical.split('/').some(p => !p || p === '.' || p === '..') || logical.includes('\\')) throw new Error('Test mapping must name a safe logical legacy path')
  return logical.replace(/^legacy\//, 'packages/parity/fixtures/oracle/')
}
export function checkUnmappedTwins(inventory: Set<string>, mappedPaths: Set<string>, portedPaths: string[]): void {
  const legacyByStem = new Set([...inventory].map(f => basename(f).replace(/\.jsx?$/, '')))
  for (const ported of portedPaths.filter(f => /\.test\.tsx?$/.test(f) && !f.includes('.diff.test.'))) {
    if (legacyByStem.has(basename(ported).replace(/\.tsx?$/, '')) && !mappedPaths.has(ported)) throw new Error(`Unregistered legacy test twin: ${ported}`)
  }
}
export function assertCount(id: string) {
  const units = loadPublicParityMap(), unit = units[id]
  if (!unit) throw new Error(`Unknown unit ${id}; register its public test twins in scripts/public-parity-map.json`)
  verifyFrozenPublicOracle()
  const root = 'packages/parity/fixtures/oracle/'
  const inventory = new Set(files(root).filter(file => /\.test\.jsx?$/.test(file)).map(file => file.replace(root, 'legacy/')))
  const docs = unit.packages.map(pkg => {
    try { return readFileSync(`packages/${pkg}/PORTING-WAIVERS.md`, 'utf8') } catch { return '' }
  }).join('\n')
  checkMappingCoverage(unit, inventory, docs, id)
  const allPairs = Object.values(units).flatMap(u => u.tests)
  checkUnmappedTwins(inventory, new Set(allPairs.map(p => p.ported)), unit.packages.flatMap(pkg => files(`packages/${pkg}`).filter(f => !f.startsWith(root))))
  for (const pair of unit.tests) {
    if (!/^(?:packages\/[^/]+|scripts\/test)\//.test(pair.ported) || pair.ported.split('/').some(p => !p || p === '.' || p === '..') || pair.ported.includes('\\')) throw new Error('Test mapping must name package or foundation paths')
    const old = assertionCount(readFileSync(oraclePath(pair.legacy), 'utf8')), next = assertionCount(readFileSync(pair.ported, 'utf8'))
    const waiverDoc = pair.waiver ? readFileSync(pair.ported.split('/').slice(0, 2).join('/') + '/PORTING-WAIVERS.md', 'utf8') : ''
    checkAssertionBudget(old, next, pair.waiver, waiverDoc, pair.ported)
  }
  console.log(`parity:assert-count ${id}: ${unit.tests.length} twins checked`)
}
if (import.meta.main) {
  const id = process.argv[2] ?? ''
  if (id === '--all') for (const key of Object.keys(loadPublicParityMap())) assertCount(key)
  else assertCount(id)
}
