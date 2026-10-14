// Short-lived synthetic data/library test process; OS-assigned loopback port only.
import fs from 'node:fs'
import { openStore, putUser, commitStateDoc } from '../../../server/src/storage'
import { putLibraryEntry } from '../../../server/src/storage/library'
import { DataService } from '../../../server/src/data'
import { loadConfig } from '../../../server/src/config'
import { createAuth } from '../../../server/src/auth'
import { startServer } from '../../../server/src/index'
const dir = process.argv[2]!, input = JSON.parse(fs.readFileSync(dir + '/input.json', 'utf8'))
const store = openStore(dir), now = () => Date.parse('2026-07-27T12:00:00Z')
const user = { id: 'test-uid', name: 'Synthetic', created: '2026-01-01', admin: 0, disabled: 0, sv: 0,
  invited_by: null, last_pull: null, last_reminder: null, last_nudge: null, ord: 0, x: '{}' }
putUser(store.db, user)
if (input.state !== null) commitStateDoc(store.db, user.id, JSON.stringify(input.state), now(), 20)
for (const definition of input.library || []) putLibraryEntry(store.db, user.id, definition.id, { definition, expectedVersionId: null, now: now() })
const config = loadConfig({ DATA_DIR: dir, PORT: '0', HOST: '127.0.0.1', DEVICE_TOKENS: '1', ORIGIN: 'http://localhost:8080' })
const auth = createAuth(store.db, config, { now, address: () => '127.0.0.1' })
const data = new DataService(store.db, dir, { now, log: () => {} })
const server = startServer(config, { auth, data, log: () => {}, routes(app) {
  app.get('/__m01_identity', () => Response.json({ nonce: input.nonce }))
  app.get('/__m01_redirect', () => new Response(null, { status: 302, headers: { Location: '/api/data' } }))
  app.get('/__m01_invalid', () => new Response('{ private invalid JSON'))
} }, () => {})
console.log(JSON.stringify({ api: `http://127.0.0.1:${server.port}`, token: auth.mint(user, 'agent'), nonce: input.nonce }))
process.on('SIGTERM', async () => { await server.stop(true); store.close(); process.exit(0) })
