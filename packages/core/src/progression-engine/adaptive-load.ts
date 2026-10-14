import { dbLoadFor, dbLoadOf, meaningFactor, type BellProfile } from '../dumbbells'
import { checkedLoad, convertWeightPrecise } from './units'
import type { Exposure, RuleContext, WorkingSet } from './types'

/** Uses replayLoad each/total semantics and returns definition-unit load. */
export function adaptiveWorkingLoad(context: RuleContext, exposure: Exposure, set: WorkingSet): number | undefined {
  if (typeof set.w !== 'number') return undefined
  const cfg = { ...context.authored.slot, id: context.authored.slot.id ?? undefined }
  const to = dbLoadFor(context.input.profile as BellProfile, cfg, context.index)
  const factor = meaningFactor(dbLoadOf(exposure.target.dbLoad) ?? 'as', to, { ...exposure.target, id: exposure.exerciseId ?? cfg.id }, context.index)
  return convertWeightPrecise(checkedLoad(set.w * factor), exposure.unit, context.definition.unit)
}
