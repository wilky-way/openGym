import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openStore, putUser, commitStateDoc, putInvite } from '../packages/server/src/storage'
import { putDevice } from '../packages/server/src/storage/devices'
import { createAuth } from '../packages/server/src/auth'
import { loadConfig } from '../packages/server/src/config'

// Creates its own EMPTY disposable directory. Never accepts an existing data directory.
// Only for the signed-in part of the synthetic tour, after capturing the guest UI.
const fixture = process.argv[2]
if (!fixture) throw new Error('Usage: bun scripts/screenshot-account.ts <synthetic-fixture.json>')
mkdirSync(resolve('.gate'), {recursive:true})
const dataDir = mkdtempSync(join(resolve('.gate'), 'screenshot-'))
const config = loadConfig({ ORIGIN:'http://127.0.0.1:18195', DEVICE_TOKENS:'1' }, ['--data-dir',dataDir])
const store = openStore(dataDir), now = Date.now()
try {
  const user = {id:'synthetic-owner',name:'Demo Owner',created:new Date(now).toISOString(),admin:1,disabled:0,sv:0,
    invited_by:null,last_pull:now,last_reminder:null,last_nudge:null,ord:0,x:'{}'}
  putUser(store.db,user)
  const state = {...JSON.parse(readFileSync(fixture,'utf8')),_rev:1,_wid:'synthetic-initial'}
  commitStateDoc(store.db,user.id,JSON.stringify(state),now,10)
  putDevice(store.db,{id:'demo-browser-001',user_id:user.id,kind:'browser',name:'Demo Browser',sv:0,created:now,last_seen:now,revoked_at:null})
  putDevice(store.db,{id:'demo-agent-00001',user_id:user.id,kind:'paired',name:'Demo Local Agent',sv:0,created:now-86400000,last_seen:now-3600000,revoked_at:null})
  putInvite(store.db,{code:'DEMO-ONLY',note:'Invented showcase invite',created_by:user.id,created:new Date(now).toISOString(),used_by:null,used_at:null,revoked:0,ord:0})
  const auth = createAuth(store.db,config)
  const token = auth.mint(user,'browser','demo-browser-001')
  // Keep this manifest inside the ignored scratch directory; never put a session in docs.
  console.log(JSON.stringify({dataDir,cookie:token}))
} finally { store.close() }
