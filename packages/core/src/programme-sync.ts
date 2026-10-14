import { offloadInputs, resetOffload, offloadStamp } from './programme-offload'
import type { EntryClocks, ProgrammeDefinition, ProgrammeSession, RoutineExercise, RoutineProgrammeLink, Queue, Rotation } from '../../contract/domain/state-doc'

// Tolerant legacy readers accept partial records; unknown fields pass through unchanged.
export interface Occurrence extends EntryClocks {
  instanceId: string; status?: string; routineId: string; weekIndex: number; dayKey: string; ordinal?: number;
  routineName?: string; date?: string; pinnedOn?: string; skippedAt?: number; reason?: string;
  weekId?: string; orderIndex?: number; inserted?: boolean; sessionTemplateId?: string; [k: string]: unknown
}
export interface Snapshot { weeks?: { index: number; weekId?: string; mode?: string; days?: { key: string; sessions: Partial<ProgrammeSession>[] }[]; [k: string]: unknown }[]; short?: string; name?: string; [k: string]: unknown }
export interface Cycle extends EntryClocks {
  id: string; programmeId?: string; status?: string; snapshot?: Snapshot; occurrences?: Occurrence[];
  cadence?: { perWeek: number }; notBefore?: string | null; since?: number; startsOn?: string; week1StartDate?: string;
  weekIndex?: number; weekId?: string; lengthWeeks?: number; seriesId?: string; strict?: boolean; activationConflict?: string; [k: string]: unknown
}
export type Definition = Partial<ProgrammeDefinition> & { id: string }
export interface ProgrammeData extends EntryClocks { version?: number; fork?: string; definitions?: Definition[]; cycles?: Cycle[]; offloaded?: Record<string, { versionId: string; at: number }>; installed?: Record<string, { versionId: string; at: number }>; [k: string]: unknown }
export interface NormalProgrammes extends ProgrammeData { definitions: Definition[]; cycles: (Cycle & { occurrences: Occurrence[] })[] }
export interface Log { id?: string; d?: string; start?: number; name?: string; routineIds?: string[]; routineId?: string | null; programmeInstance?: { cycleId?: string; instanceId?: string }; entries?: { occurrenceId?: string; [k: string]: unknown }[]; [k: string]: unknown }
export interface SchedulingRoutine extends EntryClocks { id: string; name?: string; ex?: RoutineExercise[]; programme?: Partial<RoutineProgrammeLink>; programmeHistory?: { cycleId: string; series: string }; [k: string]: unknown }
export interface SchedulingState {
  routines: SchedulingRoutine[]; workouts: Log[]; queue?: Partial<Queue> | null; rotation?: Rotation | null;
  programmes?: ProgrammeData; dayPlan?: Record<string, string | string[] | null>; week?: Record<string, string | string[] | null>;
  scheduleMode?: string | null; active?: { start: number; backfill?: unknown; routineIds?: string[]; routineId?: string | null; [k: string]: unknown } | null;
  edited?: Record<string, number>; [k: string]: unknown
}
type Row = Record<string, unknown>
export type MergeEntry = (a: Row, b: Row) => Row
export type StampEntry = (a: Row, b: Row, now: number) => void

// Pure client sync helpers; server stamping keeps its separately documented legacy drifts.
const map = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)
const list = <T,>(v: T[] | unknown): T[] => Array.isArray(v) ? v : []
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const records = <T extends Row>(v: unknown, key = 'id'): T[] => {
  const seen = new Set()
  return list<Row>(v).filter(x => map(x) && typeof x[key] === 'string' && x[key] && !seen.has(x[key]) && seen.add(x[key])) as T[]
}

/** Tolerant read, never a migration: unknown fields and future versions survive. */
export function normaliseProgrammes(raw: unknown): NormalProgrammes {
  const p = map(raw) ? raw : {}
  return {
    version: 1, fork: 'opengym/1', ...p,
    definitions: records<Definition>(p.definitions),
    cycles: records<Cycle>(p.cycles).map(c => ({ ...c, occurrences: records<Occurrence>(c.occurrences, 'instanceId') })),
  }
}

export const programmesOf = (S: { programmes?: unknown } | null | undefined) => normaliseProgrammes(S?.programmes)

/** A reset names the records it cleared; future records with other ids remain valid. */
export function programmesSinceReset(raw: unknown, at: number, ids: unknown) {
  const out = normaliseProgrammes(raw)
  if (!(Number(at) > 0)) return out
  for (const [field, key] of [['definitions', 'programmeDefinitions'], ['cycles', 'programmeCycles']] as const) {
    const gone = new Set(list<unknown>(map(ids) ? ids[key] : undefined).map(String))
    const keep = (x: EntryClocks & { id: string }) => (Number(x._ts) || 0) > at || map(ids) && !gone.has(String(x.id))
    if (field === 'definitions') out.definitions = out.definitions.filter(keep)
    else out.cycles = out.cycles.filter(keep)
  }
  return resetOffload(out, at)
}

const without = <T extends Row>(x: T, key: string): T => { const out = { ...x }; delete out[key]; return out }
const pairs = <T extends Row>(a: unknown, b: unknown, key: string, merge: (a: T, b: T) => Row): T[] => {
  const old = new Map(records<T>(b, key).map(x => [x[key], x]))
  const out = records<T>(a, key).map(x => old.has(x[key]) ? merge(x, old.get(x[key])!) as T : clone(x))
  const ids = new Set(out.map(x => x[key]))
  return out.concat(records<T>(b, key).filter(x => !ids.has(x[key])).map(clone))
}

/** Finished logs are authoritative even when a stale skip has a later edit stamp. */
export function resolveOccurrences(cycle: Cycle, workouts: Log[] = []): Occurrence[] {
  return records<Occurrence>(cycle.occurrences, 'instanceId').map(o => {
    const w = list<Log>(workouts).filter(w => {
      const ids = list<NonNullable<Log["entries"]>[number]>(w?.entries).map(e => e?.occurrenceId).filter(Boolean)
      // Modern combined logs count only the occurrences whose entries survived finish.
      if (ids.length) return ids.includes(o.instanceId)
      return w?.programmeInstance?.cycleId === cycle.id && w.programmeInstance.instanceId === o.instanceId || legacyCounts(cycle, o, w)
    }).sort((a, b) => String(b.d).localeCompare(String(a.d)))[0]
    if (!w) {
      if (o.status !== 'done') return o
      // Done is a cache of a finished log, not a permanent disposition like Skip.
      const out: Occurrence = { ...o, status: 'pending' }
      delete out.date
      return out
    }
    const out: Occurrence = { ...o, status: 'done', date: w.d }
    delete out.skippedAt
    delete out.reason
    return out
  })
}

export function mergeProgrammes(a: unknown, b: unknown, workouts: Log[], mergeEntry: MergeEntry): NormalProgrammes {
  const [left, right] = offloadInputs(normaliseProgrammes(a), normaliseProgrammes(b))
  const x = normaliseProgrammes(left), y = normaliseProgrammes(right)
  // The callback preserves passthrough record shapes; it need not be generic over every subtype.
  const out = mergeEntry(without(without(x, 'definitions'), 'cycles'), without(without(y, 'definitions'), 'cycles')) as NormalProgrammes
  out.definitions = pairs<Definition>(x.definitions, y.definitions, 'id', mergeEntry)
  out.cycles = pairs<Cycle>(x.cycles, y.cycles, 'id', (c, d) => {
    const merged = mergeEntry(without(c, 'occurrences'), without(d, 'occurrences')) as Cycle
    const terminal = [c, d].find(x => x.activationConflict) || [c, d].find(x => x.status === 'finished') || [c, d].find(x => x.status === 'archived')
    if (terminal) {
      merged.status = terminal.activationConflict ? 'archived' : terminal.status
      if (terminal.activationConflict) merged.activationConflict = terminal.activationConflict
      merged._f = { ...merged._f, status: Math.max(Number(merged._f?.status) || 0, Number(terminal._f?.status) || 0) }
    }
    merged.occurrences = pairs<Occurrence>(c.occurrences, d.occurrences, 'instanceId', mergeEntry)
    return merged
  }).map(c => ({ ...c, ...(c.activationConflict ? {status:'archived'} : {}), occurrences: resolveOccurrences(c, workouts) }))
  // Concurrent offline activations keep the oldest run; retain the losing snapshot/history.
  const running = out.cycles.filter(c => c.status === 'active' || c.status === 'paused')
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || (Number(a.since) || 0) - (Number(b.since) || 0) || a.id.localeCompare(b.id))
  for (const c of running.slice(1)) {
    const at = Math.max(Number(c._ts) || 0, Number(running[0]!._ts) || 0, ...Object.values(c._f || {}).map(Number), ...Object.values(running[0]!._f || {}).map(Number)) + 1
    c.status = 'archived'; c.activationConflict = running[0]!.id
    c._ts = Math.max(Number(c._ts) || 0, at)
    c._f = { ...c._f, status: at, activationConflict: at }
  }
  return out
}

/** Terminal cycles and activation conflicts cannot reclaim routines or a running queue. */
export function reconcileProgrammeOwnership(S: SchedulingState) {
  const cycles = list<Cycle>(S.programmes?.cycles)
  const winner = cycles.find(c => c.status === 'active') || cycles.find(c => c.status === 'paused')
  const terminal = (c: Cycle | undefined): c is Cycle => !!c && ['archived','finished'].includes(c.status!)
  const owner = cycles.find(c => c.id === S.queue?.programmeCycleId)
  const staleQueue = terminal(owner)
  const conflict = cycles.some(c => c.activationConflict)
  for (const r of list<SchedulingRoutine>(S.routines)) {
    const ended = cycles.find(c => c.id === r.programme?.cycleId)
    if (!terminal(ended) || ended.activationConflict) continue
    if (list<Occurrence>(winner?.occurrences).some(o => o.routineId === r.id)) continue
    r.programmeHistory = {cycleId:ended.id,series:r.programme!.series!}
    delete r.programme
    const at = Math.max(Number(r._f?.programme) || 0, Number(ended._f?.status) || 0) + 1
    r._ts = Math.max(Number(r._ts) || 0,at); r._f = {...r._f,programme:at,programmeHistory:at}
  }
  const queueStamp = () => {
    S.edited = { ...S.edited, queue: Math.max(Number(S.edited?.queue) || 0, programmeStamp(S)) + 1 }
  }
  if (!winner) {
    if (staleQueue) { S.queue = null; queueStamp() }
    return
  }
  const staleRoutine = list<Occurrence>(winner.occurrences).some(o => {
    const r = list<SchedulingRoutine>(S.routines).find(r => r.id === o.routineId)
    return terminal(cycles.find(c => c.id === (r?.programme?.cycleId || r?.programmeHistory?.cycleId))) && r?.programme?.cycleId !== winner.id
  })
  if (!conflict && !staleQueue && !staleRoutine) return
  for (const o of list<Occurrence>(winner.occurrences)) {
    const r = list<SchedulingRoutine>(S.routines).find(r => r.id === o.routineId)
    if (!r || r.programme?.cycleId === winner.id) continue
    const loser = cycles.find(c => c.id === (r.programme?.cycleId || r.programmeHistory?.cycleId) && terminal(c))
    if (!loser) continue
    const at = Math.max(Number(r._f?.programme) || 0, Number(loser._f?.activationConflict) || 0, Number(loser._f?.status) || 0) + 1
    const peers = list<Occurrence>(winner.occurrences).filter(p => p.weekIndex === o.weekIndex && p.weekId === o.weekId && p.dayKey === o.dayKey)
    r.programme = { cycleId: winner.id, instanceId: o.instanceId, weekIndex: o.weekIndex, ordinal: o.ordinal,
      series: `${winner.seriesId || winner.id}:${o.dayKey}${peers.length > 1 ? ':' + (o.sessionTemplateId || peers.findIndex(p => p.instanceId === o.instanceId) + 1) : ''}`,
      ...(o.weekId ? { weekId: o.weekId, orderIndex: o.orderIndex, inserted: true } : {}) }
    r._ts = Math.max(Number(r._ts) || 0, at); r._f = { ...r._f, programme: at }
  }
  if (S.queue?.programmeCycleId !== winner.id) {
    const stage = resolveOccurrences(winner, S.workouts).filter(o => o.weekIndex === winner.weekIndex && (o.weekId || null) === (winner.weekId || null))
    const natural = stage.map(o => o.routineId)
    const retained = list<string>(S.queue?.ids).filter(id => natural.includes(id))
    S.queue = { ...S.queue, ids: [...new Set(retained.concat(natural))], programmeCycleId: winner.id, since: winner.since,
      startsOn: winner.startsOn || winner.week1StartDate, skipped: stage.filter(o => o.status === 'skipped').map(o => o.routineId),
      label: `${winner.snapshot?.short || winner.snapshot?.name || ''} · W${winner.weekIndex}/${winner.lengthWeeks}` }
    queueStamp()
  }
}

/** Stamps changed fields independently down to each occurrence. Mutates next only. */
export function stampProgrammes(prev: unknown, next: unknown, now: number, stampEntry: StampEntry) {
  if (!map(next)) return
  const p = normaliseProgrammes(prev)
  const changed = (a: unknown, b: unknown) => JSON.stringify(a, (k, v) => ['_ts', '_f', '_u'].includes(k) ? undefined : v) !== JSON.stringify(b, (k, v) => ['_ts', '_f', '_u'].includes(k) ? undefined : v)
  const stampChanged = (a: Row, b: Row) => { if (changed(a, b)) stampEntry(a, b, now) }
  const stamp = (old: Row | undefined, x: Row, omit: string) => {
    const a = old ? without(old, omit) : {}
    const b = without(x, omit)
    stampChanged(a, b)
    // The server stamp callback can restore missed fields as well as their clocks.
    for (const k of Object.keys(x)) if (k !== omit && !(k in b)) delete x[k]
    Object.assign(x, b)
  }
  // The root's metadata is stamped separately from its union lists.
  const root = without(without(next, 'definitions'), 'cycles')
  stampChanged(without(without(p, 'definitions'), 'cycles'), root)
  if (root._ts != null) next._ts = root._ts
  if (root._f) next._f = root._f
  for (const f of ['definitions', 'cycles'] as const) {
    const by = new Map(p[f].map(x => [x.id, x]))
    for (const x of records<Definition | Cycle>(next[f])) {
      const old = by.get(x.id)
      if (f === 'definitions') { stampChanged(old || {}, x); continue }
      stamp(old, x, 'occurrences')
      const os = new Map(records<Occurrence>(old?.occurrences, 'instanceId').map(o => [o.instanceId, o]))
      for (const o of records<Occurrence>(x.occurrences, 'instanceId')) stampChanged(os.get(o.instanceId) || {}, o)
    }
  }
}

export function programmeStamp(S: { programmes?: unknown }) {
  let at = 0
  const see = (x: EntryClocks) => { at = Math.max(at, Number(x?._ts) || 0, ...Object.values(map(x?._f) ? x._f : {}).map(v => Number(v) || 0)) }
  const p = programmesOf(S)
  see(p)
  for (const d of p.definitions) see(d)
  for (const c of p.cycles) { see(c); for (const o of c.occurrences) see(o) }
  return Math.max(at, offloadStamp(p))
}

// Older clients log plain routines. Preserve the existing queue DONE rule for their logs.
function legacyCounts(cycle: Cycle, occurrence: Occurrence, workout: Log) {
  if (workout?.programmeInstance || list<NonNullable<Log["entries"]>[number]>(workout?.entries).some(e => e?.occurrenceId)) return false
  if (!Number.isFinite(cycle.since)) return false
  const ids = Array.isArray(workout?.routineIds) ? workout.routineIds : workout?.routineId ? [workout.routineId] : []
  return ids.includes(occurrence.routineId) && ((Number(workout.start) || 0) >= cycle.since! ||
    cycle.strict !== true && typeof cycle.startsOn === 'string' && String(workout.d || '') >= cycle.startsOn &&
    occurrence.routineName && String(workout.name || '').split(' + ').includes(occurrence.routineName))
}
