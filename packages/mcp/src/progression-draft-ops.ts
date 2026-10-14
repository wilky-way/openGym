import { createExerciseIndex } from '@opengym/core/exercises'
import { validateProgression } from '@opengym/core/progression-validate'
import { error } from './http-client'
import { redactToolCredentials } from './state'
import type { Draft } from './draft-store'

/** Validate using the catalogue saved with the draft, never another invocation's profile. */
export function checkDraftProgression(draft: Draft): void {
  const result = redactToolCredentials(validateProgression(draft.definition, createExerciseIndex(draft.customEx ?? [])))
  if (!result.ok) throw Object.assign(error('INVALID_RULES', 'Progression operation rejected: ' + JSON.stringify(result.issues).slice(0,8000)), { issues: result.issues })
}
export function attachDraftRule(slot: Record<string, any>, rule: Record<string, any>, attach: boolean): void {
  if (!attach && (slot.progression == null || (rule.kind === 'stall' ? slot.progression.onStall !== rule.id : !slot.progression.rules?.includes(rule.id)))) return
  const p = slot.progression ?? { kind: 'authored', instructions: 'Follow the attached progression rules and their explanations.' }
  if (rule.kind === 'stall') {
    if (attach) p.onStall = rule.id
    else if (p.onStall === rule.id) delete p.onStall
  } else {
    const refs = p.rules ?? []
    if (!Array.isArray(refs)) throw error('INVALID_RULES', 'Slot rule references must be an array.')
    p.rules = attach ? [...new Set([...refs, rule.id])] : refs.filter(id => id !== rule.id)
  }
  slot.progression = p
}
