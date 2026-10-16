/** GM-approved P3 semantics (2026-10-13, msg_68aaebd0fc08):
 * AMRAP effective date = max(next week/lap boundary, day after shifted exposure).
 * Stall fires once per N failures; success/action resets the counter, skips do not count.
 * Load reset/repeat use latest actual working loads; overrides end at later actual logs.
 * Deload runs N calendar weeks from day after the trigger. TM reset/deload are timeline
 * events; restoration adds the original reduction, preserving later AMRAP bumps.
 * Core estimate1RM stays unchanged, including non-weighted logged-effort behavior.
 * Fixed numeric definition seeds remain safe fallback; unfrozen from-e1rm seeds
 * stay unavailable. Current-week cutoffs observe effective events; historical
 * prescriptions and day windows remain anchored to the historical week date.
 */
import type { PrescribedSet, ProgressionRule, StallRule } from '../../../contract/domain/progression'
import type { AuthoredSlot, Exposure, RuleContext, WorkingSet } from './types'
import { isAssisted } from '../exercises'
import { authoredSlots, finite, sameSeries, evaluationDate } from './replay'
import { exposureSuccess, isLoadRule } from './rules'
import { adaptiveWorkingLoad } from './adaptive-load'
import { buildWhy } from './why'

export const addDays = (date: string, days: number) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
export interface StallEvent { exposure: Exposure; authored: AuthoredSlot; rule: StallRule; failures: number; at: string }
/** Each slot series has its own consecutive failure counter and rule attachment. */
export function stallEvents(slots: AuthoredSlot[], exposures: Exposure[], rules: Map<string, ProgressionRule>): StallEvent[] {
  const counters = new Map<string, number>(), events: StallEvent[] = []
  for (const exposure of exposures) {
    const authored = slots.find(a => a.ref.week === exposure.ref.week && sameSeries(a.ref, exposure.ref))
    const rule = authored?.slot.progression?.onStall ? rules.get(authored.slot.progression.onStall) : undefined
    const load = authored?.slot.progression?.rules?.map(id => rules.get(id)).find((r): r is ProgressionRule => !!r && isLoadRule(r))
    if (!authored || rule?.kind !== 'stall' || !load) continue
    const key = JSON.stringify([authored.ref.day, authored.ref.session, authored.ref.slot, rule.id])
    const failures = exposureSuccess(load, exposure, authored) ? 0 : (counters.get(key) ?? 0) + 1
    counters.set(key, failures === rule.after ? 0 : failures)
    if (failures === rule.after) events.push({ exposure, authored, rule, failures, at: addDays(exposure.date, 1) })
  }
  return events
}
export function prescriptionDate(context: RuleContext): string | undefined {
  return evaluationDate(context.input, context.authored.ref.week)
}
export function applyStall(context: RuleContext, sets: PrescribedSet[]): PrescribedSet[] {
  if (context.rule.kind !== 'stall') return sets
  const rule = context.rule, date = prescriptionDate(context)
  const rules = new Map<string, ProgressionRule>((context.definition.progressionRules ?? []).map(r => [r.id, r as ProgressionRule]))
  const events = stallEvents(authoredSlots(context.definition), context.exposures, rules).filter(e => e.rule.id === rule.id && sameSeries(e.authored.ref, context.authored.ref) && (!date || e.at <= date))
  const event = events.at(-1)
  if (!event) return sets
  const action = rule.action
  const why = buildWhy(rule.id, rule.kind, { failures: event.failures, after: rule.after, action: action.kind, appliesTo: rule.appliesTo, at: event.at,
    resetPct: action.kind === 'reset' ? action.pct : null, setsFactor: action.kind === 'deload' ? action.setsFactor : null,
    loadFactor: action.kind === 'deload' ? action.loadFactor : null, weeks: action.kind === 'deload' ? action.weeks : null })
  if (action.kind === 'deload') {
    if (date && date >= addDays(event.at, action.weeks * 7)) return sets
    return sets.slice(0, Math.max(1, Math.ceil(sets.length * action.setsFactor))).map(s => ({ ...s, load: rule.appliesTo === 'load' && s.load !== null ? s.load * action.loadFactor : s.load, why: [...s.why, why] }))
  }
  if (rule.appliesTo === 'tm') return sets.map(s => ({ ...s, why: [...s.why, why] }))
  const assisted = isAssisted(context.authored.slot.id, context.index)
  const actual = (s?: WorkingSet) => { const w = finite(s?.w); return w !== undefined && (assisted ? w >= 0 : w > 0) }
  const laterActual = context.exposures.some(e => context.exposures.indexOf(e) > context.exposures.indexOf(event.exposure) && e.sets.some(actual))
  if (laterActual) return sets
  return sets.map((s, i) => {
    const prior = context.exposures.slice(0, context.exposures.indexOf(event.exposure) + 1).filter(e => sameSeries(e.ref, context.authored.ref)).reverse()
    const actualExposure = prior.find(e => actual(e.sets.find(s => s.workIndex === i)))
    const actualSet = actualExposure?.sets.find(s => s.workIndex === i)
    const base = !actualSet || !actualExposure ? s.load : adaptiveWorkingLoad(context, actualExposure, actualSet) ?? s.load
    return { ...s, load: base === null ? null : base * (action.kind === 'reset' ? action.pct : 1), why: [...s.why, buildWhy(rule.id, rule.kind, { ...why.inputs, set: i, actualLoad: base })] }
  })
}
