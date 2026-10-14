import { run } from './files'
import { discoverTests } from './test-discovery'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { passingBunTests } from './test-execution'
// The data performance benchmark runs separately on a quiet host with --perf.
const perf = process.env.GATE_PERF === '1' || process.argv.includes('--perf')
const tests = discoverTests('.').filter(test => perf || !test.endsWith('/data-performance.test.ts'))
if (!perf) console.log('Data performance benchmark: skipped (opt in with --perf)')
if (!tests.length) console.log('server: no tests (foundation skeleton)')
let passing = 0
for (const [index, test] of tests.entries()) {
  const report = process.env.GATE_TEST_REPORT && `${process.env.GATE_TEST_REPORT}.${index}.xml`
  if (report) rmSync(report, { force: true })
  await run(['bun', 'test', test, ...(report ? ['--reporter=junit', `--reporter-outfile=${report}`] : [])])
  if (report) passing += passingBunTests(readFileSync(report, 'utf8'))
}
if (process.env.GATE_TEST_REPORT) writeFileSync(process.env.GATE_TEST_REPORT, JSON.stringify({ passing }))
