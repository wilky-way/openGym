#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import { readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import {readPrivateJSON} from './private-json.mjs'
const repo = resolve(import.meta.dir, '../../..')
const child = spawn(process.execPath, [join(import.meta.dir, 'I01.mjs'), '--legacy-only'], { cwd: repo, stdio: ['ignore', 'ignore', 'pipe'] })
const exited = new Promise(resolve => child.once('exit', resolve))
let errors = ''; child.stderr.on('data', bytes => { errors += bytes })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let root
try {
  const deadline = performance.now() + 15000
  while (!root && performance.now() < deadline) {
    assert.equal(child.exitCode, null, errors)
    const dirs = await readdir('/private/tmp', { withFileTypes: true })
    for (const dir of dirs.filter(d => d.isDirectory() && d.name.startsWith('opengym-I01-'))) {
      const candidate = join('/private/tmp', dir.name)
      const rows = await readPrivateJSON(join(candidate, 'pids.json'), {timeoutMs: 100}).catch(error => {
        if (error instanceof SyntaxError || error?.code === 'ENOENT') return []
        throw error
      })
      if (rows.some(r => r.label === 'I01 harness' && r.pid === child.pid) && rows.some(r => r.label === 'legacy production build')) { root = candidate; break }
    }
    if (!root) await pause(25)
  }
  assert(root, 'owned build PID was recorded before interruption')
  child.kill('SIGTERM')
  const code = await Promise.race([exited, pause(15000).then(() => { throw new Error('interrupted harness did not exit') })])
  assert.equal(code, 1)
  const records = await readPrivateJSON(join(root, 'pids.json'))
  assert(records.every(r => r.stopped), 'all processes report stopped')
  for (const record of records) assert.throws(() => process.kill(record.pid, 0), { code: 'ESRCH' }, 'owned PID is no longer running')
  await writeFile(join(repo, 'packages/parity/.artifacts/I01/interruption.json'), JSON.stringify({ scenario: 'SIGTERM during production build', exitCode: code, allRecordedProcessesStopped: true, records }, null, 2) + '\n', { mode: 0o600 })
  console.log('I01 interruption cleanup: PASS')
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await Promise.race([exited, pause(5000)])
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }
  }
}
