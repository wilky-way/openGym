import type { OpenGymProgrammeDefinition } from '../../../contract/domain/programme-model.generated'
import type { ProgressionRule, Why } from '../../../contract/domain/progression'
import type { AuthoredSlot, EngineInput, Exposure, TmTimeline } from './types'
import { sameSeries, finite, weekDate, cmp } from './replay'
import { addDays, stallEvents } from './stall'
import { buildWhy } from './why'
import { tmAt } from './tm'
import { isProgrammeDate } from '../programme-calendar'
import { InvalidLoadError, convertWeightPrecise } from './units'

interface Event { at: string; order: number; lift: string; change: 'delta' | 'factor' | 'repeat' | 'set'; amount: number; why: Why; restoreAt?: string; restore?: boolean }
export function adaptiveTimeline(input: EngineInput, slots: AuthoredSlot[], exposures: Exposure[], seed: TmTimeline): TmTimeline {
  const definition = input.definition as OpenGymProgrammeDefinition
  const rules = new Map<string, ProgressionRule>((definition.progressionRules ?? []).map(r => [r.id, r as ProgressionRule]))
  const attached = new Set(slots.flatMap(a => a.slot.progression?.rules ?? [])), events: Event[] = []
  for (const rule of rules.values()) {
    if (rule.kind !== 'amrap-tm' || !attached.has(rule.id)) continue
    const source = slots.find(a => a.ref.week === rule.source.slot.week && sameSeries(a.ref, rule.source.slot))!
    const load = source.slot.progression?.rules?.map(id => rules.get(id)).find(r => r?.kind === 'percentage')
    const row = load?.kind === 'percentage' ? load.weeks[String(source.ref.week)]?.[rule.source.set] : undefined
    // A generated AMRAP row replaces the authored rep floor, just as loadSets and
    // exposureSuccess do; omitted percentage repsMin has the core minimum of one.
    const minimum = Number(row ? row.repsMin ?? 1 : source.slot.setRepsMin?.[rule.source.set] ?? source.slot.repsMin ?? 1)
    const boundary = weekDate(input, rule.at === 'end-of-week' ? source.ref.week + 1 : (definition.lengthWeeks ?? Math.max(...definition.weeks.map(w => w.index))) + 1)
    // One bump per source occurrence even if duplicate imported workout rows exist.
    const seen = new Set<string>()
    for (const [order, exposure] of exposures.entries()) {
      if (exposure.ref.week !== source.ref.week || !sameSeries(exposure.ref, source.ref) || seen.has(exposure.occurrenceId)) continue
      const reps = finite(exposure.sets.find(s => s.workIndex === rule.source.set)?.r)
      if (reps === undefined) continue
      seen.add(exposure.occurrenceId)
      const repsOver = reps - minimum, band = rule.bands.find(b => repsOver >= b.minRepsOver)
      if (!band) continue
      const next = addDays(exposure.date, 1), at = boundary && boundary > next ? boundary : next
      const delta = Number(convertWeightPrecise(band.tmDelta, rule.unit, definition.unit))
      events.push({ at, order, lift: rule.lift, change: 'delta', amount: delta, why: buildWhy(rule.id, rule.kind, { lift: rule.lift, reps, minimum, repsOver, minRepsOver: band.minRepsOver, tmDelta: delta, sourceUnit: rule.unit, at, boundary: boundary ?? null, occurrenceId: exposure.occurrenceId }) })
    }
  }
  for (const event of stallEvents(slots, exposures, rules)) {
    if (event.rule.appliesTo !== 'tm') continue
    const lift = event.authored.slot.tm?.key
    if (!lift) continue // Authoring rejects this composition.
    const action = event.rule.action
    events.push({ at: event.at, order: exposures.indexOf(event.exposure), lift, change: action.kind === 'repeat' ? 'repeat' : 'factor', amount: action.kind === 'reset' ? action.pct : action.kind === 'deload' ? action.loadFactor : 1,
      ...(action.kind === 'deload' ? { restoreAt: addDays(event.at, action.weeks * 7) } : {}),
      why: buildWhy(event.rule.id, 'stall', { lift, failures: event.failures, after: event.rule.after, action: action.kind, appliesTo: 'tm', at: event.at, pct: action.kind === 'reset' ? action.pct : null, loadFactor: action.kind === 'deload' ? action.loadFactor : null, weeks: action.kind === 'deload' ? action.weeks : null }) })
  }
  const adjustments = input.cycle?.maxAdjustments ?? []
  if (!Array.isArray(adjustments) || adjustments.some(event=>!event || typeof event.id!=='string' || !event.id || typeof event.lift!=='string' || !event.lift || !isProgrammeDate(event.effectiveOn) || !Number.isSafeInteger(event.recordedAt) || event.recordedAt<0 || typeof event.value!=='number' || !Number.isFinite(event.value) || event.value<=0 || !['lb','kg'].includes(event.unit))) throw new InvalidLoadError()
  for (const [order, event] of [...adjustments].sort((a,b)=>a.recordedAt-b.recordedAt || cmp(a.id,b.id)).entries()) {
    events.push({at:event.effectiveOn, order:Number.MAX_SAFE_INTEGER, lift:event.lift, change:'set', amount:convertWeightPrecise(event.value,event.unit,definition.unit),
      why:buildWhy(event.id,'authored',{source:'manual-max',recordedAt:event.recordedAt,sequence:order,reason:event.reason,unit:event.unit})})
  }
  const out = structuredClone(seed)
  // Dynamic restores carry the original reduction, so later bumps survive unchanged.
  while (events.length) {
    events.sort((a, b) => cmp(a.at, b.at) || a.order - b.order || Number(a.why.inputs.sequence ?? 0) - Number(b.why.inputs.sequence ?? 0) || cmp(a.why.ruleId, b.why.ruleId))
    const event = events.shift()!, before = tmAt(out, event.lift, event.at)
    let cancelledRestores = 0
    if (event.change === 'set') for (let i=events.length-1;i>=0;i--) {
      if (events[i]!.restore && events[i]!.lift === event.lift) { events.splice(i,1);cancelledRestores++ }
    }
    if (before === null && event.change !== 'set') continue
    const value = event.change === 'set' ? event.amount : event.change === 'factor' ? before! * event.amount : event.change === 'delta' ? before! + event.amount : before!
    if (!Object.hasOwn(out,event.lift)) Object.defineProperty(out,event.lift,{value:[],enumerable:true,writable:true,configurable:true})
    out[event.lift]!.push({ value, at: event.at, why: buildWhy(event.why.ruleId, event.why.kind, { ...event.why.inputs, before, value, ...(cancelledRestores ? {cancelledRestores} : {}) }) })
    if (event.restoreAt) events.push({ at: event.restoreAt, order: -1, lift: event.lift, change: 'delta', amount: before! - value, restore: true,
      why: buildWhy(event.why.ruleId, 'stall', { ...event.why.inputs, action: 'restore', at: event.restoreAt, restored: before! - value }) })
  }
  return out
}
