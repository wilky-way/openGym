import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { matchRoute } from '../packages/contract/src/validators'
const rows: {method: string; path: string; source: string; body: unknown}[] = readFileSync(process.argv[2] ?? '.gate/legacy-requests.jsonl', 'utf8').trim().split('\n').map(s => JSON.parse(s))
const kept = rows.flatMap(row => {
  const route = matchRoute(row.method, row.path)
  if (!route) return [] // Deleted routes must 404 and have no request validator.
  const fixture = row.source.match(/(?:packages\/parity\/fixtures\/oracle|legacy)\/api\/test\/([^ )]+)/)?.[1]
  const source = fixture ? `public synthetic API test/${fixture}` : 'public synthetic API fixture'
  return [{ route, source, body: row.body }]
})
mkdirSync('packages/contract/test/fixtures', {recursive:true})
writeFileSync('packages/contract/test/fixtures/legacy-requests.jsonl', kept.map(r => JSON.stringify(r)).join('\n') + '\n')
console.log(`Recorded ${rows.length} parsed object bodies; retained ${kept.length} across ${new Set(kept.map(r => r.route)).size} KEEP routes; excluded ${rows.length - kept.length} deleted-route requests`)
