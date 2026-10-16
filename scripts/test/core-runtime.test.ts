import { it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
it('resolves every native core module through package exports without a legacy fallback', async () => {
  const directory = resolve(import.meta.dirname, '../../packages/core/src')
  for (const file of readdirSync(directory).filter(file => file.endsWith('.ts') && !file.endsWith('.d.ts'))) {
    const stem = file.slice(0, -3)
    expect(Bun.resolveSync(`@opengym/core/${stem}`, resolve('packages/web'))).toBe(resolve(directory, file))
    expect(Bun.resolveSync(`@opengym/core/${stem}.js`, resolve('packages/web'))).toBe(resolve(directory, file))
  }
  for (const config of ['packages/core/vitest.config.ts', 'packages/web/vitest.config.ts']) {
    expect(readFileSync(resolve(config), 'utf8')).not.toContain('legacyCompat')
  }
})
