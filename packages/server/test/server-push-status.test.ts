import assert from 'node:assert/strict'
import {test, fixture, keys, cookie, other, post, status, readDb, wait, T0} from './notification-helpers'
const startServer = async (_t: unknown, subs: any[] = []) => fixture(subs)
test('status tells whether the server holds the endpoint; subscribe is an upsert that keeps created and stores the device id', async t => {
  const h = await startServer(t);
  const endpoint = 'https://push.example/one';
  assert.deepEqual(await status(h, endpoint), { subscribed: false });

  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint, keys }, deviceId: 'dev_aaaaaaaa' })).status, 200);
  assert.deepEqual(await status(h, endpoint), { subscribed: true, deviceId: 'dev_aaaaaaaa' });
  assert.deepEqual(await status(h, endpoint, other), { subscribed: false }, 'another account does not see it');
  const first = readDb(h).subs[0];
  assert.equal(first.deviceId, 'dev_aaaaaaaa');

  await wait(20);
  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: { p256dh: 'p2', auth: 'a2' } }, deviceId: 'dev_bbbbbbbb' })).status, 200);
  const subs = readDb(h).subs;
  assert.equal(subs.length, 1, 'same endpoint sent again is one row');
  assert.equal(subs[0].created, first.created, 'created survives the re-send');
  assert.equal(subs[0].deviceId, 'dev_bbbbbbbb');
  assert.deepEqual(subs[0].keys, { p256dh: 'p2', auth: 'a2' });

  // a device id that is not a short token is dropped, not stored
  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint: 'https://push.example/two', keys }, deviceId: { evil: true } })).status, 200);
  assert.equal('deviceId' in readDb(h).subs.find((s: any) => s.endpoint.endsWith('/two')), false);

  assert.equal((await fetch(`${h.api}/api/push/status?endpoint=x`)).status, 401);
});

// Rows from before device ids, or re-sent by the worker without one, used to stay that way:
// the boot sync saw the endpoint stored and wrote nothing. Status now names the row's device, so
// the owner's browser re-sends the same subscription with its id and the row is repaired in place.
test('a row stored without a device id: status says so, and the owner re-sending it gives it one', async t => {
  const endpoint = 'https://push.example/legacy';
  const browserKeys = { p256dh: 'p-legacy', auth: 'a-legacy' };
  const created = '2025-01-01T00:00:00.000Z';
  const h = await startServer(t, [{ userId: 'u_test_1', endpoint, keys: browserKeys, created }]);

  assert.deepEqual(await status(h, endpoint), { subscribed: true, deviceId: null });
  assert.deepEqual(await status(h, endpoint, other), { subscribed: false }, 'another account does not see it');

  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: browserKeys }, deviceId: 'dev_phone000' })).status, 200);
  assert.deepEqual(await status(h, endpoint), { subscribed: true, deviceId: 'dev_phone000' });
  assert.deepEqual(readDb(h).subs, [{ userId: 'u_test_1', endpoint, keys: browserKeys, deviceId: 'dev_phone000', created }],
    'one row, the same account, the same keys, its original created, and now a device id');
});

// A re-send with no usable device id used to store the row without one, so a single request with
// a malformed id (or none) made the owner's phone lose its own rest-timer routing. deviceIdOf
// ignores such an id everywhere else (200, not 400), and ignoring it here means keeping the one
// the row already has.
test('a re-send without a usable device id keeps the id the row has', async t => {
  const endpoint = 'https://push.example/kept';
  const browserKeys = { p256dh: 'p-kept', auth: 'a-kept' };
  const created = '2025-03-03T00:00:00.000Z';
  const h = await startServer(t, [{ userId: 'u_test_1', endpoint, keys: browserKeys, deviceId: 'dev_phone000', created }]);

  for (const deviceId of ['bad!', { evil: true }, undefined]) {
    const r = await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: browserKeys }, deviceId });
    assert.equal(r.status, 200, `deviceId ${JSON.stringify(deviceId)}`);
    assert.deepEqual(await r.json(), { ok: true });
    assert.deepEqual(readDb(h).subs, [{ userId: 'u_test_1', endpoint, keys: browserKeys, deviceId: 'dev_phone000', created }],
      `deviceId ${JSON.stringify(deviceId)} leaves the row as it was`);
  }
  // a usable one still replaces it
  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint, keys: browserKeys }, deviceId: 'dev_phone001' })).status, 200);
  assert.deepEqual(await status(h, endpoint), { subscribed: true, deviceId: 'dev_phone001' });
});

test('a rest started on a device whose row has no id rings that row, never another device\'s (#348)', async t => {
  // Same method as the rest-timer test below: every send to localhost fails and is logged.
  const phone = { userId: 'u_test_1', endpoint: 'https://localhost/phone', keys, created: new Date(T0).toISOString() };
  const desk = { userId: 'u_test_1', endpoint: 'https://localhost/desk', keys, deviceId: 'dev_desk0000', created: new Date(T0).toISOString() };
  const h = await startServer(t, [phone, desk]);
  const sent = () => (h.log.match(/push send failed/g) || []).length;

  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1, deviceId: 'dev_phone000' })).status, 200);
  await wait(2500);
  assert.equal(sent(), 1, `no row carries the phone's id: the id-less row (an older client) rings, the desk does not:\n${h.log}`);

  assert.equal((await post(h, '/api/push/subscribe', { subscription: { endpoint: phone.endpoint, keys }, deviceId: 'dev_phone000' })).status, 200);
  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1, deviceId: 'dev_phone000' })).status, 200);
  await wait(2500);
  assert.equal(sent(), 2, `after the repair the phone's alert goes to the phone alone:\n${h.log}`);
});

test('a rest timer belongs to the device that set it: another device cancelling does not silence it', async t => {
  // localhost resolves to a loopback address, which PUSH_AGENT refuses — every send fails locally
  // and quietly, and "push send failed" in the log is the proof that a send was attempted.
  const mk = (deviceId: string, n: string) => ({ userId: 'u_test_1', endpoint: `https://localhost/${n}`, keys, deviceId, created: new Date(T0).toISOString() });
  const h = await startServer(t, [mk('dev_phone000', 'phone'), mk('dev_desk0000', 'desk')]);
  const sends = () => (h.log.match(/push send failed/g) || []).length;

  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1, deviceId: 'dev_phone000' })).status, 200);
  assert.equal((await post(h, '/api/push/rest-timer/cancel', { deviceId: 'dev_desk0000' })).status, 200);
  await wait(2500);
  assert.equal(sends(), 1, `the phone's alert went out, to the phone's subscription only:\n${h.log}`);

  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1, deviceId: 'dev_phone000' })).status, 200);
  assert.equal((await post(h, '/api/push/rest-timer/cancel', { deviceId: 'dev_phone000' })).status, 200);
  await wait(2500);
  assert.equal(sends(), 1, 'cancelled by its own device: nothing more went out');

  // an older client, no device id: the account-wide behaviour it always had
  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1 })).status, 200);
  assert.equal((await post(h, '/api/push/rest-timer/cancel', {})).status, 200);
  await wait(2500);
  assert.equal(sends(), 1, 'legacy cancel clears the legacy timer');
  assert.equal((await post(h, '/api/push/rest-timer', { seconds: 1 })).status, 200);
  await wait(2500);
  assert.equal(sends(), 3, 'a legacy timer goes to every subscription of the account');
});
