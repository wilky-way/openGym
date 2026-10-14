import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import { SaxesParser } from 'saxes'
import { files } from './files'
export function hasImplementation(root: string): boolean {
  return files(root).some(file => {
    if (!/\/src\/.*\.[cm]?[jt]sx?$/.test(file) || file.endsWith('.d.ts') || /\.test\.[cm]?[jt]sx?$/.test(file)) return false
    const ast = parse(readFileSync(file, 'utf8'), { sourceType: 'unambiguous', plugins: ['typescript', 'jsx'] })
    return ast.program.body.some(node => node.type !== 'EmptyStatement' && !(node.type === 'ExportNamedDeclaration' && !node.source && !node.declaration && !node.specifiers.length))
  })
}
export function passingVitestTests(report: string): number {
  const data = JSON.parse(report)
  if (!data || !Array.isArray(data.testResults)) throw new Error('Missing Vitest execution results')
  const checkFailures = (result: Record<string, unknown>) => {
    if (result.success === false || result.status === 'failed') throw new Error('Vitest report contains failures')
    for (const field of ['numFailedTests', 'numFailedTestSuites', 'numRuntimeErrorTestSuites']) {
      if (field in result && result[field] !== 0) throw new Error(`Vitest report contains failures or invalid ${field}`)
    }
    if (result.failureMessage || Array.isArray(result.failureMessages) && result.failureMessages.length) throw new Error('Vitest report contains failures')
  }
  checkFailures(data)
  let passing = 0
  for (const suite of data.testResults) {
    if (!suite || !Array.isArray(suite.assertionResults)) throw new Error('Malformed Vitest execution results')
    checkFailures(suite)
    for (const test of suite.assertionResults) {
      if (!test || !['passed', 'failed', 'pending', 'todo', 'skipped'].includes(test.status)) throw new Error('Malformed Vitest assertion results')
      checkFailures(test)
      if (test.status === 'passed') passing++
    }
  }
  return passing
}
export function passingBunTests(junit: string): number {
  const parser = new SaxesParser({ xmlns: false })
  const stack: string[] = []
  let root = '', passing = 0, skipped = false
  parser.on('doctype', () => { throw new Error('JUnit doctypes are forbidden') })
  parser.on('opentag', tag => {
    if (!stack.length) root = tag.name
    if (['failure', 'error'].includes(tag.name)) throw new Error('Bun report contains failures')
    for (const field of ['failures', 'errors']) {
      const count = tag.attributes[field]
      if (count !== undefined && !/^0+$/.test(count)) throw new Error(`Bun report contains failures or invalid ${field}`)
    }
    if (tag.name === 'testcase') {
      if (stack.at(-1) !== 'testsuite') throw new Error('Malformed JUnit testcase')
      skipped = false
    }
    if (tag.name === 'skipped' && stack.includes('testcase')) skipped = true
    stack.push(tag.name)
  })
  parser.on('closetag', tag => {
    if (tag.name === 'testcase' && !skipped) passing++
    stack.pop()
  })
  // Saxes throws on malformed/truncated XML instead of accepting a passing prefix.
  parser.write(junit).close()
  if (root !== 'testsuites') throw new Error('Missing Bun execution results')
  return passing
}
export function requireExecutedTests(implemented: boolean, passing: number, pkg: string) {
  if (!Number.isInteger(passing) || passing < 0) throw new Error(`${pkg}: invalid execution count`)
  if (implemented && passing === 0) throw new Error(`${pkg}: implemented package requires at least one executed, passing test (skipped-only is not coverage)`)
}
