// Programs live inside the existing persisted state blob; ordinary routines remain runnable.
import { programmesOf, resolveOccurrences } from './programme-sync.js'
import { projectCycle, orderedOccurrences, occurrenceWeekId, occurrenceOrder, addProgrammeDays, isProgrammeDate } from './programme-calendar.js'
import { programmeSlotIds } from './programme-edit.js'
import { todayISO, uid } from './format.js'
import { convertStateUnit } from './units.js'
export { normaliseProgrammes, programmesOf } from './programme-sync.js'

const clone = v => JSON.parse(JSON.stringify(v))
const list = v => Array.isArray(v) ? v : []

/** One explicit week becomes ordinary routines. Exported for inserted weeks and future laps. */
export function materializeWeek(definition, week, cycle, { unit = definition.unit || 'kg' } = {}) {
  const routines = [], occurrences = []
  for (const [di, day] of list(week.days).entries()) {
    if (!day?.key) throw new Error('A programme day needs a key')
    const sessions = list(day.sessions)
    for (const [si, session] of sessions.entries()) {
      const snapshot = session?.routineSnapshot
      if (!snapshot || !Array.isArray(snapshot.ex)) throw new Error('A programme session needs a routine snapshot')
      const dayNumber = day.ordinal || di + 1
      const suffix = sessions.length > 1 ? `s${si + 1}` : ''
      const slot = week.weekId ? `${week.weekId}:${day.key}${suffix}` : `w${week.index}${day.key}${suffix}`
      const instanceId = `${cycle.id}:${slot}`
      const routineId = `${cycle.id}-${slot.replaceAll(':', '-')}`
      const series = `${cycle.seriesId || cycle.id}:${day.key}${sessions.length > 1 ? ':' + (session.sessionTemplateId || si + 1) : ''}`
      const ordinal = occurrences.length + 1
      const converted = convertStateUnit({ unit: week.unit || definition.unit || unit, routines: [clone(snapshot)] }, unit).routines[0]
      const routine = {
        ...converted, id: routineId,
        name: `${definition.short || definition.name || 'Program'} D${dayNumber} · ${definition.days?.find(d => d.key === day.key)?.name || snapshot.name || day.key} · ${week.label || 'W' + week.index}`,
        programme: { cycleId: cycle.id, instanceId, weekIndex: week.index, ordinal, series, ...(week.weekId ? { weekId: week.weekId, orderIndex: week.orderIndex, fromWeekIndex: week.fromWeekIndex, inserted: true } : {}) },
      }
      programmeSlotIds(routine.ex, instanceId)
      if (week.rir != null) routine.ex = routine.ex.map(e => ({ ...e, target: { ...e.target, rir: week.rir } }))
      if (week.mode === 'deload') {
        routine.prog = 'off'
        routine.excludeFromProgression = true
        routine.deload = { setsFactor: .5, loadFactor: .7, from: 'series-last', ...week.deload }
        routine.ex = routine.ex.map(e => ({ ...e, prog: 'off' }))
        if (week.weekId && week.rir != null) routine.ex = routine.ex.map(e => {
          const { rpe, rir, ...target } = e.target || {}
          return { ...e, target: { ...target, rir: week.rir },
            ...(e.setTargets ? { setTargets: e.setTargets.map(value => {
              const { rpe, rir, ...target } = value || {}
              return { ...target, rir: week.rir }
            }) } : {}),
          }
        })
      }
      routines.push(routine)
      occurrences.push({ instanceId, weekIndex: week.index, dayKey: day.key, ordinal, routineId, status: 'pending', ...(session.sessionTemplateId ? { sessionTemplateId: session.sessionTemplateId } : {}), routineName: routine.name, ...(week.weekId ? { weekId: week.weekId, orderIndex: week.orderIndex, inserted: true } : {}) })
    }
  }
  if (!occurrences.length) throw new Error('A programme week needs sessions')
  return { routines, occurrences }
}

/** Earlier numbered weeks are history metadata, independent of authored repeat prescriptions. */
export function programmePreAppWeeks(definition, weekIndex) {
  const start = weekIndex ?? Math.min(...definition.weeks.map(w=>w.index))
  if (!Number.isInteger(start) || start < 1 || start > 64) throw new Error('Programme week indexes must be unique positive integers')
  return Array.from({length:start-1},(_,i)=>i+1)
}

/** Activate a frozen definition in a draft state, as store.update's other helpers do. */
export function activate(S, definition, opts = {}) {
  if (S.active) throw new Error('Finish the current workout before changing the program.')
  if (!definition?.id || !list(definition.weeks).length) throw new Error('A programme needs explicit weeks')
  const programmes = programmesOf(S)
  if (programmes.cycles.some(c => c.status === 'active' || c.status === 'paused')) throw new Error('A programme is already running')
  const weeks = clone(definition.weeks).sort((a, b) => a.index - b.index)
  if (weeks.some(w => !Number.isInteger(w.index) || w.index < 1) || new Set(weeks.map(w => w.index)).size !== weeks.length) throw new Error('Programme week indexes must be unique positive integers')
  const weekIndex = opts.weekIndex ?? weeks[0].index
  if (!weeks.some(w => w.index === weekIndex)) throw new Error('The starting week is missing')
  const today = opts.today || todayISO()
  const adoption = opts.existingRoutineIds
  const adopting = adoption && Object.keys(adoption).length > 0
  const cycle = {
    id: opts.cycleId || uid(), programmeId: definition.id, status: 'active',
    week1StartDate: opts.week1StartDate || today, lengthWeeks: opts.lengthWeeks || Math.max(...weeks.map(w => w.index)),
    lap: opts.lap || 1, end: opts.end || definition.end || 'next',
    cadence: { perWeek: opts.perWeek || Math.min(7, list(weeks.find(w => w.index === weekIndex).days).length) },
    since: adopting && S.queue ? S.queue.since : opts.now ?? Date.now(),
    startsOn: adopting && S.queue ? S.queue.startsOn : today,
    ...(adopting && S.queue?.strict === true ? { strict: true } : {}),
    notBefore: null, snapshot: clone({ ...definition, weeks }), weekIndex,
    occurrences: [], inserted: [], ...(opts.preApp ? { preApp: clone(opts.preApp) } : {}),
    ...(opts.seriesId ? { seriesId: opts.seriesId } : {}), ...(opts.tm ? { tm: clone(opts.tm) } : {}),
  }
  if (!Number.isInteger(cycle.cadence.perWeek) || cycle.cadence.perWeek < 1 || cycle.cadence.perWeek > 7) throw new Error('Cadence must be between one and seven sessions a week')
  if (programmes.cycles.some(c => c.id === cycle.id)) throw new Error('The cycle id already exists')
  const built = weeks.filter(w => w.index >= weekIndex).map(w => materializeWeek(definition, w, cycle, { unit: S.unit }))
  const routines = built.flatMap(w => w.routines)
  cycle.occurrences = built.flatMap(w => w.occurrences)
  const current = cycle.occurrences.filter(o => o.weekIndex === weekIndex)
  const mapped = adopting && !Array.isArray(adoption)
  if (mapped && (typeof adoption !== 'object' || new Set(current.map(o => o.dayKey)).size !== current.length ||
    Object.keys(adoption).length !== current.length || current.some(o => typeof adoption[o.dayKey] !== 'string'))) throw new Error('Adopt mapping needs one routine id per distinct current-week dayKey')
  const adopted = mapped ? current.map(o => adoption[o.dayKey]) : list(adoption)
  if (adopted.length) {
    if (adopted.length !== current.length || new Set(adopted).size !== adopted.length) throw new Error('Adopt needs one distinct routine for each current-week session')
    for (const [i, id] of adopted.entries()) {
      const existing = list(S.routines).find(r => r.id === id)
      if (!existing || existing.programme) throw new Error('An adopted routine must exist and be unassigned')
      const at = routines.findIndex(r => r.id === current[i].routineId)
      routines[at] = { ...clone(existing), ex:programmeSlotIds(clone(existing.ex), current[i].instanceId), programme: routines[at].programme }
      current[i].routineId = id
      current[i].routineName = existing.name
    }
    if (S.queue && (!Array.isArray(S.queue.ids) || S.queue.ids.some(id => !adopted.includes(id)))) throw new Error('The existing queue does not belong to the adopted week')
  }
  const existingIds = new Set(list(S.routines).map(r => r.id))
  if (routines.some(r => existingIds.has(r.id) && !adopted.includes(r.id)) || new Set(routines.map(r => r.id)).size !== routines.length) throw new Error('A materialized routine id already exists')
  if (adopted.length) for (const o of current) if (S.queue?.skipped?.includes(o.routineId)) {
    o.status = 'skipped'; o.reason = 'adopted-queue' // Legacy queue skips have no known calendar date.
  }
  cycle.occurrences = resolveOccurrences(cycle, S.workouts)
  // Commit the activation only after every snapshot, adoption and id has been validated.
  S.routines = list(S.routines).map(r => routines.find(n => n.id === r.id) || r).concat(routines.filter(r => !existingIds.has(r.id)))
  programmes.definitions = programmes.definitions.filter(d => d.id !== definition.id).concat(clone(definition))
  programmes.cycles.push(cycle)
  S.programmes = programmes
  S.queue = adopted.length && S.queue ? { ...S.queue, programmeCycleId: cycle.id } : {
    ids: current.map(o => o.routineId), since: opts.now ?? Date.now(), startsOn: today,
    label: `${definition.short || definition.name} · W${weekIndex}/${cycle.lengthWeeks}`, programmeCycleId: cycle.id, skipped: [],
  }
  delete S.queue.rotationId
  return cycle
}

/** Adopt current routines without changing their ids, prescriptions, or queue progress. */
export const adopt = (S, definition, existingRoutineIds, opts = {}) => activate(S, definition, { ...opts, existingRoutineIds })

const requireDate = today => { if (!isProgrammeDate(today)) throw new Error('A programme action needs a calendar date') }
const cycleIn = (S, id) => {
  const cycle = list(S.programmes?.cycles).find(c => c?.id === id)
  if (!cycle) throw new Error('The programme cycle does not exist')
  return cycle
}
const pendingIn = (S, id, instanceId) => {
  const cycle = cycleIn(S, id)
  const o = resolveOccurrences(cycle, S.workouts).find(o => o.instanceId === instanceId)
  if (!o || o.status === 'done' || o.status === 'skipped') throw new Error('Only a pending programme session can be changed')
  return { cycle, occurrence: cycle.occurrences.find(x => x.instanceId === instanceId) }
}

// Remove mirrors written by older clients; pinnedOn alone constrains programme dates.
const clearProgrammeDayPlan = (S, cycle) => {
  const ids = new Set(cycle.occurrences.map(o => o.routineId))
  for (const [date, id] of Object.entries(S.dayPlan || {})) if (ids.has(id)) delete S.dayPlan[date]
}

/** Set an explicit lower bound; projected dates themselves never enter the stored cycle. */
export function shiftNotToday(S, cycleId, today = todayISO()) {
  const cycle = cycleIn(S, cycleId)
  if (cycle.status !== 'active') return false
  const projection = projectCycle(cycle, S.workouts, today, S.queue)
  if (!projection.next) return false
  cycle.notBefore = [cycle.notBefore, addProgrammeDays(today, 1)].filter(isProgrammeDate).sort().at(-1)
  clearProgrammeDayPlan(S, cycle)
  cycle.shiftDoneIds = resolveOccurrences(cycle, S.workouts).filter(o => o.status === 'done').map(o => o.instanceId)
  return true
}

export function skip(S, cycleId, instanceId, { today = todayISO(), now = Date.now(), reason = '' } = {}) {
  requireDate(today)
  const { occurrence } = pendingIn(S, cycleId, instanceId)
  occurrence.status = 'skipped'
  occurrence.date = today
  occurrence.skippedAt = now
  if (reason) occurrence.reason = reason
  delete occurrence.pinnedOn
  for (const [date, id] of Object.entries(S.dayPlan || {})) if (id === occurrence.routineId && date >= today) delete S.dayPlan[date]
  advanceProgramme(S, today, now)
  return occurrence
}

export function pin(S, cycleId, instanceId, date, today = todayISO()) {
  requireDate(today)
  const { cycle, occurrence } = pendingIn(S, cycleId, instanceId)
  if (date != null) {
    if (!isProgrammeDate(date) || date < today) throw new Error('A programme pin needs a current or future date')
    const trial = { ...cycle, occurrences: cycle.occurrences.map(o => o.instanceId === instanceId ? { ...o, pinnedOn: date } : o) }
    if (projectCycle(trial, S.workouts, today, S.queue).occurrences.find(o => o.instanceId === instanceId)?.pinConflict) throw new Error('The pin would precede an earlier session or collide with it')
  }
  for (const [day, id] of Object.entries(S.dayPlan || {})) if (id === occurrence.routineId && day >= today) delete S.dayPlan[day]
  if (date == null) delete occurrence.pinnedOn
  else occurrence.pinnedOn = date
  return occurrence
}

export function pause(S, cycleId, today = todayISO()) {
  requireDate(today)
  const cycle = cycleIn(S, cycleId)
  if (cycle.status !== 'active') return false
  cycle.status = 'paused'
  cycle.pausedOn = today
  const ids = new Set(cycle.occurrences.map(o => o.routineId))
  for (const [date, id] of Object.entries(S.dayPlan || {})) if (date >= today && ids.has(id)) delete S.dayPlan[date]
  // Keep the queue's identity/order for Resume; readers suppress its projection and reminders.
  return true
}

export function resume(S, cycleId, { today = todayISO(), now = Date.now() } = {}) {
  requireDate(today)
  const cycle = cycleIn(S, cycleId)
  if (cycle.status !== 'paused') return false
  cycle.status = 'active'
  delete cycle.pausedOn
  if (!isProgrammeDate(cycle.notBefore) || cycle.notBefore < today) { cycle.notBefore = null; delete cycle.shiftDoneIds }
  advanceProgramme(S, today, now)
  return true
}

/** Resolve finished logs and move to the first week still pending; a calendar boundary does nothing. */
export function advanceProgramme(S, today = todayISO(), now = Date.now()) {
  requireDate(today)
  const cycle = list(S.programmes?.cycles).find(c => c?.status === 'active' || c?.status === 'paused')
  if (!cycle) return false
  const before = JSON.stringify({ cycle, queue: S.queue, dayPlan: S.dayPlan })
  clearProgrammeDayPlan(S, cycle)
  cycle.occurrences = resolveOccurrences(cycle, S.workouts)
  if (cycle.notBefore && (today > cycle.notBefore || cycle.occurrences.some(o => o.status === 'done' && Array.isArray(cycle.shiftDoneIds) && !cycle.shiftDoneIds.includes(o.instanceId)))) { cycle.notBefore = null; delete cycle.shiftDoneIds }
  if (cycle.status === 'paused') return before !== JSON.stringify({ cycle, queue: S.queue, dayPlan: S.dayPlan })
  const ordered = orderedOccurrences(cycle, S.queue)
  const pending = ordered.find(o => o.status !== 'done' && o.status !== 'skipped')
  const previousWeek = cycle.weekId || String(cycle.weekIndex)
  if (!pending) {
    cycle.status = 'finished'
    cycle.completedOn = today
    if (S.queue?.programmeCycleId === cycle.id) S.queue = null
    return true
  }
  const weekId = occurrenceWeekId(pending)
  const rolled = weekId !== previousWeek
  if (rolled) cycle.rollover = { fromWeekId: previousWeek, fromWeekIndex: cycle.weekIndex, toWeekId: weekId, toWeekIndex: pending.weekIndex, closedOn: today }
  cycle.weekIndex = pending.weekIndex
  if (pending.weekId) cycle.weekId = pending.weekId
  else delete cycle.weekId
  const current = ordered.filter(o => occurrenceWeekId(o) === weekId)
  const oldQueue = S.queue?.programmeCycleId === cycle.id && !rolled ? S.queue : null
  const naturalIds = current.map(o => o.routineId)
  const retained = list(oldQueue?.ids).filter(id => naturalIds.includes(id))
  const ids = retained.concat(naturalIds.filter(id => !retained.includes(id)))
  const skipped = current.filter(o => o.status === 'skipped').map(o => o.routineId)
  const week = list(cycle.snapshot?.weeks).find(w => (w.weekId || String(w.index)) === weekId)
  S.queue = { ...(oldQueue || {}), ids, since: oldQueue?.since ?? cycle.since ?? now,
    startsOn: oldQueue?.startsOn ?? today, programmeCycleId: cycle.id, skipped,
    label: oldQueue?.label ?? `${cycle.snapshot?.short || cycle.snapshot?.name || 'Program'} · W${pending.weekIndex}/${cycle.lengthWeeks}${pending.inserted ? ' (inserted deload)' : ''}${week?.rir != null ? ` · ${week.rir} RIR` : ''}` }
  delete S.queue.rotationId
  return before !== JSON.stringify({ cycle, queue: S.queue, dayPlan: S.dayPlan })
}

/** Insert a separate stage without renumbering authored weeks or retargeting logged routines. */
export function insertDeload(S, cycleId, { key = uid(), setsFactor = .5, loadFactor = .7 } = {}) {
  const cycle = cycleIn(S, cycleId)
  if (![setsFactor, loadFactor].every(f => Number.isFinite(f) && f > 0 && f <= 1)) throw new Error('Deload factors must be greater than zero and at most one')
  if (cycle.status === 'finished') throw new Error('A finished cycle cannot insert a deload')
  const currentId = cycle.weekId || String(cycle.weekIndex)
  const ordered = orderedOccurrences(cycle, S.queue)
  const current = ordered.filter(o => occurrenceWeekId(o) === currentId)
  if (!current.length || current.some(o => o.inserted)) throw new Error('Insert after an authored programme week')
  if (!Array.isArray(cycle.snapshot?.weeks)) throw new Error('The cycle needs explicit snapshot weeks')
  const weekId = `deload-${key}`
  if (list(cycle.inserted).some(w => w.weekId === weekId)) throw new Error('This inserted week already exists')
  const currentOrder = occurrenceOrder(current[0])
  const nextOrder = ordered.find(o => occurrenceOrder(o) > currentOrder)?.orderIndex ?? ordered.find(o => occurrenceOrder(o) > currentOrder)?.weekIndex ?? currentOrder + 1
  const days = new Map()
  for (const o of current) {
    const routine = list(S.routines).find(r => r.id === o.routineId)
    if (!routine) throw new Error('The source routine is missing')
    if (!days.has(o.dayKey)) days.set(o.dayKey, { key: o.dayKey, ordinal: days.size + 1, sessions: [] })
    days.get(o.dayKey).sessions.push({ sessionTemplateId: o.sessionTemplateId || o.dayKey, routineSnapshot: { name: cycle.snapshot?.weeks.find(w => w.index === cycle.weekIndex && !w.weekId)?.days.find(d => d.key === o.dayKey)?.sessions.find(s => s.sessionTemplateId === o.sessionTemplateId)?.routineSnapshot?.name || o.dayKey, ex: clone(routine.ex), prog: routine.prog } })
  }
  const week = { index: cycle.weekIndex + 1, weekId, orderIndex: (currentOrder + nextOrder) / 2,
    fromWeekIndex: cycle.weekIndex, unit: S.unit, mode: 'deload', rir: 8,
    label: `W${cycle.weekIndex + 1} (inserted deload)`, deload: { setsFactor, loadFactor, from: 'series-last' },
    days: [...days.values()] }
  const built = materializeWeek(cycle.snapshot, week, cycle, { unit: S.unit })
  if (new Set(built.routines.map(r => r.id)).size !== built.routines.length || built.routines.some(r => S.routines.some(old => old.id === r.id))) throw new Error('An inserted routine id already exists')
  S.routines.push(...built.routines)
  cycle.occurrences.push(...built.occurrences)
  cycle.snapshot.weeks.push(clone(week))
  cycle.inserted = [...list(cycle.inserted), { weekId, afterWeekIndex: cycle.weekIndex, orderIndex: week.orderIndex }]
  return week
}
