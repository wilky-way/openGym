import { test, afterEach } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { dataServer, dataHeaders } from './data-helpers'
const UID = 'u_bad_1', authed = dataHeaders(UID)
async function status(h: ReturnType<typeof dataServer>, method: string, p: string, headers: HeadersInit, body?: string) {
 const r = await fetch(h.api + p, {method,headers,body}); return {status:r.status,body:await r.json() as any}
}
const rawPut = (h: ReturnType<typeof dataServer>, agent: http.Agent, body: string): Promise<{status:number;body:any}> => new Promise((resolve,reject) => {
 const rq=http.request(h.api+'/api/data',{method:'PUT',headers:authed,agent},res=>{let data='';res.on('data',d=>data+=d);res.on('end',()=>resolve({status:res.statusCode!,body:JSON.parse(data)}))});rq.on('error',reject);rq.end(body)
})
test('malformed and non-object JSON bodies are a 400 with no stack trace, on every route', async () => {
 const h=dataServer([UID]);
 for(const body of ['{','null','[]','7','"x"']) {
  const r=await status(h,'PUT','/api/data',authed,body);
  assert.equal(r.status,400); assert.equal(r.body.error,'invalid json')
 }
 assert.equal((await status(h,'PUT','/api/data',authed)).body.error,'state required')
 assert.equal((await h.call('PUT','/api/data',{state:{workouts:[],routines:[]}})).status,200)
 assert.equal(h.logs.length,0)
})
test('a body over the 5 MiB cap is a 413 that every client gets to read, and nothing is written', async () => {
  const h = dataServer([UID]);
  const big = JSON.stringify({ state: { workouts: [], routines: [], pad: 'x'.repeat(6 * 1024 * 1024) }, baseRev: 0 });
  let r = await status(h, 'PUT', '/api/data', authed, big);
  assert.equal(r.status, 413);
  assert.equal(r.body.error, 'body too large');
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${UID}.json`)), false, 'nothing was written');
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  afterEach(() => agent.destroy());
  for (let i = 0; i < 3; i++) {
    r = await rawPut(h, agent, big);
    assert.equal(r.status, 413, `node client, attempt ${i + 1}`);
  }
  // The same keep-alive socket, and the server as a whole, are still fine afterwards.
  r = await rawPut(h, agent, JSON.stringify({ state: { workouts: [], routines: [] }, baseRev: 0 }));
  assert.equal(r.status, 200);
  // Past twice the cap the upload is cut off rather than drained: the 413 may or may not
  // arrive, but the process must not be left reading, and must still serve.
  const huge = 'x'.repeat(11 * 1024 * 1024);
  await rawPut(h, new http.Agent(), huge).catch(() => {});
  r = await status(h, 'GET', '/api/health', {});
  assert.equal(r.status, 200);
  assert.equal(h.logs.filter(x => /at .*:[0-9]+:[0-9]+/.test(x)).length, 0, `stack traces in the log:\n${h.logs.join("\n")}`);
});

test('PUT /api/data: an array is not a document, and null entries never reach the disk', async () => {
  const h = dataServer([UID]);
  const put = (body: any) => status(h, 'PUT', '/api/data', authed, JSON.stringify(body));
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${UID}.json`), 'utf8'));

  let r = await put({ state: { _ts: 100, workouts: [{ id: 'w1', d: '2026-09-01' }], routines: [], unit: 'kg' }, baseRev: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 1);

  // An array passes `typeof === 'object'`; it used to be written as `[]`, losing the document
  // and, since `_rev` cannot live on an array, resetting the revision to 0 while the response
  // claimed rev 2.
  r = await put({ state: [], baseRev: 1 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid state');
  assert.equal(onDisk()._rev, 1);
  assert.deepEqual(onDisk().workouts.map((w: any) => w.id), ['w1']);
  r = await status(h, 'GET', '/api/data/rev', authed);
  assert.deepEqual(r.body, { rev: 1, wid: onDisk()._wid });

  // Null and other non-object entries are dropped: every server-side reader of the document
  // (reminder tick, admin drill-down) dereferences the entries, and a 400 would strand a client
  // whose own copy is already malformed.
  r = await put({ state: { workouts: [null, { id: 'w2', d: '2026-09-02' }, 7, 'x', [], { id: 'w3', d: '2026-09-03' }], routines: [null, { id: 'r1', name: 'A', ex: [] }], unit: 'kg' }, baseRev: 1 });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 2);
  assert.deepEqual(onDisk().workouts.map((w: any) => w.id), ['w2', 'w3']);
  assert.deepEqual(onDisk().routines.map((x: any) => x.id), ['r1']);
  // Absent lists stay absent from a client that stamps its own changes: every client fills its
  // own defaults. From one that does not, a list it left out is one it never knew, and the stored
  // one stays (sync-stamps.js keepUnknown).
  r = await put({ state: { unit: 'kg' }, baseRev: 2 });
  assert.equal(r.status, 200);
  assert.deepEqual(onDisk().workouts.map((w: any) => w.id), ['w2', 'w3']);
  // What it was told is not what is stored, so the revision moves on past the one it was told.
  assert.equal(r.body.rev, 3);
  assert.equal(onDisk()._rev, 4);
  r = await put({ state: { unit: 'kg' }, baseRev: 3, stamped: true });
  assert.equal(r.status, 409);
  r = await put({ state: { unit: 'kg' }, baseRev: 4, stamped: true });
  assert.equal(r.status, 200);
  assert.equal('workouts' in onDisk(), false);
  assert.equal(h.logs.filter(x => /at .*:[0-9]+:[0-9]+/.test(x)).length, 0, `stack traces in the log:\n${h.logs.join("\n")}`);
});

test('PUT /api/data: a document nested too deep to store is a 400, not a 500, and nothing is written', async () => {
  const h = dataServer([UID]);
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${UID}.json`), 'utf8'));
  let r = await status(h, 'PUT', '/api/data', authed, JSON.stringify({ state: { workouts: [], routines: [], unit: 'kg' }, baseRev: 0 }));
  assert.equal(r.status, 200);
  // JSON.parse takes this (it is not recursive in V8); JSON.stringify on the way to the disk is.
  const depth = 200000;
  const deep = '{"state":{"workouts":[],"routines":[],"x":' + '['.repeat(depth) + ']'.repeat(depth) + '},"baseRev":1}';
  r = await status(h, 'PUT', '/api/data', authed, deep);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid state');
  assert.equal(onDisk()._rev, 1);
  r = await status(h, 'GET', '/api/data/rev', authed);
  assert.deepEqual(r.body, { rev: 1, wid: onDisk()._wid });
  assert.equal(h.logs.filter(x => /at .*:[0-9]+:[0-9]+/.test(x)).length, 0, `stack traces in the log:\n${h.logs.join("\n")}`);
});

