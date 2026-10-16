// Runs only the bounded public oracle fixture, never a historical private archive.
import { files, run } from './files'
import { verifyFrozenPublicOracle } from './verify-public-oracle'
const root = 'packages/parity/fixtures/oracle'
if (process.argv[2] !== 'test') throw new Error('Public oracle runner supports test only; dependencies must already be frozen')
verifyFrozenPublicOracle()
const apiTests = files(`${root}/api/test`).filter(path => path.endsWith('.test.js'))
if (!apiTests.length) throw new Error('Public oracle API test inventory is empty')
await run(['mise', 'exec', 'node@22', '--', 'node', '--test', '--test-concurrency=1', ...apiTests])
for (const pkg of ['frontend', 'mcp']) {
  await run(['bun', '--bun', 'vitest', 'run', '--allowOnly=false', '--maxWorkers=1', '--root', `${root}/${pkg}`])
}
