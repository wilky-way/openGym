import { test, expect } from 'bun:test'
import { NUDGE_COPY, lineIndex } from '@opengym/core/nudge'
import { nudgePush } from '../src/push-messages'
test('api/nudge-copy.js matches the frontend strings (node scripts/build-nudge-copy.mjs)', () => {
  // Server now consumes the core English pool directly; no generated duplicate to drift.
  for (const [tone, copy] of Object.entries(NUDGE_COPY)) for (const date of ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']) {
    expect(nudgePush('en', tone, { name: 'Synthetic' }, date)).toEqual({ title: copy.title,
      body: copy.lines[lineIndex(date, copy.lines.length)]!.replace('{0}', 'Synthetic'), tag: 'nudge' })
  }
})
