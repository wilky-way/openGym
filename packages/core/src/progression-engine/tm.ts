import { checkedLoad, convertWeightPrecise } from './units'
import type { EngineInput, AuthoredSlot, Exposure, TmTimeline } from './types'
import type { EvaluateResult } from '../../../contract/domain/progression'
import type { OpenGymProgrammeDefinition } from '../../../contract/domain/programme-model.generated'
import { buildWhy } from './why'
import { cmp, finite, record } from './replay'

/** Always starts from tmSeed, never the mutable cycle.tm display cache. Values are in definition units. */
export function buildTmTimeline(input: EngineInput, slots: AuthoredSlot[], exposures: Exposure[], warnings: EvaluateResult['warnings'] = []): TmTimeline {
  const d = input.definition as OpenGymProgrammeDefinition
  const seeds = record(d.tmSeeds), frozen = record(input.cycle?.tmSeed)
  const keys = [...new Set([...Object.keys(seeds), ...Object.keys(frozen), ...slots.flatMap(a=>a.slot.tm?.key ? [a.slot.tm.key] : [])])].sort(cmp)
  const out: TmTimeline = {}
  for (const lift of keys) {
    let value = Object.hasOwn(frozen,lift) && typeof frozen[lift] === 'number' ? checkedLoad(frozen[lift]) : undefined, source = 'cycle.tmSeed'
    const seed = record(seeds[lift])
    if (value === undefined && finite(seed.value) !== undefined) {
      value = Number(convertWeightPrecise(Number(seed.value), seed.unit === 'lb' ? 'lb' : 'kg', d.unit)); source='definition.tmSeeds'
    }
    if (value === undefined && finite(record(seed.fromE1rm).pct) !== undefined) {
      warnings.push({code:'tm.seed-unfrozen',message:`Materialize the ${lift} e1RM seed at activation before prescribing loads.`})
    }
    if (value !== undefined && value > 0) Object.defineProperty(out, lift, {value:[{value, at:'seed', why:buildWhy('authored','authored',{tm:value,source})}],enumerable:true,writable:true,configurable:true})
  }
  return out
}
export function tmAt(tm: TmTimeline, lift: string, date?: string): number | null {
  const points = Object.hasOwn(tm,lift) ? tm[lift] : undefined
  return points?.filter(p => p.at === 'seed' || !date || p.at <= date).at(-1)?.value ?? null
}
