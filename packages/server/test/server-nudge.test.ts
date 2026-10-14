import assert from 'node:assert/strict'
import {test, fixture, post, T0} from './notification-helpers'
import {mint} from './auth-helpers'
const UID='u_nudge_1'
const all: ReturnType<typeof fixture>[]=[]
import {afterEach} from 'bun:test'
afterEach(()=>{all.length=0})
const startServer=async (_t: unknown, subs: any[]=[{userId:UID,endpoint:'https://localhost/x',keys:{p256dh:'p',auth:'a'}}])=>{const h=fixture(subs,{}, {}, [UID]);all.push(h);return h}
const zoneAt=(hour: number)=>hour===20?'UTC':hour===10?'Etc/GMT+10':'Etc/GMT-2'
const dateIn=(tz: string, ms=T0)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms))
const daysAgo=(tz: string,n: number)=>dateIn(tz,T0-n*86400000)
const mintSession=(uid: string)=>mint(uid,30,0,T0)
const ticks=async (_ms: number)=>{for(const h of all) await h.tick()}
const until=async (pred:()=>boolean)=>{await ticks(0);assert.ok(pred(),'pinned tick reached expected output')}
const routines = [{ id: 'r1', name: 'Push Day', emoji: '💪', ex: [] }];
const everyDay = { 0: 'r1', 1: 'r1', 2: 'r1', 3: 'r1', 4: 'r1', 5: 'r1', 6: 'r1' };
// Trained yesterday, today planned and not logged: a missed day, nothing to back off from.
const missedToday = (tz: string, over: any = {}) => ({
  reminder: { on: true, time: '08:00', tz, nudge: true, tone: 'drill' },
  routines, week: everyDay, workouts: [{ id: 'w1', d: daysAgo(tz, 1), routineId: 'r1' }], ...over
});
const firings = (log: string) => (log.match(/nudge firing/g) || []).length;
test('fires once on the evening of a missed planned day, in the user\'s zone', async t => {
  const tz = zoneAt(20);
  const h = await startServer(t);
  h.write(missedToday(tz));
  await until(() => firings(h.log) > 0);
  assert.equal(firings(h.log), 1, h.log);
  await ticks(1200);  // several more ticks: once per local date
  assert.equal(firings(h.log), 1, 'fired twice in one evening');
  assert.equal(h.db().users[0].lastNudge, dateIn(tz));
  // the plain reminder (08:00 there) is long past its window and stays out of it
  assert.doesNotMatch(h.log, /reminder firing/);
});

test('silent outside the evening, on a rest day, on a trained day, and when switched off', async t => {
  const h = await startServer(t);
  const eve = zoneAt(20);
  const cases = [
    ['morning in that zone', missedToday(zoneAt(10))],
    ['22:00 in that zone, past 21:30', missedToday(zoneAt(22))],
    ['rest day', missedToday(eve, { week: {} })],
    ['rest override today', missedToday(eve, { dayPlan: { [dateIn(eve)]: 'rest' } })],
    ['workout logged today', missedToday(eve, { workouts: [{ id: 'w2', d: dateIn(eve), routineId: 'r1' }] })],
    ['nudge off', missedToday(eve, { reminder: { on: true, time: '08:00', tz: eve, nudge: false } })],
    ['reminder off', missedToday(eve, { reminder: { on: false, time: '08:00', tz: eve, nudge: true } })],
    ['reminder too late for an evening nudge', missedToday(eve, { reminder: { on: true, time: '20:00', tz: eve, nudge: true } })],
    ['back-off: 3 missed days in a row already', missedToday(eve, { workouts: [{ id: 'w0', d: daysAgo(eve, 4), routineId: 'r1' }] })],
  ];
  for (const [name, state] of cases) {
    h.write(state);
    await ticks(700);
    assert.equal(firings(h.log), 0, `${name}:\n${h.log}`);
  }
  assert.equal(h.db().users[0].lastNudge, undefined);
  // …and the same server does fire once the day really is a missed one
  h.write(missedToday(eve));
  await until(() => firings(h.log) > 0);
  assert.equal(firings(h.log), 1, h.log);
});

test('no push subscription, or a workout on screen right now: no nudge', async t => {
  const tz = zoneAt(20);
  const bare = await startServer(t, []);
  bare.write(missedToday(tz));
  await ticks(1000);
  assert.equal(firings(bare.log), 0, bare.log);

  const h = await startServer(t);
  const live = await fetch(`${h.api}/api/activity`, {
    method: 'POST', headers: { Cookie: `gymsid=${mintSession(UID)}` },
    body: JSON.stringify({ active: true, name: 'Push Day', startedAt: T0 })
  });
  assert.equal(live.status, 200);
  h.write(missedToday(tz));
  await ticks(1000);
  assert.equal(firings(h.log), 0, `a session is under way:\n${h.log}`);
  // the session ends without a workout being saved: the nudge is owed again
  await fetch(`${h.api}/api/activity`, { method: 'POST', headers: { Cookie: `gymsid=${mintSession(UID)}` }, body: JSON.stringify({ active: false }) });
  await until(() => firings(h.log) > 0);
  assert.equal(firings(h.log), 1, h.log);
});
