import assert from 'node:assert/strict'
import { test, fixture, post, other, T0 } from './notification-helpers'
const TTL=70000, GRACE=45000
const startServer = async (_t: unknown) => {
 const h=fixture()
 h.store.db.query('UPDATE users SET admin=1 WHERE id=?').run('u_test_2')
 return {at: h.at, beat: async () => {assert.equal((await post(h,'/api/activity',{active:true,name:'Push Day',exIdx:2,exTotal:5,setsDone:7,setsTotal:16,startedAt:T0-600000})).status,200)},
 left: async (reason?: string) => {assert.equal((await post(h,'/api/activity',{active:false,reason})).status,200)},
 live: async () => {
   const r = await fetch(h.api + '/api/admin/users', { headers: other })
   assert.equal(r.status, 200)
   return (await r.json()).users.find((u: any) => u.id === 'u_test_1').live
 }}
}
test('navigated, closed and no reason at all drop the athlete at once', async t => {
  const h = await startServer(t);
  for (const reason of ['navigated', 'closed', undefined]) {
    await h.at(T0);
    await h.beat();
    assert.ok(await h.live(), `listed before ${reason}`);
    await h.left(reason);
    assert.equal(await h.live(), null, `gone at once after ${reason}`);
  }
});

test('hidden keeps the athlete listed for 45 s after the mark, then drops them', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.at(T0 + 5000);
  await h.left('hidden');
  const live = await h.live();
  assert.equal(live!.name, 'Push Day', 'still listed right after the mark');
  assert.deepEqual(Object.keys(live!).sort(), ['exIdx', 'exTotal', 'name', 'setsDone', 'setsTotal', 'startedAt', 'updatedAt'],
    'the dashboard gets the row it always did, with no mark in it');
  await h.at(T0 + 5000 + GRACE - 1);
  assert.ok(await h.live(), 'listed until the grace is up');
  await h.at(T0 + 5000 + GRACE);
  assert.equal(await h.live(), null, 'gone 45 s after the mark, before the 70 s expiry');
});

test('a heartbeat after hidden (a phone locked between sets) clears the mark', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.at(T0 + 1000);
  await h.left('hidden');
  await h.at(T0 + 20000);
  await h.beat();
  await h.at(T0 + 1000 + GRACE);
  assert.ok(await h.live(), 'past the grace, still listed: the heartbeat cleared the mark');
  await h.at(T0 + 20000 + TTL - 1);
  assert.ok(await h.live(), 'listed until the expiry after that heartbeat');
  await h.at(T0 + 20000 + TTL);
  assert.equal(await h.live(), null, 'and gone at it');
});

test('the 70 s expiry after the last heartbeat applies whatever the hidden mark says', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.at(T0 + 60000);
  await h.left('hidden');
  await h.at(T0 + TTL - 1);
  assert.ok(await h.live(), 'listed: 10 s into the grace and inside the expiry');
  await h.at(T0 + TTL);
  assert.equal(await h.live(), null, 'gone at the expiry, 10 s into a 45 s grace');
});

test('a second hidden with no heartbeat between does not stretch the grace', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.at(T0 + 1000);
  await h.left('hidden');
  await h.at(T0 + 20000);
  await h.left('hidden');
  await h.at(T0 + 1000 + GRACE);
  assert.equal(await h.live(), null, 'gone 45 s after the first mark');
});

test('hidden with no row (it arrived after closed) lists nobody', async t => {
  const h = await startServer(t);
  await h.at(T0);
  await h.beat();
  await h.left('closed');
  await h.left('hidden');
  assert.equal(await h.live(), null);
});

// The `hidden` beacon and the heartbeat go out on different connections, so the beacon can land
// after a heartbeat the page sent later than it and mark that fresh row. The page's next
// heartbeat, at most 20 s on, replaces the row inside the 45 s grace, so an athlete whose page
// keeps heartbeating is listed at every second, however late in the interval the beacon lands.
test('a hidden that lands after a later heartbeat cannot drop an athlete who keeps heartbeating', async t => {
  const h = await startServer(t);
  let base = T0;
  for (const late of [0, 10000, 19999]) {
    await h.at(base);
    await h.beat();
    await h.at(base + late);
    await h.left('hidden');                       // lands after the heartbeat it raced
    assert.ok(await h.live(), `listed right after a beacon ${late} ms late`);
    for (let s = 1; s <= 100; s++) {
      await h.at(base + s * 1000);
      if (s % 20 === 0) await h.beat();
      assert.ok(await h.live(), `listed ${s} s on, with the beacon ${late} ms late`);
    }
    base += 200000;
  }
});
