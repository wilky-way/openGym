import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { startOracle, mintSession, SYNTHETIC_SECRET } from '../../parity/src/oracle'
import { syntheticProfile } from '../../parity/src/synthetic'
import http from 'node:http'
import { importLegacy, verifyLegacy } from '../src/migration/importer'
import { offloadLibrary, reinstallLibrary } from '../src/migration/library'
import { openDb, readStateDoc, commitStateDoc } from '../src/storage'
import { DataService } from '../src/data'
import { createAuth } from '../src/auth'
import { loadConfig } from '../src/config'
import { startServer } from '../src/index'
import { scratchDir } from './helpers'
import { definition } from './library-helpers'

const NOW = 1791840000000
function directGet(url: string, headers: Record<string, string>, nonce?: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: 'GET', headers, agent: false }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('error', reject)
      response.on('end', () => {
        if (Object.keys(response.headers).some(k => k.startsWith('tailscale-'))) return reject(new Error('foreign listener'))
        if (nonce && response.headers['x-parity-oracle-nonce'] !== nonce) return reject(new Error('oracle identity mismatch'))
        resolve({ status: response.statusCode!, body: Buffer.concat(chunks) })
      })
    })
    req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('direct GET deadline'))); req.end()
  })
}

test('S09 extra gate: synthetic import then actual GET equals frozen Node 22 legacy GET byte-for-byte', async () => {
  const profile = syntheticProfile(20261013, { users: 3, workouts: 12, now: NOW })
  const ids = profile.db.users.map(u => u.id)
  const original = JSON.parse(profile.docs[ids[0]!]!)
  original._rev = 9; original._wid = 'synthetic-legacy-wid'
  original._unstamped = { fp: 'synthetic', own: { example: 17 } }; original._prior = { keep: 'private' }
  original.programmes = { definitions: [definition('synthetic-inactive'), definition('synthetic-active')], cycles: [{ id: 'synthetic-cycle', programmeId: 'synthetic-active', status: 'active' }] }
  profile.docs[ids[0]!] = JSON.stringify(original, null, 2)
  profile.docs[ids[1]!] = '{"extension":{"z":1,"a":"é"},"workouts":[],"_prior":{"private":true}}'
  delete profile.docs[ids[2]!]
  const oracle = await startOracle(profile)
  const data = scratchDir()
  let db: ReturnType<typeof openDb> | undefined, server: ReturnType<typeof startServer> | undefined
  try {
    const expected = []
    const nonce: unknown = Reflect.get(oracle, 'nonce')
    if (typeof nonce !== 'string') throw new Error('oracle nonce seam unavailable')
    for (const uid of ids) expected.push(await directGet(oracle.baseUrl + '/api/data', { Cookie: `gymsid=${mintSession(uid, NOW)}` }, nonce))
    fs.cpSync(oracle.dataDir, data, { recursive: true })
    const options = { data, scratch: data, protectedRoot: () => '/synthetic-protected-opengym', apply: true, now: NOW, profile: ids[0]! }
    const imported = await importLegacy(options)
    expect(imported.profiles.every(p => p.equal)).toBe(true)
    expect(verifyLegacy(options).ok).toBe(true)
    db = openDb(path.join(data, 'opengym.db'))
    const config = loadConfig({ DATA_DIR: data, HOST: '127.0.0.1', PORT: '0', ORIGIN: 'http://localhost:8080' })
    const auth = createAuth(db, config, { secret: SYNTHETIC_SECRET, now: () => NOW })
    const service = new DataService(db, data, { now: () => NOW })
    server = startServer(config, { auth, data: service, now: () => NOW }, () => {})
    for (const [i, uid] of ids.entries()) {
      const got = await directGet(`http://127.0.0.1:${server.port}/api/data`, { Cookie: `gymsid=${mintSession(uid, NOW)}` })
      expect(got.status).toBe(expected[i]!.status)
      expect(got.body.toString('base64')).toBe(expected[i]!.body.toString('base64'))
    }
    expect(readStateDoc(db, ids[0]!)!.json).toBe(profile.docs[ids[0]!]!)
    offloadLibrary(options)
    const current = JSON.parse(readStateDoc(db, ids[0]!)!.json)
    current.workouts.push({ id: 'synthetic-post-offload', d: '2026-10-14' })
    commitStateDoc(db, ids[0]!, JSON.stringify(current), NOW + 1, 30)
    reinstallLibrary({ ...options, now: NOW + 2 })
    const result = await directGet(`http://127.0.0.1:${server.port}/api/data`, { Cookie: `gymsid=${mintSession(ids[0]!, NOW)}` })
    const body = JSON.parse(result.body.toString('utf8'))
    expect(JSON.stringify(body.state.programmes.definitions)).toBe(JSON.stringify(original.programmes.definitions))
    expect(body.state.workouts.at(-1).id).toBe('synthetic-post-offload')
  } finally { await server?.stop(true); db?.close(); await oracle.stop() }
}, 30000)
