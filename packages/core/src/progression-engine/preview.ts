import { EXIDX, type ExerciseIndex } from '../exercises'
import type { EngineInput, EngineExtensions, EngineResult } from './types'
import { evaluate, canonical } from './index'
import { weekDate, list, record } from './replay'

export type PreviewInput = EngineInput & {hypotheticalLogs?: unknown[]}

/** Explicit hypothetical logs are appended, never synthesized, persisted or mutated. */
export function preview(input: PreviewInput, extensions: EngineExtensions = {}, index: ExerciseIndex = EXIDX): EngineResult {
  const logs=[...input.logs,...(input.hypotheticalLogs ?? [])]
  if (!input.weeks.length) return evaluate({...input,logs},extensions,index)
  const result: EngineResult={weeks:[],tm:{},warnings:[]}
  for (const week of [...new Set(input.weeks)].sort((a,b)=>a-b)) {
    const known=list(record(input.definition).weeks).some(w=>record(w).index===week)
    const start=known ? weekDate(input,week) : undefined
    const boundary=start ? new Date(Date.parse(`${start}T00:00:00Z`)-86400000).toISOString().slice(0,10) : undefined
    const cutoff=[input.asOf ?? input.now,boundary].filter((v):v is string=>!!v).sort()[0]
    const evaluated=evaluate({...input,logs,weeks:[week],prescriptionAsOf:input.asOf ?? input.now,...(cutoff ? {asOf:cutoff} : {}),
      communityPreviewHistory:week===input.cycle?.weekIndex ? {asOf:input.asOf,now:input.now} : undefined},extensions,index)
    if (evaluated.error) return evaluated
    result.weeks.push(...evaluated.weeks)
    result.tm=evaluated.tm
    result.warnings.push(...evaluated.warnings)
    if (evaluated.slotErrors) (result.slotErrors ??= []).push(...evaluated.slotErrors)
  }
  const unique=new Map(result.warnings.map(w=>[JSON.stringify(canonical(w)),w]))
  result.warnings=[...unique].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,w])=>w)
  return canonical(result) as EngineResult
}
