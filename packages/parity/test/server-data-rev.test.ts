// Complete legacy scenario twin; only server lifecycle/auth/clock plumbing changes.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PINNED_NOW } from '../src'
import { startDataOracle, headers, oracleResponse } from './helpers'
test('GET/PUT /api/data: revisions, conditional writes and the legacy overwrite', async () => {
  const h = await startDataOracle('u_rev_1');
  const uid = 'u_rev_1';
  const get = async () => { const r = await oracleResponse(h, '/api/data', { headers: headers(uid) }); return { status: r.status, body: await r.json() }; };
  const put = async (body: unknown) => { const r = await oracleResponse(h, '/api/data', { method: 'PUT', headers: headers(uid), body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${uid}.json`), 'utf8'));

  // nothing synced yet
  let r = await get();
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { state: null, rev: 0 });

  // first write against rev 0
  r = await put({ state: { _ts: 100, workouts: [{ id: 'w1', d: '2026-09-01' }], routines: [], active: { id: 'running' } }, baseRev: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.rev, 1);
  assert.equal(r.body.ts, 100);
  assert.equal(onDisk()._rev, 1);
  assert.equal('active' in onDisk(), false, 'active is stripped');

  r = await get();
  assert.equal(r.body.rev, 1);
  assert.equal(r.body.state._rev, 1);
  assert.deepEqual(r.body.state.workouts.map((w: {id: string}) => w.id), ['w1']);

  // the same baseRev again — someone else already wrote rev 1 — is a conflict, and the current
  // document comes back with it
  r = await put({ state: { _ts: 200, workouts: [], routines: [] }, baseRev: 0 });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'conflict');
  assert.equal(r.body.rev, 1);
  assert.deepEqual(r.body.state.workouts.map((w: {id: string}) => w.id), ['w1']);
  assert.deepEqual(onDisk().workouts.map((w: {id: string}) => w.id), ['w1'], 'a refused write changes nothing');

  // a client from before revisions sends no baseRev and overwrites, as it always did
  r = await put({ state: { _ts: 300, workouts: [{ id: 'w2', d: '2026-09-02' }], routines: [] } });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 2);
  assert.deepEqual(onDisk().workouts.map((w: {id: string}) => w.id), ['w2']);

  // a matching baseRev goes through; a client-supplied _rev is ignored
  r = await put({ state: { _ts: 400, _rev: 99, workouts: [{ id: 'w3', d: '2026-09-03' }], routines: [] }, baseRev: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 3);
  assert.equal(onDisk()._rev, 3);

  // an explicit null is "no baseRev", not "rev null"
  r = await put({ state: { _ts: 500, workouts: [], routines: [] }, baseRev: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.rev, 4);

  // a baseRev that is a string never matches (no coercion)
  r = await put({ state: { _ts: 600, workouts: [], routines: [] }, baseRev: '4' });
  assert.equal(r.status, 409);

  // the shape check still comes first
  r = await put({ state: { workouts: 'nope' }, baseRev: 4 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid state');
  assert.equal(onDisk()._rev, 4);
});

// `{}` keeps every rule this route has and still empties the profile: it is
// an object, it is not an array, `workouts` and `routines` are absent (which is legal — a client
// fills its own defaults), so the document on disk becomes `{"_rev":n+1}` with every routine,
// workout and weigh-in gone, and the revision keeps counting so the next poll sees nothing wrong.
// No shipped client sends it: the web and mobile clients push a state built on DEF, which always
// carries its keys.
test('PUT /api/data refuses an empty object, which would wipe the profile and keep counting', async () => {
  const h = await startDataOracle('u_rev_1');
  const uid = 'u_rev_1';
  const put = async (body: unknown) => { const r = await oracleResponse(h, '/api/data', { method: 'PUT', headers: headers(uid), body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
  const rev = async () => (await oracleResponse(h, '/api/data/rev', { headers: headers(uid) }).then(r => r.json())).rev;
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${uid}.json`), 'utf8'));

  assert.equal((await put({ state: { _ts: 100, workouts: [{ id: 'w1', d: '2026-09-01' }], routines: [] } })).status, 200);
  assert.equal(await rev(), 1);

  // `_rev` and `_ts` are this route's own bookkeeping — it stamps the one and echoes the other —
  // so a document carrying nothing but those is the same empty push wearing a hat, and did the
  // same damage: `{"_rev":5}` wrote `{"_rev":2}` over the profile.
  for (const state of [{}, { _rev: 5 }, { _ts: PINNED_NOW }, { _rev: 5, _ts: PINNED_NOW }]) {
    const r = await put({ state, baseRev: 1 });
    assert.equal(r.status, 400, `state: ${JSON.stringify(state)}`);
    assert.equal(r.body.error, 'state required');
  }
  assert.equal(await rev(), 1, 'nothing was written');
  assert.deepEqual(onDisk().workouts.map((w: {id: string}) => w.id), ['w1'], 'the profile is still there');

  // …and a document that carries one real key alongside them is a profile, and goes through.
  assert.equal((await put({ state: { _rev: 99, _ts: 1, routines: [] }, baseRev: 1, stamped: true })).status, 200);
  assert.equal(await rev(), 2);
});
