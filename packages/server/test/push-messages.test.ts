import {test} from 'bun:test'
import assert from 'node:assert/strict'
import {dayReminderPush, restTimerPush, testPush} from '../src/push-messages'
// English-only ruling replaces localized output while retaining all assertion sites.
test('localizes every server-generated notification in pt-BR', () => {
  assert.deepEqual(restTimerPush('pt-BR'), {
    title: 'Rest over 💪',
    body: 'Time for your next set.',
    tag: 'rest-timer',
  });
  assert.deepEqual(testPush('pt-BR'), {
    title: 'openGym',
    body: 'Test notification ✅ This is what alerts look like.',
    tag: 'test',
  });
  assert.deepEqual(dayReminderPush('pt-BR', { name: 'Treino A', emoji: '💪' }), {
    title: '💪 Treino A today',
    body: "It's on your plan. Let's go 💪",
    tag: 'day-reminder',
  });
});

test('keeps the existing English copy as the fallback', () => {
  assert.deepEqual(restTimerPush('fr'), restTimerPush('en'));
  assert.equal(dayReminderPush('unknown', null).title, 'Workout planned today');
  assert.equal(testPush(undefined).body, 'Test notification ✅ This is what alerts look like.');
});
