import { test } from 'bun:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { hashLinkCode } from '../src/device-link'
import { MAX_PASSKEYS } from '../src/passkeys-store'
import { CLOCK } from './auth-helpers'
import { makeLink, redeem, startServer, softPasskey, user, withPassword, GOOD, mintSession, b64u } from './passkey-helpers'
test('the list is the caller’s own passkeys, without key material, and says when one is the last way in', async () => {
  const a = softPasskey(), b = softPasskey(), c = softPasskey();
  const h = await startServer(undefined, {
    users: [user('u1', 'Ana'), user('u2', 'Bea')],
    creds: [a.row('u1', { name: 'Laptop', created: '2026-09-01T00:00:00.000Z' }), b.row('u2'), c.row('u1')]
  });
  assert.equal((await h.req('GET', '/api/account/passkeys')).status, 401);
  const r = await h.req('GET', '/api/account/passkeys', { cookie: mintSession('u1') });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.passkeys.map((p: any) => p.id), [a.id, c.id]);
  assert.deepEqual(r.body.passkeys[0], { id: a.id, name: 'Laptop', created: '2026-09-01T00:00:00.000Z', lastUsed: null, transports: ['internal'] });
  assert.ok(r.body.passkeys.every((p: any) => !('publicKey' in p) && !('userId' in p) && !('counter' in p)));
  assert.equal(r.body.lastWayIn, false);
  assert.equal(r.body.password, false);
  const bea = await h.req('GET', '/api/account/passkeys', { cookie: mintSession('u2') });
  assert.equal(bea.body.lastWayIn, true);
});

test('adding a passkey needs proof, excludes the ones the profile has, and the new one signs in', async () => {
  const key = softPasskey(), fresh = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.20', cookie = mintSession('u1');
  // A session on its own is not enough.
  const bare = await h.req('POST', '/api/account/passkeys/options', { body: {}, cookie, ip });
  assert.equal(bare.status, 403);
  assert.equal(bare.body.code, 'passkey-required');

  const opt = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(key!, ip), cookie, ip });
  assert.equal(opt.status, 200);
  assert.deepEqual(opt.body.options.excludeCredentials.map((c: any) => c.id), [key.id]);
  assert.equal(opt.body.options.user.id, b64u('u1'));   // the profile's own user handle, as at sign-up
  const ver = await h.req('POST', '/api/account/passkeys/verify', {
    body: { cid: opt.body.cid, credential: fresh.attestation(opt.body.options.challenge), name: ' Phone\n' }, cookie, ip
  });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  assert.deepEqual(ver.body.passkeys.map((p: any) => p.id), [key.id, fresh.id]);
  const row = h.db().creds.find((c: any) => c.id === fresh.id);
  assert.equal(row.userId, 'u1');
  assert.equal(row.name, 'Phone');
  assert.ok(row.created);
  // The confirming passkey was used just now.
  assert.ok(h.db().creds.find((c: any) => c.id === key.id).lastUsed);
  assert.ok(h.audit().some(e => e.ev === 'auth.passkey.add' && e.uid === 'u1' && e.msg === 'passkey'));

  // The new passkey is a way in of its own.
  const lo = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
  const signedIn = await h.req('POST', '/api/login/verify', { body: { cid: lo.cid, credential: fresh.assertion(lo.options.challenge) }, ip });
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.user.id, 'u1');
  assert.ok(h.db().creds.find((c: any) => c.id === fresh.id).lastUsed);

  // The same authenticator again is refused, not stored twice.
  const again = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(key!, ip), cookie, ip });
  const dup = await h.req('POST', '/api/account/passkeys/verify', { body: { cid: again.body.cid, credential: fresh.attestation(again.body.options.challenge) }, cookie, ip });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, 'credential-exists');
  assert.equal(h.db().creds.length, 2);
});

test('another profile’s passkey, or a challenge minted for another profile, adds nothing', async () => {
  const ana = softPasskey(), bea = softPasskey(), fresh = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [ana.row('u1'), bea.row('u2')] });
  const ip = '198.51.100.21';
  // Bea's session confirmed with Ana's passkey.
  const wrong = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(ana, ip), cookie: mintSession('u2'), ip });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.code, 'passkey');
  assert.ok(h.audit().some(e => e.ev === 'auth.proof.fail' && e.act === 'passkey-add' && e.uid === 'u2' && e.msg === 'step-up-failed'));
  // Ana's ceremony finished under Bea's session.
  const opt = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(ana, ip), cookie: mintSession('u1'), ip });
  const hijack = await h.req('POST', '/api/account/passkeys/verify', {
    body: { cid: opt.body.cid, credential: fresh.attestation(opt.body.options.challenge) }, cookie: mintSession('u2'), ip
  });
  assert.equal(hijack.status, 400);
  assert.equal(h.db().creds.length, 2);
  // A registration made for another origin does not verify.
  const opt2 = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(ana, ip), cookie: mintSession('u1'), ip });
  const phish = await h.req('POST', '/api/account/passkeys/verify', {
    body: { cid: opt2.body.cid, credential: fresh.attestation(opt2.body.options.challenge, { origin: 'https://evil.example' }) }, cookie: mintSession('u1'), ip
  });
  assert.equal(phish.status, 400);
  assert.equal(h.db().creds.length, 2);
});

test('signing out everywhere between the proof and the new passkey ends the ceremony', async () => {
  const key = softPasskey(), fresh = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.22', cookie = mintSession('u1');
  const opt = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(key!, ip), cookie, ip });
  assert.equal((await h.req('POST', '/api/logout/all', { body: {}, cookie, ip })).status, 200);
  // Even a session signed in afterwards cannot finish a ceremony begun under the old version.
  const late = await h.req('POST', '/api/account/passkeys/verify', {
    body: { cid: opt.body.cid, credential: fresh.attestation(opt.body.options.challenge) }, cookie: mintSession('u1', 1), ip
  });
  assert.equal(late.status, 401);
  assert.equal(h.db().creds.length, 1);
});

test('with PASSWORD_LOGIN off only a passkey proves anything; a stored password is ignored', async () => {
  const key = softPasskey(), other = softPasskey();
  const h = await startServer(undefined, { env: { PASSWORD_LOGIN: '' }, users: [withPassword('u1', 'Ana'), withPassword('u2', 'Bea')], creds: [key.row('u1'), other.row('u1')] });
  const ip = '198.51.100.24', cookie = mintSession('u1');
  assert.equal((await h.req('GET', '/api/account/passkeys', { cookie, ip })).body.password, false);
  for (let i = 0; i < 7; i++) {
    for (const [method, p] of [['POST', '/api/account/passkeys/options'], ['POST', '/api/account/device-link'], ['DELETE', '/api/account/passkeys?id=' + encodeURIComponent(other.id)]] as const) {
      for (const current of [GOOD, 'not it at all ' + i]) {
        const r = await h.req(method, p, { body: { current }, cookie, ip });
        assert.equal(r.status, 403, `${method} ${p}`);
        assert.equal(r.body.code, 'passkey-required', `${method} ${p}`);
      }
    }
  }
  assert.ok(!h.audit().some(e => e.ev === 'auth.password.fail' || e.ev === 'auth.proof.fail' || e.ev === 'auth.password.locked'));
  assert.equal(h.db().creds.length, 2);
  assert.deepEqual(h.db().deviceLinks || [], []);
  // A profile with only a password cannot confirm anything at all.
  assert.equal((await h.req('POST', '/api/account/passkeys/options', { body: { current: GOOD }, cookie: mintSession('u2'), ip })).body.code, 'passkey-required');
  // The passkey does, for all three.
  assert.equal((await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(key!, ip), cookie, ip })).status, 200);
  assert.equal((await h.req('POST', '/api/account/device-link', { body: await h.stepUp(key!, ip), cookie, ip })).status, 200);
  const removed = await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(other.id), { body: await h.stepUp(key!, ip), cookie, ip });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.passkeys.map((p: any) => p.id), [key.id]);
});

test('a profile has at most MAX_PASSKEYS passkeys', async () => {
  const keys = Array.from({ length: MAX_PASSKEYS }, () => softPasskey());
  const h = await startServer(undefined, { users: [user('u1', 'Ana')], creds: keys.map(k => k.row('u1')) });
  const ip = '198.51.100.27', cookie = mintSession('u1');
  const r = await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(keys[0]!, ip), cookie, ip });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'passkey-limit');
  assert.equal((await h.req('POST', '/api/account/device-link', { body: await h.stepUp(keys[0]!, ip), cookie, ip })).body.code, 'passkey-limit');
});

test('renaming touches only the caller’s own passkey', async () => {
  const a = softPasskey(), b = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [a.row('u1'), b.row('u2')] });
  const r = await h.req('POST', '/api/account/passkeys/rename', { body: { id: a.id, name: '  Work\tlaptop  ' }, cookie: mintSession('u1') });
  assert.equal(r.status, 200);
  assert.equal(r.body.passkeys[0].name, 'Work laptop');
  const theirs = await h.req('POST', '/api/account/passkeys/rename', { body: { id: b.id, name: 'mine' }, cookie: mintSession('u1') });
  assert.equal(theirs.status, 404);
  assert.equal(h.db().creds.find((c: any) => c.id === b.id).name, undefined);
  assert.equal((await h.req('POST', '/api/account/passkeys/rename', { body: { id: a.id, name: 'x' } })).status, 401);
});

test('removing: never the last way in, never someone else’s, audited, and it stops that passkey signing in', async () => {
  const a = softPasskey(), b = softPasskey(), bea = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [a.row('u1', { name: 'Old phone' }), b.row('u1'), bea.row('u2')] });
  const ip = '198.51.100.29', cookie = mintSession('u1');
  const del = async (id: string, proof: ReturnType<typeof softPasskey>) => h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(id), { body: await h.stepUp(proof, ip), cookie, ip });
  assert.equal((await del(bea.id, a)).status, 404);
  // A passkey may confirm its own removal: whoever uses it holds it.
  const first = await del(a.id, a);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.passkeys.map((p: any) => p.id), [b.id]);
  assert.equal(first.body.lastWayIn, true);
  assert.ok(h.audit().some(e => e.ev === 'auth.passkey.remove' && e.uid === 'u1' && e.msg === 'Old phone'));
  const last = await del(b.id, b);
  assert.equal(last.status, 409);
  assert.equal(last.body.code, 'last-way-in');
  assert.equal(h.db().creds.filter((c: any) => c.userId === 'u1').length, 1);
  // The removed passkey is unknown from now on…
  const lo = (await h.req('POST', '/api/login/options', { body: {} })).body;
  assert.equal((await h.req('POST', '/api/login/verify', { body: { cid: lo.cid, credential: a.assertion(lo.options.challenge) } })).status, 404);
  // …but sessions are not tied to a passkey, so one it opened lasts until "sign out everywhere".
  assert.equal((await h.req('GET', '/api/me', { cookie })).status, 200);
});

// A stolen cookie must not choose which of the owner's ways in is left, so removing takes the
// proof adding does. Every refusal below leaves both passkeys in place.
test('removing a passkey needs proof made for it: none, another profile’s passkey, another ceremony’s challenge or a spent one remove nothing', async () => {
  const a = softPasskey(), b = softPasskey(), bea = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [a.row('u1'), b.row('u1'), bea.row('u2')] });
  const ip = '198.51.100.30', cookie = mintSession('u1');
  const url = '/api/account/passkeys?id=' + encodeURIComponent(a.id);
  const refused = async (body: any, code: string) => {
    const r = await h.req('DELETE', url, { body, cookie, ip });
    assert.equal(r.status, 403, JSON.stringify(body)?.slice(0, 60));
    assert.equal(r.body.code, code);
    assert.deepEqual(h.db().creds.filter((c: any) => c.userId === 'u1').map((c: any) => c.id), [a.id, b.id]);
  };
  // A session on its own — with no body at all, or an empty one.
  await refused(undefined, 'passkey-required');
  await refused({}, 'passkey-required');
  // A password where the profile has none.
  await refused({ current: GOOD }, 'passkey-required');
  // Bea's passkey says nothing about Ana.
  await refused(await h.stepUp(bea, ip), 'passkey');
  assert.ok(h.audit().some(e => e.ev === 'auth.proof.fail' && e.act === 'passkey-remove' && e.uid === 'u1' && e.msg === 'step-up-failed'));
  // Challenges handed out for another ceremony, signed as if they were a sign-in's: adding a
  // passkey in Settings, a sign-up, redeeming a device link.
  const add = (await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(b, ip), cookie, ip })).body;
  await refused({ cid: add.cid, credential: b.assertion(add.options.challenge) }, 'passkey');
  const reg = (await h.req('POST', '/api/register/options', { body: { name: 'Mallory' }, ip })).body;
  await refused({ cid: reg.cid, credential: b.assertion(reg.options.challenge) }, 'passkey');
  const { code } = (await h.req('POST', '/api/account/device-link', { body: await h.stepUp(b, ip), cookie, ip })).body;
  const link = (await h.req('POST', '/api/device-link/options', { body: { code }, ip })).body;
  await refused({ cid: link.cid, credential: b.assertion(link.options.challenge) }, 'passkey');
  // A sign-in challenge signed for another one, and one that finished a sign-in already.
  const lo1 = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
  const lo2 = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
  await refused({ cid: lo1.cid, credential: b.assertion(lo2.options.challenge) }, 'passkey');
  const signedIn = await h.req('POST', '/api/login/verify', { body: { cid: lo2.cid, credential: b.assertion(lo2.options.challenge) }, ip });
  assert.equal(signedIn.status, 200);
  await refused({ cid: lo2.cid, credential: b.assertion(lo2.options.challenge) }, 'passkey');
  // A proof works once: the one that removed a passkey removes nothing else afterwards.
  const proof = await h.stepUp(b, ip);
  assert.equal((await h.req('DELETE', url, { body: proof, cookie, ip })).status, 200);
  const again = await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(b.id), { body: proof, cookie, ip });
  assert.equal(again.status, 409);   // b is the last way in now, which is answered before any proof
  assert.deepEqual(h.db().creds.filter((c: any) => c.userId === 'u1').map((c: any) => c.id), [b.id]);
  assert.equal(h.audit().filter(e => e.ev === 'auth.passkey.remove').length, 1);
});

test('a proof is spent by the removal it was made for, and a replayed one removes nothing', async () => {
  const a = softPasskey(), b = softPasskey(), c = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana')], creds: [a.row('u1'), b.row('u1'), c.row('u1')] });
  const ip = '198.51.100.31', cookie = mintSession('u1');
  const proof = await h.stepUp(c, ip);
  assert.equal((await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(a.id), { body: proof, cookie, ip })).status, 200);
  const replay = await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(b.id), { body: proof, cookie, ip });
  assert.equal(replay.status, 403);
  assert.equal(replay.body.code, 'passkey');
  assert.deepEqual(h.db().creds.map(x => x.id), [b.id, c.id]);
  // The confirming passkey's use is recorded like any other.
  assert.ok(h.db().creds.find(x => x.id === c.id).lastUsed);
});

test('a password is a way in only while the instance offers password sign-in', async () => {
  for (const [flag, status] of [['1', 409], ['', 409]] as const) {
    const key = softPasskey();
    const h = await startServer(undefined, { env: { PASSWORD_LOGIN: flag }, users: [withPassword('u1', 'Ana')], creds: [key.row('u1')] });
    const ip = flag ? '198.51.100.36' : '198.51.100.37';
    const list = await h.req('GET', '/api/account/passkeys', { cookie: mintSession('u1'), ip });
    assert.equal(list.body.lastWayIn, true);
    assert.equal(list.body.password, false);
    const r = await h.req('DELETE', '/api/account/passkeys?id=' + key.id, { body: await h.stepUp(key!, ip), cookie: mintSession('u1'), ip });
    assert.equal(r.status, status, `PASSWORD_LOGIN=${flag}`);
  }
});

test('a device link: made with proof, kept only as a hash, redeemed once by a new passkey that signs the device in', async () => {
  const key = softPasskey(), phone = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [key.row('u1')] });
  const ip = '198.51.100.40';
  assert.equal((await h.req('POST', '/api/account/device-link', { body: {} })).status, 401);
  assert.equal((await h.req('POST', '/api/account/device-link', { body: {}, cookie: mintSession('u1'), ip })).body.code, 'passkey-required');

  const made = await makeLink(h, key, 'u1', ip);
  assert.equal(made.status, 200);
  const { code, expires } = made.body;
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(expires > CLOCK + 9 * 60000 && expires <= CLOCK + 10 * 60000);
  const stored = fs.readFileSync(path.join(h.dataDir, 'db.json'), 'utf8');
  assert.doesNotMatch(stored, new RegExp(code));
  assert.doesNotMatch(stored, new RegExp(code.replace(/-/g, '')));
  assert.deepEqual(h.db().deviceLinks.map(l => [l.userId, l.h]), [['u1', hashLinkCode(code)]]);
  assert.ok(h.audit().some(e => e.ev === 'auth.link.create' && e.uid === 'u1' && e.msg === 'passkey'));

  // The other device, signed in as nobody.
  const opt = await h.req('POST', '/api/device-link/options', { body: { code: code.toLowerCase() }, ip: '198.51.100.41' });
  assert.equal(opt.status, 200);
  assert.equal(opt.body.name, 'Ana');
  assert.equal(opt.body.id, 'u1');   // what the other device tells profiles apart by, not the name
  assert.deepEqual(opt.body.options.excludeCredentials.map((c: any) => c.id), [key.id]);
  const done = await h.req('POST', '/api/device-link/verify', {
    body: { code, cid: opt.body.cid, credential: phone.attestation(opt.body.options.challenge), name: 'Phone' }, ip: '198.51.100.41'
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.deepEqual(done.body.user, { id: 'u1', name: 'Ana', admin: false });
  assert.ok(done.cookie);
  assert.equal((await h.req('GET', '/api/me', { cookie: done.cookie })).body.user.id, 'u1');
  const row = h.db().creds.find((c: any) => c.id === phone.id);
  assert.equal(row.userId, 'u1');
  assert.equal(row.name, 'Phone');
  assert.deepEqual(h.db().deviceLinks, []);
  assert.ok(h.audit().some(e => e.ev === 'auth.link.ok' && e.uid === 'u1'));

  // Used: gone for good, whichever step tries it.
  const again = await redeem(h, code, softPasskey(), '198.51.100.42');
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'link-invalid');
  assert.equal(h.db().creds.length, 2);
});

test('an expired link, a replaced link and a link of a disabled profile are all just wrong', async () => {
  const code = 'ABCD-EFGH-JKLM', old = 'ZZZZ-YYYY-XXXX', locked = 'QQQQ-RRRR-SSSS';
  const h = await startServer(undefined, {
    users: [user('u1', 'Ana'), user('u2', 'Bea', { disabled: true })],
    deviceLinks: [
      { h: hashLinkCode(code), userId: 'u1', exp: CLOCK - 1000, created: CLOCK - 601000 },
      { h: hashLinkCode(locked), userId: 'u2', exp: CLOCK + 60000, created: CLOCK }
    ]
  });
  const ip = '198.51.100.44';
  for (const c of [code, old, locked, '', 'x'.repeat(5000)]) {
    const r = await h.req('POST', '/api/device-link/options', { body: { code: c }, ip });
    assert.equal(r.status, 400, c.slice(0, 20));
    assert.equal(r.body.code, 'link-invalid');
  }
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: { toString: 1 } }, ip })).status, 400);
  assert.ok(h.audit().some(e => e.ev === 'auth.link.fail' && e.msg === 'user-unavailable' && e.uid === 'u2'));
});

test('removing a passkey drops an unused code, so one made with it just before adds nothing afterwards', async () => {
  const key = softPasskey(), stolen = softPasskey(), thief = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana')], creds: [key.row('u1'), stolen.row('u1', { name: 'Old phone' })] });
  const ip = '198.51.100.54';
  // Whoever holds the lost phone makes a code with its passkey…
  const { code } = (await makeLink(h, stolen, 'u1', ip)).body;
  assert.equal(h.db().deviceLinks.length, 1);
  // …the owner removes that passkey…
  assert.equal((await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(stolen.id), { body: await h.stepUp(key!, ip), cookie: mintSession('u1'), ip })).status, 200);
  assert.deepEqual(h.db().deviceLinks, []);
  // …and the code no longer adds a new one.
  const r = await redeem(h, code, thief, '203.0.113.54');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'link-invalid');
  assert.deepEqual(h.db().creds.map((c: any) => c.id), [key.id]);
  // A refused removal leaves the owner's own code alone.
  const mine = (await makeLink(h, key, 'u1', ip)).body.code;
  assert.equal((await h.req('DELETE', '/api/account/passkeys?id=' + encodeURIComponent(key.id), { body: await h.stepUp(key!, ip), cookie: mintSession('u1'), ip })).status, 409);
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: mine }, ip })).status, 200);
});

test('a newer link replaces the older one, and signing out everywhere or a new password drops it', async () => {
  const key = softPasskey();
  const h = await startServer(undefined, { users: [withPassword('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.45', cookie = mintSession('u1');
  const first = (await makeLink(h, key, 'u1', ip)).body.code;
  const second = (await makeLink(h, key, 'u1', ip)).body.code;
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: first }, ip })).status, 400);
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: second }, ip })).status, 200);
  await h.req('POST', '/api/logout/all', { body: {}, cookie, ip });
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code: second }, ip })).status, 400);


});

test('a link redeemed after the owner signed out everywhere mid-ceremony makes no passkey', async () => {
  const key = softPasskey(), thief = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.46';
  const { code } = (await makeLink(h, key, 'u1', ip)).body;
  const opt = await h.req('POST', '/api/device-link/options', { body: { code }, ip });
  await h.req('POST', '/api/logout/all', { body: {}, cookie: mintSession('u1'), ip });
  const r = await h.req('POST', '/api/device-link/verify', { body: { code, cid: opt.body.cid, credential: thief.attestation(opt.body.options.challenge) }, ip });
  assert.equal(r.status, 400);
  assert.equal(r.cookie, null);
  assert.equal(h.db().creds.length, 1);
});

test('two devices racing with one code: exactly one gets the passkey and the session', async () => {
  const key = softPasskey(), one = softPasskey(), two = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.47';
  const { code } = (await makeLink(h, key, 'u1', ip)).body;
  const o1 = (await h.req('POST', '/api/device-link/options', { body: { code }, ip })).body;
  const o2 = (await h.req('POST', '/api/device-link/options', { body: { code }, ip })).body;
  const results = await Promise.all([
    h.req('POST', '/api/device-link/verify', { body: { code, cid: o1.cid, credential: one.attestation(o1.options.challenge) }, ip }),
    h.req('POST', '/api/device-link/verify', { body: { code, cid: o2.cid, credential: two.attestation(o2.options.challenge) }, ip })
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
  assert.equal(results.filter(r => r.cookie).length, 1);
  assert.equal(h.db().creds.length, 2);
});

test('a challenge from one ceremony does not finish the other, nor a link of another profile', async () => {
  const ana = softPasskey(), bea = softPasskey(), fresh = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana'), user('u2', 'Bea')], creds: [ana.row('u1'), bea.row('u2')] });
  const ip = '198.51.100.48';
  const anaCode = (await makeLink(h, ana, 'u1', ip)).body.code;
  const beaCode = (await makeLink(h, bea, 'u2', ip)).body.code;
  // Bea's options, Ana's code: the challenge belongs to the other link.
  const beaOpt = (await h.req('POST', '/api/device-link/options', { body: { code: beaCode }, ip })).body;
  const cross = await h.req('POST', '/api/device-link/verify', { body: { code: anaCode, cid: beaOpt.cid, credential: fresh.attestation(beaOpt.options.challenge) }, ip });
  assert.equal(cross.status, 400);
  // A Settings ceremony's challenge presented as a link's.
  const add = (await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(ana, ip), cookie: mintSession('u1'), ip })).body;
  const mixed = await h.req('POST', '/api/device-link/verify', { body: { code: anaCode, cid: add.cid, credential: fresh.attestation(add.options.challenge) }, ip });
  assert.equal(mixed.status, 400);
  // …and a link's challenge presented to Settings.
  const linkOpt = (await h.req('POST', '/api/device-link/options', { body: { code: anaCode }, ip })).body;
  const mixed2 = await h.req('POST', '/api/account/passkeys/verify', { body: { cid: linkOpt.cid, credential: fresh.attestation(linkOpt.options.challenge) }, cookie: mintSession('u1'), ip });
  assert.equal(mixed2.status, 400);
  assert.equal(h.db().creds.length, 2);
  // Both codes still work for their own profiles.
  assert.equal((await redeem(h, beaCode, fresh, ip)).body.user.id, 'u2');
});

test('wrong codes pause link redemption for the address, and only that', async () => {
  const key = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.49';
  const { code } = (await makeLink(h, key, 'u1', '198.51.100.50')).body;
  // 20 wrong codes are free; the 21st is still answered, and starts the pause.
  for (let i = 0; i < 21; i++) {
    const r = await h.req('POST', '/api/device-link/options', { body: { code: 'WRONG' + i }, ip });
    assert.equal(r.status, 400, `attempt ${i}`);
  }
  const paused = await h.req('POST', '/api/device-link/options', { body: { code: 'ZZZZ-ZZZZ-ZZZZ' }, ip });
  assert.equal(paused.status, 429);
  assert.equal(paused.body.code, 'locked');
  assert.ok(Number(paused.headers.get('retry-after')) > 0);
  // Even the right code waits at that address…
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code }, ip })).status, 429);
  assert.equal((await h.req('POST', '/api/device-link/verify', { body: { code }, ip })).status, 429);
  assert.ok(h.audit().some(e => e.ev === 'auth.throttled' && e.msg === 'link'));
  // …while another address redeems it, and sign-in at the paused one is untouched.
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code }, ip: '198.51.100.51' })).status, 200);
  assert.equal((await h.req('POST', '/api/login/options', { body: {}, ip })).status, 200);
  const lo = (await h.req('POST', '/api/login/options', { body: {}, ip })).body;
  assert.equal((await h.req('POST', '/api/login/verify', { body: { cid: lo.cid, credential: key.assertion(lo.options.challenge) }, ip })).status, 200);
});

test('link redemption keeps the origin check; the account routes do too', async () => {
  const key = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.52';
  const { code } = (await makeLink(h, key, 'u1', ip)).body;
  const crossSite = { 'Sec-Fetch-Site': 'cross-site' };
  const sibling = { 'Sec-Fetch-Site': 'same-site' };
  const noFetchMeta = { 'Sec-Fetch-Site': '', Origin: 'https://evil.example' };
  for (const headers of [crossSite, sibling, noFetchMeta]) {
    assert.equal((await h.req('POST', '/api/device-link/options', { body: { code }, ip, headers })).status, 403);
    assert.equal((await h.req('POST', '/api/device-link/verify', { body: { code }, ip, headers })).status, 403);
    assert.equal((await h.req('POST', '/api/account/device-link', { body: {}, cookie: mintSession('u1'), ip, headers })).status, 403);
    assert.equal((await h.req('POST', '/api/account/passkeys/options', { body: {}, cookie: mintSession('u1'), ip, headers })).status, 403);
    assert.equal((await h.req('DELETE', '/api/account/passkeys?id=' + key.id, { cookie: mintSession('u1'), ip, headers })).status, 403);
  }
  // The refused requests used nothing up.
  assert.equal((await h.req('POST', '/api/device-link/options', { body: { code }, ip })).status, 200);
});

test('a Settings or device-link challenge never finishes a sign-up, a sign-in or a proof — and the code stays good once', async () => {
  const key = softPasskey(), thief = softPasskey(), phone = softPasskey(), newcomer = softPasskey();
  const h = await startServer(undefined, { users: [user('u1', 'Ana')], creds: [key.row('u1')] });
  const ip = '198.51.100.53', other = '203.0.113.53';
  const { code } = (await makeLink(h, key, 'u1', ip)).body;
  const linkOptions = async () => (await h.req('POST', '/api/device-link/options', { body: { code }, ip: other })).body;
  const unchanged = () => {
    const db = h.db();
    assert.deepEqual(db.users.map((u: any) => u.id), ['u1']);
    assert.deepEqual(db.creds.map((c: any) => c.id), [key.id]);
    assert.equal(db.deviceLinks.length, 1);
  };

  // Someone who read the code sends the link's challenge to sign-up instead of to the link route.
  for (let i = 0; i < 2; i++) {
    const opt = await linkOptions();
    const r = await h.req('POST', '/api/register/verify', { body: { cid: opt.cid, credential: thief.attestation(opt.options.challenge) }, ip: other });
    assert.equal(r.status, 400);
    assert.equal(r.cookie, null);
    unchanged();
  }
  assert.ok(h.audit().some(e => e.ev === 'auth.register.fail' && e.msg === 'challenge-expired'));
  assert.ok(!h.audit().some(e => e.ev === 'auth.register.ok'));

  // A Settings ceremony's challenge is no sign-up either.
  const add = (await h.req('POST', '/api/account/passkeys/options', { body: await h.stepUp(key!, ip), cookie: mintSession('u1'), ip })).body;
  const viaAdd = await h.req('POST', '/api/register/verify', { body: { cid: add.cid, credential: thief.attestation(add.options.challenge) }, ip });
  assert.equal(viaAdd.status, 400);
  assert.equal(viaAdd.cookie, null);
  unchanged();

  // Nor is a link's challenge a sign-in, or the proof that makes another code.
  const asLogin = await linkOptions();
  const signIn = await h.req('POST', '/api/login/verify', { body: { cid: asLogin.cid, credential: key.assertion(asLogin.options.challenge) }, ip: other });
  assert.equal(signIn.status, 400);
  assert.equal(signIn.cookie, null);
  const asProof = await linkOptions();
  const proof = await h.req('POST', '/api/account/device-link', { body: { cid: asProof.cid, credential: key.assertion(asProof.options.challenge) }, cookie: mintSession('u1'), ip });
  assert.equal(proof.status, 403);
  assert.equal(proof.body.code, 'passkey');
  // …and a sign-up's challenge proves nothing.
  const reg = (await h.req('POST', '/api/register/options', { body: { name: 'Mallory' }, ip })).body;
  const regProof = await h.req('POST', '/api/account/device-link', { body: { cid: reg.cid, credential: key.assertion(reg.options.challenge) }, cookie: mintSession('u1'), ip });
  assert.equal(regProof.status, 403);
  unchanged();

  // A link challenge fetched before "sign out everywhere" finishes nothing afterwards.
  const early = await linkOptions();
  const early2 = await linkOptions();
  assert.equal((await h.req('POST', '/api/logout/all', { body: {}, cookie: mintSession('u1'), ip })).status, 200);
  const late = await h.req('POST', '/api/register/verify', { body: { cid: early.cid, credential: thief.attestation(early.options.challenge) }, ip: other });
  assert.equal(late.status, 400);
  const late2 = await h.req('POST', '/api/device-link/verify', { body: { code, cid: early2.cid, credential: thief.attestation(early2.options.challenge) }, ip: other });
  assert.equal(late2.status, 400);
  assert.deepEqual(h.db().users.map((u: any) => u.id), ['u1']);
  assert.deepEqual(h.db().creds.map((c: any) => c.id), [key.id]);

  // The owner's next code is redeemed exactly once, by the link route.
  const next = (await h.req('POST', '/api/account/device-link', { body: await h.stepUp(key!, ip), cookie: mintSession('u1', 1), ip })).body.code;
  const done = await redeem(h, next, phone, ip, 'Phone');
  assert.equal(done.status, 200);
  assert.equal(done.body.user.id, 'u1');
  assert.equal((await redeem(h, next, softPasskey(), ip)).status, 400);
  assert.deepEqual(h.db().creds.map((c: any) => [c.id, c.userId]), [[key.id, 'u1'], [phone.id, 'u1']]);

  // Sign-up with its own challenge still works, and makes one new profile.
  const signUp = (await h.req('POST', '/api/register/options', { body: { name: 'Cleo' }, ip })).body;
  const made = await h.req('POST', '/api/register/verify', { body: { cid: signUp.cid, credential: newcomer.attestation(signUp.options.challenge) }, ip });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.equal(made.body.user.name, 'Cleo');
  assert.ok(made.cookie);
  assert.equal(h.db().users.length, 2);
});

// The app says these in the UI language, so each refusal carries a stable code beside its English line.
test('passkey sign-up and sign-in refusals carry a code the app can translate', async () => {
  const known = softPasskey(), stranger = softPasskey();
  const h = await startServer(undefined, { env: { INVITE_ONLY: '1' }, users: [user('u1', 'Ana', { disabled: true })], creds: [known.row('u1')] });
  const reg = await h.req('POST', '/api/register/options', { body: { name: 'Bo', code: 'NOPE' } });
  assert.equal(reg.status, 403);
  assert.equal(reg.body.code, 'invite');
  const expired = await h.req('POST', '/api/register/verify', { body: { cid: 'gone', credential: stranger.attestation('x') } });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.code, 'challenge-expired');
  const late = await h.req('POST', '/api/login/verify', { body: { cid: 'gone', credential: stranger.assertion('x') } });
  assert.equal(late.body.code, 'challenge-expired');
  let lo = (await h.req('POST', '/api/login/options', { body: {} })).body;
  const unknown = await h.req('POST', '/api/login/verify', { body: { cid: lo.cid, credential: stranger.assertion(lo.options.challenge) } });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.code, 'unknown-credential');
  lo = (await h.req('POST', '/api/login/options', { body: {} })).body;
  const off = await h.req('POST', '/api/login/verify', { body: { cid: lo.cid, credential: known.assertion(lo.options.challenge) } });
  assert.equal(off.status, 403);
  assert.equal(off.body.code, 'disabled');
});
