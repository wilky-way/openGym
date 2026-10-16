import { test, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { publicTree } from '../check-docker-payload'

test('every copied tree rejects server credentials and data at any depth', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opengym-payload-'))
  try {
    for (const tree of ['packages', 'api', 'web', 'dist', 'catalogue']) {
      const root = join(dir, tree), nested = join(root, 'nested')
      mkdirSync(nested, { recursive: true })
      writeFileSync(join(nested, 'public.js'), 'synthetic')
      expect(() => publicTree(root)).not.toThrow()
      for (const name of ['vapid.json', 'secret', 'tls.pem', 'tls.key', '.env', '.env.production', 'db.json', 'db.json.bak', 'state-synthetic.json', 'opengym.db', 'opengym.db-wal', 'opengym.db-shm', 'secret.123.abcdef123456.tmp', 'vapid.json.123.abcdef123456.tmp', 'state-synthetic.json.123.abcdef123456.tmp']) {
        for (const parent of [root, nested]) {
          const file = join(parent, name)
          writeFileSync(file, 'synthetic private payload')
          try { expect(() => publicTree(root)).toThrow('non-public build input: ' + file) }
          finally { rmSync(file) }
        }
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('check-docker refuses a stray vapid.json or secret before building a public context', async () => {
  const root = resolve(import.meta.dirname, '../..'), dir = mkdtempSync(join(tmpdir(), 'opengym-stray-'))
  try {
    writeFileSync(join(dir, 'index.html'), '<html>synthetic</html>')
    mkdirSync(join(dir, 'assets'))
    for (const name of ['vapid.json', 'secret', 'secret.123.abcdef123456.tmp', 'vapid.json.123.abcdef123456.tmp', 'state-synthetic.json.123.abcdef123456.tmp']) {
      const file = join(dir, 'assets', name)
      writeFileSync(file, 'synthetic credential')
      try {
        const child = Bun.spawn(['bun', 'scripts/check-docker.ts', '--check-context', '--web-dist', dir], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
        expect(await child.exited).not.toBe(0)
        expect(await new Response(child.stderr).text()).toContain('non-public build input: ' + file)
      } finally { rmSync(file) }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('dockerignore independently excludes credentials after all public-tree inclusions', () => {
  const rules = readFileSync(resolve(import.meta.dirname, '../../.dockerignore'), 'utf8').trim().split('\n')
  const lastInclude = rules.findLastIndex(rule => rule.startsWith('!'))
  for (const rule of ['**/vapid.json', '**/vapid.json.*', '**/secret', '**/secret.*', '**/*.pem', '**/*.key', '**/.env*', '**/db.json*', '**/state-*.json', '**/state-*.json.*', '**/opengym.db*']) {
    expect(rules.indexOf(rule)).toBeGreaterThan(lastInclude)
  }
})
