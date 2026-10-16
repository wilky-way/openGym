// Complete legacy rewind/ancestry scenario twin.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startDataOracle, headers, oracleResponse } from './helpers'
test('PUT /api/data: write ids, their ancestry, and a stale write id refused at a reused revision', async () => {
  const h = await startDataOracle('u1');
  const dataDir = h.dataDir;
  const authHeaders = headers('u1');
  const put = async (body: unknown) => { const r = await oracleResponse(h, '/api/data', { method: 'PUT', headers: authHeaders, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const file = path.join(dataDir, 'state-u1.json');

  const a = await put({ state: { _ts: 1, workouts: [], routines: [] }, baseRev: 0 });
  assert.equal(a.status, 200);
  const backup = fs.readFileSync(file, 'utf8');   // the nightly backup, at rev 1
  const b = await put({ state: { _ts: 2, workouts: [{ id: 'LegDay', d: '2026-10-01' }], routines: [] }, baseRev: 1, baseWid: a.body.wid });
  assert.equal(b.status, 200);
  assert.notEqual(b.body.wid, a.body.wid);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8'))._wids, [a.body.wid]);
  // restored, and another device writes rev 2 again
  fs.writeFileSync(file, backup);
  const other = await put({ state: { _ts: 3, workouts: [{ id: 'B', d: '2026-10-02' }], routines: [] }, baseRev: 1, baseWid: a.body.wid });
  assert.equal(other.status, 200);
  assert.equal(other.body.rev, 2);
  // the first device, at "rev 2" of the lost document, is refused with the current one
  const stale = await put({ state: { _ts: 4, workouts: [], routines: [] }, baseRev: 2, baseWid: b.body.wid });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.state.workouts.map((w: {id: string}) => w.id), ['B']);
  // Quoting an explicit absent identity cannot overwrite a new same-revision document.
  const absent = await put({ state: { workouts: [], routines: [] }, baseRev: 2, baseWid: null });
  assert.equal(absent.status, 409);
  assert.deepEqual(absent.body.state.workouts.map((w: {id: string}) => w.id), ['B']);
  // Nor may an old non-null identity overwrite an identity-less restored legacy document.
  const legacy = JSON.parse(fs.readFileSync(file, 'utf8')); delete legacy._wid;
  fs.writeFileSync(file, JSON.stringify(legacy));
  const missing = await put({ state: { workouts: [], routines: [] }, baseRev: 2, baseWid: other.body.wid });
  assert.equal(missing.status, 409);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).workouts.map((w: {id: string}) => w.id), ['B']);
  fs.writeFileSync(file, JSON.stringify({...legacy, _wid:other.body.wid}));
  // its rev check sees the other write id
  const rev = await (await oracleResponse(h, '/api/data/rev', { headers: authHeaders })).json();
  assert.deepEqual(rev, { rev: 2, wid: other.body.wid });
});
