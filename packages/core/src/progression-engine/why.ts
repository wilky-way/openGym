import type { Why } from '../../../contract/domain/progression'

const templates: Record<Why['kind'], (i: Why['inputs']) => string> = {
  authored: i => i.source === 'manual-max' ? `Use the reviewed reference max ${i.value}.${i.cancelledRestores ? ' Cancel the pending deload restore for this lift.' : ''}` : i.reason === 'no-seed' ? 'Choose a starting load; no authored seed is available.' : 'Use the authored prescription.',
  percentage: i => `Use ${Number(i.pct) * 100}% of ${i.basis} ${i.reference ?? 'unavailable'}.`,
  linear: i => i.assisted ? `Use ${i.increment} less assistance after every ${i.every} successful ${i.period}; ${i.bumps} reductions earned.` : `Add ${i.increment} after every ${i.every} successful ${i.period}; ${i.bumps} increases earned.`,
  double: i => i.assisted ? `Use ${i.increment} less assistance when ${i.condition} reach the rep ceiling; ${i.bumps} reductions earned.` : `Increase by ${i.increment} when ${i.condition} reach the rep ceiling; ${i.bumps} increases earned.`,
  'rpe-load': i => `Use estimated 1RM ${i.e1rm ?? 'unavailable'} at the prescribed effort.`,
  'amrap-tm': i => `Change the training max by ${i.tmDelta} after ${i.repsOver} reps above the minimum.`,
  stall: i => `After ${i.failures} failed exposures, apply ${i.action}.`,
  'scheduled-deload': i => `Deload with set factor ${i.setsFactor} and load factor ${i.loadFactor}.`,
  'volume-ramp': i => `Prescribe ${i.sets} weekly sets with a cap of ${i.maxSets}.`,
}
/** Only fixed sentences and named scalar inputs; authored text is never executed/interpolated. */
export function buildWhy(ruleId: Why['ruleId'], kind: Why['kind'], inputs: Why['inputs']): Why {
  return { ruleId, kind, inputs: Object.fromEntries(Object.keys(inputs).sort().map(k => [k, inputs[k]!])), text: inputs.inventoryWarning ? `Warning: owned inventory changes the computed load from ${inputs.roundedFrom} to ${inputs.roundedTo}, beyond the tolerance of ${inputs.roundingTolerance}. Review this load before lifting.` : inputs.roundedFrom !== undefined ? `Round ${inputs.roundedFrom} using ${inputs.inventory ? 'owned inventory' : 'increment '+inputs.roundingIncrement} (${inputs.rounding}).` : inputs.assisted && inputs.loadAfter !== undefined ? `Use ${Number(inputs.loadAfter)>Number(inputs.loadBefore) ? 'more assistance for recovery' : 'less assistance for progression'}: ${inputs.loadBefore} to ${inputs.loadAfter}.` : templates[kind](inputs) }
}
