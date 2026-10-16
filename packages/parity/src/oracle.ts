import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, writeFile, rm, readdir, chmod, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Socket } from 'node:net'
import { directRequest } from './http-transport'
import { syntheticProfile } from './synthetic'
import { type ParityRequest, type ParityResponse, type ParityTarget, type SyntheticProfile, type StoredDocs } from './types'
export const SYNTHETIC_SECRET = 'opengym-parity-synthetic-secret-v1'
export const ORACLE_ORIGIN = 'http://localhost:8080'
export function mintSession(uid: string, now: number, sv = 0, expires = now + 86400000): string {
  if (!/^[A-Za-z0-9_-]+$/.test(uid) || !Number.isFinite(expires) || !Number.isInteger(sv)) throw new Error('Invalid synthetic session')
  const payload = `${uid}:${expires}:${sv}`
  return `${payload}.${createHmac('sha256', SYNTHETIC_SECRET).update(payload).digest('base64url')}`
}
export interface OracleDiagnostics { stdout: string; stderr: string; baseUrl: string; pid: number | null }
export class OracleFailure extends Error {
  constructor(message: string, readonly request: ParityRequest | null, readonly response: ParityResponse | null, readonly diagnostics: OracleDiagnostics, cause?: unknown) { super(message, { cause }) }
}
/** Reads only the directory owned by startOracle. Always preserve file bytes. */
export class Oracle implements ParityTarget {
  private stopped = false
  private clockId = 0
  private readonly peerChecks = new Map<string, (error?: Error) => void>()
  private now: number
  private constructor(readonly dataDir: string, readonly baseUrl: string, readonly child: ChildProcess, readonly profile: SyntheticProfile, private readonly exit: Promise<void>, private readonly nonce: string, readonly diagnostics: OracleDiagnostics) {
    this.now = profile.now
    child.on('message', (message: unknown) => {
      const m = message as { type?: string; id?: string; owned?: boolean }
      if (m.type === 'parity-peer' && m.id) this.peerChecks.get(m.id)?.(m.owned ? undefined : new Error('Oracle harness connected peer is not owned by the child'))
    })
    child.once('exit', () => {
      for (const finish of this.peerChecks.values()) finish(new Error('Oracle exited before socket authorization'))
    })
  }
  static async start(profile: SyntheticProfile = syntheticProfile(), options: { timeoutMs?: number; env?: Record<string, string> } = {}): Promise<Oracle> {
    // Never inherit service configuration, tokens, data paths, or mail/push settings.
    const env: Record<string, string> = {}
    for (const key of ['PATH', 'TMPDIR', 'TZ']) if (process.env[key]) env[key] = process.env[key]!
    for (const [key, value] of Object.entries(options.env ?? {})) {
      if (!['INVITE_ONLY', 'FIRST_USER_ADMIN', 'ALLOW_GUEST', 'SESSION_DAYS', 'DEFAULT_LANG', 'ADMIN_UIDS', 'MEDIA_UPLOADS'].includes(key)) throw new Error(`Unsafe oracle environment override: ${key}`)
      env[key] = value
    }
    // Resolve mise with the host configuration, then run Node without access to host HOME.
    const node = (await promisify(execFile)('mise', ['which', 'node', '--tool=node@22.23.3'])).stdout.trim()
    const dir = await mkdtemp(join(tmpdir(), 'opengym-parity-'))
    let child: ChildProcess | undefined, exited: Promise<void> | undefined
    const diagnostics: OracleDiagnostics = { stdout: '', stderr: '', baseUrl: '', pid: null }
    try {
      await chmod(dir, 0o700)
      const home = join(dir, 'home')
      await mkdir(home, { mode: 0o700 })
      env.HOME = home
      await writeFile(join(dir, 'secret'), SYNTHETIC_SECRET, { mode: 0o600 })
      await writeFile(join(dir, 'db.json'), JSON.stringify(profile.db), { mode: 0o600 })
      for (const [uid, doc] of Object.entries(profile.docs)) {
        if (!/^[A-Za-z0-9_-]+$/.test(uid) || !profile.db.users.some(u => u.id === uid)) throw new Error('Invalid synthetic doc identity')
        await writeFile(join(dir, `state-${uid}.json`), doc, { mode: 0o600 })
      }
      const nonce = randomUUID()
      child = spawn(node, ['--import', fileURLToPath(new URL('./fakedate.mjs', import.meta.url)), '--import', fileURLToPath(new URL('./oracle-network.mjs', import.meta.url)), 'server.js'], {
        cwd: fileURLToPath(new URL('../fixtures/oracle/api/', import.meta.url)), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...env, DATA_DIR: dir, PORT: '0', ORIGIN: ORACLE_ORIGIN, RP_ID: 'localhost', PARITY_NOW: String(profile.now), PARITY_ORACLE_NONCE: nonce }
      })
      diagnostics.pid = child.pid ?? null
      child.stdout!.on('data', (chunk: Buffer) => { diagnostics.stdout = (diagnostics.stdout + chunk.toString()).slice(-20000) })
      child.stderr!.on('data', (chunk: Buffer) => { diagnostics.stderr = (diagnostics.stderr + chunk.toString()).slice(-20000) })
      const processChild = child
      exited = new Promise(resolve => { processChild.once('exit', () => resolve()); processChild.once('error', () => resolve()) })
      const port = await new Promise<number>((resolve, reject) => {
        let log = ''
        const timer = setTimeout(() => reject(new Error(`Oracle startup timeout: ${log}`)), options.timeoutMs ?? 20000)
        const finish = (err?: Error, port?: number) => { clearTimeout(timer); err ? reject(err) : resolve(port!) }
        processChild.once('error', err => finish(err))
        processChild.once('exit', code => finish(new Error(`Oracle exited before readiness (${code}): ${log}`)))
        processChild.stdout!.on('data', (chunk: Buffer) => { log = (log + chunk.toString()).slice(-20000); const match = /gym-api on :(\d+)/.exec(log); if (match) finish(undefined, Number(match[1])) })
        processChild.stderr!.on('data', (chunk: Buffer) => { log = (log + chunk.toString()).slice(-20000) })
      })
      diagnostics.baseUrl = `http://127.0.0.1:${port}`
      const oracle = new Oracle(dir, diagnostics.baseUrl, child, structuredClone(profile), exited, nonce, diagnostics)
      // Readiness is ownership, not merely a listening port. Verify before recording/replay.
      await oracle.request({ method: 'GET', path: '/api/health' })
      return oracle
    } catch (error) {
      child?.kill('SIGKILL'); await exited
      await rm(dir, { recursive: true, force: true })
      if (error instanceof OracleFailure) throw error
      throw new OracleFailure(error instanceof Error ? error.message : String(error), null, null, diagnostics, error)
    }
  }
  async setTime(now: number): Promise<void> {
    this.assertLive()
    if (!Number.isFinite(now)) throw new Error('Clock must be finite')
    const id = ++this.clockId
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Oracle clock acknowledgement timed out')), 5000)
      const onMessage = (message: unknown) => {
        const m = message as { type?: string; id?: number; now?: number }
        if (m.type === 'parity-clock' && m.id === id && m.now === now) finish()
      }
      const onExit = () => finish(new Error('Oracle exited during clock update'))
      const finish = (err?: Error) => { clearTimeout(timer); this.child.off('message', onMessage); this.child.off('exit', onExit); err ? reject(err) : resolve() }
      this.child.on('message', onMessage); this.child.once('exit', onExit)
      this.child.send({ type: 'parity-clock', id, now }, err => { if (err) finish(err) })
    })
    this.now = now
  }
  async request(request: ParityRequest): Promise<ParityResponse> {
    this.assertLive()
    if (!request.path.startsWith('/') || request.path.startsWith('//')) throw new Error('Parity requests must use an origin-relative path')
    const url = new URL(request.path, this.baseUrl)
    if (url.origin !== this.baseUrl) throw new Error('Parity request escaped its oracle')
    const headers = { ...request.headers }
    if (request.session) {
      const { uid, sv, bearer, expires } = request.session, token = mintSession(uid, this.now, sv, expires)
      if (bearer) headers.Authorization = `Bearer ${token}`
      else headers.Cookie = `gymsid=${token}`
    }
    let response: ParityResponse | null = null
    try {
      response = await directRequest(Number(url.port), { ...request, path: url.pathname + url.search }, headers, socket => this.authorizePeer(socket))
      const foreignHeader = Object.keys(response.headers).find(key => key.startsWith('tailscale-'))
      if (foreignHeader) throw new Error(`Oracle harness rejected foreign Tailscale listener at ${this.baseUrl} (pid ${this.child.pid}): ${foreignHeader}`)
      if (response.headers['x-parity-oracle-nonce']?.[0] !== this.nonce) throw new Error(`Oracle harness identity mismatch at ${this.baseUrl} (pid ${this.child.pid}): missing or incorrect run nonce`)
      delete response.headers['x-parity-oracle-nonce']
      return response
    } catch (error) {
      throw new OracleFailure(error instanceof Error ? error.message : String(error), request, response, { ...this.diagnostics }, error)
    }
  }
  private async authorizePeer(socket: Socket): Promise<void> {
    this.assertLive()
    const id = randomUUID()
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer); this.peerChecks.delete(id); socket.off('close', onClose)
        error ? reject(error) : resolve()
      }
      const onClose = () => finish(new Error('Oracle socket closed before authorization'))
      const timer = setTimeout(() => finish(new Error('Oracle socket authorization timed out')), 5000)
      this.peerChecks.set(id, finish); socket.once('close', onClose)
      this.child.send({ type: 'parity-peer', id, clientPort: socket.localPort, serverPort: socket.remotePort }, error => { if (error) finish(error) })
    })
    this.assertLive()
  }
  async storedDocs(): Promise<StoredDocs> {
    this.assertLive()
    const docs: StoredDocs = {}
    for (const file of (await readdir(this.dataDir)).filter(file => /^state-[A-Za-z0-9_-]+\.json$/.test(file)).sort()) docs[file.slice(6, -5)] = await readFile(join(this.dataDir, file))
    return docs
  }
  async restoreDocs(docs: StoredDocs): Promise<void> {
    this.assertLive()
    for (const [uid, raw] of Object.entries(docs)) {
      if (!/^[A-Za-z0-9_-]+$/.test(uid)) throw new Error('Invalid fixture identity')
    }
    for (const file of (await readdir(this.dataDir)).filter(file => /^state-[A-Za-z0-9_-]+\.json$/.test(file))) await rm(join(this.dataDir, file))
    for (const [uid, raw] of Object.entries(docs)) await writeFile(join(this.dataDir, `state-${uid}.json`), raw, { mode: 0o600 })
  }
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.child.kill('SIGKILL'); await this.exit
    await rm(this.dataDir, { recursive: true, force: true })
  }
  private assertLive() { if (this.stopped || this.child.exitCode !== null || this.child.signalCode !== null) throw new Error('Oracle is stopped') }
}
export const startOracle = Oracle.start
