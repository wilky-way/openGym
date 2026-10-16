// Executes only audited synthetic oracle API tests; never records a running instance.
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { delimiter, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyFrozenPublicOracle } from './verify-public-oracle'
import { run } from './files'

function diskFloor() {
  const raw=execFileSync('df',['-k','.'],{encoding:'utf8'})
  const available=Number(raw.trim().split('\n').at(-1)!.trim().split(/\s+/)[3])
  if(!Number.isFinite(available)||available/1048576<90)throw new Error('Synthetic corpus recording requires at least 90 GiB available')
}
if(Bun.version!=='1.4.1')throw new Error('Use Bun 1.4.1 first in child PATH')
verifyFrozenPublicOracle()
const node=execFileSync('mise',['which','node','--tool=node@22'],{encoding:'utf8'}).trim()
if(execFileSync(node,['--version'],{encoding:'utf8'}).trim()!=='v22.23.3')throw new Error('Synthetic oracle corpus is pinned to Node 22.23.3')
const api=resolve('packages/parity/fixtures/oracle/api')
const tests=readdirSync(resolve(api,'test')).filter(file=>file.endsWith('.test.js')).sort().map(file=>'test/'+file)
if(!tests.length)throw new Error('Synthetic oracle API test inventory is empty')
process.umask(0o022)
diskFloor()
mkdirSync('.gate',{recursive:true})
diskFloor()
const scratch=mkdtempSync(resolve('.gate/public-corpus-'))
chmodSync(scratch,0o700)
const log=resolve(scratch,'requests.jsonl'),home=resolve(scratch,'home')
diskFloor()
mkdirSync(home,{mode:0o700});chmodSync(home,0o700)
console.log(`Private synthetic request log: ${log}`)
// Source tests own finite temporary DATA_DIRs and loopback children. Drop host service configuration.
const childPath=[dirname(process.execPath),dirname(node),process.env.PATH].filter(Boolean).join(delimiter)
const env:Record<string,string>={PATH:childPath,HOME:home,ORACLE_REQUEST_LOG:log,
  OPENGYM_CORPUS_HARNESS:'synthetic-node-recording-v1',
  NODE_OPTIONS:`--import=${pathToFileURL(resolve('scripts/corpus-loopback.mjs')).href}`}
for(const key of ['TMPDIR','TZ'])if(process.env[key])env[key]=process.env[key]!
diskFloor()
const child=Bun.spawn([node,'--import',resolve('scripts/record-requests.mjs'),'--test','--test-concurrency=1',...tests],{cwd:api,env,stdout:'inherit',stderr:'inherit'})
const code=await child.exited
if(code!==0)throw new Error(`Synthetic API recording tests failed (${code}); raw requests retained, no corpus freeze`)
chmodSync(log,0o600)
const rows=readFileSync(log,'utf8').trim().split('\n')
if(rows.length<=500)throw new Error(`Synthetic request corpus needs more than 500 captured objects; received ${rows.length}`)
diskFloor()
await run(['bun','scripts/freeze-requests.ts',log])
if(readFileSync('packages/contract/test/fixtures/legacy-requests.jsonl','utf8').trim().split('\n').length<=500)throw new Error('Fewer than 501 retained public request objects; raw capture retained')
console.log(`Synthetic corpus recorded from ${tests.length} original API test files; no live API/profile was read`)
