import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRoutineId, pinState, queueLiveOn } from '../queue.js';
import { projectCycle } from '../programme-calendar.js';

const day = '2026-10-12';
const setup = () => ({ workouts: [], week: {}, dayPlan: {}, routines: [1, 2, 3, 4].map(n => ({ id: `r${n}`, name: `Synthetic D${n}` })),
  queue: { ids: ['r1', 'r2', 'r3', 'r4'], skipped: [], since: 10, startsOn: day, programmeCycleId: 'c' },
  programmes: { version: 1, definitions: [], cycles: [{ id: 'c', status: 'active', cadence: { perWeek: 4 }, occurrences: [1, 2, 3, 4].map(n => ({ instanceId: `c:w1d${n}`, weekIndex: 1, ordinal: n, routineId: `r${n}`, status: 'pending' })) }] },
});
const cycle = S => S.programmes.cycles[0];

test('a programme queue skips planned sessions, with the next occurrence moved to today', () => {
  const S = setup(); S.queue.skipped = ['r1'];
  assert.equal(effectiveRoutineId(S, day), 'r2');
  assert.equal(pinState(S, 'r1'), 'done');
  assert.equal(queueLiveOn(S, day), true);
  cycle(S).occurrences[0].status = 'skipped'; S.queue.skipped = [];
  assert.equal(effectiveRoutineId(S, day), 'r2');
});
test('shift and trained-today both suppress today reminders and offer the next day', () => {
  const S = setup(); cycle(S).notBefore = '2026-10-13';
  assert.equal(effectiveRoutineId(S, day), null);
  assert.equal(effectiveRoutineId(S, '2026-10-13'), 'r1');
  cycle(S).notBefore = null;
  S.workouts.push({ id: 'done', d: day, start: 20, routineIds: ['r1'], programmeInstance: { cycleId: 'c', instanceId: 'c:w1d1' } });
  assert.equal(effectiveRoutineId(S, day), null);
  assert.equal(effectiveRoutineId(S, '2026-10-13'), 'r2');
});
test('a finished occurrence beats a stale queue skip', () => {
  const S = setup(); S.queue.skipped = ['r1'];
  S.workouts.push({ id: 'done', d: day, start: 20, routineIds: ['r1'], programmeInstance: { cycleId: 'c', instanceId: 'c:w1d1' } });
  assert.equal(projectCycle(cycle(S), S.workouts, day).occurrences[0].status, 'done');
  assert.equal(effectiveRoutineId(S, day), null);
  assert.equal(effectiveRoutineId(S, '2026-10-13'), 'r2');
});
test('paused program reminders and pins are suppressed, including old weekday queue pointers', () => {
  const S = setup(); cycle(S).status = 'paused';
  S.dayPlan[day] = 'r1'; S.week[1] = ['r2'];
  assert.equal(effectiveRoutineId(S, day), null);
  assert.equal(pinState(S, 'r1'), 'done');
  assert.equal(projectCycle(cycle(S), [], day).next, null);
});
test('an unowned skipped queue keeps stock reminder behavior for the other sessions', () => {
  const S = setup(); delete S.queue.programmeCycleId; S.queue.skipped = ['r1'];
  assert.equal(effectiveRoutineId(S, day), 'r2');
  assert.equal(pinState(S, 'r1'), 'done');
});

test('legacy pin today yields to a programme shift', () => {
  const S = setup(); cycle(S).occurrences[0].pinnedOn = day;
  S.dayPlan[day] = 'r1'; cycle(S).notBefore = '2026-10-13';
  assert.equal(effectiveRoutineId(S, day), null);
  assert.equal(effectiveRoutineId(S, '2026-10-13'), 'r1');
});
test('a Tuesday D2 pin yields to slipped D1', () => {
  const S = setup(); cycle(S).occurrences[1].pinnedOn = '2026-10-13';
  S.dayPlan['2026-10-13'] = 'r2';
  assert.equal(effectiveRoutineId(S, '2026-10-13'), 'r1');
});
test('a fulfilled W4 pin no longer in queue ids yields to W5', () => {
  const S = setup(); cycle(S).occurrences[0].pinnedOn = '2026-10-20';
  S.dayPlan['2026-10-20'] = 'r1';
  S.workouts = cycle(S).occurrences.map(o => ({ id: o.instanceId, d: '2026-10-19', programmeInstance: { cycleId: 'c', instanceId: o.instanceId } }));
  cycle(S).occurrences.push({ instanceId: 'c:w2d1', weekIndex: 2, ordinal: 1, routineId: 'r5', status: 'pending' });
  S.routines.push({ id: 'r5' }); S.queue.ids = ['r5'];
  assert.equal(pinState(S, 'r1'), 'done');
  assert.equal(effectiveRoutineId(S, '2026-10-20'), 'r5');
});
for (const kind of ['ordinary', 'programme']) {
  test(`a future ${kind} workout does not re-anchor reminders`, () => {
    const S = setup(), w = { id: 'future', d: '2026-11-01' };
    if (kind === 'programme') w.programmeInstance = { cycleId: 'c', instanceId: 'c:w1d1' };
    S.workouts.push(w);
    const p = projectCycle(cycle(S), S.workouts, day);
    assert.equal(p.anchor, day);
    assert.equal(p.lastDoneDate, null);
    assert.equal(effectiveRoutineId(S, day), kind === 'programme' ? 'r2' : 'r1');
  });
}
test('programme queueLiveOn agrees with frontend for past and future previews', () => {
  const S = setup();
  assert.equal(queueLiveOn(S, '2026-10-11', day), false);
  assert.equal(queueLiveOn(S, day, day), true);
  assert.equal(queueLiveOn(S, '2026-10-13', day), true);
});
