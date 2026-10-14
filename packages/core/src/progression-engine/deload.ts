import type { PrescribedSet, ScheduledDeloadRule } from '../../../contract/domain/progression'
import type { OpenGymProgrammeDefinition } from '../../../contract/domain/programme-model.generated'
import { authoredSlots } from './replay'
import { slotKey } from './volume'
import type { Exposure, RuleContext } from './types'
import { buildWhy } from './why'

/** Deload logs remain history, but cannot earn load or TM progress. */
export function progressionExposures(definition: OpenGymProgrammeDefinition, exposures: Exposure[]): Exposure[] {
  const rules=new Map((definition.progressionRules ?? []).map(r=>[r.id,r]))
  const off=new Set(authoredSlots(definition).filter(a=>a.slot.progression?.rules?.some(id=>{
    const r=rules.get(id)
    return r?.kind==='scheduled-deload' && r.weeks.includes(a.ref.week) && r.progressionDuring==='off'
  })).map(a=>slotKey(a.ref)))
  return exposures.filter(e=>!off.has(slotKey(e.ref)))
}

/** Phase 4 alone applies both explicit factors, before the one final load rounding. */
export function scheduledDeload(context: RuleContext, sets: PrescribedSet[]): PrescribedSet[] {
  const rule=context.rule as ScheduledDeloadRule
  if (rule.kind!=='scheduled-deload' || !rule.weeks.includes(context.authored.ref.week)) return sets
  const count=sets.length===0 ? 0 : Math.max(1,Math.ceil(sets.length*rule.setsFactor))
  const effort=rule.effort
  const display: Record<string,number> | undefined=effort ? context.input.profile.effortScale==='rir'
    ? {rir:effort.rir ?? 10-effort.rpe!}
    : {rpe:effort.rpe ?? 10-effort.rir!} : undefined
  return sets.slice(0,count).map(s=>({...s,
    load:s.load===null ? null : s.load*rule.loadFactor,
    ...(display ? {target:{...(s.target?.pct===undefined ? {} : {pct:s.target.pct}),...display}} : {}),
    why:[...s.why,buildWhy(rule.id,rule.kind,{week:context.authored.ref.week,setsBefore:sets.length,sets:count,setsFactor:rule.setsFactor,loadFactor:rule.loadFactor,
      loadBefore:s.load,load:s.load===null ? null : s.load*rule.loadFactor,progressionDuring:rule.progressionDuring,...display})],
  }))
}
