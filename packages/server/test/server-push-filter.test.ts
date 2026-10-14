import assert from 'node:assert/strict'
import net from 'node:net'
import { test, fixture, keys, cookie, post, T0 } from './notification-helpers'
const startServer = async (_t: unknown, subs: any[] = []) => fixture(subs)
test('subscribe refuses every spelling of a private IP literal and accepts public ones', async t => {
  const h = await startServer(t);
  const subscribe = (endpoint: string) => fetch(`${h.api}/api/push/subscribe`, {
    method: 'POST', headers: cookie, body: JSON.stringify({ subscription: { endpoint, keys } })
  });
  const privateForms = [
    'https://[::ffff:127.0.0.1]/x',          // mapped loopback, dotted
    'https://[::ffff:7f00:1]/x',             // mapped loopback, hex (what new URL makes of the above)
    'https://[0:0:0:0:0:ffff:7f00:1]/x',     // mapped loopback, fully expanded
    'https://[::ffff:169.254.169.254]/x',    // mapped link-local (cloud metadata)
    'https://[::FFFF:C0A8:0101]/x',          // mapped 192.168.1.1, upper-case, zero-padded
    'https://[::ffff:10.0.0.1]/x',           // mapped private
    'https://[0:0:0:0:0:0:0:1]/x',           // loopback, expanded
    'https://[::1]/x',                       // loopback, compressed
    'https://[fe80::1]/x',                   // link-local
    'https://[fd00::1]/x',                   // unique local
    'https://127.0.0.1/x'                    // plain IPv4 (the case that always worked)
  ];
  for (const ep of privateForms) {
    const r = await subscribe(ep);
    assert.equal(r.status, 400, ep);
    assert.deepEqual(await r.json(), { error: 'endpoint must not point at a private address' }, ep);
  }
  assert.equal((await subscribe('https://[::ffff:8.8.8.8]/x')).status, 400, 'parser-disagreeing public IP spelling is ambiguous');
  for (const ep of ['https://[::ffff:808:808]/x', 'https://[2606:4700::1111]/x', 'https://8.8.8.8/x', 'https://push.example/x']) {
    assert.equal((await subscribe(ep)).status, 200, ep);
  }
});


test('a private literal already stored as an endpoint is refused at send time, never connected to, and dropped', async t => {
 const hits: string[]=[]
 const target=net.createServer(s=>{hits.push(s.remoteAddress || '');s.destroy()})
 await new Promise<void>(r=>target.listen(0,'127.0.0.1',r))
 t.after(()=>{target.close()})
 const endpoint=`https://[::ffff:7f00:1]:${(target.address() as net.AddressInfo).port}/x`
 const h=fixture([{userId:'u_test_1',endpoint,keys,created:new Date(T0).toISOString()}],{send:async()=>{throw new Error('private literal reached transport')}})
 assert.equal((await post(h,'/api/push/test')).status,200)
 assert.deepEqual(hits,[],'no socket reached the private address')
 assert.match(h.log,/push endpoint refused/)
 assert.equal(h.db().subs.length,0,'the unusable subscription is gone from db.json')
})
