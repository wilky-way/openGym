import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { dataServer, dataHeaders } from './data-helpers'
test('GET /api/data/rev tracks PUT /api/data', async () => {
  const fixture = dataServer(['u_rev_1']); const {api: base} = fixture; const cookie = () => dataHeaders('u_rev_1').Cookie;
  assert.equal((await fetch(`${base}/api/health`)).status, 200);

  const h = { cookie: cookie(), origin: 'http://localhost:8080', 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/api/data/rev`)).status, 401);
  assert.deepEqual(await (await fetch(`${base}/api/data/rev`, { headers: h })).json(), { rev: 0 });
  const put = await fetch(`${base}/api/data`, { method: 'PUT', headers: h, body: JSON.stringify({ state: { workouts: [], routines: [] }, baseRev: 0 }) });
  assert.equal(put.status, 200);
  const after = await (await fetch(`${base}/api/data/rev`, { headers: h })).json();
  assert.equal(after.rev, 1);
  assert.match(after.wid, /^[0-9a-f]{16}$/, 'the write id of the stored document');
});
