// Short-lived synthetic S04/S08 test process; OS-assigned loopback port only.
import fs from 'node:fs'
import { openStore, putUser, commitStateDoc } from '../../../server/src/storage'
import { putLibraryEntry } from '../../../server/src/storage/library'
import { DataService } from '../../../server/src/data'
import { loadConfig } from '../../../server/src/config'
import { createAuth } from '../../../server/src/auth'
import { observeTrainingPut } from '../../../server/src/training-guard'
import { startServer } from '../../../server/src/index'
const dir = process.argv[2]!, input = JSON.parse(fs.readFileSync(dir + '/input.json', 'utf8'))
const store = openStore(dir)
let clock = Date.parse('2026-07-27T12:00:00Z')
const now = () => clock
const user = { id: 'test-uid', name: 'Synthetic', created: '2026-01-01', admin: 0, disabled: 0, sv: 0,
  invited_by: null, last_pull: null, last_reminder: null, last_nudge: null, ord: 0, x: '{}' }
putUser(store.db, user)
if (input.state !== null) commitStateDoc(store.db, user.id, JSON.stringify(input.state), now(), 20)
for (const definition of input.library || []) putLibraryEntry(store.db, user.id, definition.id, { definition, expectedVersionId: null, now: now() })
const config = loadConfig({ DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', DEVICE_TOKENS: '1', ORIGIN: 'http://localhost:8080' })
const auth = createAuth(store.db, config, { now, address: () => '127.0.0.1' })
const browserToken = auth.mint(user,'browser'), pairedToken = auth.mint(user,'paired')
const browser = auth.sessionOf(new Request('http://synthetic/',{headers:{Authorization:'Bearer '+browserToken}}))!
observeTrainingPut(store.db,browser,{state:{active:null},baseRev:input.state?._rev ?? 0,baseWid:input.state?._wid ?? null},now())
const data = new DataService(store.db, dir, { now, log: () => {} })
const token = auth.mint(user, 'agent')
// Transport behavior is tested on a dedicated synthetic listener. These routes
// deliberately do not mount the production application or expand its allowlist.
const hits = { redirect: 0, invalid: 0, followed: 0 }
const server = input.transportFixture ? Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(request) {
  switch (new URL(request.url).pathname) {
    case '/__m01_identity': return Response.json({ nonce: input.nonce })
    case '/__m01_stats': return Response.json(hits)
    case '/__m01_redirect':
      hits.redirect++
      return new Response(null, { status: 302, headers: { Location: '/__m01_followed' } })
    case '/__m01_followed': hits.followed++; return Response.json({ unexpected: true })
    case '/__m01_invalid':
      hits.invalid++
      return new Response('{ private invalid JSON ' + token, { status: 200 })
    default: return new Response(null, { status: 404 })
  }
} }) : startServer(config, { auth, data, log: () => {}, routes(app) {
  app.get('/__m01_identity', () => Response.json({ nonce: input.nonce }))
  app.post('/__m01_clock', async c => {
    const body = await c.get('body').readJson()
    if (body.nonce !== input.nonce || typeof body.ms !== 'number' || !Number.isSafeInteger(body.ms) || body.ms < 0 || body.ms > 300000) return c.json({error:'invalid synthetic clock'},400)
    clock += body.ms
    return c.json({ok:true})
  })
} }, () => {})
console.log(JSON.stringify({ api: `http://127.0.0.1:${server.port}`, token, browserToken, pairedToken, nonce: input.nonce }))
process.on('SIGTERM', async () => { await server.stop(true); if (input.transportFixture) auth.auditLog.close(); store.close(); process.exit(0) })
