import type { Cycle, Occurrence, Log, SchedulingState } from './programme-sync'
import type { Queue } from '../../contract/domain/state-doc'
// Pure projection shared by the frontend and server reminders.
import { resolveOccurrences, programmesOf } from './programme-sync'

const list = <T,>(v: T[] | null | undefined): T[] => Array.isArray(v) ? v : []
export const isProgrammeDate = (iso: unknown): iso is string => {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(iso + 'T12:00:00')
  return Number.isFinite(d.getTime()) && dayOf(d) === iso
}
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** Noon + setDate walks calendar days in this runtime's zone, including 23/25-hour days. */
export function addProgrammeDays(iso: unknown, days: number) {
  if (!isProgrammeDate(iso)) return null
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return dayOf(d)
}

export const occurrenceWeekId = (o: Occurrence) => o.weekId || String(o.weekIndex)
export const occurrenceOrder = (o: Occurrence) => Number(o.orderIndex ?? o.weekIndex) || 0
export function orderedOccurrences(cycle: Cycle | null | undefined, queue: Partial<Queue> | null | undefined) {
  const ids = list(queue?.ids)
  const rank = (o: Occurrence) => { const i = ids.indexOf(o.routineId); return i < 0 ? ids.length + (Number(o.ordinal) || 0) : i }
  return list(cycle?.occurrences).slice().sort((a, b) => occurrenceOrder(a) - occurrenceOrder(b) ||
    (occurrenceWeekId(a) === occurrenceWeekId(b) ? rank(a) - rank(b) : 0) || (Number(a.ordinal) || 0) - (Number(b.ordinal) || 0))
}

/** DESIGN §3.1. `queue` is optional; pass S.queue to reflect its current-week reorder. */
export function projectCycle(cycle: Cycle | null | undefined, workouts: Log[] = [], today: string, queue: Partial<Queue> | null = null) {
  if (!isProgrammeDate(today)) throw new Error('Projection needs a calendar date')
  const actual = resolveOccurrences(cycle || {} as Cycle, workouts)
  const ordered = orderedOccurrences({ ...cycle, occurrences: actual } as Cycle, queue)
  const doneDates = [...ordered.filter(o => o.status === 'done').map(o => o.date), ...list(workouts).map(w => w?.d)].filter(d => isProgrammeDate(d) && d <= today)
  const lastDoneDate = doneDates.sort().at(-1) || null
  const anchor = [today, lastDoneDate && addProgrammeDays(lastDoneDate, 1), cycle?.notBefore].filter(isProgrammeDate).sort().at(-1)!
  const supplied = Number(cycle?.cadence?.perWeek)
  const perWeek = Number.isFinite(supplied) ? Math.max(1, Math.min(7, Math.round(supplied))) : 4
  const projecting = cycle?.status !== 'paused' && cycle?.status !== 'finished' && cycle?.status !== 'archived'
  let base = anchor, k = 0, previous: string | null = null
  const occurrences = ordered.map(o => {
    const week = list(cycle?.snapshot?.weeks).find(w => (w.weekId || String(w.index)) === occurrenceWeekId(o))
    const out: Occurrence & { mode: string; projected?: boolean; pinConflict?: boolean } = { ...o, mode: week?.mode || (o.inserted ? 'deload' : 'train') }
    delete out.projected
    delete out.pinConflict
    // Ignore accidental stored pending dates: only a derived projection may date them.
    if (o.status !== 'done' && o.status !== 'skipped') {
      out.status = 'pending'
      delete out.date
      if (projecting) {
        const natural = addProgrammeDays(base, Math.floor(k * 7 / perWeek))
        const lower = previous ? addProgrammeDays(previous, 1) : anchor
        const pinned = isProgrammeDate(o.pinnedOn) && o.pinnedOn >= today
        out.date = [pinned ? o.pinnedOn : natural, lower, anchor].sort().at(-1)!
        out.projected = true
        if (pinned) {
          if (out.date !== o.pinnedOn) out.pinConflict = true
          base = addProgrammeDays(out.date, 1)!
          k = 0
        } else k++
        previous = out.date!
      }
    }
    return out
  })
  const pending = occurrences.filter(o => o.status === 'pending' && o.projected)
  const dates = occurrences.map(o => o.date).filter(isProgrammeDate).sort()
  const endDate = projecting || !ordered.some(o => o.status !== 'done' && o.status !== 'skipped') ? dates.at(-1) || null : null
  const groups = new Map<string, { weekId: string; weekIndex?: number; inserted: boolean; mode: string; occurrences: typeof occurrences }>()
  for (const o of occurrences) {
    const id = occurrenceWeekId(o)
    if (!groups.has(id)) groups.set(id, { weekId: id, weekIndex: o.weekIndex, inserted: !!o.inserted, mode: o.mode, occurrences: [] })
    groups.get(id)!.occurrences.push(o)
  }
  const weeks = [...groups.values()].map(w => {
    const ds = w.occurrences.map(o => o.date).filter(isProgrammeDate).sort()
    const done = w.occurrences.filter(o => o.status === 'done').length
    const skipped = w.occurrences.filter(o => o.status === 'skipped').length
    return { ...w, startDate: ds[0] || null, endDate: ds.at(-1) || null,
      done, skipped, planned: w.occurrences.length, closed: done + skipped === w.occurrences.length }
  })
  return { occurrences, pending, next: pending[0] || null, weeks, anchor, lastDoneDate, endDate,
    nextBlockStart: endDate ? addProgrammeDays(endDate, 1) : null }
}

/** General calendar cells combine historical lifts and projected/resolved program sessions. */
export function monthCells(projection: { occurrences?: Occurrence[]; endDate?: string | null } | null, month: string, { workouts = [], weekStartsOn = 0, today = null }: { workouts?: Log[]; weekStartsOn?: number; today?: string | null } = {}) {
  const first = month + '-01'
  if (!isProgrammeDate(first)) return []
  const d = new Date(first + 'T12:00:00')
  const offset = (d.getDay() - weekStartsOn + 7) % 7
  const count = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate()
  return [...Array<null>(offset).fill(null), ...Array.from({ length: count }, (_, i) => {
    const date = addProgrammeDays(first, i)!
    return { date, day: i + 1, today: date === today,
      occurrences: list(projection?.occurrences).filter(o => o.date === date),
      workouts: list(workouts).filter(w => w?.d === date), end: date === projection?.endDate }
  })]
}

/** Optional current queue projection; no programme metadata means the stock queue rules. */
export function projectionForQueue(S: SchedulingState, today: string) {
  const id = S?.queue?.programmeCycleId
  const cycle = id && programmesOf(S).cycles.find(c => c.id === id)
  if (!cycle) return null
  const skipped = list(S.queue!.skipped)
  const effective = { ...cycle, occurrences: list(cycle.occurrences).map(o => skipped.includes(o.routineId) && o.status !== 'done' ? { ...o, status: 'skipped' } : o) }
  return projectCycle(effective, S.workouts, today, S.queue!)
}
