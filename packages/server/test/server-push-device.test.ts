import assert from 'node:assert/strict'
import {test, fixture, cookie, wait, T0} from './notification-helpers'
const startServer = async (_t: unknown, subs: any[] = []) => fixture(subs)
const sub = (endpoint: string, deviceId?: string) => ({userId: 'u_test_1', endpoint, keys: {p256dh: 'p', auth: 'a'}, ...(deviceId ? {deviceId} : {}), created: new Date(T0).toISOString()})
async function restOn(h: any, deviceId: string) {
  const r = await fetch(`${h.api}/api/push/rest-timer`, {
    method: 'POST', headers: { ...cookie, 'Content-Type': 'application/json', Origin: 'http://localhost:8080' },
    body: JSON.stringify({ seconds: 1, deviceId })
  });
  assert.equal(r.status, 200);
  await wait(2500);   // fires at 1 s, then prunes what it tried
  return h.db().subs.map((s: any) => s.endpoint).sort();
}

test('a rest on a device without a subscription rings no other device', async t => {
  const h = await startServer(t, [sub('https://10.0.0.2/phone', 'phoneBBBBBB'), sub('https://10.0.0.3/old')]);
  // The desktop has none: the phone is left alone, the subscription from an older client still rings.
  assert.deepEqual(await restOn(h, 'desktopAAAA'), ['https://10.0.0.2/phone']);
});

test('a rest on a subscribed device rings that device and nobody else', async t => {
  const h = await startServer(t, [sub('https://10.0.0.2/phone', 'phoneBBBBBB'), sub('https://10.0.0.4/desk', 'desktopAAAA')]);
  assert.deepEqual(await restOn(h, 'desktopAAAA'), ['https://10.0.0.2/phone']);
});
