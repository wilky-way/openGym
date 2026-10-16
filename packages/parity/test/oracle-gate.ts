/** Extra F2 gate: the untouched legacy data/stamping scenarios on pinned Node 22. */
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PINNED_NOW } from '../src/synthetic'
const cwd = fileURLToPath(new URL('../fixtures/oracle/api/', import.meta.url))
const clock = new URL('../src/fakedate.mjs', import.meta.url).href
const loopback = new URL('../../../scripts/corpus-loopback.mjs', import.meta.url).href
const tests = ['server-data-rev', 'server-data-rev-endpoint', 'server-data-wid', 'server-data-reset', 'sync-stamps'].map(name => `test/${name}.test.js`)
// NODE_OPTIONS carries the preload to the legacy tests' child server processes too.
const node = (await promisify(execFile)('mise', ['which', 'node', '--tool=node@22.23.3'])).stdout.trim()
const home = await mkdtemp(join(tmpdir(), 'opengym-parity-gate-home-'))
try {
  await chmod(home, 0o700)
  const child = spawn(node, ['--test', '--test-concurrency=1', ...tests], {
    cwd, stdio: 'inherit', env: { PATH: process.env.PATH, HOME: home, TZ: 'UTC', OPENGYM_CORPUS_HARNESS: 'synthetic-node-recording-v1', NODE_OPTIONS: `--import=${clock} --import=${loopback}`, PARITY_NOW: String(PINNED_NOW) }
  })
  const code = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)) })
  if (code !== 0) throw new Error(`Legacy F2 oracle scenarios failed (${code})`)
} finally { await rm(home, { recursive: true, force: true }) }
