import type { ExportWorkout, ExportEntry, WorkoutExportOptions } from './export-types'
import type { ExerciseIndex } from './exercises'
// A finished workout as plain text, for "Copy as text" in its detail sheet (Discord 'Improvement
// ideas'): something to paste into a chat, a coach's spreadsheet or a notes app. The sets are the
// same labels the history shows, so a drop-set or a rest-pause set reads the same in both.
// i18n-core rather than i18n, like history.js: nothing here needs the React half.
import { setLabel, sessionSections, workoutVolume } from '@opengym/core/history'
import { EXIDX } from '@opengym/core/exercises'
import { hasCompletedWork, isWarmupRow } from '@opengym/core/workout-model'
import { fmtDate, fmtNum, fmtVol, durPart, capWords } from '@opengym/core/format'
import { t, exerciseNameClass } from '@opengym/core/i18n-core'

/**
 * `unit` is the profile's, `nameOf(entry)` the exercise's display name, `speedUnit` the one cardio
 * is shown in (lib/speed.js; km/h when absent). Blocks are separated by a blank line: the heading,
 * then each exercise (a superset's under one "Superset" line, its members together), then the
 * session note.
 */
export function workoutText(w: ExportWorkout, { unit, nameOf, speedUnit }: WorkoutExportOptions, index: ExerciseIndex = EXIDX) {
  // Keep legacy subtraction/coercion for foreign string clocks; do not normalize the doc.
  const facts = [
    ...durPart(((w.end || 0) as number) - ((w.start || 0) as number)),
    fmtVol(w.vol ?? workoutVolume(w, index), unit),
    ...(w.bw ? [t('Body weight') + ' ' + fmtNum(w.bw) + ' ' + unit] : []),
  ]
  const blocks = [[[w.name, fmtDate(w.d, true, true)].filter(Boolean).join(' · '), facts.join(' · ')].join('\n')]
  // Work sets only: the text is what you trained, the work the volume above counts. Warm-ups are
  // left out of volume, records and progression everywhere else, and listed here with nothing to
  // tell them apart they would read as sets of their own.
  const lines = (entry: ExportEntry) => {
    const sets = (entry.sets || []).filter(s => hasCompletedWork(s) && !isWarmupRow(s))
    if (!sets.length) return null
    // Title case the way the screen shows it (exerciseNameClass): an English name gets it, a
    // translated one keeps its own casing, which German's capitalised nouns depend on.
    const name = nameOf(entry)
    return [exerciseNameClass(index[entry.id]) ? capWords(name) : name, sets.map(s => setLabel(entry.id, s, entry.target, speedUnit, index)).join(', '), ...(entry.note ? [entry.note] : [])]
  }
  // Grouped the way the detail sheet groups it (sessionSections): per routine first, so a
  // superset is only ever paired inside one routine's section, in the order the sheet lists them.
  const entries = w.entries || []
  for (const group of sessionSections(entries).flatMap(section => section.units)) {
    const members = group.map((i: number) => lines(entries[i]!)).filter(Boolean)
    if (!members.length) continue
    blocks.push([...(members.length > 1 ? [t('Superset')] : []), ...members.flat()].join('\n'))
  }
  if (w.note) blocks.push(w.note)
  return blocks.join('\n\n')
}
