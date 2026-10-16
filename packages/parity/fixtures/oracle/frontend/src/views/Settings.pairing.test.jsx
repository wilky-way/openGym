// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac, randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { boundPort } from '../../../api/test/helpers.mjs'
import { api, configureApiConnection } from '../lib/api.js'
import { apiConnection } from '../lib/api-connection.js'
import { connect, forgetRemote, renewToken } from '../lib/remote.js'
import { searchSettings } from './settings-pages.js'
import Settings from './Settings.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const state = vi.hoisted(() => ({ user: { id: 'pair_ui_user', name: 'Synthetic pairing user' }, openSheet: null }))
vi.mock('../store/useStore.js', () => {
  const snapshot = () => ({ S: { workouts: [], routines: [], exWeights: {}, sound: false }, user: state.user,
    config: {}, sync: null, update: () => {}, keptChanges: async () => [] })
  const useStore = selector => selector ? selector(snapshot()) : snapshot()
  useStore.getState = snapshot
  return { useStore, DEF: {}, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const snapshot = () => ({ toast: () => {}, openSheet: (...args) => state.openSheet(...args) })
  const useUI = selector => selector ? selector(snapshot()) : snapshot()
  useUI.getState = snapshot
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../lib/push.js', () => ({ pushSupported: () => false }))
vi.mock('../lib/wakelock.js', () => ({ wakeLockSupported: () => false }))
vi.mock('../lib/demo.js', () => ({ DEMO: false, REPO: '' }))
vi.mock('../sheets.jsx', () => ({ starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), importFromApp: vi.fn(), importFromHevy: vi.fn(), equipmentProfileSheet: vi.fn(), menuSheet: vi.fn() }))

let child, dataDir, base, cookie
const mounted = [], calls = []
let authenticated = true
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const title = 'Pair an agent or device'
const row = host => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)

beforeAll(async () => {
  const secret = randomBytes(32).toString('hex')
  dataDir = mkdtempSync(join(tmpdir(), 'opengym-pair-ui-'))
  writeFileSync(join(dataDir, 'secret'), secret, { mode: 0o600 })
  writeFileSync(join(dataDir, 'db.json'), JSON.stringify({ users: [state.user], creds: [], subs: [], invites: [] }))
  const payload = `${state.user.id}:${Date.now() + 86400000}:0`
  cookie = `gymsid=${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
  child = spawn(process.execPath, ['server.js'], {
    cwd: resolve(process.cwd(), '../api'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost' },
  })
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  base = `http://127.0.0.1:${await boundPort(child, () => log)}`
}, 25000)

afterAll(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL') })
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

beforeEach(() => {
  state.user = { id: 'pair_ui_user', name: 'Synthetic pairing user' }
  authenticated = true
  calls.length = 0
  configureApiConnection({ baseUrl: base })
  // Real HTTP to a disposable server: only creation gets the test session. Redemption
  // and /api/me must work with the new bearer alone. No endpoints are mocked.
  vi.stubGlobal('fetch', (url, init = {}) => new Promise((resolve, reject) => {
    const headers = { ...init.headers }
    if (authenticated && String(url).endsWith('/api/pair/create')) headers.Cookie = cookie
    calls.push({ url: String(url), headers })
    const req = request(url, { method: init.method || 'GET', headers }, res => {
      let body = ''
      res.on('data', d => { body += d })
      res.on('end', () => resolve(new Response(body, { status: res.statusCode, headers: res.headers })))
    })
    req.on('error', reject)
    if (init.body) req.write(init.body)
    req.end()
  }))
})
afterEach(() => {
  act(() => mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }))
  forgetRemote()
  vi.unstubAllGlobals()
})

describe('Settings pairing through the real API', () => {
  it('clicks the account row, displays a real code, redeems it, and authenticates /api/me', async () => {
    const account = mount(<Settings page="account" />)
    let sheet
    const close = vi.fn()
    state.openSheet = render => { sheet = mount(render(close)) }
    expect(searchSettings('pair agent', { user: state.user }).some(h => h.title === title)).toBe(true)
    act(() => row(account).click())
    await vi.waitFor(async () => {
      await act(() => new Promise(r => setTimeout(r, 0)))
      expect(sheet.querySelector('.card')?.textContent).toMatch(/^[A-Z2-9]{8}$/)
    })
    expect(sheet.querySelector('h3').textContent).toBe(title)
    expect(sheet.textContent).toContain('5 minutes and works once')
    const code = sheet.querySelector('.card').textContent
    expect((await connect(base, ` ${code} `)).id).toBe(state.user.id)
    const token = apiConnection().token
    expect(token).toBeTruthy()
    expect((await api('/api/me')).user.id).toBe(state.user.id)
    expect(calls.find(c => c.url.endsWith('/api/pair/redeem')).headers).not.toHaveProperty('Cookie')
    expect(calls.find(c => c.url.endsWith('/api/me')).headers).toMatchObject({ Authorization: `Bearer ${token}` })
    await expect(connect(base, code)).rejects.toMatchObject({ status: 400, code: 'pair-invalid' })
    renewToken({ base }, token)
    expect((await api('/api/me')).user.id).toBe(state.user.id)
    act(() => [...sheet.querySelectorAll('button')].find(b => b.textContent === 'Done').click())
    expect(close).toHaveBeenCalledOnce()
    forgetRemote()
    expect(apiConnection().token).toBeNull()
  })

  it('shows a server refusal in the sheet instead of a pairing code', async () => {
    authenticated = false
    const account = mount(<Settings page="account" />)
    let sheet
    state.openSheet = render => { sheet = mount(render(() => {})) }
    act(() => row(account).click())
    await vi.waitFor(async () => {
      await act(() => new Promise(r => setTimeout(r, 0)))
      expect(sheet.querySelector('.dim')?.textContent).toBeTruthy()
    })
    expect(sheet.querySelector('.card')).toBeNull()
  })

  it('offers no code creation or pairing search result to a guest', () => {
    state.user = null
    const account = mount(<Settings page="account" />)
    expect(row(account)).toBeUndefined()
    expect(searchSettings('pair agent', { user: null }).some(h => h.title === title)).toBe(false)
    expect(calls.some(c => c.url.endsWith('/api/pair/create'))).toBe(false)
  })
})
