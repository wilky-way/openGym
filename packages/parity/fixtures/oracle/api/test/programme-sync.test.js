import test from 'node:test';
import assert from 'node:assert/strict';
import { stampPut, keepUnknown, highestStamp } from '../sync-stamps.js';

const state = () => ({ workouts: [], programmes: { version: 1, fork: 'wilky/1', definitions: [{ id: 'synthetic' }], cycles: [{ id: 'c', occurrences: [{ instanceId: 'one', status: 'pending' }, { instanceId: 'two', status: 'pending' }] }] } });
const os = S => S.programmes.cycles[0].occurrences;
test('older writer keeps program data without stamping unrelated occurrences', () => {
  const cur = state(), next = { workouts: [], sound: false };
  keepUnknown(cur, next);
  stampPut(cur, next, { overRead: true, now: 10 });
  assert.deepEqual(next.programmes, cur.programmes);
});
test('unstamped planner edits one occurrence and keeps clocks of the other', () => {
  const cur = state(), next = structuredClone(cur);
  os(next)[0].status = 'skipped';
  stampPut(cur, next, { overRead: true, now: 10 });
  assert.equal(os(next)[0]._f.status, 10);
  assert.equal(os(next)[1]._ts, undefined);
  assert.equal(highestStamp(next), 10);
});
test('stamped devices keep independent occurrence changes on PUT', () => {
  const cur = state(), next = state();
  Object.assign(os(cur)[0], { status: 'skipped', _ts: 20, _f: { status: 20 } });
  Object.assign(os(next)[1], { pinnedOn: '2026-10-16', _ts: 30, _f: { pinnedOn: 30 } });
  stampPut(cur, next, { stamped: true, overRead: true, now: 40 });
  assert.equal(os(next)[0].status, 'skipped');
  assert.equal(os(next)[1].pinnedOn, '2026-10-16');
});
test('a finished workout beats a skipped occurrence in either copy', () => {
  const cur = state(), next = state();
  os(next)[0].status = 'skipped';
  next.workouts.push({ id: 'log', d: '2026-10-12', programmeInstance: { cycleId: 'c', instanceId: 'one' } });
  stampPut(cur, next, { stamped: true, now: 40 });
  assert.equal(os(next)[0].status, 'done');
  assert.equal(os(next)[0].date, '2026-10-12');
});

test('a stamped unforked merge that omits programmes cannot wipe the block', () => {
  const cur = state(), next = { workouts: [], _ts: 200, sound: false };
  stampPut(cur, next, { stamped: true, overRead: true, now: 200 });
  assert.deepEqual(next.programmes, cur.programmes);
});
for (const path of ['sign-in forceNext', 'backup import']) {
  test(`${path} cannot resurrect reset program ids on either side`, () => {
    const cur = state(), next = state();
    cur.resetAt = next.resetAt = 100; // server.js pins the stored reset before stampPut
    cur.resetIds = next.resetIds = { programmeDefinitions: ['synthetic'], programmeCycles: ['c'] };
    next.programmes.definitions.push({ id: 'after-reset' });
    next.programmes.cycles.push({ id: 'after-reset-cycle', occurrences: [] });
    stampPut(cur, next, { stamped: path === 'sign-in forceNext', overRead: path === 'backup import', now: 200 });
    assert.deepEqual(next.programmes.definitions.map(d => d.id), ['after-reset']);
    assert.deepEqual(next.programmes.cycles.map(c => c.id), ['after-reset-cycle']);
  });
}
test('a new reset does not copy the stored programme block when its writer omits it', () => {
  const cur = state(), next = { workouts: [], resetAt: 100 };
  stampPut(cur, next, { stamped: true, now: 200 });
  assert.equal(next.programmes, undefined);
});

test('modern combined log counts entry occurrence ids instead of an empty leading occurrence', () => {
  const cur = state(), next = state();
  next.workouts = [{ id: 'w', d: '2026-10-12', programmeInstance: { cycleId: 'c', instanceId: 'one' }, entries: [{ occurrenceId: 'two', sets: [{ done: true, w: 100, r: 8 }] }] }];
  stampPut(cur, next, { stamped: true, now: 30 });
  assert.deepEqual(os(next).map(o => o.status), ['pending', 'done']);
});

test('deleting a log removes cached done status and actual date on a stamped PUT', () => {
  const cur = state();
  cur.workouts = [{ id: 'w', d: '2026-10-12', programmeInstance: { cycleId: 'c', instanceId: 'one' } }];
  Object.assign(os(cur)[0], { status: 'done', date: '2026-10-12', _ts: 10, _f: { status: 10, date: 10 } });
  const next = structuredClone(cur);
  next.workouts = [];
  next.deleted = { workouts: { w: 20 } };
  stampPut(cur, next, { stamped: true, now: 30 });
  assert.equal(os(next)[0].status, 'pending');
  assert.equal(os(next)[0].date, undefined);
});

test('reset then re-import the same definition id keeps the newer record', () => {
  const cur = { workouts: [], resetAt: 100, resetIds: { programmeDefinitions: ['synthetic'], programmeCycles: ['c'] }, programmes: { definitions: [], cycles: [] } };
  const next = state();
  next.resetAt = 100;
  next.resetIds = structuredClone(cur.resetIds);
  next.programmes.definitions[0]._ts = 200;
  next.programmes.cycles[0]._ts = 200;
  stampPut(cur, next, { stamped: true, now: 300 });
  assert.equal(next.programmes.definitions[0].id, 'synthetic');
  assert.equal(next.programmes.cycles[0].id, 'c');
  const again = structuredClone(next);
  stampPut(next, again, { stamped: true, now: 400 });
  assert.equal(again.programmes.definitions[0].id, 'synthetic');
});

test('unstamped PUT restores newer cycle fields with their clocks', () => {
  const cur = state(), next = state();
  Object.assign(cur.programmes.cycles[0], { weekIndex: 5, notBefore: '2026-10-16', _ts: 20, _f: { weekIndex: 20, notBefore: 20 } });
  Object.assign(next.programmes.cycles[0], { _ts: 10, _f: { weekIndex: 10, notBefore: 10 } });
  const report = {};
  stampPut(cur, next, { overRead: true, now: 30, report });
  assert.equal(next.programmes.cycles[0].weekIndex, 5);
  assert.equal(next.programmes.cycles[0].notBefore, '2026-10-16');
  assert.equal(next.programmes.cycles[0]._f.weekIndex, 20);
  assert.equal(next.programmes.cycles[0]._f.notBefore, 20);
  assert.equal(report.changed, true);
});

test('server concurrent activation retargets paused queue and shared adopted routine ownership durably', () => {
 const cycle=(id,status,since)=>({id,status,since,weekIndex:1,startsOn:'2026-10-12',occurrences:[{instanceId:id+':w1d1',routineId:'shared',weekIndex:1,dayKey:'d1',ordinal:1,status:'pending'}]});
 const cur={workouts:[],routines:[{id:'shared',programme:{cycleId:'paused',instanceId:'paused:w1d1'},_ts:200,_f:{programme:200}}],queue:{ids:['shared'],programmeCycleId:'paused'},programmes:{cycles:[cycle('paused','paused',100)]}};
 const next=structuredClone(cur);next.programmes.cycles=[cycle('active','active',200)];
 stampPut(cur,next,{stamped:true,now:300});
 assert.equal(next.queue.programmeCycleId,'active');assert.equal(next.routines[0].programme.cycleId,'active');assert.equal(next.routines[0].programme.instanceId,'active:w1d1');assert.equal(next.programmes.cycles.find(c=>c.id==='paused').status,'archived');assert.ok(next.programmes.cycles.find(c=>c.id==='paused')._f.status>0);
 const stale=structuredClone(cur);stale.programmes.cycles[0]._ts=1000;stale.programmes.cycles[0]._f={status:1000};stale.programmes.cycles[0].activationConflict='active';next.programmes.cycles.find(c=>c.id==='active').status='finished';stampPut(next,stale,{stamped:true,now:1100});assert.equal(stale.programmes.cycles.find(c=>c.id==='paused').status,'archived');
});
