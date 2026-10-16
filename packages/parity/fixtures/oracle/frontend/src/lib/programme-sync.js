// Dependency-free sync helpers. Keep api/programme-sync.js identical (parity test).
const map = v => !!v && typeof v === 'object' && !Array.isArray(v)
const list = v => Array.isArray(v) ? v : []
const clone = v => JSON.parse(JSON.stringify(v))
const records = (v, key = 'id') => {
  const seen = new Set()
  return list(v).filter(x => map(x) && typeof x[key] === 'string' && x[key] && !seen.has(x[key]) && seen.add(x[key]))
}

/** Tolerant read, never a migration: unknown fields and future versions survive. */
export function normaliseProgrammes(raw) {
  const p = map(raw) ? raw : {}
  return {
    version: 1, fork: 'wilky/1', ...p,
    definitions: records(p.definitions),
    cycles: records(p.cycles).map(c => ({ ...c, occurrences: records(c.occurrences, 'instanceId') })),
  }
}

export const programmesOf = S => normaliseProgrammes(S?.programmes)

/** A reset names the records it cleared; future records with other ids remain valid. */
export function programmesSinceReset(raw, at, ids) {
  const out = normaliseProgrammes(raw)
  if (!(Number(at) > 0)) return out
  for (const [field, key] of [['definitions', 'programmeDefinitions'], ['cycles', 'programmeCycles']]) {
    const gone = new Set(list(ids?.[key]).map(String))
    out[field] = out[field].filter(x => (Number(x._ts) || 0) > at || map(ids) && !gone.has(String(x.id)))
  }
  return out
}

const without = (x, key) => { const out = { ...x }; delete out[key]; return out }
const pairs = (a, b, key, merge) => {
  const old = new Map(records(b, key).map(x => [x[key], x]))
  const out = records(a, key).map(x => old.has(x[key]) ? merge(x, old.get(x[key])) : clone(x))
  const ids = new Set(out.map(x => x[key]))
  return out.concat(records(b, key).filter(x => !ids.has(x[key])).map(clone))
}

/** Finished logs are authoritative even when a stale skip has a later edit stamp. */
export function resolveOccurrences(cycle, workouts = []) {
  return records(cycle.occurrences, 'instanceId').map(o => {
    const w = list(workouts).filter(w => {
      const ids = list(w?.entries).map(e => e?.occurrenceId).filter(Boolean)
      // Modern combined logs count only the occurrences whose entries survived finish.
      if (ids.length) return ids.includes(o.instanceId)
      return w?.programmeInstance?.cycleId === cycle.id && w.programmeInstance.instanceId === o.instanceId || legacyCounts(cycle, o, w)
    }).sort((a, b) => String(b.d).localeCompare(String(a.d)))[0]
    if (!w) {
      if (o.status !== 'done') return o
      // Done is a cache of a finished log, not a permanent disposition like Skip.
      const out = { ...o, status: 'pending' }
      delete out.date
      return out
    }
    const out = { ...o, status: 'done', date: w.d }
    delete out.skippedAt
    delete out.reason
    return out
  })
}

export function mergeProgrammes(a, b, workouts, mergeEntry) {
  const x = normaliseProgrammes(a), y = normaliseProgrammes(b)
  const out = mergeEntry(without(without(x, 'definitions'), 'cycles'), without(without(y, 'definitions'), 'cycles'))
  out.definitions = pairs(x.definitions, y.definitions, 'id', mergeEntry)
  out.cycles = pairs(x.cycles, y.cycles, 'id', (c, d) => {
    const merged = mergeEntry(without(c, 'occurrences'), without(d, 'occurrences'))
    const terminal = [c, d].find(x => x.activationConflict) || [c, d].find(x => x.status === 'finished') || [c, d].find(x => x.status === 'archived')
    if (terminal) {
      merged.status = terminal.activationConflict ? 'archived' : terminal.status
      if (terminal.activationConflict) merged.activationConflict = terminal.activationConflict
      merged._f = { ...merged._f, status: Math.max(Number(merged._f?.status) || 0, Number(terminal._f?.status) || 0) }
    }
    merged.occurrences = pairs(c.occurrences, d.occurrences, 'instanceId', mergeEntry)
    return merged
  }).map(c => ({ ...c, ...(c.activationConflict ? {status:'archived'} : {}), occurrences: resolveOccurrences(c, workouts) }))
  // Concurrent offline activations keep the oldest run; retain the losing snapshot/history.
  const running = out.cycles.filter(c => c.status === 'active' || c.status === 'paused')
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || (Number(a.since) || 0) - (Number(b.since) || 0) || a.id.localeCompare(b.id))
  for (const c of running.slice(1)) {
    const at = Math.max(Number(c._ts) || 0, Number(running[0]._ts) || 0, ...Object.values(c._f || {}).map(Number), ...Object.values(running[0]._f || {}).map(Number)) + 1
    c.status = 'archived'; c.activationConflict = running[0].id
    c._ts = Math.max(Number(c._ts) || 0, at)
    c._f = { ...c._f, status: at, activationConflict: at }
  }
  return out
}

/** Terminal cycles and activation conflicts cannot reclaim routines or a running queue. */
export function reconcileProgrammeOwnership(S) {
  const cycles = list(S.programmes?.cycles)
  const winner = cycles.find(c => c.status === 'active') || cycles.find(c => c.status === 'paused')
  const terminal = c => c && ['archived','finished'].includes(c.status)
  const owner = cycles.find(c => c.id === S.queue?.programmeCycleId)
  const staleQueue = terminal(owner)
  const conflict = cycles.some(c => c.activationConflict)
  for (const r of list(S.routines)) {
    const ended = cycles.find(c => c.id === r.programme?.cycleId)
    if (!terminal(ended) || ended.activationConflict) continue
    if (list(winner?.occurrences).some(o => o.routineId === r.id)) continue
    r.programmeHistory = {cycleId:ended.id,series:r.programme.series}
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
  const staleRoutine = list(winner.occurrences).some(o => {
    const r = list(S.routines).find(r => r.id === o.routineId)
    return terminal(cycles.find(c => c.id === (r?.programme?.cycleId || r?.programmeHistory?.cycleId))) && r?.programme?.cycleId !== winner.id
  })
  if (!conflict && !staleQueue && !staleRoutine) return
  for (const o of list(winner.occurrences)) {
    const r = list(S.routines).find(r => r.id === o.routineId)
    if (!r || r.programme?.cycleId === winner.id) continue
    const loser = cycles.find(c => c.id === (r.programme?.cycleId || r.programmeHistory?.cycleId) && terminal(c))
    if (!loser) continue
    const at = Math.max(Number(r._f?.programme) || 0, Number(loser._f?.activationConflict) || 0, Number(loser._f?.status) || 0) + 1
    const peers = list(winner.occurrences).filter(p => p.weekIndex === o.weekIndex && p.weekId === o.weekId && p.dayKey === o.dayKey)
    r.programme = { cycleId: winner.id, instanceId: o.instanceId, weekIndex: o.weekIndex, ordinal: o.ordinal,
      series: `${winner.seriesId || winner.id}:${o.dayKey}${peers.length > 1 ? ':' + (o.sessionTemplateId || peers.findIndex(p => p.instanceId === o.instanceId) + 1) : ''}`,
      ...(o.weekId ? { weekId: o.weekId, orderIndex: o.orderIndex, inserted: true } : {}) }
    r._ts = Math.max(Number(r._ts) || 0, at); r._f = { ...r._f, programme: at }
  }
  if (S.queue?.programmeCycleId !== winner.id) {
    const stage = resolveOccurrences(winner, S.workouts).filter(o => o.weekIndex === winner.weekIndex && (o.weekId || null) === (winner.weekId || null))
    const natural = stage.map(o => o.routineId)
    const retained = list(S.queue?.ids).filter(id => natural.includes(id))
    S.queue = { ...S.queue, ids: [...new Set(retained.concat(natural))], programmeCycleId: winner.id, since: winner.since,
      startsOn: winner.startsOn || winner.week1StartDate, skipped: stage.filter(o => o.status === 'skipped').map(o => o.routineId),
      label: `${winner.snapshot?.short || winner.snapshot?.name || ''} · W${winner.weekIndex}/${winner.lengthWeeks}` }
    queueStamp()
  }
}

/** Stamps changed fields independently down to each occurrence. Mutates next only. */
export function stampProgrammes(prev, next, now, stampEntry) {
  if (!map(next)) return
  const p = normaliseProgrammes(prev)
  const changed = (a, b) => JSON.stringify(a, (k, v) => ['_ts', '_f', '_u'].includes(k) ? undefined : v) !== JSON.stringify(b, (k, v) => ['_ts', '_f', '_u'].includes(k) ? undefined : v)
  const stampChanged = (a, b) => { if (changed(a, b)) stampEntry(a, b, now) }
  const stamp = (old, x, omit) => {
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
  for (const f of ['definitions', 'cycles']) {
    const by = new Map(p[f].map(x => [x.id, x]))
    for (const x of records(next[f])) {
      const old = by.get(x.id)
      if (f === 'definitions') { stampChanged(old || {}, x); continue }
      stamp(old, x, 'occurrences')
      const os = new Map(records(old?.occurrences, 'instanceId').map(o => [o.instanceId, o]))
      for (const o of records(x.occurrences, 'instanceId')) stampChanged(os.get(o.instanceId) || {}, o)
    }
  }
}

export function programmeStamp(S) {
  let at = 0
  const see = x => { at = Math.max(at, Number(x?._ts) || 0, ...Object.values(map(x?._f) ? x._f : {}).map(v => Number(v) || 0)) }
  const p = programmesOf(S)
  see(p)
  for (const d of p.definitions) see(d)
  for (const c of p.cycles) { see(c); for (const o of c.occurrences) see(o) }
  return at
}

// Older clients log plain routines. Preserve the existing queue DONE rule for their logs.
function legacyCounts(cycle, occurrence, workout) {
  if (workout?.programmeInstance || list(workout?.entries).some(e => e?.occurrenceId)) return false
  if (!Number.isFinite(cycle.since)) return false
  const ids = Array.isArray(workout?.routineIds) ? workout.routineIds : workout?.routineId ? [workout.routineId] : []
  return ids.includes(occurrence.routineId) && ((Number(workout.start) || 0) >= cycle.since ||
    cycle.strict !== true && typeof cycle.startsOn === 'string' && String(workout.d || '') >= cycle.startsOn &&
    occurrence.routineName && String(workout.name || '').split(' + ').includes(occurrence.routineName))
}
