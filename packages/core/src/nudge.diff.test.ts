// Differential: the ported missed-workout nudge against the legacy module on seeded random
// schedules. The same plan, workouts, reminder time and tone must give the same nudge and the
// same minute, copy index and tone.
import { describe, expect, it } from 'vitest'
import * as fc from 'fast-check'
// @ts-expect-error the legacy oracle is untyped JS; this differential test is its only importer
import * as Old from '../../../packages/parity/fixtures/oracle/frontend/src/lib/nudge.js'
import * as Ported from './nudge'
// @ts-expect-error the legacy oracle is untyped JS; this differential test is its only importer
import * as OldHistory from '../../../packages/parity/fixtures/oracle/frontend/src/lib/history.js'
import * as PortedHistory from './history'

const RUNS = { numRuns: 1000, seed: 20261013 }
const DAY = 86400000
const isoAt = (offset: number) => new Date(Date.UTC(2026, 8, 7) + offset * DAY).toISOString().slice(0, 10)

const stateArb = fc.record({
  week: fc.array(fc.constantFrom<string | string[] | undefined>(undefined, 'push', 'pull', ['push', 'pull']), { minLength: 7, maxLength: 7 }),
  notes: fc.array(fc.constantFrom<string | undefined>(undefined, 'sick', 'cleared'), { minLength: 30, maxLength: 30 }),
  workoutOffsets: fc.array(fc.integer({ min: -20, max: 10 }), { maxLength: 5 }),
  dayPlan: fc.array(fc.constantFrom<string | undefined>(undefined, 'rest', 'push'), { minLength: 30, maxLength: 30 }),
  tone: fc.constantFrom<string | undefined>(undefined, 'friendly', 'guilt', 'drill', 'bogus'),
})

describe('nudge (differential)', () => {
  it('nudgeFor agrees with legacy on random schedules', () => {
    fc.assert(fc.property(stateArb, fc.integer({ min: -15, max: 15 }), (s, dayOffset) => {
      const week: Record<number, string | string[]> = {}
      s.week.forEach((id, wd) => { if (id) week[wd] = id })
      const dayPlan: Record<string, string> = {}
      s.dayPlan.forEach((v, i) => { if (v) dayPlan[isoAt(i - 15)] = v })
      const dayNotes: Record<string, unknown> = {}
      s.notes.forEach((n, i) => {
        if (n === 'sick') dayNotes[isoAt(i - 15)] = { tag: 'sick', _ts: 1 }
        if (n === 'cleared') dayNotes[isoAt(i - 15)] = { _ts: 2 }
      })
      const state = {
        routines: [{ id: 'push', name: 'Push' }, { id: 'pull', name: 'Pull' }],
        week, dayPlan, dayNotes,
        workouts: s.workoutOffsets.map(o => ({ id: 'w' + o, d: isoAt(o), routineId: 'push' })),
        reminder: { on: true, time: '08:00', nudge: true, tone: s.tone },
      }
      const iso = isoAt(dayOffset)
      const a = Ported.nudgeFor(state, iso), b = Old.nudgeFor(state, iso)
      expect(a).toEqual(b)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      expect(PortedHistory.effectiveRoutineIds(state, iso, iso)).toEqual(OldHistory.effectiveRoutineIds(state, iso, iso))
    }), RUNS)
  })

  it('nudgeMinute, lineIndex and toneOf agree with legacy', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), fc.integer({ min: 0, max: 4000 }),
      fc.constantFrom<string | undefined>(undefined, 'friendly', 'guilt', 'drill', 'x'),
      (h, m, n, tone) => {
        const hhmm = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
        expect(Ported.nudgeMinute(hhmm)).toBe(Old.nudgeMinute(hhmm))
        expect(Ported.nudgeMinute(undefined)).toBe(Old.nudgeMinute(undefined))
        expect(Ported.lineIndex(isoAt(n % 400), 4)).toBe(Old.lineIndex(isoAt(n % 400), 4))
        expect(Ported.toneOf({ tone })).toBe(Old.toneOf({ tone }))
      }), RUNS)
  })
})
