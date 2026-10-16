import { test, expect, afterEach } from 'bun:test'
import { spawn, execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { fixture, T0, keys, cookie, other } from '../../packages/server/test/notification-helpers'
import { SECRET } from '../../packages/server/test/auth-helpers'
import { scratchDir } from '../../packages/server/test/helpers'

test('Node 22 web-push socket guard refuses parser confusion and numeric literals without opening loopback', () => {
  const dir = scratchDir(), script = join(dir, 'socket-guard.mjs')
  writeFileSync(script, `import assert from 'node:assert/strict';import net from 'node:net';import {createRequire} from 'node:module';
import {createPushGuard} from ${JSON.stringify(resolve('packages/server/src/push-address.ts'))};
const require=createRequire(${JSON.stringify(resolve('packages/server/package.json'))});const webpush=require('web-push');
let hits=0;const target=net.createServer(socket=>{hits++;socket.destroy()});await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
const guard=createPushGuard();try {
  for(const host of ['127.0.0.1%2eexample.com','127.0.0.1','2130706433','0177.0.0.1','0x7f000001','[::ffff:127.0.0.1]']) {
    const endpoint='https://'+host+':'+target.address().port+'/x';
    await assert.rejects(webpush.sendNotification({endpoint,keys:{p256dh:'p',auth:'a'}},null,{agent:guard.agent,timeout:500}),{code:'EPUSHBLOCKED'});
  }
  assert.equal(hits,0);console.log('Node 22: six direct web-push socket attacks blocked; loopback connections = 0');
}finally {guard.agent.destroy();await new Promise(resolve=>target.close(resolve));}`)
  const runtime = Bun.spawnSync(['mise', 'where', 'node@22'])
  expect(runtime.exitCode).toBe(0)
  const output = execFileSync(join(runtime.stdout.toString().trim(), 'bin/node'), ['--experimental-strip-types', script],
    { encoding: 'utf8', timeout: 5000 })
  expect(output).toContain('loopback connections = 0')
})
import { exportAccounts, writeAccountsMirror } from '../../packages/server/src/storage'

async function oracle(accounts: unknown, vapid: unknown, state: unknown) {
  const dir = scratchDir(), pushes = join(dir, 'pushes.jsonl'), nonce = randomBytes(16).toString('hex')
  writeFileSync(join(dir, 'secret'), SECRET, { mode: 0o600 })
  writeFileSync(join(dir, 'vapid.json'), JSON.stringify(vapid), { mode: 0o600 })
  writeFileSync(join(dir, 'db.json'), JSON.stringify(accounts))
  writeFileSync(join(dir, 'state-u_test_1.json'), JSON.stringify(state))
  const preload = join(dir, 'pinned.mjs')
  writeFileSync(preload, `import {createRequire} from 'node:module';import fs from 'node:fs';import net from 'node:net';import http from 'node:http';
const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(port,cb){return listen.call(this,port,'127.0.0.1',cb)};
const emit=http.Server.prototype.emit;http.Server.prototype.emit=function(event,...args){if(event==='request')args[1].setHeader('X-OpenGym-Oracle',${JSON.stringify(nonce)});return emit.call(this,event,...args)};
const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[${T0}]))}static now(){return ${T0}}};
const require=createRequire(${JSON.stringify(resolve('packages/parity/fixtures/oracle/api/package.json'))});const webpush=require('web-push');
webpush.sendNotification=(sub,body)=>{fs.appendFileSync(${JSON.stringify(pushes)},JSON.stringify({endpoint:sub.endpoint,payload:JSON.parse(body)})+'\\n');return Promise.resolve()};
process.stdout.write(${JSON.stringify(nonce + '\n')});`)
  const runtime = Bun.spawnSync(['mise', 'where', 'node@22'])
  if (runtime.exitCode !== 0) throw new Error('Node 22 oracle runtime unavailable')
  const child = spawn(join(runtime.stdout.toString().trim(), 'bin/node'), ['--import', preload, 'server.js'], {
    cwd: resolve('packages/parity/fixtures/oracle/api'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost',
      REMINDER_TICK_MS: '50', AUDIT_LOG: '0', ALLOWED_PRIVATE_IPS: '', ADMIN_UIDS: '', FIRST_USER_ADMIN: '0', DEVICE_TOKENS: '0' },
  })
  const exited = new Promise<void>(r => { child.once('exit', () => r()); child.once('error', () => r()) })
  afterEach(async () => { child.kill('SIGTERM'); await exited })
  const port = await new Promise<number>((res, reject) => {
    let log = ''
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('oracle readiness timeout')) }, 5000)
    const read = (data: Buffer) => {
      log += data
      const match = /gym-api on :(\d+)/.exec(log)
      if (match && log.includes(nonce)) { clearTimeout(timeout); res(Number(match[1])) }
    }
    child.stdout.on('data', read); child.stderr.on('data', read)
    child.once('error', e => { clearTimeout(timeout); reject(e) })
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('oracle exited: ' + log)) })
  })
  return { api: `http://127.0.0.1:${port}`, nonce, pushes: () => existsSync(pushes) ? readFileSync(pushes, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [],
    accounts: () => JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8')) }
}
const request = async (base: string, method: string, route: string, body?: unknown, headers: HeadersInit = cookie, nonce?: string) => {
  const r = await fetch(base + route, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  if ([...r.headers.keys()].some(k => k.startsWith('tailscale-'))) throw new Error('oracle hygiene: tailscale response')
  if (nonce && r.headers.get('x-opengym-oracle') !== nonce) throw new Error('oracle identity nonce mismatch')
  return { status: r.status, body: await r.text() }
}
test('pinned HTTP push transcript matches the Node 22 server oracle byte for byte', async () => {
  const h = fixture(); h.write({ workouts: [], routines: [] })
  writeAccountsMirror(h.store.db, h.dataDir)
  const old = await oracle(exportAccounts(h.store.db), h.notifications.push.vapid, { workouts: [], routines: [] })
  for (const [method, route, body, headers] of [
    ['GET', '/api/push/public-key', undefined, {}], ['GET', '/api/push/status?endpoint=x', undefined, {}],
    ['POST', '/api/push/subscribe', {}, cookie], ['POST', '/api/push/subscribe', { subscription: { endpoint: 'https://127.0.0.1/x', keys } }, cookie],
    ['POST', '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/x', keys }, deviceId: 'dev_phone000' }, cookie],
    ['GET', '/api/push/status?endpoint=https%3A%2F%2Fpush.example%2Fx', undefined, cookie],
    ['GET', '/api/push/status?endpoint=https%3A%2F%2Fpush.example%2Fx', undefined, other],
    ['POST', '/api/push/rest-timer', {}, cookie], ['POST', '/api/push/rest-timer', { seconds: '4000', deviceId: 'dev_phone000' }, cookie],
    ['POST', '/api/push/rest-timer/cancel', { deviceId: 'dev_phone000' }, cookie],
    ['POST', '/api/activity', { active: true, name: 'Synthetic', startedAt: T0 }, cookie],
    ['POST', '/api/activity', { active: false, reason: 'hidden' }, cookie],
    ['POST', '/api/push/test', undefined, cookie], ['POST', '/api/push/unsubscribe', { endpoint: 'https://push.example/x' }, cookie],
  ] as const) expect(await request(h.api, method, route, body, headers)).toEqual(await request(old.api, method, route, body, headers, old.nonce))
  expect(h.sent.map(x => ({ endpoint: x.sub.endpoint, payload: x.body }))).toEqual(old.pushes())
}, 15000)
test('pinned reminder and nudge payload/once-per-date transcripts match the Node 22 tick', async () => {
  for (const [time, nudge, tag] of [['20:02', false, 'day-reminder'], ['08:00', true, 'nudge']] as const) {
    const h = fixture([{ userId: 'u_test_1', endpoint: 'https://push.example/x', keys }])
    const state = { lang: 'en', reminder: { on: true, time, tz: 'UTC', nudge, tone: 'drill' },
      routines: [{ id: 'r1', name: 'Synthetic', emoji: '💪' }], week: { 1: 'r1' },
      workouts: [{ id: 'w1', d: '2026-09-06', routineId: 'r1' }] }
    h.write(state); writeAccountsMirror(h.store.db, h.dataDir)
    const old = await oracle(exportAccounts(h.store.db), h.notifications.push.vapid, state)
    await h.tick(); await h.tick()
    for (let i = 0; i < 100 && !old.pushes().length; i++) await Bun.sleep(10)
    expect(h.sent.length).toBe(1)
    expect(h.sent[0].body.tag).toBe(tag)
    expect(h.sent.map(x => ({ endpoint: x.sub.endpoint, payload: x.body }))).toEqual(old.pushes())
    const key = nudge ? 'lastNudge' : 'lastReminder'
    expect(h.db().users[0][key]).toBe('2026-09-07')
    expect(h.db().users[0][key]).toBe(old.accounts().users[0][key])
  }
}, 15000)
