import { readdirSync } from 'node:fs'
import { join } from 'node:path'
export function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', '.git', '.gate', 'coverage'].includes(e.name)) return []
    if (e.isSymbolicLink()) throw new Error(`Symlink is forbidden in checked source: ${join(dir, e.name)}`)
    return e.isDirectory() ? files(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []
  })
}
export async function run(argv: string[], cwd = '.', env: Record<string, string | undefined> = {}) {
  const p = Bun.spawn(argv, { cwd, env: { ...process.env, ...env }, stdout: 'inherit', stderr: 'inherit' })
  if (await p.exited !== 0) throw new Error(`Command failed: ${argv.join(' ')} (${cwd})`)
}
