import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { projectCycle, monthCells, addProgrammeDays } from './programme-calendar.js'

const cycle = (over = {}) => ({ id: 'c', status: 'active', cadence: { perWeek: 4 }, weekIndex: 4,
  snapshot: { weeks: [4, 5, 6].map(index => ({ index, mode: index === 6 ? 'deload' : 'train' })) },
  occurrences: [4, 5, 6].flatMap(weekIndex => [1, 2, 3, 4].map(ordinal => ({ instanceId: `c:w${weekIndex}d${ordinal}`, routineId: `r-w${weekIndex}d${ordinal}`, weekIndex, ordinal, dayKey: `d${ordinal}`, status: 'pending' }))), ...over })
const dates = p => p.pending.map(o => o.date)
const log = (instanceId, d) => ({ id: instanceId, d, programmeInstance: { cycleId: 'c', instanceId } })

describe('floating projection', () => {
  it('implements the October 12 worked example and week ranges', () => {
    const c = cycle(), before = structuredClone(c), p = projectCycle(c, [], '2026-10-12')
    expect(dates(p)).toEqual(['2026-10-12', '2026-10-13', '2026-10-15', '2026-10-17', '2026-10-19', '2026-10-20', '2026-10-22', '2026-10-24', '2026-10-26', '2026-10-27', '2026-10-29', '2026-10-31'])
    expect(p.endDate).toBe('2026-10-31')
    expect(p.nextBlockStart).toBe('2026-11-01')
    expect(p.weeks.map(w => [w.startDate, w.endDate, w.mode])).toEqual([['2026-10-12', '2026-10-17', 'train'], ['2026-10-19', '2026-10-24', 'train'], ['2026-10-26', '2026-10-31', 'deload']])
    expect(c).toEqual(before)
  })
  it.each([['2026-10-13', '2026-11-01', 1], ['2026-10-16', '2026-11-04', 4]])('a gap to %s shifts every pending session by exactly %s days', (today, end, gap) => {
    const initial = projectCycle(cycle(), [], '2026-10-12'), moved = projectCycle(cycle(), [], today)
    expect(moved.endDate).toBe(end)
    expect(dates(moved)).toEqual(dates(initial).map(d => addProgrammeDays(d, gap)))
  })
  it('Shift sets the lower bound and moves the end to Nov 1', () => {
    const p = projectCycle(cycle({ notBefore: '2026-10-13' }), [], '2026-10-12')
    expect(p.next.date).toBe('2026-10-13')
    expect(p.endDate).toBe('2026-11-01')
  })
  it('D1/D2 logged and D3 skipped on Oct 13 puts D4 on Oct 14 and ends Oct 28', () => {
    const c = cycle()
    Object.assign(c.occurrences[2], { status: 'skipped', date: '2026-10-13' })
    const workouts = [log('c:w4d1', '2026-10-12'), log('c:w4d2', '2026-10-13')]
    const p = projectCycle(c, workouts, '2026-10-13')
    expect(p.next).toMatchObject({ instanceId: 'c:w4d4', date: '2026-10-14' })
    expect(p.endDate).toBe('2026-10-28')
    expect(p.weeks[0]).toMatchObject({ done: 2, skipped: 1, planned: 4, closed: false, startDate: '2026-10-12', endDate: '2026-10-14' })
  })
  it('trained today means tomorrow, including an ordinary historical workout', () => {
    expect(projectCycle(cycle(), [{ id: 'ordinary', d: '2026-10-12' }], '2026-10-12').next.date).toBe('2026-10-13')
  })
  it.each(['ordinary', 'programme'])('a future %s workout does not move the projection anchor', kind => {
    const c = cycle()
    const workouts = [kind === 'programme' ? log('c:w4d1', '2026-11-01') : { id: 'future', d: '2026-11-01' }]
    const p = projectCycle(c, workouts, '2026-10-12')
    expect(p.lastDoneDate).toBeNull()
    expect(p.anchor).toBe('2026-10-12')
    expect(p.next.date).toBe('2026-10-12')
    const expected = projectCycle(c, [], '2026-10-12').pending.slice(kind === 'programme' ? 1 : 0).map(o => o.instanceId)
    expect(p.pending.map(o => o.instanceId)).toEqual(expected)
    if (kind === 'ordinary') expect(p.endDate).toBe('2026-10-31')
  })
  it('D3 before D2 leaves D2 next, preserving the other dates as history', () => {
    const p = projectCycle(cycle(), [log('c:w4d1', '2026-10-12'), log('c:w4d3', '2026-10-13')], '2026-10-13')
    expect(p.next).toMatchObject({ instanceId: 'c:w4d2', date: '2026-10-14' })
    expect(p.occurrences[2]).toMatchObject({ status: 'done', date: '2026-10-13' })
  })
  it('uses a reordered current-week queue, then the authored order of later weeks', () => {
    const p = projectCycle(cycle(), [], '2026-10-12', { ids: ['r-w4d2', 'r-w4d1', 'r-w4d4', 'r-w4d3'] })
    expect(p.pending.slice(0, 5).map(o => o.routineId)).toEqual(['r-w4d2', 'r-w4d1', 'r-w4d4', 'r-w4d3', 'r-w5d1'])
  })
  it.each([[3, [0, 2, 4, 7, 9, 11]], [4, [0, 1, 3, 5, 7, 8]], [5, [0, 1, 2, 4, 5, 7]]])('%s/week uses floor(k*7/perWeek) with no duplicate or past dates', (perWeek, offsets) => {
    const c = cycle({ cadence: { perWeek } })
    // A garbage stored projected date never affects a read.
    c.occurrences[0].date = '2000-01-01'
    const p = projectCycle(c, [], '2026-10-12')
    expect(dates(p).slice(0, 6)).toEqual(offsets.map(n => addProgrammeDays('2026-10-12', n)))
    expect(new Set(dates(p)).size).toBe(p.pending.length)
    expect(dates(p).every(d => d >= '2026-10-12')).toBe(true)
  })
})

describe('pins, pause, calendar and time zones', () => {
  it.each([['2026-10-14', '2026-10-15', '2026-10-29'], ['2026-10-20', '2026-10-21', '2026-11-04']])('a third-session pin on %s restarts following spacing', (pin, next, end) => {
    const c = cycle(); c.occurrences[2].pinnedOn = pin
    const p = projectCycle(c, [], '2026-10-12')
    expect(p.pending[2].date).toBe(pin)
    expect(p.pending[3].date).toBe(next)
    expect(p.endDate).toBe(end)
  })
  it('stale pins float and conflicting incoming pins are flagged without past or duplicate dates', () => {
    const c = cycle()
    c.occurrences[0].pinnedOn = '2026-10-11'
    c.occurrences[1].pinnedOn = '2026-10-12'
    const p = projectCycle(c, [], '2026-10-12')
    expect(p.pending[0].date).toBe('2026-10-12')
    expect(p.pending[1]).toMatchObject({ date: '2026-10-13', pinConflict: true })
    expect(new Set(dates(p)).size).toBe(p.pending.length)
  })
  it('paused cycles project nothing but preserve actual done and skipped dates', () => {
    const c = cycle({ status: 'paused' }); Object.assign(c.occurrences[1], { status: 'skipped', date: '2026-10-13' })
    Object.assign(c.occurrences[2], { date: '2026-10-14', projected: true, pinConflict: true })
    c.occurrences.push(null, false, { noInstanceId: true })
    const p = projectCycle(c, [log('c:w4d1', '2026-10-12')], '2026-10-14')
    expect(p.pending).toEqual([])
    expect(p.next).toBeNull()
    expect(p.endDate).toBeNull()
    expect(p.occurrences[0].date).toBe('2026-10-12')
    expect(p.occurrences[2].date).toBeUndefined()
  })
  it('month cells include historical ordinary lifts, actual sessions, deload, today and finish', () => {
    const workouts = [{ id: 'old', d: '2026-10-03' }]
    const p = projectCycle(cycle(), workouts, '2026-10-12')
    const cells = monthCells(p, '2026-10', { workouts, today: '2026-10-12', weekStartsOn: 1 })
    expect(cells.slice(0, 3)).toEqual([null, null, null])
    expect(cells.find(c => c?.date === '2026-10-03').workouts[0].id).toBe('old')
    expect(cells.find(c => c?.date === '2026-10-12').today).toBe(true)
    expect(cells.find(c => c?.date === '2026-10-31')).toMatchObject({ end: true, occurrences: [expect.objectContaining({ mode: 'deload' })] })
    expect(monthCells(p, 'bad')).toEqual([])
  })
  it('walks calendar days through America/Chicago Nov 1 DST (a 25-hour day)', () => {
    const path = new URL('./programme-calendar.js', import.meta.url).href
    const code = `import { addProgrammeDays, projectCycle } from ${JSON.stringify(path)}; const p = projectCycle(${JSON.stringify(cycle())}, [], '2026-10-31'); process.stdout.write(JSON.stringify({next:addProgrammeDays('2026-10-31', 1), dates:p.pending.map(o=>o.date), hours:(new Date('2026-11-01T12:00:00')-new Date('2026-10-31T12:00:00'))/3600000}));`
    const actual = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, TZ: 'America/Chicago' }, encoding: 'utf8' }))
    expect(actual.next).toBe('2026-11-01')
    expect(actual.hours).toBe(25)
    expect(actual.dates.slice(0, 5)).toEqual(['2026-10-31', '2026-11-01', '2026-11-03', '2026-11-05', '2026-11-07'])
  })
  it('keeps frontend/API projection code identical', () => {
    expect(readFileSync(new URL('../../../api/programme-calendar.js', import.meta.url), 'utf8')).toBe(readFileSync(new URL('./programme-calendar.js', import.meta.url), 'utf8'))
  })
})
