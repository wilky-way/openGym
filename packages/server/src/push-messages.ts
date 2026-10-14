import { NUDGE_COPY, lineIndex } from '@opengym/core/nudge'

export interface PushPayload { title: string; body: string; tag: string }
export interface PushRoutine { name?: string; emoji?: string }
// English-only ruling: keep the legacy English bytes for every stored language.
export function restTimerPush(_lang?: unknown): PushPayload {
  return { title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer' }
}
export function testPush(_lang?: unknown): PushPayload {
  return { title: 'openGym', body: 'Test notification ✅ This is what alerts look like.', tag: 'test' }
}
export function dayReminderPush(_lang: unknown, routine?: PushRoutine | null): PushPayload {
  return { title: routine ? `${routine.emoji || '🏋️'} ${routine.name} today` : 'Workout planned today',
    body: "It's on your plan. Let's go 💪", tag: 'day-reminder' }
}
export function nudgePush(_lang: unknown, tone: string, routine: PushRoutine | null | undefined, iso: string): PushPayload {
  const copy = NUDGE_COPY[tone as keyof typeof NUDGE_COPY] || NUDGE_COPY.friendly
  const line = copy.lines[lineIndex(iso, copy.lines.length)]!
  return { title: copy.title, body: line.replace('{0}', () => routine?.name || 'openGym'), tag: 'nudge' }
}
