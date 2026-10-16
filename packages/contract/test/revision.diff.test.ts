import { expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, chmodSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHmac } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { validateRequest } from '../src/validators'
/** F3 will rerun this gate against golden transcripts/new server. This uses the
 * real Node 22 oracle and the request body from server-data-rev.test.js. */
it('contract-unsure:PUT /api/data baseRev string reaches legacy 409', async () => {
  const node = execFileSync('mise', ['which', 'node', '--tool=node@22.23.3'], {encoding:'utf8'}).trim()
  if (execFileSync(node, ['--version'], {encoding:'utf8'}).trim() !== 'v22.23.3') throw new Error('Revision oracle requires Node 22.23.3')
  const dir = mkdtempSync(join(tmpdir(), 'opengym-f1-'))
  chmodSync(dir,0o700)
  const home=join(dir,'home');mkdirSync(home,{mode:0o700})
  const secret = '1'.repeat(64), uid = 'synthetic_f1'
  writeFileSync(join(dir,'secret'), secret, {mode:0o600})
  writeFileSync(join(dir,'db.json'), JSON.stringify({users:[{id:uid,name:'Synthetic',created:'2026-10-12T00:00:00Z'}],creds:[],subs:[],invites:[]}),{mode:0o600})
  writeFileSync(join(dir,`state-${uid}.json`), JSON.stringify({_rev:4,workouts:[],routines:[]}),{mode:0o600})
  const child = Bun.spawn([node,'server.js'], {cwd: fileURLToPath(new URL('../../parity/fixtures/oracle/api/',import.meta.url)), env:{PATH:process.env.PATH,TZ:process.env.TZ,TMPDIR:process.env.TMPDIR,HOME:home,OPENGYM_CORPUS_HARNESS:'synthetic-node-recording-v1',NODE_OPTIONS:`--import=${new URL('../../../scripts/corpus-loopback.mjs',import.meta.url).href}`,DATA_DIR:dir,PORT:'0',ORIGIN:'http://localhost:8080',RP_ID:'localhost'},stdout:'pipe',stderr:'pipe'})
  try {
    const reader = child.stdout.getReader(), decoder = new TextDecoder()
    let log='', match: RegExpMatchArray | null = null
    while (!(match = log.match(/gym-api on :(\d+)/))) {
      const next = await reader.read()
      if (next.done) throw new Error(`Oracle exited before readiness: ${log}`)
      log += decoder.decode(next.value)
    }
    const payload = `${uid}:${Date.now()+86_400_000}:0`
    const token = payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url')
    const body = {state:{_ts:600,workouts:[],routines:[]},baseRev:'4'}, bytes = JSON.stringify(body)
    expect(validateRequest('PUT /api/data',body)).toEqual({ok:true})
    expect(JSON.stringify(body)).toBe(bytes)
    const res = await fetch(`http://127.0.0.1:${match[1]}/api/data`, {method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:bytes})
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({error:'conflict',rev:4})
    const stored = readDoc()
    expect(stored).toEqual({_rev:4,workouts:[],routines:[]})
    function readDoc() { return JSON.parse(readFileSync(join(dir,`state-${uid}.json`),'utf8')) }
  } finally { child.kill('SIGKILL'); await child.exited; rmSync(dir,{recursive:true,force:true}) }
}, 15_000)
