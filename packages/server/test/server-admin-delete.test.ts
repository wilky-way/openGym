import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { writeAccountsMirror } from '../src/storage'
import { startAdmin, ADMIN, ADMIN2, VICTIM, as, asAdmin, mintSession } from './admin-helpers'
test('removes the account and everything attached to it', async () => {
  const h = await startAdmin();
  assert.ok(fs.existsSync(path.join(h.dataDir, `state-${VICTIM}.json`)));
  const res = await h.del(VICTIM);
  assert.equal(res.status, 200);

  const db = h.db();
  assert.deepEqual(db.users.map((u: any) => u.id), [ADMIN], 'the user is gone');
  assert.deepEqual(db.creds.map((c: any) => c.userId), [ADMIN], 'their passkeys are gone');
  assert.deepEqual(db.subs.map((s: any) => s.userId), [ADMIN], 'their push subscriptions are gone');
  assert.equal(fs.existsSync(path.join(h.dataDir, `state-${VICTIM}.json`)), false, 'their history is gone');
  // The code they joined with stays burned: it was used, and freeing it would quietly widen
  // an invite-only instance.
  assert.equal(db.invites[0].usedBy, VICTIM);
  assert.equal(h.stackFrames(), 0, `no stack traces:\n${h.log}`);
});

test('their session stops working immediately', async () => {
  const h = await startAdmin();
  const before = await fetch(`${h.api}/api/me`, { headers: as(VICTIM) });
  assert.equal(before.status, 200);
  await h.del(VICTIM);
  const after = await fetch(`${h.api}/api/me`, { headers: as(VICTIM) });
  assert.equal(after.status, 401, 'a cookie for a deleted account is worthless');
});

test('refuses the two deletions that cannot be undone', async () => {
  const h = await startAdmin();
  const self = await h.del(ADMIN);
  assert.equal(self.status, 400);
  assert.match(self.body.error, /your own account/);

  const last = await h.del(ADMIN, ADMIN);   // ADMIN is also the only admin
  assert.equal(last.status, 400);
  assert.equal(h.db().users.length, 2, 'nothing was removed');
});

test('another admin can be deleted while one remains', async () => {
  const h = await startAdmin({ twoAdmins: true });
  const res = await h.del(ADMIN2);
  assert.equal(res.status, 200);
  assert.deepEqual(h.db().users.map((u: any) => u.id).sort(), [ADMIN, VICTIM].sort());
});

test('says so plainly when the account is not there, and needs an admin', async () => {
  const h = await startAdmin();
  const missing = await h.del('nobody');
  assert.equal(missing.status, 404);
  const asVictim = await h.del(ADMIN, VICTIM);
  assert.equal(asVictim.status, 403, 'an ordinary user cannot delete anyone');
  assert.equal(h.db().users.length, 2);
});
