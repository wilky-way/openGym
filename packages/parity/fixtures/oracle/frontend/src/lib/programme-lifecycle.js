// Store-draft transitions: validate on an isolated copy, then commit once.
import { activate, resume } from './programme.js'
import { resolveOccurrences } from './programme-sync.js'
import { isProgrammeDate } from './programme-calendar.js'
import { todayISO } from './format.js'
import { validateProgrammeDefinition } from './programme-import.js'
import { allExercises } from './exercises.js'

export const runningProgramme = S => S.programmes?.cycles?.find(c => ['active', 'paused'].includes(c.status))

export function requireProgrammeIdle(S) {
  if (S.active) throw new Error('Finish the current workout before changing the program.')
}

const dateOf = opts => {
  const today = opts.today ?? todayISO()
  if (!isProgrammeDate(today)) throw new Error('A programme action needs a calendar date')
  return today
}
const liveCycle = (S, id) => {
  const c = S.programmes?.cycles?.find(c => c.id === id)
  if (!c || !['active', 'paused'].includes(c.status)) throw new Error('The program changed. Review your choice again.')
  return c
}
const validate = (S, definition) => validateProgrammeDefinition(definition, allExercises(S))
const commit = (S, change) => {
  requireProgrammeIdle(S)
  const draft = structuredClone(S)
  const result = change(draft)
  Object.assign(S, draft)
  return result
}
const archive = (S, id, today) => {
  const cycle = liveCycle(S, id)
  cycle.occurrences = resolveOccurrences(cycle, S.workouts)
  cycle.status = 'archived'
  cycle.archivedOn = today
  delete cycle.pausedOn
  if (S.queue?.programmeCycleId === id) S.queue = null
  const ids = new Set(cycle.occurrences.map(o => o.routineId))
  for (const [date, rid] of Object.entries(S.dayPlan || {})) {
    if (date >= today && ids.has(rid)) delete S.dayPlan[date]
  }
  // Retain ids, prescriptions, exercise slot ids and frozen logs. Ownership alone ends.
  for (const routine of S.routines || []) {
    if (routine.programme?.cycleId === id) {
      routine.programmeHistory = { cycleId: id, series: routine.programme.series }
      delete routine.programme
    }
  }
  return cycle
}

export function endProgramme(S, cycleId, opts = {}) {
  return commit(S, draft => archive(draft, cycleId, dateOf(opts)))
}

const activateStarted = (S, definition, opts, startsOn) => {
  const cycle = activate(S, definition, { ...opts, today: startsOn })
  if (opts.startsOn) { cycle.startsOn = startsOn; S.queue.startsOn = startsOn }
  // The calendar reads notBefore rather than startsOn; store both the selected date and bound.
  cycle.notBefore = startsOn
  cycle.shiftDoneIds = cycle.occurrences.filter(o => o.status === 'done').map(o => o.instanceId)
  return cycle
}

export function startProgramme(S, definition, opts = {}) {
  return commit(S, draft => {
    const today = dateOf(opts), startsOn = opts.startsOn ?? today
    if (!isProgrammeDate(startsOn)) throw new Error('A programme action needs a calendar date')
    validate(draft, definition)
    return activateStarted(draft, definition, opts, startsOn)
  })
}

export function switchProgramme(S, cycleId, definition, opts = {}) {
  return commit(S, draft => {
    const today = dateOf(opts)
    const startsOn = opts.startsOn ?? today
    if (!isProgrammeDate(startsOn)) throw new Error('A programme action needs a calendar date')
    // The confirmation names a specific current cycle; never archive a replacement run.
    validate(draft, definition)
    archive(draft, cycleId, today)
    return activateStarted(draft, definition, { ...opts, startsOn }, startsOn)
  })
}

export function resumeProgramme(S, cycleId, opts = {}) {
  return commit(S, draft => {
    const c = liveCycle(draft, cycleId)
    if (c.status !== 'paused' || draft.programmes.cycles.some(x => x.id !== cycleId && ['active', 'paused'].includes(x.status))) {
      throw new Error('The program changed. Review your choice again.')
    }
    return resume(draft, cycleId, { ...opts, today: dateOf(opts) })
  })
}
