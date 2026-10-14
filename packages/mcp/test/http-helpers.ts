import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { directFetch, type Fetcher } from '../src/http-client'
export async function target(state: any, library: any[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-http-')), nonce = randomUUID()
  writeFileSync(join(dir, 'input.json'), JSON.stringify({ state, library, nonce }), { mode: 0o600 })
  const child = spawn(process.execPath, [join(import.meta.dirname, 'fixtures/http-target.ts'), dir], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', chunk => stderr += chunk)
  try {
    const ready = await new Promise<{ api: string; token: string; nonce: string }>((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error('test target startup timeout: ' + stderr)), 10000)
      child.once('error', err => { clearTimeout(timer); reject(err) })
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`test target exited ${code}: ${stderr}`)) })
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('\n')) { clearTimeout(timer); try { resolve(JSON.parse(output.split('\n')[0]!)) } catch (e) { reject(e) } } })
    })
    if (ready.nonce !== nonce || !/^http:\/\/127\.0\.0\.1:\d+$/.test(ready.api) || ['19357', '19443'].includes(new URL(ready.api).port)) throw new Error('invalid synthetic test identity')
    const identity = await directFetch(ready.api + '/__m01_identity', { method: 'GET' })
    if (identity.headers && [...identity.headers.keys()].some(key => key.startsWith('tailscale-'))) throw new Error('Tailscale answered a synthetic request')
    if ((await identity.json() as any).nonce !== nonce) throw new Error('synthetic server identity mismatch')
    const env = { OPENGYM_URL: ready.api, OPENGYM_UID: 'test-uid', OPENGYM_TOKEN: ready.token, OPENGYM_ENABLE_PROGRAMME_WRITES: '1' }
    const calls: { path: string; method: string; body?: any }[] = []
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ path: new URL(url).pathname, method: init.method || 'GET', ...(init.body ? { body: JSON.parse(String(init.body)) } : {}) })
      const response = await directFetch(url, init)
      if (response.headers && [...response.headers.keys()].some(key => key.startsWith('tailscale-'))) throw new Error('Tailscale answered a synthetic request')
      return response
    }
    const request = async (method: string, path: string, body?: any) => {
      const res = await fetcher(ready.api + path, { method, headers: { Authorization: 'Bearer ' + ready.token, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
      return { status: res.status, body: await res.json() as any }
    }
    return { ...ready, env, calls, request, fetcher, close: async () => {
      if (child.exitCode === null) { const exited = new Promise<void>(resolve => child.once('exit', () => resolve())); child.kill('SIGTERM'); await exited }
      rmSync(dir, { recursive: true, force: true })
    } }
  } catch (e) { child.kill('SIGTERM'); rmSync(dir, { recursive: true, force: true }); throw e }
}
