import { expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { withHostingToolchain } from '../hosting-toolchain'

it('compiles and runs package scripts with the driver despite conflicting bun and node on PATH', async () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-hosting-path-'))
  const wrong = join(root, 'wrong-runtime')
  try {
    const hostile = join(root, 'hostile')
    mkdirSync(hostile)
    for (const name of ['bun', 'node']) writeFileSync(join(hostile, name), `#!/bin/sh\necho ${name} >> '${wrong}'\nexit 93\n`, { mode: 0o700 })
    const env = { ...process.env, PATH: hostile + delimiter + (process.env.PATH ?? '') }
    // Prove the conflicting commands really would be selected without the runner.
    for (const name of ['bun', 'node']) expect(() => execFileSync(name, ['--version'], { env, stdio: 'pipe' })).toThrow()
    expect(readFileSync(wrong, 'utf8')).toBe('bun\nnode\n')
    rmSync(wrong)
    const pin = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).packageManager
    writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: pin, scripts: { build: 'bun build-script.ts' } }))
    const probe = 'console.log(JSON.stringify({version:Bun.version,executable:process.execPath}))'
    writeFileSync(join(root, 'probe.ts'), probe)
    writeFileSync(join(root, 'shebang.js'), '#!/usr/bin/env node\n' + probe, { mode: 0o700 })
    writeFileSync(join(root, 'build-script.ts'), `
      import {execFileSync} from 'node:child_process'; import {writeFileSync} from 'node:fs';
      execFileSync('bun',['build','--compile','--no-compile-autoload-dotenv','--no-compile-autoload-bunfig','probe.ts','--outfile','compiled'],{stdio:'inherit'});
      for(const [name,command,args] of [['node','node',['probe.ts']],['shebang','./shebang.js',[]],['compiled','./compiled',[]]])
        writeFileSync(name+'.json',execFileSync(command,args));
    `)
    await withHostingToolchain(root, async ({ run, version }) => {
      expect(version).toBe(Bun.version)
      run(['run', '--bun', 'build'])
    }, env)
    expect(existsSync(wrong)).toBe(false)
    for (const name of ['node', 'shebang', 'compiled']) {
      const actual = JSON.parse(readFileSync(join(root, name + '.json'), 'utf8'))
      expect(actual.version, name).toBe(Bun.version)
      if (name !== 'compiled') expect(realpathSync(actual.executable), name).toBe(realpathSync(process.execPath))
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}, 30_000)

it('refuses a driver that does not match the pinned version before running builds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'opengym-hosting-version-'))
  let built = false
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'bun@0.0.0' }))
    await expect(withHostingToolchain(root, async () => { built = true })).rejects.toThrow('requires bun@0.0.0')
    expect(built).toBe(false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
