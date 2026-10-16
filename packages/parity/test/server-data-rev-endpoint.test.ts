// Complete legacy rev-poll endpoint twin.
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { startDataOracle, headers, oracleResponse } from './helpers'
test('GET /api/data/rev tracks PUT /api/data', async () => {
  const oracle = await startDataOracle('u_rev_1');
  assert.equal((await oracleResponse(oracle, '/api/health')).status, 200);

  const h = headers('u_rev_1');
  assert.equal((await oracleResponse(oracle, '/api/data/rev')).status, 401);
  assert.deepEqual(await (await oracleResponse(oracle, '/api/data/rev', { headers: h })).json(), { rev: 0 });
  const put = await oracleResponse(oracle, '/api/data', { method: 'PUT', headers: h, body: JSON.stringify({ state: { workouts: [], routines: [] }, baseRev: 0 }) });
  assert.equal(put.status, 200);
  const after = await (await oracleResponse(oracle, '/api/data/rev', { headers: h })).json();
  assert.equal(after.rev, 1);
  assert.match(after.wid, /^[0-9a-f]{16}$/, 'the write id of the stored document');
});
