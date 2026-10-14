import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { createHmac } from 'node:crypto'
import { openStore, putUser } from '../src/storage'
import { user } from './helpers'

test('compiled binary boots without source, embeds migrations, persists a PUT/GET and serves static dist', async () => {
  const root = resolve(import.meta.dir, '../../..'), dir = mkdtempSync(join(tmpdir(), 'opengym-binary-'))
  let process: ReturnType<typeof Bun.spawn> | undefined
  try {
    const binary = join(dir, 'opengym-server'), meta = join(dir, 'inputs.json')
    const build = Bun.spawn(['bun', 'build', '--compile', '--minify', '--sourcemap=none', '--no-compile-autoload-dotenv', '--no-compile-autoload-bunfig', '--metafile=' + meta, 'packages/server/src/cli/serve.ts', '--outfile', binary], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    expect(await build.exited).toBe(0)
    const inputs = Object.keys(JSON.parse(readFileSync(meta, 'utf8')).inputs)
    expect(inputs.some(name => /^legacy\/|^packages\/[^/]+\/(tests?|private)\/|\.test\./.test(name))).toBe(false)
    expect(inputs.some(name => name.endsWith('0001_init.sql'))).toBe(true)
    for (const value of ['0', 'false', 'NO', 'Off', '', 'typo']) {
      const refusedDir = join(dir, 'refused-' + (value || 'empty'))
      const refused = Bun.spawn([binary, '--data-dir', refusedDir, '--port', '0', '--host', '127.0.0.1'], {
        cwd: dir, env: { PATH: '', EXPOSURE: 'public', ORIGIN: 'https://gym.example', DEVICE_TOKENS: value }, stdout: 'pipe', stderr: 'pipe',
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const code = await Promise.race([refused.exited, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('public binary did not refuse startup')), 3000)
        })])
        expect(code).not.toBe(0)
        expect(await new Response(refused.stderr).text()).toContain('EXPOSURE=public requires DEVICE_TOKENS')
        expect(existsSync(refusedDir)).toBe(false)
      } finally {
        clearTimeout(timer)
        if (refused.exitCode === null) { refused.kill(); await refused.exited }
      }
    }
    writeFileSync(join(dir, '.env'), 'EXPOSURE=public\nFIRST_USER_ADMIN=1\n')
    const dist = join(dir, 'dist'); mkdirSync(dist)
    writeFileSync(join(dist, 'index.html'), '<html>synthetic compiled dist</html>')
    process = Bun.spawn([binary, '--data-dir', join(dir, 'data'), '--port', '0', '--host', '127.0.0.1', '--static-dir', dist], { cwd: dir, env: { PATH: '', ORIGIN: 'http://localhost:8080' }, stdout: 'pipe', stderr: 'pipe' })
    const reader = (process.stdout as ReadableStream<Uint8Array>).getReader()
    let timer: ReturnType<typeof setTimeout> | undefined
    const boot = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('binary boot timeout')), 10000) })]).finally(() => clearTimeout(timer))
    const port = Number(new TextDecoder().decode(boot.value).match(/gym-api on :(\d+)/)?.[1])
    expect(port).toBeGreaterThan(0)
    const request = (path: string, method = 'GET', body?: object, token?: string) => new Promise<{ status: number; body: string }>((done, fail) => {
      const r = httpRequest({ host: '127.0.0.1', port, path, method, agent: false, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } }, response => {
        let text = ''; response.on('data', chunk => text += chunk); response.on('end', () => done({ status: response.statusCode!, body: text }))
      }); r.on('error', fail); r.end(body ? JSON.stringify(body) : undefined)
    })
    expect((await request('/api/health')).status).toBe(200)
    expect(existsSync(join(dir, 'data', 'opengym.db'))).toBe(true)
    const store = openStore(join(dir, 'data')); putUser(store.db, user('binary-synthetic')); store.close()
    const payload = 'binary-synthetic:' + (Date.now() + 60000) + ':0'
    const token = payload + '.' + createHmac('sha256', readFileSync(join(dir, 'data', 'secret'), 'utf8').trim()).update(payload).digest('base64url')
    expect((await request('/api/data', 'PUT', { baseRev: 0, state: { _ts: 123, workouts: [{ id: 'binary-workout', d: '2026-10-01' }], routines: [] } }, token)).status).toBe(200)
    expect(JSON.parse((await request('/api/data', 'GET', undefined, token)).body).state.workouts[0].id).toBe('binary-workout')
    // A migrated v1 bearer may authenticate, but a default boot issues only v2 sessions.
    const code = JSON.parse((await request('/api/pair/create', 'POST', {}, token)).body).code
    const paired = await request('/api/pair/redeem', 'POST', { code })
    expect(paired.status).toBe(200)
    const deviceToken = JSON.parse(paired.body).token
    expect(deviceToken).toStartWith('v2.')
    expect((await request('/api/me', 'GET', undefined, deviceToken)).status).toBe(200)
    expect((await request('/')).body).toContain('synthetic compiled dist')
    expect((await request('/api/not-a-route')).status).toBe(404)
    process.kill('SIGTERM'); expect(await process.exited).toBe(0); process = undefined
  } finally { if (process) { process.kill(); await process.exited }; rmSync(dir, { recursive: true, force: true }) }
}, 30000)
