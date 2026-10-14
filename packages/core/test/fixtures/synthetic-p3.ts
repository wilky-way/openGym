import type { ProgressionRule, RpeLoadRule, PercentageRule, StallRule, AmrapTmRule } from '../../../contract/domain/progression'
import type { EngineInput } from '../../src/progression-engine'
import { addDays } from '../../src/progression-engine/stall'
import { syntheticProgramme } from './synthetic-programme'
export const rounding = { increment: 1, mode: 'nearest' as const, usePlates: false }
export const rpeRule = (): RpeLoadRule => ({ id: 'rpe', kind: 'rpe-load', lift: 'bench', weeks: { '*': [{ reps: 6, rir: 0 }] }, e1rm: { window: { sessions: 3 }, pick: 'best', formula: 'epley', useLoggedEffort: true }, rounding, whenNoData: { kind: 'athlete-picks' } })
export const percentage = (weeks = 8): PercentageRule => ({ id: 'wave', kind: 'percentage', ref: { lift: 'bench', basis: 'tm' }, weeks: Object.fromEntries(Array.from({ length: weeks }, (_, i) => [i + 1, [{ pct: 1, reps: 'amrap', repsMin: 5 }]])), rounding })
export const stallRule = (action: StallRule['action'], appliesTo: StallRule['appliesTo'] = 'load', after = 2): StallRule => ({ id: 'stall', kind: 'stall', after, action, appliesTo })
export const bumpRule = (week = 1): AmrapTmRule => ({ id: 'bump', kind: 'amrap-tm', lift: 'bench', source: { slot: { week, day: 'd1', session: 'main', slot: 'bench' }, set: 0 }, bands: [{ minRepsOver: 5, tmDelta: 10 }, { minRepsOver: 2, tmDelta: 5 }, { minRepsOver: 0, tmDelta: 0 }], unit: 'lb', at: 'end-of-week' })
export function p3Input(loadRule: ProgressionRule = rpeRule(), others: ProgressionRule[] = [], weeks = 8): EngineInput {
  const d = syntheticProgramme(), original = d.weeks[0]
  d.lengthWeeks = weeks; d.tmSeeds = { bench: { value: 200, unit: 'lb' } }; d.progressionRules = [loadRule, ...others]
  d.weeks = Array.from({ length: weeks }, (_, i) => ({ ...structuredClone(original), index: i + 1 }))
  for (const w of d.weeks) {
    const s = w.days[0].sessions[0].routineSnapshot.ex[0]
    s.sets = 1; s.reps = loadRule.kind === 'percentage' ? 'amrap' : 6; s.repsMin = 5; s.weight = 100
    s.tm = { key: 'bench', percentages: [1], reference: 'tm' }
    s.progression.rules = [loadRule.id, ...others.filter(r => r.kind === 'amrap-tm').map(r => r.id)]
    const stall = others.find(r => r.kind === 'stall'); if (stall) s.progression.onStall = stall.id
  }
  return { definition: d, cycle: { id: 'cycle', week1StartDate: '2026-01-05', weekIndex: weeks, tmSeed: { bench: 200 }, occurrences: Array.from({ length: weeks }, (_, i) => ({ instanceId: `o${i + 1}`, weekIndex: i + 1, dayKey: 'd1', ordinal: 1, routineId: `r${i + 1}`, sessionTemplateId: 'main', status: 'pending' })) }, logs: [], profile: { unit: 'lb', effortScale: 'rir' }, weeks: [weeks] }
}
export const p3Log = (week: number, w = 100, r = 6, extra: Record<string, unknown> = {}, date = addDays('2026-01-05', (week - 1) * 7)) => ({ id: `w${week}`, d: date, start: week, unit: 'lb', entries: [{ id: '0025', occurrenceId: `o${week}`, target: { slotId: 'bench', sets: 1, reps: 6, repsMin: 5 }, sets: [{ done: true, w, r, ...extra }] }] })
