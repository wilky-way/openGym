import { afterEach, test, expect } from 'bun:test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { startAdmin, ADMIN, VICTIM, as } from '../../packages/server/test/admin-helpers'
import { CLOCK, SECRET } from '../../packages/server/test/auth-helpers'
import { scratchDir } from '../../packages/server/test/helpers'

async function oracle(accounts: unknown) {
  const dir = scratchDir()
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 })
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(accounts))
  fs.writeFileSync(path.join(dir, 'state-' + VICTIM + '.json'), JSON.stringify({ _rev: 3, unit: 'kg', workouts: [] }))
  const preload = path.join(dir, 'fakedate.mjs')
  fs.writeFileSync(preload, `const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[${CLOCK}]))}static now(){return ${CLOCK}}};`)
  const runtime = Bun.spawnSync(['mise', 'where', 'node@22'])
  if (runtime.exitCode !== 0) throw Error('Node 22 oracle runtime unavailable')
  const child = spawn(path.join(runtime.stdout.toString().trim(), 'bin/node'), ['--import', preload, 'server.js'], {
    cwd: new URL('../../packages/parity/fixtures/oracle/api/', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost',
      AUDIT_LOG: '1', AUDIT_IP: 'off', AUDIT_MAX: '5000', AUDIT_DAYS: '90', INVITE_ONLY: '0',
      FIRST_USER_ADMIN: '0', ADMIN_UIDS: '', DEVICE_TOKENS: '0', PASSWORD_LOGIN: '0' },
  })
  const exited = new Promise<void>(resolve => { child.once('exit', () => resolve()); child.once('error', () => resolve()) })
  afterEach(async () => { child.kill('SIGTERM'); await exited })
  const port = await new Promise<number>((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('oracle readiness timeout: ' + output)) }, 5000)
    child.stdout.on('data', data => { output += data; const found = /gym-api on :(\d+)/.exec(output); if (found) { clearTimeout(timer); resolve(+found[1]!) } })
    child.stderr.on('data', data => { output += data })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', () => { clearTimeout(timer); reject(Error('oracle exited: ' + output)) })
  })
  return 'http://127.0.0.1:' + port
}

test('nine-route HTTP transcripts match Node 22 legacy oracle, including JSON key order', async () => {
  const h = startAdmin(), old = await oracle(h.db())
  const codes = new Map<string, string>()
  const normal = (body: unknown): unknown => {
    if (typeof body === 'string') return codes.get(body) ?? body
    if (Array.isArray(body)) return body.map(normal)
    if (body && typeof body === 'object') return Object.fromEntries(Object.entries(body).map(([k, v]) => [k, normal(v)]))
    return body
  }
  const request = async (base: string, method: string, route: string, body?: unknown, actor = ADMIN) => {
    const r = await fetch(base + route, { method, headers: as(actor), ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: r.status, body: await r.json() }
  }
  const transcript: unknown[] = []
  const same = async (method: string, route: string, body?: unknown, actor = ADMIN) => {
    const legacy = await request(old, method, route, body, actor), port = await request(h.api, method, route, body, actor)
    transcript.push({ method, route, ...(body === undefined ? {} : { body }), actor, response: normal(legacy) })
    expect(port).toEqual(legacy)
    expect(JSON.stringify(port)).toBe(JSON.stringify(legacy))
  }
  await same('GET', '/api/admin/users')
  await same('GET', '/api/admin/user?id=' + VICTIM)
  await same('GET', '/api/admin/user?id=missing')
  await same('GET', '/api/admin/users', undefined, VICTIM)
  await same('POST', '/api/admin/user/disable', { id: ADMIN, disabled: true })
  await same('POST', '/api/admin/user/disable', { id: VICTIM, disabled: true })
  await same('POST', '/api/admin/user/disable', { id: VICTIM, disabled: false })
  await same('GET', '/api/admin/invites')
  const l = await request(old, 'POST', '/api/admin/invites/new', { note: 'synthetic guest' })
  const n = await request(h.api, 'POST', '/api/admin/invites/new', { note: 'synthetic guest' })
  codes.set(l.body.invite.code, '<invite>'); codes.set(n.body.invite.code, '<invite>')
  transcript.push({ method: 'POST', route: '/api/admin/invites/new', body: { note: 'synthetic guest' }, actor: ADMIN, response: normal(l) })
  expect(normal(n)).toEqual(normal(l))
  expect(JSON.stringify(normal(n))).toBe(JSON.stringify(normal(l)))
  const lr = await request(old, 'POST', '/api/admin/invites/revoke', { code: l.body.invite.code.toLowerCase() })
  const nr = await request(h.api, 'POST', '/api/admin/invites/revoke', { code: n.body.invite.code.toLowerCase() })
  transcript.push({ method: 'POST', route: '/api/admin/invites/revoke', body: { code: '<invite>' }, actor: ADMIN, response: lr })
  expect(nr).toEqual(lr)
  await same('POST', '/api/admin/invites/revoke', { code: 'code1' })
  await same('POST', '/api/admin/user/delete', { id: ADMIN })
  await same('POST', '/api/admin/user/delete', { id: VICTIM })
  await same('GET', '/api/admin/invites')
  for (const route of ['/api/admin/audit', '/api/admin/audit?cat=fail', '/api/admin/audit?cat=admin&limit=2&before=5']) {
    const legacy = normal(await request(old, 'GET', route)), port = normal(await request(h.api, 'GET', route))
    transcript.push({ method: 'GET', route, actor: ADMIN, response: legacy })
    expect(port).toEqual(legacy)
    expect(JSON.stringify(port)).toBe(JSON.stringify(legacy))
  }
  await same('POST', '/api/admin/audit/clear')
  await same('GET', '/api/admin/audit')
  fs.writeFileSync(new URL('../../packages/server/test/fixtures/admin-transcript.json', import.meta.url), JSON.stringify(transcript, null, 2) + '\n')
}, 15000)
