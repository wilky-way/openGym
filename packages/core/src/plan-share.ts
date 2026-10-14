import type { ExportPlan, ExportRoutine, ExportConfig, ExportCustom } from './export-types'
import type { ExerciseIndex } from './exercises'
// Share a weekly plan.
//
// Two jobs:
//  1. A small, self-contained file a friend can import into THEIR openGym — just the
//     routines + the week schedule + the custom exercises those routines use. It never
//     carries workouts, weigh-ins or settings, and importing MERGES (adds routines with
//     fresh ids) so nothing the friend already has is touched.
//  2. A clean, printable page (Save as PDF) where a single exercise never splits across
//     a page break — each exercise, and each routine that fits, stays in one place.

import { EXIDX, canonicalExId, isBodyweightEq } from '@opengym/core/exercises'

import { modeOf, exLine, MAX_PLANNED_WARMUPS } from '@opengym/core/history'
import { deriveSessionName } from '@opengym/core/session-merge'
import { isPyramid, normalizePyramid, normalizePyramidRest, normalizePyramidWeight } from '@opengym/core/pyramid'
import { isBackoff } from '@opengym/core/backoff'
import { dbLoadOf } from '@opengym/core/dumbbells'
import { MAX_TRIPLE_SETS } from '@opengym/core/progression'
import { uid, todayISO, DAYN, weekOrder, weekStartOf, exCount } from '@opengym/core/format'
import { t, exerciseNameFor, exerciseNameClass, getLang, RTL_LANGS } from '@opengym/core/i18n-core'
import { convertWeight } from '@opengym/core/units'
import { fmtSpeed, speedUnitOf } from '@opengym/core/speed'
import { MUSCLES, inMuscleOrder } from '@opengym/core/muscles'

const PLAN_FMT = 1
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 0]   // every getDay() index; only the reader's own
                                          // screen puts them in an order (see weekOrder)
const PLAN_UNITS = new Set(['kg', 'lb'])

// Safety limit: shared-plan imports are bounded before parsing, including file reads.
// These generous limits apply to unknown metadata as well as the visible prescriptions.
const PLAN_LIMITS = {
  bytes: 1024 * 1024, depth: 32, stringLength: 16 * 1024, nodes: 100_000,
  arrayItems: 4096, objectKeys: 256, routines: 256, customEx: 2048,
  exercisesPerRoutine: 128, exercises: 8192, routinesPerDay: 256,
} as const
const limitError = (): never => {
  throw Object.assign(new Error('This openGym plan exceeds the import safety limits'), { code: 'plan-limit' })
}
const planId = (id: unknown): id is string => typeof id === 'string' && id.length > 0
const ownExercise = (id: unknown, index: ExerciseIndex): id is string => planId(id) && Object.hasOwn(index, id)
function canonicalPlanId(id: string, index: ExerciseIndex) {
  const canonical = canonicalExId(id, index)
  // A caller index may own the alias but only inherit its canonical target.
  return ownExercise(canonical, index) ? canonical : id
}

/** Scan the bounded text BEFORE JSON.parse allocates a decoded object graph. JSON.parse
 * owns syntax validation; this scanner only counts containers, entries, tokens and decoded
 * string lengths, ignoring structural characters inside strings (including escapes). */
function checkPlanText(raw: string) {
  if (raw.length > PLAN_LIMITS.bytes || new TextEncoder().encode(raw).length > PLAN_LIMITS.bytes) limitError()
  const stack: { entries: number; max: number }[] = []
  let nodes = 0
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!
    if (c === '"') {
      let length = 0
      for (i++; i < raw.length && raw[i] !== '"'; i++) {
        if (raw[i] === '\\') {
          i++
          if (raw[i] === 'u') i += 4
        }
        if (++length > PLAN_LIMITS.stringLength) limitError()
      }
      nodes++
    } else if (c === '{' || c === '[') {
      stack.push({ entries: 1, max: c === '[' ? PLAN_LIMITS.arrayItems : PLAN_LIMITS.objectKeys })
      if (stack.length > PLAN_LIMITS.depth) limitError()
      nodes++
    } else if (c === '}' || c === ']') {
      stack.pop()
    } else if (c === ',') {
      const top = stack[stack.length - 1]
      if (top && ++top.entries > top.max) limitError()
    } else if (c !== ':' && !/\s/.test(c)) {
      // A number, boolean, null, or malformed token. Never allocate a token substring.
      while (i + 1 < raw.length && !/[\s,:[\]{}"]/.test(raw[i + 1]!)) i++
      nodes++
    }
    if (nodes > PLAN_LIMITS.nodes) limitError()
  }
}

/** Also bound callers supplying already decoded objects. Recursion is stopped at 32
 * containers, so deep nesting and cycles cannot exhaust the JavaScript call stack. */
function checkPlanValue(raw: unknown) {
  let nodes = 0, bytes = 0
  const string = (value: string) => {
    if (value.length > PLAN_LIMITS.stringLength) limitError()
    bytes += new TextEncoder().encode(value).length
    if (bytes > PLAN_LIMITS.bytes) limitError()
  }
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > PLAN_LIMITS.nodes) limitError()
    if (typeof value === 'string') { string(value); return }
    if (!value || typeof value !== 'object') return
    if (++depth > PLAN_LIMITS.depth) limitError()
    const array = Array.isArray(value)
    if (array && value.length > PLAN_LIMITS.arrayItems) limitError()
    const names = Object.getOwnPropertyNames(value)
    if (names.length > (array ? PLAN_LIMITS.arrayItems + PLAN_LIMITS.objectKeys + 1 : PLAN_LIMITS.objectKeys)) limitError()
    let keys = 0
    for (const key of names) {
      if (array && key === 'length') continue
      const element = array && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length
      // Arrays can carry named properties on the direct-object path, and an exercise's
      // spread retains them. Bound those properties exactly like object metadata.
      if (!element) {
        if (++keys > PLAN_LIMITS.objectKeys) limitError()
        string(key)
      }
      visit((value as Record<string, unknown>)[key], depth)
    }
    // JSON has only ordinary prototypes, but direct callers may supply consumed fields
    // (e.g. custom desc) through a nonstandard prototype. Bound that data as well.
    const prototype: unknown = Object.getPrototypeOf(value)
    if (prototype && prototype !== Object.prototype && prototype !== Array.prototype) visit(prototype, depth)
  }
  visit(raw, 0)
}

function checkPlanCounts(data: ExportPlan) {
  if (data.routines.length > PLAN_LIMITS.routines || (Array.isArray(data.customEx) && data.customEx.length > PLAN_LIMITS.customEx)) limitError()
  let exercises = 0
  for (const routine of data.routines) {
    if (!routine || !Array.isArray(routine.ex)) continue
    if (routine.ex.length > PLAN_LIMITS.exercisesPerRoutine) limitError()
    exercises += routine.ex.length
    if (exercises > PLAN_LIMITS.exercises) limitError()
  }
  for (const day of WEEK_DAYS) {
    const value = data.week?.[day]
    if (Array.isArray(value) && value.length > PLAN_LIMITS.routinesPerDay) limitError()
  }
}

/** Only own weekday keys survive. Keep valid scalar/null/empty-array legacy shapes. */
function cleanWeek(raw: unknown): ExportPlan['week'] {
  const week: ExportPlan['week'] = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return week
  for (const day of WEEK_DAYS) {
    if (!Object.hasOwn(raw, day)) continue
    const value = (raw as Record<string, unknown>)[day]
    if (value === null || planId(value)) week[day] = value
    else if (Array.isArray(value)) week[day] = value.filter(planId)
  }
  return week
}

// A plan's numbers are in the unit that wrote it. Missing unit is deliberately legacy-compatible:
// old files were read as already being in the recipient's unit, so keep their values unchanged.
const planUnit = (value: unknown): string | null => value === 'lbs' ? 'lb' : PLAN_UNITS.has(value as string) ? value as string : null
const unitError: () => never = () => { throw new Error(t('this isn’t an openGym plan file')) }

function declaredPlanUnit(data: Pick<ExportPlan, 'unit' | 'weightUnit'>) {
  let declared: string | null = null
  for (const key of ['unit', 'weightUnit'] as const) {
    if (data[key] == null) continue
    const unit = planUnit(data[key])
    if (!unit || (declared && declared !== unit)) unitError()
    declared = unit
  }
  return declared
}

function convertedExercise(e: ExportConfig, sourceUnit: string | null, destinationUnit: string, index: ExerciseIndex) {
  if (!sourceUnit || sourceUnit === destinationUnit) return e
  const out = { ...e }
  if (out.weight != null) out.weight = convertWeight(out.weight, sourceUnit, destinationUnit)
  // A timed increment is seconds, not a load. Rep-mode increments are load overrides.
  if (modeOf(out, index) === 'reps' && (out.inc ?? 0) > 0) out.inc = convertWeight(out.inc, sourceUnit, destinationUnit)
  if (Array.isArray(out.pyramidWeight)) out.pyramidWeight = out.pyramidWeight.map(w => (w > 0 ? convertWeight(w, sourceUnit, destinationUnit) : w))
  return out
}

function convertedBundle(bundle: ExportPlan, destinationUnit: string, index: ExerciseIndex) {
  const sourceUnit = declaredPlanUnit(bundle)
  if (!sourceUnit || sourceUnit === destinationUnit) return bundle
  return {
    ...bundle,
    unit: destinationUnit,
    routines: (bundle.routines || []).map(r => ({
      ...r,
      ex: (r.ex || []).map(e => convertedExercise(e, sourceUnit, destinationUnit, index))
    }))
  }
}

// Keep only the meaningful config fields, so the file stays small and readable.
function cleanEx(e: ExportConfig, index: ExerciseIndex) {
  const o: ExportConfig = { id: e.id, sets: e.sets }
  const mode = modeOf(e, index)
  if (mode === 'cardio') {
    if (e.min != null) o.min = e.min
    if (e.speed != null) o.speed = e.speed
  } else if (mode === 'time') {
    // Written out even though 'reps' is the fallback for a non-cardio id: a plan file that
    // dropped the mode would turn a 45-second plank into a 45-rep one at the other end.
    o.mode = 'time'
    if (e.sec != null) o.sec = e.sec
    if (e.weight) o.weight = e.weight
  } else {
    if (e.reps != null) o.reps = e.reps
    if (e.weight) o.weight = e.weight
    // Pyramid sets are the prescription itself; without them a "12 · 8 · 6 · Max · 12" arrives as 5 × 12.
    if (isPyramid(e)) {
      o.pyramid = normalizePyramid(e.pyramid)
      const rest = normalizePyramidRest(e.pyramidRest, o.pyramid!.length)
      if (rest.length) o.pyramidRest = rest
      const weight = normalizePyramidWeight(e.pyramidWeight, o.pyramid!.length)
      if (weight.length) o.pyramidWeight = weight
    }
  }
  // How the exercise is logged travels too (issues #31/#32) — the bodyweight flag only when
  // it disagrees with the catalogue, since agreeing is what the other end already assumes.
  if (e.bodyweight != null && e.bodyweight !== isBodyweightEq(e.id, index)) o.bodyweight = e.bodyweight
  // Reps work and timed holds (a per-side hold is an L and an R hold per set); never cardio.
  if (e.side && mode !== 'cardio') o.side = true
  // Progression settings travel with the plan — a shared Greyskull routine that arrives
  // without its rule is just a list of weights.
  if (e.prog) o.prog = e.prog
  if ((e.inc ?? 0) > 0) o.inc = e.inc
  // Back-off sets step down by that same step; written only when on (lib/backoff.js).
  if (isBackoff(e)) o.backoff = true
  // "Last set to failure" is how the exercise is prescribed too; only when on, never on cardio.
  if (e.lastToFailure === true && mode !== 'cardio') o.lastToFailure = true
  // Epley deload factor is a per-occurrence progression setting. Omit the default so older
  // exports remain compact and importing them preserves the default 90% behaviour.
  if (e.deloadFactor != null && Number(e.deloadFactor) !== 0.9) o.deloadFactor = e.deloadFactor
  // What a dumbbell weight means in this slot (lib/dumbbells.js): without it "20 each" arrives
  // as a bare 20 and the other end counts half the volume.
  if (dbLoadOf(e.dbLoad)) o.dbLoad = dbLoadOf(e.dbLoad)
  if (e.repsMin != null) o.repsMin = e.repsMin
  // Triple progression's set ceiling (progression.js tripleSetsOf), rep work only.
  if (mode === 'reps' && (e.setsMax ?? 0) > 0) o.setsMax = Math.min(MAX_TRIPLE_SETS, Math.round(e.setsMax!))
  if (e.repsMax != null) o.repsMax = e.repsMax
  // The exercise's own rest (issue #10) is part of how it is prescribed, so it travels too —
  // only when set, so a plan that never asked for one leaves the recipient's own default
  // timer in charge. parsePlan and mergePlan carry it through by spread.
  if ((e.restSec ?? 0) > 0) o.restSec = e.restSec
  if ((e.warmupRestSec ?? 0) > 0) o.warmupRestSec = e.warmupRestSec   // the ramp's own rest travels with the work rest
  if (e.sg) o.sg = e.sg
  if (e.note) o.note = e.note
  const warm = cleanWarmupSets(e.warmupSets)
  if (warm) o.warmupSets = warm
  // Drop-sets and rest-pause are part of how the exercise is prescribed, not a logging detail.
  // Without this a shared "3x5 with a double drop" arrived at the other end as a plain 3x5,
  // silently — parsePlan's `dropped` counter only tracks exercises it cannot resolve at all.
  const intens = cleanIntensifier(e.intensifier)
  if (intens) o.intensifier = intens
  return o
}

/** Clamped the same way buildSets clamps it on the way out — the stepper showed a hand-edited
 *  plan file's "999" verbatim, because the clamp only happened when the rows were built. */
function cleanWarmupSets(v: unknown) {
  const n = Math.round(Number(v)) || 0
  return n > 0 ? Math.min(MAX_PLANNED_WARMUPS, n) : 0
}

/** A positive whole number of seconds or nothing — the same gate cleanEx applies on the way
 *  out, so a hand-edited plan file can't hand the rest timer a string or a negative. */
function cleanRestSec(v: unknown) {
  const n = Math.round(Number(v)) || 0
  return n > 0 ? n : 0
}

/** Keep the floors the config sheet and applyIntensifierPlan already enforce, and nothing else:
 *  a plan file is someone else's data, so anything unrecognised is dropped rather than trusted. */
function cleanIntensifier(raw: unknown) {
  // Read the legacy passthrough shape; the type discriminator below owns normalization.
  const x = raw as { type?: unknown; count?: unknown; pct?: unknown; totalReps?: unknown; restSec?: unknown } | null | undefined
  const type = x && x.type
  if (type === 'dropset') {
    return { type, count: Math.max(1, Math.round(Number(x!.count)) || 1), pct: Math.max(5, Math.round(Number(x!.pct)) || 20) }
  }
  if (type === 'restpause') {
    return { type, totalReps: Math.max(1, Math.round(Number(x!.totalReps)) || 1), restSec: Math.max(5, Math.round(Number(x!.restSec)) || 15) }
  }
  return null
}

// The muscles the map can draw, plus the one label the form gives a cardio exercise.
const CUSTOM_MUSCLES = new Set([...MUSCLES, 'cardiovascular system'])
const muscleList = (v: unknown): string[] => inMuscleOrder([...new Set((Array.isArray(v) ? v : []).filter(m => CUSTOM_MUSCLES.has(m)))])

/** A custom exercise with its own metadata — equipment, muscles, description — in the shape
 *  CustomExForm writes, minus the recipient-side `custom`/`sm` fields mergePlan adds. The bundle
 *  used to carry only {id, n, bp}, so the exercise arrived with an empty equipment tag, no muscle
 *  credit, and (stored without `custom: true`) no way to edit or delete it (QA C7). The same gate
 *  runs on the way in as on the way out, since a plan file is someone else's data: only muscles the
 *  map can draw, a secondary never repeating a primary, the way the form itself enforces. Fields
 *  that are empty stay absent, so a file written before this change reads the same as one after. */
function cleanCustom(c: ExportCustom) {
  const o: ExportCustom = { id: c.id, n: c.n, bp: c.bp }
  if (c.desc) o.desc = c.desc
  // The link to a video or guide travels with a shared plan (#246), cleaned both ways like any
  // other field of someone else's file; the exercise's own photo or video never does — it is a
  // file on the sender's device and server, and a plan file is plain JSON.
  const url = cleanUrl(c.url)
  if (url) o.url = url
  if (typeof c.eq === 'string' && c.eq) o.eq = c.eq
  const prim = muscleList(c.primaries)
  const sm = muscleList(c.secondaries).filter(m => !prim.includes(m))
  // `tg` is the legacy single primary; the form keeps it equal to the first primary.
  const tg = prim[0] || (CUSTOM_MUSCLES.has(c.tg!) ? c.tg : '')
  if (tg) o.tg = tg
  if (prim.length) o.primaries = prim
  if (sm.length) o.secondaries = sm
  if (prim.length || sm.length) o.muscleGroups = [...prim, ...sm]
  return o
}

/** Build the shareable bundle: every routine, the week schedule, referenced customs. */
export function buildPlanBundle(S: Partial<ExportPlan>, name?: string, index: ExerciseIndex = EXIDX) {
  const unit = planUnit(S.unit == null ? 'kg' : S.unit)
  if (!unit) unitError()
  const routines = (S.routines || []).map(r => ({
    id: r.id, name: r.name, emoji: r.emoji,
    ...(r.prog ? { prog: r.prog } : {}),
    ...(r.excludeFromProgression === true ? { excludeFromProgression: true } : {}),
    ex: (r.ex || []).map(e => cleanEx(e, index))
  }))
  const usedIds = new Set(routines.flatMap(r => r.ex.map(e => e.id)))
  const customEx = (S.customEx || [])
    .filter(c => usedIds.has(c.id))
    .map(cleanCustom)
  // A weekday can hold several routines (merge order preserved). `[].concat` normalises a
  // legacy scalar id to a one-element list, so a bundle written before this change and one
  // written after are read the same way at the other end.
  const week: ExportPlan['week'] = {}
  WEEK_DAYS.forEach(d => { if (S.week?.[d]?.length) week[d] = ([] as string[]).concat(S.week[d]!) })
  return { opengym_plan: PLAN_FMT, exported: todayISO(), name: name || '', unit, week, routines, customEx }
}

/**
 * Validate + normalise an imported file. Throws with a friendly message if it isn't one.
 *
 * Every exercise id has to resolve — either to the built-in library or to a custom
 * exercise carried in the same file. An id that resolves to neither (a hand-edited file,
 * an export from a build with a different exercise dataset) is dropped here: kept, it
 * would sit invisibly in the routine and only surface as a blank screen when the routine
 * is trained.
 */
export function parsePlan(raw: unknown, destinationUnit = 'kg', index: ExerciseIndex = EXIDX) {
  const notPlan = () => Object.assign(new Error(t('this isn’t an openGym plan file')), { code: 'not-plan' })
  let data = raw as ExportPlan
  if (typeof raw === 'string') {
    checkPlanText(raw)
    try { data = JSON.parse(raw) } catch { throw notPlan() }
  }
  checkPlanValue(data)
  const destination = planUnit(destinationUnit)
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.opengym_plan || !Array.isArray(data.routines) || !destination) {
    throw notPlan()
  }
  checkPlanCounts(data)
  const sourceUnit = declaredPlanUnit(data)
  const customEx = (Array.isArray(data.customEx) ? data.customEx : []).filter(c => c && planId(c.id))
  const known = new Set(customEx.map(c => c.id))
  let dropped = 0
  const routines = data.routines.filter(r => r && planId(r.id) && Array.isArray(r.ex)).map(r => ({
    ...r,
    id: r.id,
    ex: r.ex.filter(e => {
      const ok = !!e && planId(e.id) && (known.has(e.id) || ownExercise(e.id, index))
      if (!ok) dropped++
      return ok
    }).map(e => {
      // The exercises pass through as written, so the fields that carry numbers into the
      // planner get the same clamps on the way in that they get on the way out. A drawing's id
      // (the female figure of an exercise) becomes the exercise's own.
      const warm = cleanWarmupSets(e.warmupSets)
      const intens = cleanIntensifier(e.intensifier)
      const rest = cleanRestSec(e.restSec)
      const warmRest = cleanRestSec(e.warmupRestSec)
      const pyramid = normalizePyramid(e.pyramid)
      const pyramidRest = pyramid.length ? normalizePyramidRest(e.pyramidRest, pyramid.length) : []
      const pyramidWeight = pyramid.length ? normalizePyramidWeight(e.pyramidWeight, pyramid.length) : []
      const { warmupSets, intensifier, restSec, warmupRestSec, pyramid: _pyramid, pyramidRest: _pyramidRest, pyramidWeight: _pyramidWeight, ...passthrough } = e
      passthrough.id = known.has(e.id!) ? e.id : canonicalPlanId(e.id!, index)
      return convertedExercise({ ...passthrough, ...(pyramid.length ? { pyramid } : {}), ...(pyramidRest.length ? { pyramidRest } : {}), ...(pyramidWeight.length ? { pyramidWeight } : {}), ...(warm ? { warmupSets: warm } : {}), ...(intens ? { intensifier: intens } : {}), ...(rest ? { restSec: rest } : {}), ...(warmRest ? { warmupRestSec: warmRest } : {}) }, sourceUnit || destination, destination, index)
    })
  }))
  const week = cleanWeek(data.week)
  return {
    name: (data.name || '').trim(),
    routines,
    week,
    customEx,
    dropped,
    routineCount: routines.length,
    exerciseCount: routines.reduce((n, r) => n + r.ex.length, 0),
    scheduledDays: WEEK_DAYS.filter(d => week[d]?.length).length,
    // `unit` is the unit of the returned prescriptions. `sourceUnit` is null for a legacy file;
    // that absence means its numbers were intentionally treated as already in `destination`.
    unit: destination,
    sourceUnit: sourceUnit || null,
    destinationUnit: destination
  }
}

/**
 * Merge a parsed bundle into a draft state `s` (call inside store.update).
 *  - customs: reuse one you already have with the same name + body part, else add it fresh
 *  - routines: always added as NEW routines (fresh ids) — never overwrites yours
 *  - schedule: optional; when on, the shared week REPLACES yours (days the shared plan
 *    leaves empty become rest days — a half-overwritten week would silently mix two plans)
 */
export function mergePlan(s: ExportPlan, bundle: ExportPlan, { schedule }: { schedule?: boolean } = {}, index: ExerciseIndex = EXIDX) {
  const destination = planUnit(s.unit == null ? 'kg' : s.unit)
  if (!destination) unitError()
  checkPlanValue(bundle)
  checkPlanCounts(bundle)
  const customEx = (bundle.customEx || []).filter(c => c && planId(c.id))
  const known = new Set(customEx.map(c => c.id))
  // mergePlan also accepts a direct bundle: do not rely on a prior parsePlan call.
  const source = convertedBundle({ ...bundle, customEx, routines: bundle.routines
    .filter(r => r && planId(r.id) && Array.isArray(r.ex))
    .map(r => ({ ...r, ex: r.ex.filter(e => e && planId(e.id) && (known.has(e.id) || ownExercise(e.id, index))) }))
  }, destination, index)
  s.customEx = s.customEx || []
  const exIdMap = new Map<string, string>()
  ;(source.customEx || []).forEach(c => {
    const same = s.customEx!.find(x => (x.n || '').toLowerCase() === (c.n || '').toLowerCase() && x.bp === c.bp)
    if (same) { exIdMap.set(c.id, same.id); return }
    const nid = uid()
    exIdMap.set(c.id, nid)
    // Stored exactly as the form would have created it — `custom: true` is what lets the recipient
    // edit or delete it, and `sm` mirrors the secondaries the way the form writes them.
    const clean = cleanCustom(c)
    s.customEx!.push({ ...clean, id: nid, ...(clean.secondaries ? { sm: clean.secondaries } : {}), custom: true })
  })
  const ridMap = new Map<string, string>()
  source.routines.forEach(r => {
    const nid = uid()
    ridMap.set(r.id, nid)
    s.routines.push({
      id: nid,
      name: r.name || t('Shared routine'),
      emoji: r.emoji,
      ...(r.prog ? { prog: r.prog } : {}),
      ...(r.excludeFromProgression === true ? { excludeFromProgression: true } : {}),
      ex: (r.ex || []).map(e => ({ ...e, id: exIdMap.get(e.id!) || canonicalPlanId(e.id!, index) }))
    })
  })
  if (schedule) {
    const week: ExportPlan['week'] = {}
    const importedWeek = cleanWeek(source.week)
    WEEK_DAYS.forEach(d => {
      // A legacy scalar becomes one id. Unknown/nonstring references are dropped.
      const val = importedWeek[d]
      const ids = ([] as (string | null)[]).concat(val ?? []).map(oldId => oldId === null ? undefined : ridMap.get(oldId)).filter((id): id is string => !!id)
      if (ids.length) week[d] = ids
    })
    s.week = week
  }

  return { routines: source.routines.length }
}

/* ------------------------------- printable PDF ------------------------------- */

const esc = (str: unknown) => String(str == null ? '' : str)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// One exercise's scheme, e.g. "3 × 8–12 · 60 kg · drop-set 1× −20%", "3 × 0:45" or
// "2 × 20 min @ 8 km/h" — the speed in the profile's unit (lib/speed.js), like the weight. The
// reps half is exLine's, so a double-progression range prints as the range it is ("8–12", not
// the top alone) and a per-side split reads "8/side" exactly as the routine editor shows it.
function scheme(e: ExportConfig, unit: string, speedUnit: string | undefined, index: ExerciseIndex) {
  const sets = e.sets || 1
  const mode = modeOf(e, index)
  if (mode === 'cardio') {
    const body = `${e.min || 20} min @ ${fmtSpeed(e.speed || 8, speedUnit)}`
    return sets > 1 ? `${sets} × ${body}` : body
  }
  const line = exLine({ ...e, reps: e.reps ?? 10 }, unit, speedUnit, index)
  const extras = [intensifierLine(e.intensifier), e.lastToFailure === true ? t('Last set to failure') : ''].filter(Boolean)
  return [line, ...extras].join(' · ')
}

// A drop-set or rest-pause is how the exercise is prescribed, so the printout names it — the
// sheet at the rack otherwise reads as plain straight sets.
function intensifierLine(x: ExportConfig['intensifier']) {
  const intens = cleanIntensifier(x)
  if (!intens) return ''
  return intens.type === 'dropset'
    ? `${t('Drop-set')} ${intens.count}× −${intens.pct}%`
    : `${t('Rest-pause')} ${intens.totalReps} ${t('reps')}`
}

// Group consecutive exercises sharing a superset id into rendered units.
function units(ex: ExportConfig[]) {
  const out: ExportConfig[][] = []
  ex.forEach((e, i) => {
    const prev = ex[i - 1]
    if (i > 0 && e.sg && prev?.sg === e.sg) out[out.length - 1]!.push(e)
    else out.push([e])
  })
  return out
}

// `bare` leaves out the routine's own heading, for a page that is this one routine and already
// names it at the top.
function routineHTML(r: ExportRoutine, unit: string, { bare = false, speedUnit }: { bare?: boolean; speedUnit?: string } = {}, index: ExerciseIndex) {
  const rows = units(r.ex).map(u => {
    const items = u.map(e => {
      const ex = index[e.id!]
      const name = ex ? exerciseNameFor(ex) : t('Unknown exercise')
      // Translated, and set apart by a real space: glued to the name, "capitalize" read the two as
      // one word and printed "Curlupper Legs".
      const part = ex && ex.bp && ex.bp !== 'cardio' ? ` <span class="part">${esc(t(ex.bp))}</span>` : ''
      const note = e.note ? `<div class="ex-note">${esc(e.note)}</div>` : ''
      return `<div class="ex"><div class="ex-row"><div class="ex-n ${ex ? exerciseNameClass(ex) : ''}">${esc(name)}${part}</div><div class="ex-s">${esc(scheme(e, unit, speedUnit, index))}</div></div>${note}</div>`
    }).join('')
    return u.length > 1
      ? `<div class="ss"><div class="ss-tag">${esc(t('Superset'))}</div><div class="ss-items">${items}</div></div>`
      : items
  }).join('')
  const count = exCount(r.ex.length)
  return `<section class="routine">
    ${bare ? '' : `<div class="r-head"><h2>${esc(r.name)}</h2><span class="r-count">${esc(count)}</span></div>`}
    <div class="ex-list">${rows || `<div class="ex empty">${esc(t('No exercises yet.'))}</div>`}</div>
  </section>`
}

function weekHTML(S: ExportPlan) {
  // The printout is read by whoever exported it, so the week runs in their order.
  const rows = weekOrder(weekStartOf(S)).map(d => {
    const names = ([] as string[]).concat(S.week?.[d] || [])
      .map(id => S.routines.find(x => x.id === id)?.name)
      .filter(Boolean)
    const val = names.length ? esc(deriveSessionName(names)) : `<span class="rest">${esc(t('Rest'))}</span>`
    return `<div class="w-row"><div class="w-day">${esc(t(DAYN[d]))}</div><div class="w-r">${val}</div></div>`
  }).join('')
  return `<div class="week">${rows}</div>`
}

/**
 * Full self-contained HTML for the print/PDF view. With `routineId` it is that one routine on
 * its own page (#282) — the session you take to the gym, not the week around it — so the week
 * schedule is left out and the routine's name is the page title.
 */
export function planPrintHTML(S: ExportPlan, owner?: string, { routineId }: { routineId?: string } = {}, index: ExerciseIndex = EXIDX) {
  const unit = S.unit || 'kg'
  const single = routineId ? (S.routines || []).find(r => r.id === routineId) || null : null
  const routines = routineId ? (single ? [single] : []) : (S.routines || []).filter(r => r.ex && r.ex.length)
  const body = routines.length
    ? routines.map(r => routineHTML(r, unit, { bare: !!single, speedUnit: speedUnitOf(S) }, index)).join('')
    : `<p class="none">${esc(t('No routines yet.'))}</p>`
  const title = single ? single.name : t('Weekly Training Plan')
  const sub = [single ? exCount(single.ex.length) : null, owner, todayISO()].filter(Boolean).map(esc).join(' · ')
  const week = routineId ? '' : `<h3 class="block">${esc(t('Week schedule'))}</h3>
  ${weekHTML(S)}
  <h3 class="block">${esc(t('Routines'))}</h3>`
  return `<!doctype html><html lang="${getLang()}" dir="${RTL_LANGS.has(getLang()) ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  @page { margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0; color: #16181d; background: #fff;
    font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .doc { max-width: 720px; margin: 0 auto; }
  header { border-bottom: 2px solid #16181d; padding-bottom: 12px; margin-bottom: 20px; }
  header .kicker { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #6a7a3a; font-weight: 700; }
  header h1 { font-size: 27px; letter-spacing: -.02em; margin: 3px 0 0; }
  header .sub { color: #6b7180; font-size: 13px; margin-top: 4px; }

  h3.block { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #8a90a0; margin: 0 0 8px; font-weight: 700; }

  .week { border: 1px solid #e4e6ec; border-radius: 10px; overflow: hidden; margin-bottom: 26px; break-inside: avoid; page-break-inside: avoid; }
  .w-row { display: flex; align-items: baseline; padding: 8px 14px; border-top: 1px solid #eef0f4; }
  .w-row:first-child { border-top: 0; }
  .w-day { width: 116px; font-weight: 600; color: #16181d; flex: none; }
  .w-r { text-transform: capitalize; }
  .rest, .w-r .rest { color: #a2a8b6; text-transform: none; }

  .routine { break-inside: avoid; page-break-inside: avoid; margin-bottom: 20px; padding: 14px 16px; border: 1px solid #e4e6ec; border-radius: 12px; }
  .r-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; border-bottom: 1px solid #eef0f4; padding-bottom: 8px; margin-bottom: 8px; break-after: avoid; page-break-after: avoid; }
  .r-head h2 { font-size: 18px; letter-spacing: -.01em; margin: 0; text-transform: capitalize; }
  .r-count { font-size: 12px; color: #8a90a0; white-space: nowrap; }

  .ex-list { display: flex; flex-direction: column; }
  .ex { display: flex; flex-direction: column; padding: 6px 0; break-inside: avoid; page-break-inside: avoid; }
  .ex + .ex, .ss + .ex, .ex + .ss { border-top: 1px solid #f2f3f6; }
  .ex-row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; }
  .ex-n { font-weight: 500; }
  .ex-n.capitalize { text-transform: capitalize; }
  .ex-n .part { display: inline-block; text-transform: none; color: #9aa0ae; font-weight: 400; font-size: 12px; margin-inline-start: 4px; }
  .ex-n .part::first-letter { text-transform: uppercase; }
  .ex-s { color: #3d424e; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .ex-note { color: #6a7080; font-size: 12px; margin-top: 2px; }
  .ex.empty, .none { color: #a2a8b6; }

  .ss { break-inside: avoid; page-break-inside: avoid; border-inline-start: 3px solid #cfe08a; padding-inline-start: 12px; margin: 4px 0; }
  .ss-tag { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #6a7a3a; font-weight: 700; padding-top: 4px; }
  .ss .ex:first-of-type { padding-top: 2px; }

  footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #eef0f4; color: #a2a8b6; font-size: 11px; text-align: center; }
</style></head>
<body><div class="doc">
  <header>
    <div class="kicker">openGym</div>
    <h1>${esc(title)}</h1>
    ${sub ? `<div class="sub">${sub}</div>` : ''}
  </header>
  ${week}
  ${body}
  <footer>${esc(t('Made with openGym'))} · opengym.ch</footer>
</div></body></html>`
}


// Guide URLs are plain strings, independent of the deleted upload subsystem.
function cleanUrl(raw: unknown) {
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s || s.length > 2048) return null
  if (!/^https?:\/\//i.test(s)) {
    if (/^[a-z0-9+.-]+:/i.test(s)) return null
    s = 'https://' + s
  }
  // Chrome's URL parser takes "https://not a url" and percent-encodes the spaces into the host,
  // so "not a url" typed into the link field was saved as a link (QA 1.3.9). The host has to
  // be one a browser could reach: no whitespace in what was typed, and a dotted name,
  // localhost or an IP address.
  const authority = /^https?:\/\/([^/?#]*)/i.exec(s)?.[1] || ''
  if (/\s/.test(authority)) return null
  let u
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname || u.username || u.password) return null
  if (!plausibleHost(u.hostname)) return null
  return u.href.length <= 2048 ? u.href : null
}

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i
function plausibleHost(host: string) {
  if (host.startsWith('[') && host.endsWith(']')) return true               // IPv6
  const h = host.replace(/\.$/, '').toLowerCase()
  if (h === 'localhost') return true
  const labels = h.split('.')
  // xn-- names are how the parser writes an international domain, so they pass as letters.
  return labels.length >= 2 && labels.every(l => LABEL.test(l))
}
