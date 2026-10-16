import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

// Keep package scripts, their node shebangs and nested Bun commands on the same
// executable as the packaging driver. Never infer compiler provenance from PATH.
export async function withHostingToolchain<T>(
  root: string,
  build: (toolchain: { version: string; run: (args: string[]) => void }) => Promise<T>,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const pin = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager
  if (pin !== `bun@${Bun.version}`) throw new Error(`Hosting packaging requires ${pin}; driver is bun@${Bun.version}`)
  const executable = realpathSync(process.execPath)
  const actual = JSON.parse(execFileSync(executable, ['--eval', 'console.log(JSON.stringify({version:Bun.version,executable:process.execPath}))'], { encoding: 'utf8', env: environment }))
  if (actual.version !== Bun.version || realpathSync(actual.executable) !== executable) throw new Error('Hosting compiler executable/version does not match the packaging driver')
  const bin = mkdtempSync(join(tmpdir(), 'opengym-hosting-toolchain-'))
  try {
    for (const command of ['bun', 'node']) symlinkSync(executable, join(bin, command))
    const env = { ...environment, PATH: bin + delimiter + (environment.PATH ?? '') }
    return await build({
      version: actual.version,
      run: args => { execFileSync(executable, args, { cwd: root, env, stdio: 'inherit' }) },
    })
  } finally { rmSync(bin, { recursive: true, force: true }) }
}
