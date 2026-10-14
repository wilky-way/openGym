import assert from 'node:assert/strict'
import {test, fixture, post, keys} from './notification-helpers'
const startServer = async (_t: unknown, allowedPrivateIps: string) => {const h=fixture([],{}, {ALLOWED_PRIVATE_IPS: allowedPrivateIps});return {...h, subscribe: async (endpoint: string) => (await post(h,'/api/push/subscribe',{subscription:{endpoint,keys}})).status}}
test('no ALLOWED_PRIVATE_IPS keeps every private address blocked', async t => {
  const h = await startServer(t, '');
  for (const ip of ['10.1.2.3', '100.64.0.5', '192.168.1.1', '[fd12::1]']) {
    assert.equal(await h.subscribe(`https://${ip}/x`), 400, ip);
  }
});

test('allowed CIDR blocks, ranges and single addresses open only what they name', async t => {
  const h = await startServer(t, '10.0.0.0/8, 100.64.0.1-100.64.0.9 192.168.1.50,fd00::/8');
  const allowed = [
    '10.1.2.3', '10.255.255.255',
    '100.64.0.1', '100.64.0.5', '100.64.0.9',
    '192.168.1.50',
    '[fd12::1]', '[::ffff:a01:203]'
  ];
  const blocked = [
    '100.64.0.10', '100.64.0.0',
    '192.168.1.51', '192.168.1.1',
    '127.0.0.1', '169.254.169.254', '172.16.0.1',
    '[fc00::1]', '[fe80::1]', '[::1]', '[::ffff:127.0.0.1]'
  ];
  for (const ip of allowed) {
    assert.equal(await h.subscribe(`https://${ip}/x`), 200, ip);
  }
  for (const ip of blocked) assert.equal(await h.subscribe(`https://${ip}/x`), 400, ip);
});

test('an invalid entry is reported and ignored while valid ones still apply', async t => {
  const h = await startServer(t, 'bogus, 10.0.0.0/99, 172.16.0.0/12');
  assert.match(h.log, /ALLOWED_PRIVATE_IPS entry is not a valid address/);
  assert.match(h.log, /ALLOWED_PRIVATE_IPS entry is not a valid address/);
  assert.equal(await h.subscribe('https://172.20.0.1/x'), 200);
  assert.equal(await h.subscribe('https://10.0.0.1/x'), 400);
});
