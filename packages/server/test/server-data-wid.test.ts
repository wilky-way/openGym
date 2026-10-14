import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { dataServer, dataHeaders } from './data-helpers'
test('PUT /api/data: write ids, their ancestry, and a stale write id refused at a reused revision', async () => {
  const h = dataServer(['u1']); const {dataDir, api: base} = h; const headers = dataHeaders('u1');
  const put = async (body: any) => { const r = await fetch(`${base}/api/data`, { method: 'PUT', headers, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const file = path.join(dataDir, 'state-u1.json');

  const a = await put({ state: { _ts: 1, workouts: [], routines: [] }, baseRev: 0 });
  assert.equal(a.status, 200);
  const backup = fs.readFileSync(file, 'utf8');   // the nightly backup, at rev 1
  const b = await put({ state: { _ts: 2, workouts: [{ id: 'LegDay', d: '2026-10-01' }], routines: [] }, baseRev: 1, baseWid: a.body.wid });
  assert.equal(b.status, 200);
  assert.notEqual(b.body.wid, a.body.wid);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8'))._wids, [a.body.wid]);
  // restored, and another device writes rev 2 again
  h.plant(backup);
  const other = await put({ state: { _ts: 3, workouts: [{ id: 'B', d: '2026-10-02' }], routines: [] }, baseRev: 1, baseWid: a.body.wid });
  assert.equal(other.status, 200);
  assert.equal(other.body.rev, 2);
  // the first device, at "rev 2" of the lost document, is refused with the current one
  const stale = await put({ state: { _ts: 4, workouts: [], routines: [] }, baseRev: 2, baseWid: b.body.wid });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.state.workouts.map((w: any) => w.id), ['B']);
  // Quoting an explicit absent identity cannot overwrite a new same-revision document.
  const absent = await put({ state: { workouts: [], routines: [] }, baseRev: 2, baseWid: null });
  assert.equal(absent.status, 409);
  assert.deepEqual(absent.body.state.workouts.map((w: any) => w.id), ['B']);
  // Nor may an old non-null identity overwrite an identity-less restored legacy document.
  const legacy = JSON.parse(fs.readFileSync(file, "utf8")); delete legacy._wid;
  h.plant(legacy);
  const missing = await put({ state: { workouts: [], routines: [] }, baseRev: 2, baseWid: other.body.wid });
  assert.equal(missing.status, 409);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).workouts.map((w: any) => w.id), ['B']);
  h.plant({...legacy, _wid:other.body.wid});
  // its rev check sees the other write id
  const rev = await (await fetch(`${base}/api/data/rev`, { headers })).json();
  assert.deepEqual(rev, { rev: 2, wid: other.body.wid });
});
