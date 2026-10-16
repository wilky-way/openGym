import { expect, it } from 'vitest'
import { hasImplementation, passingVitestTests, passingBunTests, requireExecutedTests } from '../test-execution'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
it('only exempts truly empty skeletons, including JavaScript implementation detection', () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-implementation-'))
  try {
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/index.ts'), '// skeleton\nexport {};')
    expect(hasImplementation(root)).toBe(false)
    writeFileSync(join(root, 'src/impl.js'), 'export const value = 1')
    expect(hasImplementation(root)).toBe(true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
it('requires an actually passed test and rejects zero or skipped-only results', () => {
  const report = (statuses: string[]) => JSON.stringify({ testResults: [{ assertionResults: statuses.map(status => ({ status })) }] })
  for (const statuses of [[], ['pending'], ['todo'], ['skipped']]) {
    const passed = passingVitestTests(report(statuses))
    expect(() => requireExecutedTests(true, passed, 'core')).toThrow('executed, passing test')
  }
  expect(() => requireExecutedTests(true, passingVitestTests(report(['passed', 'pending'])), 'core')).not.toThrow()
  expect(() => requireExecutedTests(false, 0, 'core')).not.toThrow()
  expect(() => passingVitestTests('{}')).toThrow()
  expect(passingBunTests('<testsuites><testsuite><testcase name="ok"/><testcase name="skip"><skipped/></testcase></testsuite></testsuites>')).toBe(1)
})

it('N1 rejects reported failures even when a runner exits zero', () => {
  const passing = { status: 'passed', failureMessages: [] }
  const base = { success: true, numFailedTests: 0, numFailedTestSuites: 0, testResults: [{ status: 'passed', assertionResults: [passing] }] }
  const failures = [
    { ...base, success: false },
    { ...base, numFailedTests: 1 },
    { ...base, numFailedTestSuites: 1 },
    { ...base, numRuntimeErrorTestSuites: 1 },
    { ...base, testResults: [{ status: 'failed', assertionResults: [passing] }] },
    { ...base, testResults: [{ assertionResults: [passing, { status: 'failed' }] }] },
    { ...base, testResults: [{ assertionResults: [{ ...passing, failureMessages: ['boom'] }] }] },
    { ...base, testResults: [{ assertionResults: [passing], failureMessage: 'suite setup failed' }] },
  ]
  for (const report of failures) {
    const child = Bun.spawnSync(['bun', '-e', `process.stdout.write(${JSON.stringify(JSON.stringify(report))})`], { stdout: 'pipe', stderr: 'pipe' })
    expect(child.exitCode).toBe(0)
    expect(() => passingVitestTests(new TextDecoder().decode(child.stdout))).toThrow('failures')
  }
  expect(passingVitestTests(JSON.stringify(base))).toBe(1)
  for (const report of ['null', '{"testResults":[{}]}', '{"testResults":[{"assertionResults":[{}]}]}']) expect(() => passingVitestTests(report)).toThrow()
})

it('N1 validates complete JUnit XML and rejects failure elements and aggregate counts', () => {
  const wrap = (body: string, attributes = '') => `<testsuites><testsuite ${attributes}>${body}</testsuite></testsuites>`
  const good = '<testcase name="ok"/>'
  for (const report of [
    wrap(`${good}<testcase name="bad"><failure message="boom"/></testcase>`),
    wrap(`${good}<testcase name="bad"><error/></testcase>`),
    wrap(good, 'failures="1"'), wrap(good, 'errors="1"'),
    `<testsuites failures="1">${wrap(good)}</testsuites>`,
    wrap(good, 'failures="oops"'),
    wrap(good).slice(0, -1), wrap(good).replace('</testsuite>', '</oops>'),
    wrap('<testcase name="bad & entity"/>'),
    `${wrap(good)}<extra/>`, '<!-- <testsuites -->',
    '<!DOCTYPE testsuites [bad DTD]>' + wrap(good),
  ]) expect(() => passingBunTests(report), report).toThrow()
  expect(passingBunTests(`<?xml version="1.0"?>${wrap(`${good}<testcase name="skip"><skipped/></testcase>`, 'failures="0" errors="0"')}`)).toBe(1)
  expect(passingBunTests(wrap('<testcase name="ok"><system-out><![CDATA[<failure/>]]></system-out></testcase>'))).toBe(1)
})
