import { expect, test } from 'vitest'
import { passingBunTests } from '../../../scripts/test-execution'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXTRA_GATES, PUBLIC_PACKAGES, PUBLIC_TIMEZONES, requireCompleteExtras, requirePublicReport } from '../../../scripts/public-checks'
test('requires actual passing execution and rejects empty, skipped, malformed and failed reports', () => {
  const report = (statuses: string[], fields = {}) => JSON.stringify({ ...fields, testResults: [{ assertionResults: statuses.map(status => ({ status })) }] })
  expect(requirePublicReport(report(['passed']), 'vitest', 'synthetic')).toBe(1)
  for (const data of ['{}', 'null', report([]), report(['pending']), report(['skipped']), report(['passed'], { success: false }), report(['passed', 'failed'])]) expect(() => requirePublicReport(data, 'vitest', 'synthetic')).toThrow()
  expect(requirePublicReport('{"passing":1}', 'server', 'synthetic')).toBe(1)
  for (const data of ['null', '{}', '{"passing":0}', '{"passing":-1}', '{"passing":0.5}', '{"passing":"1"}', '{"passing":1,"success":false}', '{"passing":1,"numFailedTests":1}']) expect(() => requirePublicReport(data, 'server', 'synthetic')).toThrow()
})
test('public validation names every package, both timezones and outstanding integration resources', () => {
  expect(PUBLIC_PACKAGES).toEqual(['contract', 'core', 'web', 'server', 'mcp', 'parity'])
  expect(PUBLIC_TIMEZONES).toEqual(['America/Chicago', 'UTC'])
  expect(EXTRA_GATES.some(g => g.argv.includes('scripts/assert-stall-golden-enabled.ts'))).toBe(true)
  expect(EXTRA_GATES.some(g => g.id === 'I02' && g.gap?.includes('not integration proof'))).toBe(true)
  expect(() => requireCompleteExtras(EXTRA_GATES)).toThrow('Public proof gaps')
  expect(() => requireCompleteExtras([{ id: 'synthetic', argv: ['true'] }])).not.toThrow()
})


test('uses the actual frozen saxes JavaScript through the public parser helper in parity Vitest', () => {
  const helper = fileURLToPath(new URL('../../../scripts/test-execution.ts', import.meta.url))
  const require = createRequire(helper)
  const actual = realpathSync(require.resolve('saxes'))
  expect(realpathSync(Bun.resolveSync('saxes', dirname(helper)))).toBe(actual)
  expect(JSON.parse(readFileSync(require.resolve('saxes/package.json'), 'utf8')).version).toBe('6.0.0')
  expect(createHash('sha256').update(readFileSync(actual)).digest('hex')).toBe('d00e2ba27ed7d6ac961d03ff14d6b8c0eb5bf063ed2c996c22c6df06ac121423')
  expect(passingBunTests('<testsuites><testsuite><testcase name="invented"/></testsuite></testsuites>')).toBe(1)
  for (const xml of ['<testsuites><testsuite></testsuites>', '<testsuites><testsuite><testcase/>', '<!DOCTYPE testsuites><testsuites/>', '<testsuites><testsuite><testcase><failure/></testcase></testsuite></testsuites>']) {
    expect(() => passingBunTests(xml)).toThrow()
  }
  console.log('saxes actual JavaScript runtime', actual)
})
