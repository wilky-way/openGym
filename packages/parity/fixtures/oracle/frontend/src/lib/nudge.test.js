import { describe, expect, it } from 'vitest'
import { NUDGE_COPY, NUDGE_TONES, lineIndex, nudgeFor, nudgeMinute, toneOf } from './nudge.js'

// The same rules as api/nudge.js (api/test/nudge.test.js holds the mirror of these cases):
// a planned day with nothing logged is a miss; 3 misses in a row since the last workout and it
// goes quiet. 2026-09-07 is a Monday; Push on Mon/Wed/Fri.
const routines = [{ id: 'push', name: 'Push' }, { id: 'pull', name: 'Pull' }]
const S = (over = {}) => ({
  routines, week: { 1: 'push', 3: 'push', 5: 'push' }, dayPlan: {}, workouts: [],
  reminder: { on: true, time: '08:00', nudge: true, tone: 'friendly' }, ...over,
})
const w = d => ({ id: 'w' + d, d, routineId: 'push' })

describe('nudgeFor', () => {
  it('nudges a missed planned day, not a rest day or a trained one', () => {
    expect(nudgeFor(S({ workouts: [w('2026-09-04')] }), '2026-09-07')).toEqual(['push'])
    expect(nudgeFor(S({ workouts: [w('2026-09-04')] }), '2026-09-08')).toBeNull()
    expect(nudgeFor(S({ workouts: [w('2026-09-07')] }), '2026-09-07')).toBeNull()
    expect(nudgeFor(S({ workouts: [w('2026-09-04')], dayPlan: { '2026-09-07': 'rest' } }), '2026-09-07')).toBeNull()
  })

  it('backs off after 3 missed days in a row until the next workout', () => {
    const s = S({ workouts: [w('2026-09-04')] })
    expect(['2026-09-07', '2026-09-09', '2026-09-11', '2026-09-14'].map(d => !!nudgeFor(s, d))).toEqual([true, true, true, false])
    expect(nudgeFor(S({ workouts: [w('2026-09-04'), w('2026-09-15')] }), '2026-09-16')).toEqual(['push'])
  })

  it('in a coach week the day after a session is rest; the second day off is a miss', () => {
    const queue = { ids: ['push', 'pull'], since: 0, startsOn: '2026-09-07' }
    const s = S({ week: {}, queue, workouts: [{ id: 'a', d: '2026-09-07', routineId: 'push', start: 1 }] })
    expect(nudgeFor(s, '2026-09-08')).toBeNull()
    expect(nudgeFor(s, '2026-09-09')).toEqual(['pull'])
  })

  // #261: a day with a note on it (sick, travelling, …) is excused, not missed.
  it('leaves a noted day alone, and a noted day does not count towards the back-off', () => {
    const notes = { '2026-09-07': { tag: 'sick', _ts: 1 } }
    expect(nudgeFor(S({ workouts: [w('2026-09-04')], dayNotes: notes }), '2026-09-07')).toBeNull()
    expect(nudgeFor(S({ workouts: [w('2026-09-04')], dayNotes: { '2026-09-07': { text: 'Flight to Lisbon', _ts: 1 } } }), '2026-09-07')).toBeNull()
    // a cleared note (a stamped empty entry) is no excuse
    expect(nudgeFor(S({ workouts: [w('2026-09-04')], dayNotes: { '2026-09-07': { _ts: 2 } } }), '2026-09-07')).toEqual(['push'])
    // Monday excused: Wednesday, Friday and the next Monday are the three misses that count
    const s = S({ workouts: [w('2026-09-04')], dayNotes: notes })
    expect(['2026-09-09', '2026-09-11', '2026-09-14', '2026-09-16'].map(d => !!nudgeFor(s, d))).toEqual([true, true, true, false])
  })

  it('times the evening and reads the tone tolerantly', () => {
    expect(nudgeMinute('08:00')).toBe(1200)
    expect(nudgeMinute('19:15')).toBe(1275)
    expect(nudgeMinute('20:00')).toBeNull()
    expect(toneOf({ tone: 'guilt' })).toBe('guilt')
    expect(toneOf({ tone: 'nope' })).toBe('friendly')
    for (const k of NUDGE_TONES) expect(NUDGE_COPY[k].lines.length).toBeGreaterThanOrEqual(3)
  })
})
