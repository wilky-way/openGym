// Complete legacy scenario twin; only server lifecycle/auth/clock plumbing changes.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PINNED_NOW } from '../src'
import { startDataOracle, headers, oracleResponse } from './helpers'
const UID = 'u_reset_1'
test('PUT /api/data keeps the reset stamp when a write lacks it or carries an older one', async () => {
  const h = await startDataOracle(UID);
  const put = async (body: unknown) => {
    const r = await oracleResponse(h, '/api/data', { method: 'PUT', headers: headers(UID), body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const onDisk = () => JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${UID}.json`), 'utf8'));
  const ids = { workouts: ['w-old'] };

  // the reset
  let r = await put({ state: { _ts: 100, workouts: [], routines: [], resetAt: 5000, resetIds: ids } });
  assert.equal(r.status, 200);
  assert.equal(onDisk().resetAt, 5000);

  // a backup restored over it, with no stamp: its workouts land, the stamp stays
  r = await put({ state: { _ts: 50, workouts: [{ id: 'w-old', d: '2026-01-01' }], routines: [] } });
  assert.equal(r.status, 200);
  assert.deepEqual(onDisk().workouts.map((w: {id: string}) => w.id), ['w-old']);
  assert.equal(onDisk().resetAt, 5000);
  assert.deepEqual(onDisk().resetIds, ids);

  // an older stamp does not take it back either
  r = await put({ state: { _ts: 60, workouts: [], routines: [], resetAt: 10, resetIds: { workouts: ['x'] } }, baseRev: 2 });
  assert.equal(r.status, 200);
  assert.equal(onDisk().resetAt, 5000);
  assert.deepEqual(onDisk().resetIds, ids);

  // a later reset moves it forward
  r = await put({ state: { _ts: 70, workouts: [], routines: [], resetAt: 9000, resetIds: { workouts: ['w-new'] } } });
  assert.equal(r.status, 200);
  assert.equal(onDisk().resetAt, 9000);
  assert.deepEqual(onDisk().resetIds, { workouts: ['w-new'] });
});

test('PUT /api/data: a profile never reset gets no stamp', async () => {
  const h = await startDataOracle(UID);
  const r = await oracleResponse(h, '/api/data', { method: 'PUT', headers: headers(UID), body: JSON.stringify({ state: { _ts: 1, workouts: [], routines: [] } }) });
  assert.equal(r.status, 200);
  const doc = JSON.parse(fs.readFileSync(path.join(h.dataDir, `state-${UID}.json`), 'utf8'));
  assert.equal('resetAt' in doc, false);
  assert.equal('resetIds' in doc, false);
});
