import type { RuleRpeLoad, RuleScheduledDeload } from '../domain/programme-model.named.generated'
import type { ProgressionValidateResult } from '../domain/progression'
import { validateProgression } from '../core-api/progression-validate'
// Generated authoring types must retain the numeric reps/effort fields, not
// degrade oneOf targets into unknown extension bags.
const valid: RuleRpeLoad['weeks'] = {'*':[{reps:5,rpe:8},{reps:5,rir:2}]}
// @ts-expect-error Authoring reps are numeric, never coerced from strings.
const invalid: RuleRpeLoad['weeks'] = {'*':[{reps:'5',rpe:8}]}
const effort: RuleScheduledDeload['effort'] = {rir:2}
// @ts-expect-error Authoring effort is numeric, never an opaque string.
const badEffort: RuleScheduledDeload['effort'] = {rir:'2'}
const result: ProgressionValidateResult = validateProgression({progressionRules:[]},{})
void [valid,invalid,effort,badEffort,result]
import type { EvaluateInput } from '../domain/progression'
import type { ProgrammeCycle, ProgrammeOccurrence } from '../domain/state-doc'

// Strict consumer regression: cycle replay inputs use the existing state-doc shapes.
export function evaluationCycle(cycle: ProgrammeCycle): NonNullable<EvaluateInput['cycle']> {
  return {
    id: cycle.id, tm: cycle.tm, tmSeed: cycle.tmSeed, occurrences: cycle.occurrences,
    week1StartDate: cycle.week1StartDate, weekIndex: cycle.weekIndex,
    since: cycle.since, startsOn: cycle.startsOn, strict: cycle.strict,
  }
}
export function replayInputs(cycle: NonNullable<EvaluateInput['cycle']>) {
  const seed: ProgrammeCycle['tmSeed'] = cycle.tmSeed
  const occurrences: ProgrammeOccurrence[] = cycle.occurrences
  const since: ProgrammeCycle['since'] | undefined = cycle.since
  const startsOn: ProgrammeCycle['startsOn'] | undefined = cycle.startsOn
  const strict: ProgrammeCycle['strict'] = cycle.strict
  // @ts-expect-error TM seeds contain numeric loads, never strings.
  cycle.tmSeed = { synthetic: '100' }
  // @ts-expect-error Occurrences need identities and replay status, not just a date.
  cycle.occurrences = [{ date: '2026-01-01' }]
  // @ts-expect-error The legacy strict flag is true-only, not a general boolean.
  cycle.strict = false
  // @ts-expect-error Activation stamps are numeric, not date strings.
  cycle.since = '2026-01-01'
  // @ts-expect-error Activation dates are strings, not numeric stamps.
  cycle.startsOn = 1
  return { seed, occurrences, since, startsOn, strict }
}
