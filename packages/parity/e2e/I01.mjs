#!/usr/bin/env bun
// agent-browser owns every user interaction. Raw CDP is used only for the virtual
// passkey, isolated device contexts and deterministic clock/timezone setup,
// never for clicking, app navigation or storage.
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer, request } from 'node:http'
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm, readdir } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { Database } from 'bun:sqlite'
import { NOW, definition, fixture } from './fixture.mjs'
import { normalizeE2E, e2eDifferences } from '../src/e2e-compare.ts'
import {writePrivateJSON as privateJSON} from './private-json.mjs'

const exec = promisify(execFile), repo = resolve(import.meta.dir, '../../..')
const evidence = resolve(process.env.I01_EVIDENCE || join(repo, 'packages/parity/.artifacts/I01'))
const scratch = await mkdtemp('/private/tmp/opengym-I01-')
await chmod(scratch, 0o700)
process.umask(0o077)
const bun = process.execPath
const node = (await exec('mise', ['which', 'node', '--tool=node@22.23.3'])).stdout.trim()
const baseEnv = Object.fromEntries(['PATH', 'TMPDIR', 'TZ'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
const children = [], sockets = [], fronts = [], records = [], results = {}, storedBytes = {}
records.push({ label: 'I01 harness', pid: process.pid })
let cliSession
const pause = ms => new Promise(r => setTimeout(r, ms))
await mkdir(evidence, { recursive: true })
const bounded = async (predicate, description, timeout = 20000) => {
  const start = performance.now()
  while (performance.now() - start < timeout) { const value = await predicate(); if (value) return value; await pause(150) }
  throw new Error('Timed out: ' + description)
}
function http(port, path, method = 'GET', body, headers = {}) {
  const raw = body === undefined ? undefined : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, agent: false, headers: { ...headers, ...(raw ? { 'Content-Length': raw.length, 'Content-Type': 'application/json' } : {}) } }, res => {
      const chunks = []
      res.on('data', b => chunks.push(b)); res.on('error', reject)
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks) }))
    })
    req.setTimeout(15000, () => req.destroy(new Error('HTTP timeout')))
    req.on('error', reject); req.end(raw)
  })
}
function child(command, args, options, label) {
  const proc = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  proc.stdout.on('data', b => { output += b }); proc.stderr.on('data', b => { output += b })
  proc.on('error', e => { output += e.message })
  children.push(proc); records.push({ label, pid: proc.pid })
  return { proc, output: () => output }
}
async function agent(...args) {
  const { stdout } = await exec('agent-browser', ['--session', cliSession, '--json', ...args], { timeout: 25000, maxBuffer: 4 * 1024 * 1024 })
  const line = stdout.trim().split('\n').findLast(line => line.startsWith('{'))
  const result = JSON.parse(line)
  if (!result.success) throw new Error(`agent-browser ${args[0]}: ${result.error}`)
  return result.data
}
const evaluate = async script => (await agent('eval', script)).result
const state = () => evaluate('JSON.parse(localStorage.getItem("gym_state_v1"))')
const click = async text => {
  const matches = await bounded(async () => {
    const { refs } = await agent('snapshot', '-i', '-c')
    const buttons = Object.entries(refs).filter(([, v]) => v.role === 'button')
    const exact = buttons.filter(([, v]) => v.name === text)
    const matches = exact.length ? exact : buttons.filter(([, v]) => v.name.startsWith(text + ' '))
    return matches.length && matches
  }, `visible button named ${text}`)
  // Confirmation sheets follow their still-accessible background controls.
  matches.sort(([a], [b]) => +a.slice(1) - +b.slice(1))
  return agent('click', '@' + matches.at(-1)[0])
}
const libraryCard = async () => {
  const match = await bounded(async () => {
    const { refs } = await agent('snapshot', '-i', '-c')
    return Object.entries(refs).find(([, v]) => v.role === 'button' && v.name.startsWith(definition.name + ' ') && /\b(Ready|Valid)\b/.test(v.name))
  }, 'synthetic library card')
  await agent('click', '@' + match[0])
}
async function snapshot(name) {
  await pause(600) // let sheet/navigation transitions finish before visual evidence
  const kind = cliSession.split('-')[1]
  await writeFile(join(evidence, `${kind}-${name}.txt`), (await agent('snapshot', '-i', '-c')).snapshot || '', { mode: 0o600 })
  await agent('screenshot', join(evidence, `${kind}-${name}.png`))
}
async function CDP(url) {
  const ws = new WebSocket(url), pending = new Map(); let id = 0
  await new Promise((r, j) => {
    const timer = setTimeout(() => { ws.close(); j(new Error('CDP open timeout')) }, 5000)
    ws.onopen = () => { clearTimeout(timer); r() }; ws.onerror = e => { clearTimeout(timer); j(e) }
  })
  sockets.push(ws)
  ws.onmessage = event => { const value = JSON.parse(event.data); if (value.id) { const entry = pending.get(value.id); pending.delete(value.id); clearTimeout(entry?.timer); value.error ? entry?.reject(new Error(JSON.stringify(value.error))) : entry?.resolve(value.result) } }
  ws.onclose = () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CDP disconnected')) }; pending.clear() }
  return (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id, timer = setTimeout(() => { pending.delete(next); reject(new Error('CDP command timeout: ' + method)) }, 5000)
    pending.set(next, { resolve, reject, timer }); ws.send(JSON.stringify({ id: next, method, params }))
  })
}
async function configurePage(debugPort, tabIndex = 0, targetId) {
  const pages = JSON.parse((await http(debugPort, '/json/list')).raw).filter(p => p.type === 'page')
  const page = targetId ? pages.find(p => p.id === targetId) : pages[tabIndex]
  assert(page, 'CDP page exists')
  const cdp = await CDP(page.webSocketDebuggerUrl)
  await cdp('Page.enable')
  await cdp('Emulation.setTimezoneOverride', { timezoneId: 'America/Chicago' })
  await cdp('Network.enable')
  await cdp('Network.setExtraHTTPHeaders', { headers: { 'x-i01-tab': String(tabIndex) } })
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `{
    const NativeDate=Date; globalThis.__i01now=${NOW};
    globalThis.Date=new Proxy(NativeDate,{construct(t,a,n){return Reflect.construct(t,a.length?a:[globalThis.__i01now],n)},get(t,k){return k==='now'?()=>globalThis.__i01now:Reflect.get(t,k)},apply(){return new NativeDate(globalThis.__i01now).toString()}});
  }` })
  await cdp('WebAuthn.enable')
  const { authenticatorId } = await cdp('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
  return { cdp, authenticatorId }
}
async function runBuild(kind) {
  cliSession = `i01-${kind}-${randomUUID().slice(0, 8)}`
  const root = join(scratch, kind), dataDir = join(root, 'data'), dist = join(root, 'dist'), profile = join(root, 'browser')
  await mkdir(dataDir, { recursive: true, mode: 0o700 }); await mkdir(profile, { mode: 0o700 })
  console.log(`[${kind}] building production bundle`)
  const web = kind === 'legacy' ? 'packages/parity/fixtures/oracle/frontend' : 'packages/web'
  const builder = child(bun, [join(repo, kind === 'legacy' ? web : '', 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist], { cwd: join(repo, web), env: { ...baseEnv, APP_BUILD: 'I01' } }, `${kind} production build`)
  await privateJSON(join(scratch, 'pids.json'), records)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { builder.proc.kill('SIGTERM'); reject(new Error('Production build timeout')) }, 120000)
    builder.proc.once('error', e => { clearTimeout(timer); reject(e) })
    builder.proc.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(builder.output())) })
  })
  let backendPort, hold = false, held = [], conflicts = 0, puts = 0
  const wireCalls = []
  const nonce = randomUUID()
  const forward = async (req, res, raw) => {
    const body = req.method === 'PUT' && req.url === '/api/data' ? JSON.parse(raw) : null
    const wire = body && { tab: req.headers['x-i01-tab'], baseRev: body.baseRev, checkIn: body.state.checkIn, showWeightCard: body.state.showWeightCard }
    if (wire) wireCalls.push(wire)
    const response = await http(backendPort, req.url, req.method, raw.length ? raw.toString() : undefined, { ...req.headers, host: `localhost:${frontPort}`, origin: origin })
    if (wire) { wire.status = response.status; wire.responseRev = JSON.parse(response.raw).rev }
    puts += req.method === 'PUT' && req.url === '/api/data' ? 1 : 0
    conflicts += response.status === 409 && req.url === '/api/data' ? 1 : 0
    res.writeHead(response.status, { ...response.headers, 'x-i01-harness': nonce }); res.end(response.raw)
    return response.status
  }
  const front = createServer(async (req, res) => {
    try {
      if (req.url === '/__i01/health') { res.setHeader('x-i01-harness', nonce); return res.end(JSON.stringify({ pid: process.pid })) }
      if (req.url.startsWith('/api/')) {
        const chunks = []; for await (const chunk of req) chunks.push(chunk)
        const raw = Buffer.concat(chunks)
        if (hold && req.url === '/api/data' && req.method === 'PUT') {
          const body = JSON.parse(raw)
          held.push({ release: () => forward(req, res, raw), body, tab: req.headers['x-i01-tab'] })
          console.log(`[${kind}] held PUT ${held.length} (tab=${req.headers['x-i01-tab']}, baseRev=${body.baseRev}, checkIn=${body.state.checkIn}, showWeightCard=${body.state.showWeightCard})`)
          return
        }
        return await forward(req, res, raw)
      }
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
      const media = /^\/exercise-media\/(still|clip)\/(\d{4,5}\.(webp|mp4))$/.exec(pathname)
      if (media) {
        const bytes = await readFile(join(repo, 'catalogue/media', media[1], media[2]))
        res.setHeader('Content-Type', media[3] === 'mp4' ? 'video/mp4' : 'image/webp')
        return res.end(bytes)
      }
      const file = resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname))
      if (!file.startsWith(dist + '/')) { res.writeHead(404); return res.end() }
      const bytes = await readFile(file).catch(() => readFile(join(dist, 'index.html')))
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' })[extname(file)] || 'application/octet-stream')
      res.end(bytes)
    } catch (e) { res.writeHead(502); res.end(e.message) }
  })
  await new Promise(r => front.listen(0, '127.0.0.1', r))
  fronts.push(front)
  const frontPort = front.address().port, origin = `http://localhost:${frontPort}`
  records.push({ label: `${kind} frontend (in harness)`, pid: process.pid, port: frontPort })
  try {
    const health = await http(frontPort, '/__i01/health')
    assert.equal(health.headers['x-i01-harness'], nonce); assert.equal(JSON.parse(health.raw).pid, process.pid)
    if (kind === 'legacy') {
      await writeFile(join(dataDir, 'db.json'), JSON.stringify({ users: [], creds: [], subs: [], invites: [] }), { mode: 0o600 })
    }
    const env = { ...baseEnv, HOME: root, DATA_DIR: dataDir, HOST: '127.0.0.1', PORT: '0', RP_ID: 'localhost', ORIGIN: origin, INVITE_ONLY: '0', FIRST_USER_ADMIN: '1', DEVICE_TOKENS: '1', AUDIT_LOG: '0', PARITY_NOW: String(NOW), PARITY_ORACLE_NONCE: nonce }
    const server = kind === 'legacy'
      ? child(node, ['--import', join(repo, 'packages/parity/src/fakedate.mjs'), '--import', join(repo, 'packages/parity/src/oracle-network.mjs'), 'server.js'], { cwd: join(repo, 'packages/parity/fixtures/oracle/api'), env }, 'legacy oracle')
      : child(bun, [join(repo, 'packages/parity/e2e/server.mjs')], { cwd: repo, env }, 'new server')
    backendPort = await bounded(() => {
      if (server.proc.exitCode !== null) throw new Error(server.output())
      const match = /gym-api on :(\d+)/.exec(server.output()); return match && +match[1]
    }, 'backend boot')
    records.at(-1).port = backendPort
    assert.equal((await http(backendPort, '/api/health')).status, 200)
    assert.equal((await http(backendPort, '/api/health')).headers['x-parity-oracle-nonce'], nonce)
    await privateJSON(join(scratch, 'pids.json'), records)
    const cacheRoot = join(process.env.HOME, 'Library/Caches/ms-playwright')
    const browserDirectory = (await readdir(cacheRoot)).filter(n => n.startsWith('chromium_headless_shell-')).sort().at(-1)
    assert(browserDirectory, 'agent-browser Chromium installed')
    const executable = join(cacheRoot, browserDirectory, 'chrome-headless-shell-mac-arm64/chrome-headless-shell')
    const browser = child(executable, ['--headless', '--no-sandbox', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-proxy-server', 'about:blank#i01-primary'], { env: { ...baseEnv, HOME: root } }, `${kind} browser`)
    const debugPort = await bounded(async () => {
      if (browser.proc.exitCode !== null) throw new Error(browser.output())
      return +(await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0]
    }, 'browser CDP port')
    records.at(-1).port = debugPort
    await privateJSON(join(scratch, 'pids.json'), records)
    const primaryTarget = JSON.parse((await http(debugPort, '/json/list')).raw).find(p => p.type === 'page').id
    const browserWs = JSON.parse((await http(debugPort, '/json/version')).raw).webSocketDebuggerUrl
    const browserConfig = await CDP(browserWs)
    const { browserContextId } = await browserConfig('Target.createBrowserContext', { disposeOnDetach: true })
    const { targetId: secondTarget } = await browserConfig('Target.createTarget', { url: 'about:blank#i01-secondary', browserContextId })
    await agent('connect', String(debugPort))
    const auth = await configurePage(debugPort, 0, primaryTarget)
    const secondAuth = await configurePage(debugPort, 1, secondTarget)
    const tabSlots = {}
    for (const slot of [0, 1]) {
      await agent('tab', String(slot))
      tabSlots[await evaluate('location.hash')] = slot
    }
    assert.equal(Object.keys(tabSlots).length, 2, 'CLI found both distinct device tabs')
    const tab = index => agent('tab', String(tabSlots[index === 0 ? '#i01-primary' : '#i01-secondary']))
    await tab(0)
    await agent('set', 'viewport', '430', '932')
    await agent('open', origin)
    await click('Create new profile'); await agent('find', 'placeholder', 'Your name', 'fill', 'I01 Synthetic')
    await click('Create passkey')
    await bounded(async () => (await evaluate('document.body.textContent')).includes('Hi I01 Synthetic'), 'software passkey registration')
    const credentials = await auth.cdp('WebAuthn.getCredentials', { authenticatorId: auth.authenticatorId })
    assert.equal(credentials.credentials.length, 1, 'real browser ceremony created a software credential')
    await snapshot('01-signed-in')
    const cookies = (await agent('cookies', 'get')).cookies
    const cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ')
    const headers = { Cookie: cookie, Origin: origin }
    const get = async () => JSON.parse((await http(backendPort, '/api/data', 'GET', undefined, headers)).raw)
    const initial = await get()
    const seeded = structuredClone(fixture)
    let libraryVersion
    if (kind === 'new') {
      seeded.programmes.definitions = []
      const published = await http(backendPort, '/api/programmes/library/' + definition.id, 'PUT', { definition, expectedVersionId: null, minLevel: 'Valid' }, headers)
      assert.equal(published.status, 200, published.raw.toString())
      const entry = JSON.parse((await http(backendPort, '/api/programmes/library/' + definition.id, 'GET', undefined, headers)).raw)
      libraryVersion = entry.versionId
      assert.equal(JSON.stringify(entry.definition), JSON.stringify(definition), 'S08 returns the exact synthetic definition and key order')
    }
    const seedWrite = await http(backendPort, '/api/data', 'PUT', { state: seeded, baseRev: initial.rev }, headers)
    assert.equal(seedWrite.status, 200, seedWrite.raw.toString())
    const doc = (await get()).state
    await evaluate(`localStorage.setItem('gym_state_v1',${JSON.stringify(JSON.stringify(doc))});localStorage.removeItem('gym_dirty');true`)
    await agent('reload')
    await bounded(async () => (await evaluate('document.body.textContent')).includes('I01 offline workout'), 'seed rendered')
    // Sign out and authenticate again: registration alone is not a login test.
    await agent('open', origin + '/#/settings/account'); await click('Sign out'); await click('Sign out')
    await bounded(async () => (await evaluate('document.body.textContent')).includes('Sign in with passkey'), 'signed out')
    await click('Sign in with passkey')
    await bounded(async () => (await evaluate('document.body.textContent')).includes('Hi I01 Synthetic'), 'software passkey login')
    // Refresh the carrier after login; all later direct reads use the current cookie.
    headers.Cookie = (await agent('cookies', 'get')).cookies.map(c => `${c.name}=${c.value}`).join('; ')
    const profileId = await evaluate('localStorage.getItem("gym_owner")')
    assert(/^[A-Za-z0-9_-]+$/.test(profileId), 'scratch profile identity')
    const checkpoint = async (name, predicate) => {
      await bounded(async () => predicate((await get()).state), name)
      const raw = await readFile(join(dataDir, `state-${profileId}.json`), 'utf8')
      if (kind === 'new') {
        const db = new Database(join(dataDir, 'opengym.db'), { readonly: true })
        try { assert.equal(db.query('SELECT json FROM state_docs WHERE profile_id=?').get(profileId).json, raw, 'SQLite and JSON mirror are byte-identical') }
        finally { db.close() }
      }
      const saved = JSON.parse(raw)
      assert.deepEqual(saved.futureTop, fixture.futureTop, 'unknown fixture content survives every flow')
      const logged = saved.workouts.find(w => w.name === 'I01 offline workout')?.entries[0]?.sets[0]
      assert(logged?.done && logged.w === 42.5 && logged.r === 6, 'offline logged values survive every server checkpoint')
      if (kind === 'new' && saved.programmes.cycles.length) {
        assert.deepEqual(Object.keys(saved.programmes.installed), [definition.id])
        const marker = saved.programmes.installed[definition.id]
        assert.equal(marker.versionId, libraryVersion)
        assert(Number.isSafeInteger(marker.at) && marker.at >= NOW, 'library installation has a valid monotone clock')
      }
      ;(storedBytes[kind] ??= {})[name] = raw
      await writeFile(join(root, name + '.raw.json'), raw, { mode: 0o600 })
      await privateJSON(join(root, name + '.json'), saved)
      ;(results[kind] ??= {})[name] = saved
      console.log(`[${kind}] ${name}: PASS`)
    }
    await agent('set', 'offline', 'on')
    await agent('click', '.today-row')
    await bounded(async () => !!(await state()).active, 'offline workout started')
    await agent('fill', '.setrow .stp.w input', '42.5')
    await agent('fill', '.setrow .stp.r input', '6')
    await snapshot('02-offline-workout')
    await agent('click', '[aria-label="Set 1 done"]')
    await pause(350)
    await click('Finish workout')
    const offline = await state()
    assert.equal(offline.workouts.length, 1); assert.equal(offline.active, null)
    assert.equal(offline.workouts[0].entries[0].sets[0].w, 42.5)
    assert.equal(offline.workouts[0].entries[0].sets[0].r, 6)
    assert.equal((await get()).state.workouts.length, 0, 'offline writes have not reached server')
    await snapshot('03-offline-finished')
    await agent('set', 'offline', 'off')
    await click('Nice!')
    await agent('open', origin + '/#/settings/account'); await click('Sync now')
    await checkpoint('offline-sync', s => s.workouts.length === 1 && !s.active)
    // Capture both concurrent PUT bodies before forwarding either. The genuine server
    // (not a mock 409 response) rejects one; the clients must merge and retry.
    // Separate real storage contexts represent two devices. Same-context tabs
    // merge via shared localStorage before HTTP and cannot prove 409 response merge.
    const loginCredential = (await auth.cdp('WebAuthn.getCredentials', { authenticatorId: auth.authenticatorId })).credentials[0]
    await secondAuth.cdp('WebAuthn.addCredential', { authenticatorId: secondAuth.authenticatorId, credential: loginCredential })
    await tab(1); await agent('open', origin)
    await click('Sign in with passkey')
    await bounded(async () => (await evaluate('document.body.textContent')).includes('Hi I01 Synthetic'), 'second device tab authenticated')
    await agent('open', origin + '/#/settings/look')
    await bounded(async () => !!(await state())?.workouts?.length, 'second tab joined')
    await tab(0); await agent('open', origin + '/#/settings/look')
    hold = true
    await agent('click', '.lrow:has-text("Gym check-in") [role="switch"]')
    await bounded(() => held.some(r => r.body.state.checkIn === false), 'first tab PUT held')
    await tab(1)
    await agent('click', '.lrow:has-text("Body weight") [role="switch"]')
    assert.equal((await state()).showWeightCard, false, 'second edit persisted while concurrent PUTs are held')
    await bounded(() => held.length >= 2, 'second tab PUT held')
    const releases = held.splice(0); hold = false
    assert.deepEqual([...new Set(releases.map(r => r.tab))].sort(), ['0', '1'], 'held writes originate in two distinct tabs')
    assert.equal(new Set(releases.map(r => r.body.baseRev)).size, 1, 'both writes quote the same base revision')
    const first = releases.find(r => r.tab === '0').body.state, second = releases.find(r => r.tab === '1').body.state
    assert.equal(first.checkIn, false); assert.equal(first.showWeightCard, true)
    assert.equal(second.checkIn, true); assert.equal(second.showWeightCard, false)
    const raceStatuses = []
    for (const { release } of releases) raceStatuses.push(await release())
    assert(raceStatuses.includes(200) && raceStatuses.includes(409), 'the server accepts one held write and conflicts the other')
    await checkpoint('two-tab-merge', s => s.checkIn === false && s.showWeightCard === false)
    assert(conflicts > 0, 'real two-tab PUT returned 409')
    assert(wireCalls.some((refusal, i) => refusal.status === 409 && wireCalls.slice(i + 1).some(retry => retry.tab === refusal.tab && retry.baseRev === refusal.responseRev && retry.checkIn === false && retry.showWeightCard === false && retry.status === 200)), 'the conflict retry body includes both divergent edits before the server sees it')
    // agent-browser 0.8.5 double-removes a CDP page on tab close. Keep the idle
    // second tab until owned-browser teardown, preserving the CLI index mapping.
    await tab(0)
    await snapshot('04-settings-merge')
    await agent('open', origin + '/#/plan')
    await click('Programs')
    await libraryCard(); await click('Start this program'); await click('Confirm load')
    await checkpoint('library-activation', s => s.programmes.cycles.length === 1 && s.programmes.cycles[0].status === 'active')
    await agent('open', origin + '/#/home')
    assert(await evaluate('document.querySelector(".program-today")?.textContent.includes("I01 synthetic strength")'), 'Today programme card shown')
    await snapshot('05-today-programme')
    await agent('click', '.program-today button:has-text("Start")')
    await bounded(async () => !!(await state()).active, 'programme workout started')
    await agent('click', '[aria-label="Set 1 done"]'); await pause(350); await click('Finish workout')
    await checkpoint('rollover-pending', s => !!s.programmes.cycles[0].rollover)
    await click('Nice!')
    await agent('open', origin + '/#/plan'); await click('Review next week'); await click('Accept and continue')
    await checkpoint('rollover-accepted', s => s.programmes.cycles[0].weekIndex === 2 && !!s.programmes.cycles[0].rolloverReviewed)
    await snapshot('06-rollover')
    await privateJSON(join(root, 'wire-counts.json'), { puts, conflicts, raceStatuses, wireCalls })
    console.log(`[${kind}] actual 409 conflicts: ${conflicts}`)
    if (kind === 'new') {
      await click('End program'); await click('End program')
      await bounded(async () => (await state()).programmes.cycles[0].status === 'archived', 'archive before offline cache activation')
      await agent('set', 'offline', 'on')
      await libraryCard(); await click('Start this program'); await click('Confirm load')
      await bounded(async () => (await state()).programmes.cycles.length === 2, 'offline cached activation completes')
      const cached = await state()
      assert.equal(cached.programmes.cycles.length, 2); assert.equal(cached.programmes.cycles[1].status, 'active')
      const cachedCycle = cached.programmes.cycles[1], cachedQueue = cached.queue
      await click('All programs')
      await snapshot('07-offline-cache')
      await agent('set', 'offline', 'off')
      await agent('open', origin + '/#/settings/account'); await click('Sync now')
      await checkpoint('offline-cache-sync', s => s.programmes.cycles.length === 2 && s.programmes.cycles[0].status === 'archived' && s.programmes.cycles[1].id === cachedCycle.id && s.programmes.cycles[1].status === 'active' && s.queue?.programmeCycleId === cachedCycle.id)
      assert.deepEqual(normalizeE2E(results.new['offline-cache-sync'].queue), normalizeE2E(cachedQueue), 'offline activation retains queue content and ownership after syncing')
    }
    await agent('close')
    server.proc.kill('SIGTERM'); browser.proc.kill('SIGTERM')
  } finally {
    hold = false
    for (const { release } of held.splice(0)) await release().catch(() => {})
    front.closeAllConnections(); await new Promise(r => front.close(r))
  }
}
let passed = false
let cleaning
function cleanup() {
  return cleaning ??= (async () => {
    for (const ws of sockets) ws.close()
    for (const front of fronts) { front.closeAllConnections(); front.close() }
    // Signal the exact owned processes first, even if CLI shutdown is unresponsive.
    for (const proc of children) if (proc.pid && proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM')
    if (cliSession) await agent('close').catch(() => {})
    for (const proc of children) {
      if (proc.pid && proc.exitCode === null && proc.signalCode === null) await Promise.race([new Promise(r => proc.once('exit', r)), pause(2500)])
      if (proc.pid && proc.exitCode === null && proc.signalCode === null) { proc.kill('SIGKILL'); await new Promise(r => proc.once('exit', r)) }
    }
    await privateJSON(join(scratch, 'pids.json'), records.map(r => ({ ...r, stopped: r.pid === process.pid ? true : !children.some(p => p.pid === r.pid && p.exitCode === null && p.signalCode === null) })))
  })()
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => { void cleanup().finally(() => process.exit(1)) })
try {
  for (const kind of process.argv.includes('--new-only') ? ['new'] : process.argv.includes('--legacy-only') ? ['legacy'] : ['legacy', 'new']) await runBuild(kind)
  await privateJSON(join(scratch, 'results.json'), results)
  if (results.legacy && results.new) {
    const comparisons = []
    for (const [name, legacy] of Object.entries(results.legacy)) {
      const current = results.new[name]
      assert(current, `rewrite checkpoint ${name} exists`)
      const options = { preActivation: ['offline-sync', 'two-tab-merge'].includes(name) }
      if (options.preActivation) {
        assert.equal(legacy.programmes.definitions.length, 1)
        const { _ts, _f, ...authored } = legacy.programmes.definitions[0]
        assert.equal(JSON.stringify(authored), JSON.stringify(definition), 'legacy pre-activation authored definition and key order are unchanged')
        assert.equal(_ts, NOW)
        assert.deepEqual(_f, Object.fromEntries(Object.keys(definition).filter(k => k !== 'id').map(k => [k, NOW])), 'initial API field clocks are complete and unchanged')
      }
      const differences = e2eDifferences(normalizeE2E(legacy, options), normalizeE2E(current, options))
      assert.equal(JSON.stringify(normalizeE2E(legacy, options)), JSON.stringify(normalizeE2E(current, options)), `normalized stored bytes at ${name}`)
      const explained = e2eDifferences(legacy, current).map(path => ({ path, reason:
        /^\$\._(rev|wid|wids)(\.|$)/.test(path) ? 'Server-owned revision/write identity; request counts and random write ids differ.' :
        /^\$\._(prior|unstamped)(\.|$)/.test(path) ? 'Server-only prior-writer provenance; current authored/logged fields are compared.' :
        options.preActivation && path.startsWith('$.programmes.definitions') ? 'Approved baseline location: identical fixture in legacy doc, S08 library on rewrite; both definitions separately asserted.' :
        path.startsWith('$.programmes.installed') ? 'Approved S08 i01-synthetic installed version and clock marker; legacy has no server library.' :
        /\.(edited|_ts|_f)(\.|$)/.test(path) ? 'Named sync clock/field-clock metadata; initial API stamping and library installation have different provenance.' :
        'Generated identity/reference; values, keys and composite references are compared after consistent positional aliasing.' }))
      comparisons.push({ checkpoint: name, byteEqual: storedBytes.legacy[name] === storedBytes.new[name], differences, explained })
      await privateJSON(join(evidence, `${name}-legacy.normalized.json`), normalizeE2E(legacy, options))
      await privateJSON(join(evidence, `${name}-new.normalized.json`), normalizeE2E(current, options))
    }
    await privateJSON(join(evidence, 'comparison.json'), comparisons)
    assert(comparisons.every(c => c.differences.length === 0), 'Normalized state differences: ' + JSON.stringify(comparisons))
  }
  passed = true
  console.log(`I01 scratch evidence: ${scratch}`)
} catch (e) {
  console.error(e)
  if (cliSession) {
    await privateJSON(join(scratch, 'failure-state.json'), await state().catch(() => null))
    await snapshot('FAILURE').catch(() => {})
    console.error(JSON.stringify(await agent('snapshot', '-i', '-c').catch(() => ({}))))
    console.error(JSON.stringify(await agent('errors').catch(() => ({}))))
  }
  process.exitCode = 1
} finally {
  await cleanup()
  // Raw docs/auth carriers never enter git. Retain private failure scratch for repro.
  if (passed && process.env.I01_REMOVE_SCRATCH === '1') await rm(scratch, { recursive: true })
  console.log(`Scratch retained (0700 directory / 0600 files): ${scratch}`)
}
