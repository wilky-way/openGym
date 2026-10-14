declare global { var __programmeRuleProbe: number | undefined }
import type { Cycle, SchedulingState, Log, Occurrence } from '../src/programme-sync'
import { describe, expect, it } from 'vitest'
import { programmeRuleText } from '../src/programme-rule-text'

// These tiny programs are invented grammar fixtures, never library snapshots.
const progress = (summary: string) => ({ kind: 'progress', summary })
const update = (summary: string) => ({ kind: 'update', summary })
const translate = (summary: string, exercise: import("../src/programme-rule-text").RuleExercise = {}, raw: import("../src/programme-rule-text").RawProgram = {}) => programmeRuleText({ ...exercise, rules: [progress(summary)] }, raw)
const noCode = (text: string) => expect(text).not.toMatch(/custom\(|state\.|var\.|completedReps|completedWeights|setVariationIndex|\brm1\b|\{|\}/)

describe('authored progression text', () => {
  it('preserves authored instructions and notes without inventing a progression', () => {
    expect(programmeRuleText({ instructions: 'Stop with two reps in reserve.', notes: ['Rest three minutes.', 'Use a comfortable grip.'] })).toEqual({
      instructions: 'Stop with two reps in reserve.\n\nRest three minutes.\n\nUse a comfortable grip.', complete: true, reasons: [],
    })
    expect(programmeRuleText({})).toEqual({ instructions: '', complete: true, reasons: [] })
  })

  it('translates success and failure session counts including their units', () => {
    const result = translate('linear: add 1.25kg after 2 successful session(s); subtract 12% after 3 failed session(s)')
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('Add 1.25 kg after 2 successful sessions')
    expect(result.instructions).toContain('meet every prescribed rep target')
    expect(result.instructions).toContain('Reduce the load by 12 % after 3 failed sessions')
  })

  it('translates double progression with all-set upper target and explicit reset', () => {
    const result = translate('double progression: reps 7-11; at the top add 2.5kg and reset reps to 7')
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('7–11 reps')
    expect(result.instructions).toContain('every set reaches 11 reps, add 2.5 kg')
    expect(result.instructions).toContain('reset the rep target to 7')
  })

  it('distinguishes strict and inclusive total rep thresholds', () => {
    expect(translate('reps-sum: add 2kg when total reps > 42').instructions).toContain('exceed 42')
    expect(translate('reps-sum: add 2kg when total reps >= 42').instructions).toContain('reach at least 42')
    expect(translate('progress: none (progression disabled)').instructions).toContain('Progression is disabled')
  })

  it('accepts natural authored rules but rejects broken grammar and missing summaries', () => {
    expect(translate('Add one rep each week while maintaining your form.').complete).toBe(true)
    expect(translate('linear: add something eventually').complete).toBe(false)
    expect(translate('double progression: reps 7-11; at the top add ...').complete).toBe(false)
    expect(programmeRuleText({ rules: [{ kind: 'progress' }] }).complete).toBe(false)
    expect(programmeRuleText({ parsed: false }).reasons).toContain('The source marks this exercise as not fully parsed.')
  })
})

describe('static conditions and actions', () => {
  it('shows +5 lb only when the AMRAP hits 10+, without executing the source', () => {
    const result = translate('custom(): if (completedReps[ns] >= 10) { weights += 5lb }', { sets: [{ count: 1, reps: 5, amrap: true }] })
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('last AMRAP set is at least 10')
    expect(result.instructions).toContain('Add 5 lb')
    expect(result.instructions).not.toContain('Otherwise')
    noCode(result.instructions)
  })

  it('preserves nested success, strict bonus threshold and failure branches', () => {
    const result = translate('custom(step: 3kg): if (completedReps >= reps) { if (completedReps[ns] > 9) { weights += step * 2 } else { weights += step } } else { weights *= 0.88 }')
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('every set meets its rep target')
    expect(result.instructions).toContain('last set is more than 9')
    expect(result.instructions).toContain('Add 6 kg')
    expect(result.instructions).toContain('Add 3 kg')
    expect(result.instructions).toContain('Reduce the load for all sets by 12%')
    expect(result.instructions.match(/Otherwise:/g)).toHaveLength(2)
  })

  it('retains week/day guards, conjunctions, disjunctions and timing', () => {
    const result = translate('custom(step: 4lb): if ((week == 2 || week == 5) && dayInWeek == 3 && completedReps >= reps) { rm1 += step }')
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('After the session')
    expect(result.instructions).toContain('week equals 2')
    expect(result.instructions).toContain('or')
    expect(result.instructions).toContain('week equals 5')
    expect(result.instructions).toContain('day of the week equals 3')
    expect(result.instructions).toContain('Add 4 lb to the 1RM reference')
  })

  it('distinguishes beginning-of-session updates and set-finished updates', () => {
    const result = programmeRuleText({ rules: [update('custom(): if (setIndex == 0) { reps = 4 } if (setIndex == 1) { weights[2] = completedWeights[1] * 0.72 }')] })
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('During the session')
    expect(result.instructions).toContain('session has not started')
    expect(result.instructions).toContain('set 1 is finished')
    expect(result.instructions).toContain('load for set 2 to 72% of (the completed load for set 1)')
  })

  it('renders sums, priority branches, ternary thresholds and modulo cycles', () => {
    const result = translate('custom(): if (week % 4 == 0) { if (sum(completedReps) > (week == 4 ? 44 : 33)) { rm1 += 12lb } else if (sum(completedReps) >= 25) { rm1 += 6lb } }')
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('last week of each 4-week cycle')
    expect(result.instructions).toContain('total of the completed reps is more than (44 when the week equals 4; otherwise 33)')
    expect(result.instructions).toContain('Otherwise:\n    If')
    expect(result.instructions).toContain('Add 12 lb')
    expect(result.instructions).toContain('Add 6 lb')
  })

  it('preserves negation of all-set success', () => {
    const result = translate('custom(): if (!(completedReps >= reps)) { weights -= 2kg }')
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('not true that (every set meets its rep target)')
    expect(result.instructions).toContain('Subtract 2 kg')
  })

  it('handles per-set loops rather than treating them as total reps', () => {
    const result = translate('custom(step: 2kg): for (var.j in completedReps) { if (completedReps[var.j] >= reps[var.j]) { weights[var.j] = completedWeights[var.j] + step } }')
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('For each set, in order')
    expect(result.instructions).toContain('completed reps for this set is at least the rep target for this set')
    expect(result.instructions).toContain('load for this set to the completed load for this set plus 2 kg')
    noCode(result.instructions)
  })

  it('supports temporary calculations, set configuration and rounding', () => {
    const result = programmeRuleText({ rules: [update('custom(): if (setIndex == 1) { var.r = max(floor(completedReps[1] / 3), 1) sets(2, numberOfSets, var.r, var.r, 0, roundWeight(completedWeights[1] * 0.8), 75, RPE[1], 1) }')] })
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('rounded down')
    expect(result.instructions).toContain('larger of')
    expect(result.instructions).toContain('Configure sets 2 through the number of sets')
    expect(result.instructions).toContain('75 seconds')
    expect(result.instructions).toContain('record RPE')
    expect(result.instructions).toContain('rounded to an available load')
    noCode(result.instructions)
  })

  it('supports multiweek set selectors without leaking selectors into instructions', () => {
    const result = translate('custom(): if (week % 2 == 1) { weights[week + 1:*:*:*] = completedWeights[1] }')
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('odd-numbered week')
    expect(result.instructions).toContain('week the week plus 1')
    expect(result.instructions).not.toContain(':*')
  })

  it('does not freeze mutable state to the parameter initial value', () => {
    const result = translate('custom(failures: 0, step: 2lb): if (completedReps >= reps) { failures = 0 } else { failures += 1 if (failures >= 4) { weights -= step * 2 failures = 0 } }')
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('failure count is at least 4')
    expect(result.instructions).toContain('Subtract 4 lb')
    expect(result.instructions).not.toContain('If 0 is at least 4')
  })
})

describe('reuse, stages and source recovery', () => {
  it('recovers truncated source by a unique normalized prefix and uses full actions', () => {
    const result = translate('custom(step: 6lb): if (completedReps >= reps) { weights += step } else { weights ...', {}, {
      rules: { progression_scripts: ['custom(step: 6lb) {~ if (completedReps >= reps) { weights += state.step } else { weights *= 0.85 } ~}'] },
    })
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('Add 6 lb')
    expect(result.instructions).toContain('Reduce the load for all sets by 15%')
  })

  it('rejects ambiguous or unavailable truncated sources', () => {
    const summary = 'custom(): if (week == 2) { weights ...'
    expect(translate(summary).complete).toBe(false)
    const raw = { rules: { progression_scripts: ['custom() {~ if (week == 2) { weights += 3lb } ~}', 'custom() {~ if (week == 2) { weights -= 3lb } ~}'] } }
    const result = translate(summary, {}, raw)
    expect(result.complete).toBe(false)
    expect(result.instructions).toBe('')
    expect(result.reasons[0]!).toContain('ambiguous')
  })

  it('uses already resolved reuse clauses even when raw scripts contain only aliases', () => {
    const result = translate("custom(step: 3kg) reusing 'shared': if (completedReps >= reps) { weights += step }", {}, { rules: { progression_scripts: ['custom(step: 3kg) { ...shared }'] } })
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('Add 3 kg')
  })

  it('recovers missing aliases from matching resolved program summaries', () => {
    const result = translate("custom(step: 3kg) reusing 'shared': (script of template 'shared' not found)", {}, {
      rules: { progression: ["Invented Lift: custom(step: 8kg) reusing 'shared': if (completedReps >= reps) { weights += step }"] },
    })
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('Add 3 kg')
    expect(result.instructions).not.toContain('8 kg')
  })

  it('inherits labeled template defaults but lets callers override them', () => {
    const raw = { weeks: [{ days: [{ exercises: [{ label: 'shared', rules: [progress('custom(step: 8kg, triggerWeek: 4): if (week == triggerWeek) { weights += step }')] }] }] }] }
    const result = translate("custom(step: 3kg) reusing 'shared': (script of template 'shared' not found)", {}, raw)
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('week equals 4')
    expect(result.instructions).toContain('Add 3 kg')
  })

  it('reports missing alias parameters even when its body was translated', () => {
    const result = translate("custom() reusing 'shared': if (week == triggerWeek) { weights += increment }")
    expect(result.complete).toBe(false)
    expect(result.reasons).toContain('The progression week is missing from the imported rule.')
    expect(result.reasons).toContain('The load increase is missing from the imported rule.')
    expect(result.instructions).toContain('unspecified load increase')
    noCode(result.instructions)
  })

  it('does not borrow unspecified defaults from another alias caller', () => {
    const result = translate("custom() reusing 'shared': (script of template 'shared' not found)", {}, {
      rules: { progression: ["Invented Lift: custom(increment: 8kg) reusing 'shared': if (completedReps >= reps) { weights += increment }"] },
    })
    expect(result.complete).toBe(false)
    expect(result.reasons).toContain('The load increase is missing from the imported rule.')
    expect(result.instructions).not.toContain('8 kg')
  })

  it('recognizes explicitly named raw templates and preserves inherited defaults', () => {
    const result = translate('custom(step: 3kg) { ...shared }', {}, {
      rules: { progression_scripts: ['shared: custom(step: 8kg, triggerWeek: 4) {~ if (week == state.triggerWeek) { weights += state.step } ~}'] },
    })
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('week equals 4')
    expect(result.instructions).toContain('Add 3 kg')
  })

  it('does not lose grouping in subtraction or an AMRAP-based formula', () => {
    const result = translate('custom(): weights += completedReps[ns] - (reps[ns] - 2)')
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('minus (the rep target for the last set minus 2)')
  })

  it('does not use unrelated full script defaults with matching parameter names', () => {
    const result = translate("custom() reusing 'lost': (script of template 'lost' not found)", {}, { rules: { progression_scripts: ['custom(increment: 8kg) {~ if (week == 4) { weights += state.increment } ~}'] } })
    expect(result.complete).toBe(false)
    expect(result.instructions).toBe('')
  })

  it('shares explicit progression parameters with same-exercise updates', () => {
    const result = programmeRuleText({ rules: [progress('custom(speedDay: 2): if (completedReps >= reps) { weights += 3lb }'), update('custom(): if (setIndex == 0 && dayInWeek == speedDay) { weights *= 0.7 }')] })
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('day of the week equals 2')
    expect(result.instructions).toContain('Reduce the load for all sets by 30%')
  })

  it('preserves stage success, failure, saved load and test restart actions', () => {
    const exercise = {
      sets: [{ count: 3, reps: 4 }],
      rules: [
        { kind: 'set_variation', index: 2, sets: [{ count: 4, reps: 2, pct: 65 }] },
        { kind: 'set_variation', index: 3, sets: [{ count: 1, reps: 5, note: 'Five rep test' }] },
        progress('custom(increase: 4lb, stage1weight: 0lb, stage3increase: 9lb): if (descriptionIndex == 1) { descriptionIndex = 2 } if (completedReps >= reps) { weights = completedWeights[ns] + increase } else if (setVariationIndex == 1) { stage1weight = completedWeights[ns] setVariationIndex += 1 } else if (setVariationIndex == 2) { setVariationIndex += 1 } else { setVariationIndex = 1 weights = stage1weight + stage3increase }'),
      ],
    }
    const result = programmeRuleText(exercise)
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('Stage 2: 4 sets of 2 reps, 65%')
    expect(result.instructions).toContain('Stage 3: 1 set of 5 reps, Five rep test')
    expect(result.instructions).toContain('completed load for the last set plus 4 lb')
    expect(result.instructions).toContain('Set the saved stage 1 load to the completed load')
    expect(result.instructions).toContain('Move to the next stage')
    expect(result.instructions).toContain('Switch to stage 1')
    expect(result.instructions).toContain('saved stage 1 load plus 9 lb')
    expect(result.instructions).not.toContain('description')
    noCode(result.instructions)
  })

  it('renders test-based 1RM recalculation and percentage reset', () => {
    const result = translate('custom(): if (setVariationIndex == 4) { setVariationIndex = 1 weights = completedWeights[1] * 0.83 rm1 = completedWeights[1] / rpeMultiplier(5, 10) }')
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('stage equals 4')
    expect(result.instructions).toContain('83% of (the completed load for set 1)')
    expect(result.instructions).toContain('1RM fraction for 5 reps at RPE 10')
  })

  it('renders exercise variants and hold duration progression', () => {
    const result = programmeRuleText({ name: 'Supported Hold', rules: [
      { kind: 'exercise_variation', alternatives: ['Unsupported Hold', 'Long Hold'] },
      progress('custom(holdTarget: 25, topVar: 3): if (completedSetTime >= setTime && setTime >= holdTarget && exerciseVariationIndex < topVar) { exerciseVariationIndex += 1 } else { setTime[*:*:1:*] += 4 }'),
    ] })
    expect(result.complete).toBe(true)
    expect(result.instructions).toContain('Supported Hold → Unsupported Hold → Long Hold')
    expect(result.instructions).toContain('every hold meets its duration target')
    expect(result.instructions).toContain('hold duration in seconds is at least 25')
    expect(result.instructions).toContain('Move to the next exercise variation')
    expect(result.instructions).toContain('Add 4 to the hold duration in seconds for stage 1')
  })
})

describe('honest failures and script inertness', () => {
  it.each([
    'custom(): globalThis.__programmeRuleProbe = 99',
    'custom(): fetch("https://example.invalid")',
    'custom(): import("node:fs")',
    'custom(): Function("return 99")()',
    'custom(): weights = constructor',
    'custom(): weights = unknownValue',
    'custom(): while (true) { weights += 1lb }',
    'custom(): if (week == 2) { weights += 1lb',
    'custom(): if (week == 2) { weights += 1lb } alert(1)',
    'custom(increment: invalid): weights += increment',
  ])('rejects the whole unsupported script without executing it: %s', summary => {
    globalThis.__programmeRuleProbe = 0
    const result = translate(summary)
    expect(result.complete).toBe(false)
    expect(result.reasons.length).toBeGreaterThan(0)
    expect(result.instructions).toBe('')
    expect(globalThis.__programmeRuleProbe).toBe(0)
    delete globalThis.__programmeRuleProbe
  })

  it('does not expose hostile code-shaped notes or unknown types', () => {
    const result = programmeRuleText({ notes: 'globalThis.__programmeRuleProbe = 99', rules: [{ kind: 'other', summary: 'weights = 99lb' }] })
    expect(result.complete).toBe(false)
    expect(result.instructions).toBe('')
    expect(result.reasons).toHaveLength(2)
  })

  it.each(['console.log (99)', '() => 99', '<script>alert(99)</script>', 'let x = 99'])('does not accept raw code as athlete prose: %s', summary => {
    expect(translate(summary)).toEqual({ instructions: '', complete: false, reasons: ['An authored progression or update rule could not be translated.'] })
  })

  it('keeps independently valid prose while reporting an unreadable script', () => {
    const result = translate('custom(): unknownAction()', { notes: 'Keep your feet planted.' })
    expect(result.complete).toBe(false)
    expect(result.instructions).toBe('Keep your feet planted.')
  })

  it('bounds source size and depth to avoid runaway parsing', () => {
    expect(translate(`custom(): ${'weights += 1lb '.repeat(2000)}`).complete).toBe(false)
    expect(translate(`custom(): if (${'('.repeat(100)}week == 2${')'.repeat(100)}) { weights += 1lb }`).complete).toBe(false)
  })

  it('is deterministic and leaves all input data untouched', () => {
    const exercise = { notes: 'Use strict form.', rules: [progress('custom(step: 2kg): if (completedReps >= reps) { weights += step }')] }
    const raw = { unit: 'kg', weeks: [] }
    const before = JSON.stringify({ exercise, raw })
    const first = programmeRuleText(exercise, raw)
    expect(programmeRuleText(exercise, raw)).toEqual(first)
    expect(JSON.stringify({ exercise, raw })).toBe(before)
  })
})
