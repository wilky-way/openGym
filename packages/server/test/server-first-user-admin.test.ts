import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { startServer, user, softPasskey, mintSession } from './passkey-helpers'
async function registerPasskey(h: Awaited<ReturnType<typeof startServer>>, name: string, ip: string) {
  const opt = await h.req('POST', '/api/register/options', { body: { name }, ip });
  assert.equal(opt.status, 200);
  return h.req('POST', '/api/register/verify', { body: { cid: opt.body.cid, credential: softPasskey().attestation(opt.body.options.challenge) }, ip });
}
const stored = (h: Awaited<ReturnType<typeof startServer>>, id: string) => h.db().users.find((u: any) => u.id === id);

test('the first passkey registration on an empty instance is the admin, the second is not', async () => {
  const h = await startServer(undefined, { env: { FIRST_USER_ADMIN: '1' } });
  const first = await registerPasskey(h, 'Ana', '198.51.100.20');
  assert.equal(first.status, 200);
  assert.equal(first.body.user.admin, true);
  assert.equal(stored(h, first.body.user.id).admin, true);
  assert.ok(h.audit().some(e => e.ev === 'admin.first-user' && e.uid === first.body.user.id));
  const second = await registerPasskey(h, 'Bea', '198.51.100.21');
  assert.equal(second.status, 200);
  assert.equal(second.body.user.admin, false);
  assert.equal('admin' in stored(h, second.body.user.id), false);
});

test('unset or FIRST_USER_ADMIN=0 leaves the first profile an ordinary one', async () => {
  for (const off of [undefined, '', '0', 'false', 'off']) {
    const h = await startServer(undefined, { env: { FIRST_USER_ADMIN: off } });
    const r = await registerPasskey(h, 'Ana', '198.51.100.30');
    assert.equal(r.status, 200);
    assert.equal(r.body.user.admin, false, String(off));
    assert.equal('admin' in stored(h, r.body.user.id), false, String(off));
    const k = await registerPasskey(h, 'Bea', '198.51.100.31');
    assert.equal(k.body.user.admin, false, String(off));
  }
});

test('an instance that already has profiles promotes nobody on upgrade or on a new registration', async () => {
  const h = await startServer(undefined, { env: { FIRST_USER_ADMIN: '1' }, users: [user('u1', 'Old'), user('u2', 'Older')] });
  assert.equal(stored(h, 'u1').admin, undefined);
  const r = await registerPasskey(h, 'New', '198.51.100.40');
  assert.equal(r.status, 200);
  assert.equal(r.body.user.admin, false);
  const k = await registerPasskey(h, 'Newer', '198.51.100.41');
  assert.equal(k.body.user.admin, false);
  assert.equal(h.db().users.filter((u: any) => u.admin === true).length, 0);
});

test('an ADMIN_UIDS admin stays an admin, and does not make the next profile one', async () => {
  const h = await startServer(undefined, { env: { ADMIN_UIDS: 'u1', FIRST_USER_ADMIN: '1' }, users: [user('u1', 'Owner')] });
  assert.equal((await h.req('GET', '/api/me', { cookie: mintSession('u1') })).body.user.admin, true);
  const r = await registerPasskey(h, 'Guest', '198.51.100.50');
  assert.equal(r.body.user.admin, false);
});
