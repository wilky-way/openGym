import type { SyncRecord, StampReport } from '../src/server-stamp'
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { stampPut } from '../src/server-stamp'

const cfg: SyncRecord = { id: '0025', sets: 3, reps: 10, instructions: 'Synthetic rule', setTargets: [null, { rpe: 8 }, { pct: 75 }] }
const shapes: SyncRecord = {
  null: null,
  object: { legacy: true },
  empty: [],
  nullRow: [null],
  mixed: [null, [], {}, { id: 'r', ex: [cfg] }],
}
for (const stamped of [false, true]) for (const [stored, routines] of Object.entries(shapes)) {
  for (const [incoming, nextRoutines] of Object.entries(shapes)) {
    test(`R2-4 ${stamped ? 'stamped' : 'unstamped'} sync accepts stored ${stored} and incoming ${incoming} routines`, () => {
      const cur: SyncRecord = { routines: structuredClone(routines), workouts: [] }
      const next: SyncRecord = { routines: structuredClone(nextRoutines), workouts: [] }
      const row = next.routines?.find?.((r: SyncRecord) => r?.id === 'r')
      if (row) row.ex = [{ id: '0025', sets: 3, reps: 10 }]
      assert.equal(stampPut(cur, next, { stamped, overRead: true, now: 100 }), next)
      if (stored === 'mixed' && row) {
        assert.equal(row.ex[0].instructions, cfg.instructions)
        assert.deepEqual(row.ex[0].setTargets, cfg.setTargets)
      }
    })
  }
}
