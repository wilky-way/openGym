import { expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { files } from '../files'

it('N4 forbids exclusive tests in every mutable Vitest config and the frozen oracle runner', () => {
  const configs = files('.').filter(file => !file.startsWith('legacy/') && !file.startsWith('packages/parity/fixtures/oracle/') && /(?:vitest|vite)\.config\.[jt]s$/.test(file))
  for (const file of configs) {
    const source = readFileSync(file, 'utf8')
    if (/\btest\s*:/.test(source)) expect(source, file).toMatch(/\ballowOnly\s*:\s*false\b/)
  }
  expect(readFileSync('scripts/legacy.ts', 'utf8')).toContain("'--allowOnly=false'")
})

it('N4 a same-file it.only cannot hide a failing test with CI unset', () => {
  mkdirSync('.gate', { recursive: true })
  const root = mkdtempSync(resolve('.gate/only-'))
  try {
    writeFileSync(join(root, 'probe.test.ts'), "import {it,expect} from 'vitest';it.only('focused',()=>expect(1).toBe(1));it('hidden failure',()=>expect(1).toBe(2))")
    writeFileSync(join(root, 'vitest.config.ts'), `import config from ${JSON.stringify(resolve('scripts/vitest.config.ts'))}; export default {...config,test:{...config.test,include:[${JSON.stringify(join(root, 'probe.test.ts'))}]}}`)
    const child = Bun.spawnSync(['bun', '--bun', 'vitest', 'run', '--config', join(root, 'vitest.config.ts')], { env: { ...process.env, CI: '' }, stdout: 'pipe', stderr: 'pipe' })
    expect(child.exitCode).not.toBe(0)
    expect(new TextDecoder().decode(child.stderr)).toContain('[Vitest] Unexpected .only modifier')
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30_000)
