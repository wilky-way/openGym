import { type JsonMap, type SyncDoc, type SyncEntry } from './sync-types'
interface LoadConfig extends JsonMap { weight?: unknown; inc?: number; mode?: string; warmup?: LoadConfig[]; pyramidWeight?: number[] }
interface LoadSet extends SyncEntry { sides?: { L: LoadSet; R: LoadSet }; drops?: LoadSet[] }
interface LoadEntry extends SyncEntry { topW?: unknown; target?: LoadConfig; planned?: LoadConfig; sets?: LoadSet[] }
interface LoadSession extends SyncEntry { entries: LoadEntry[]; bw?: unknown; vol?: number }
// Converting a profile between kg and lb. Until now the unit switch only relabelled the numbers
// (60 kg became "60 lb", issue #22); this walks every stored weight once. Rounded to what a gym
// can load: lb to the nearest 0.5, kg to the nearest 0.25 — enough that a value converted there
// and back lands where it started for any plate-loadable number.
import { isSideSet, syncSideAggregate } from '@opengym/core/workout-model'
import { workoutVolume } from '@opengym/core/history'
import { type ExerciseIndex, EXIDX } from '@opengym/core/exercises'
import { defaultBarWeight } from '@opengym/core/bar'

const LB_PER_KG = 2.2046226218

export function convertWeight<T>(value: T, from: "kg" | "lb", to: "kg" | "lb"): T | number {
  if (from === to || value == null || value === '' || !Number.isFinite(Number(value))) return value
  const v = Number(value)
  if (to === 'lb') return Math.round(v * LB_PER_KG * 2) / 2
  return Math.round(v / LB_PER_KG * 4) / 4
}

// Body weight is not loaded on a bar: the weigh-in sheet steps and stores it at 0.1, so plate
// rounding would move most weigh-ins on a kg → lb → kg round trip (78.6 → 173.5 → 78.75; QA C15).
// A tenth in either unit is fine enough that kg → lb → kg comes home for every 0.1-kg value.
export function convertBodyWeight<T>(value: T, from: "kg" | "lb", to: "kg" | "lb"): T | number {
  if (from === to || value == null || value === '' || !Number.isFinite(Number(value))) return value
  const v = Number(value)
  return Math.round((to === 'lb' ? v * LB_PER_KG : v / LB_PER_KG) * 10) / 10
}

const convSet = (set: LoadSet, from: "kg" | "lb", to: "kg" | "lb"): LoadSet => {
  if (!set || typeof set !== 'object') return set
  const out = { ...set }
  if (isSideSet(set)) return syncSideAggregate({ ...set, sides: {
    L: convSet(set.sides!.L, from, to), R: convSet(set.sides!.R, from, to),
  } })
  if (out.w != null) out.w = convertWeight(out.w, from, to)
  if (Array.isArray(out.drops)) out.drops = out.drops.map(d => ({ ...d, w: convertWeight(d.w, from, to) }))
  return out
}
const convTarget = (cfg: LoadConfig, from: "kg" | "lb", to: "kg" | "lb"): LoadConfig => {
  if (!cfg || typeof cfg !== 'object') return cfg
  const out = { ...cfg }
  if (out.weight != null) out.weight = convertWeight(out.weight, from, to)
  // A per-exercise increment is a load too — 2.5 kg is 5 lb, not 2.5 lb.
  if (out.inc! > 0 && (out.mode == null || out.mode === 'reps')) out.inc = convertWeight(out.inc!, from, to)
  if (Array.isArray(out.warmup)) out.warmup = out.warmup.map(w => (w && w.weight != null ? { ...w, weight: convertWeight(w.weight, from, to) } : w))
  // A pyramid's own weight per set; 0 ("no plan for this set") stays 0.
  if (Array.isArray(out.pyramidWeight)) out.pyramidWeight = out.pyramidWeight.map(w => (w > 0 ? convertWeight(w, from, to) : w))
  return out
}
// A bar is a stamped object, not a number: the 45 lb bar IS the 20 kg bar (44.1 lb), so an
// override that equals the old unit's default for that bar type drops out and the new unit's
// default takes over — 45 lb → 20 kg, not 20.5, which with a kg plate set would leave every row
// "1 kg short". An explicit 0 ("no bar", lib/bar.js) stays 0. A custom bar converts like any
// other weight (a 33 lb women's bar → 15 kg), and drops out too if it lands on the new default.
const convBarWeights = (bw: JsonMap, from: "kg" | "lb", to: "kg" | "lb", index: ExerciseIndex) => {
  const out: Record<string, number> = {}
  for (const [id, v] of Object.entries(bw || {})) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
    if (v === 0) { out[id] = 0; continue }
    const eq = index[id]?.eq
    if (eq && v === defaultBarWeight(eq, from)) continue
    const c = convertWeight(v, from, to)
    if (eq && c === defaultBarWeight(eq, to)) continue
    out[id] = c
  }
  return out
}
const convEntry = (e: LoadEntry, from: "kg" | "lb", to: "kg" | "lb"): LoadEntry => {
  if (!e || typeof e !== 'object') return e
  return {
    ...e,
    ...(e.topW != null ? { topW: convertWeight(e.topW, from, to) } : {}),
    ...(e.target ? { target: convTarget(e.target, from, to) } : {}),
    // The plan the entry was built from (lib/session-start.js) carries the routine's weight too.
    ...(e.planned ? { planned: convTarget(e.planned, from, to) } : {}),
    ...(Array.isArray(e.sets) ? { sets: e.sets.map(s => convSet(s, from, to)) } : {}),
  }
}

/** A new state object with every weight expressed in `to`, and `unit` set to it. */
export function convertStateUnit(S: SyncDoc, to: "kg" | "lb", index: ExerciseIndex = EXIDX): SyncDoc {
  const from = (S.unit || 'kg') as 'kg' | 'lb'
  if (from === to) return S
  const c = (v: unknown) => convertWeight(v, from, to)
  const bw = (v: unknown) => convertBodyWeight(v, from, to)
  // A session carries its body weight of the day and a cached total volume; History rows, the
  // detail header, the month calendar and the heatmap tooltips read those rather than summing
  // sets, so they must move with the sets or show kg totals under an lb label (QA C11). The
  // volume is re-added from the converted sets, so it agrees with the set list to the number.
  const convSession = (s: LoadSession): LoadSession => {
    const out: LoadSession = { ...s, entries: (s.entries || []).map(e => convEntry(e, from, to)) }
    if (out.bw != null) out.bw = bw(out.bw)
    if (Number.isFinite(out.vol)) out.vol = workoutVolume({ entries: out.entries.filter(e => Array.isArray(e?.sets)) }, index)
    return out
  }
  const out: SyncDoc = { ...S, unit: to }
  if (Array.isArray(S.bodyweight)) out.bodyweight = S.bodyweight.map(b => ({ ...b, w: bw(b.w) as number }))
  if (S.targetW != null) out.targetW = bw(S.targetW)
  if (S.exWeights) out.exWeights = Object.fromEntries(Object.entries(S.exWeights).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v, w: c((v as SyncEntry).w) } : c(v)])) as Record<string, SyncEntry>
  if (S.barWeights) out.barWeights = convBarWeights(S.barWeights as JsonMap, from, to, index)
  // The plate inventory (S.plates) is carried over as it is, not converted: it is kept per unit
  // (lib/plates.js), because a 45 lb plate does not become a 20.4 kg one. After the switch the
  // rows load from the new unit's own list, or the standard set until you count yours, and
  // switching back finds the old list as you left it. The dumbbell list (S.dumbbells) is kept per
  // unit the same way. The load kinds (S.loadKind) and what a dumbbell weight means (S.dbLoad)
  // hold no weight.
  if (Array.isArray(S.routines)) out.routines = S.routines.map(r => ({ ...r, ex: ((r.ex || []) as LoadConfig[]).map(cfg => convTarget(cfg, from, to)) }))
  if (Array.isArray(S.workouts)) out.workouts = (S.workouts as LoadSession[]).map(convSession)
  if (S.active) out.active = convSession(S.active as LoadSession)
  if (Array.isArray(S.programmes?.cycles)) out.programmes = { ...S.programmes, cycles:S.programmes.cycles!.map(cycle=>({ ...cycle, ...((cycle.tmUnit === 'kg' || cycle.tmUnit === 'lb') ? {tmUnit:to} : {}), ...(cycle.tm ? {tm:Object.fromEntries(Object.entries(cycle.tm as JsonMap).map(([key,value])=>[key,c(value)]))} : {}) })) }
  return out
}
