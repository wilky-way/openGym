/**
 * openGym state document + /api/data protocol — frozen draft contract.
 * Shapes for persisted state and whole-document synchronization.
 * This file describes types; runtime modules implement validation and synchronization.
 *
 * Conventions
 *  - Every object that the app may extend carries `[k: string]: unknown` — unknown fields MUST
 *    round-trip (server keepUnknown for old writers, tolerant reads everywhere). Do not strip.
 *  - Change detection is JSON.stringify equality, so KEY ORDER IS SIGNIFICANT. A serializer that
 *    reorders keys changes sync behaviour.
 *  - `// UNSURE:` marks shapes inferred from a few call sites only.
 */

// ───────────────────────────── primitives ─────────────────────────────

/** ms since epoch. All sync clocks are these, compared numerically. */
export type Stamp = number
/** 'YYYY-MM-DD' local date. */
export type ISODate = string
export type Unit = 'kg' | 'lb'
export type ExerciseId = string
export type RoutineId = string

// ───────────────────────────── clocks ─────────────────────────────

/** Per-field edit clocks on an entry (stampEntry): field name → stamp of its last change (incl. removal). */
export type FieldClocks = Record<string, Stamp>

/**
 * Undo marker for one field: pending `[base, del]` (set by an Undo), completed `[base, del, at]`
 * once the Undo's own stamp is known. `base` = field stamp before the removal, `del` = removal stamp.
 */
export type UndoMark = [base: Stamp, del: Stamp] | [base: Stamp, del: Stamp, at: Stamp]

/** Mixed into every per-entry-clocked record (workouts, routines, customEx, equipProfiles, gymCards, programme records). */
export interface EntryClocks {
  /** Last edit of the entry as a whole. Absent on: live-finished workouts (until edited), seed/template routines, pre-stamp data. */
  _ts?: Stamp
  /** Per-field clocks. */
  _f?: FieldClocks
  /** Per-field Undo markers. Client-only semantics; server copies but never interprets except settleMarks. */
  _u?: Record<string, UndoMark>
}

/**
 * Setting clocks. Keys:
 *  - a top-level whole-value setting name, e.g. 'restSec', 'queue', 'reminder', 'coach', any unknown key
 *  - '<perKey>.<sub>' for PER_KEY maps: 'week.3', 'dayPlan.2026-10-08', 'exNotes.<exId>', 'barWeights.<exId>'
 *  - 'routineOrder' (pseudo key: order of `routines`)
 * Never '_wid' / '_wids' (server deletes those).
 */
export type EditedMap = Record<string, Stamp>

/** Same keys as EditedMap; Undo markers for settings (client only). */
export type UndoneMap = Record<string, UndoMark>

/** Lists that carry tombstones, and how an entry is keyed. */
export type DeletableList =
  | 'workouts'      // key: workout.id ?? `${d}|${start}`
  | 'routines'      // key: id
  | 'customEx'      // key: id
  | 'bodyweight'    // key: d
  | 'measurements'  // key: d
  | 'gymCards'      // key: id
  | 'equipProfiles' // key: id
  | 'favEx'         // key: the exercise id string

/**
 * Tombstones. Value > 0: removed at that stamp. Value < 0: added back at |value|.
 * Merge per key: larger |v| wins; equal |v| → negative wins. ≤ 5000 keys per list (oldest |v| evicted).
 * Keys are String(entryKey).
 */
export type DeletedMap = Partial<Record<DeletableList, Record<string, Stamp>>>

/** Names wiped by "Reset everything" (≤ 20000 per field). */
export interface ResetIds {
  workouts?: string[]        // workoutKey
  routines?: string[]
  customEx?: string[]
  bodyweight?: string[]      // NB: `${d}|${t ?? ''}` — differs from the tombstone key (d)
  measurements?: string[]    // `${d}|${t ?? ''}`
  gymCards?: string[]
  equipProfiles?: string[]
  favEx?: string[]
  exNotes?: string[]         // map keys
  barWeights?: string[]
  balanceOverrides?: string[]
  loadKind?: string[]
  plates?: string[]
  dbLoad?: string[]
  dumbbells?: string[]
  dayNotes?: string[]
  programmeDefinitions?: string[]
  programmeCycles?: string[]
}

export interface UnitSet {
  /** Stamp of the unit switch; decides which unit survives a merge. */
  at: Stamp
  /** false = label-only switch (numbers were already in the new unit): other copies relabel instead of converting. */
  convert: boolean
}

// ───────────────────────────── server-only notes (never sent to clients) ─────────────────────────────

/** `_unstamped`: what the server stamped for the last push of a non-stamping writer. */
export interface UnstampedNote {
  /** fingerprint(writer's `edited` as sent) — `${len}.${fnv1a36}.${djb2_36}` or 'none'. */
  fp: string
  /** setting key → stamp the server gave it */
  ed?: Record<string, Stamp>
  /** `${list}|${id}` → field → stamp the server gave it */
  f?: Record<string, Record<string, Stamp>>
}

/**
 * `_prior`: per field, hashes (`${len}.${fnv1a36}` of JSON, 'u' for undefined) of up to 6 earlier
 * values; insertion order = recency; ≤ 5000 keys. Keys: setting name, '<perKey>.<sub>',
 * or `${list}|${id}|${field}` for entry fields.
 */
export type PriorNote = Record<string, string[]>

// ───────────────────────────── entities ─────────────────────────────

/** One row of a logged/active exercise. All optional; legacy rows have only w/r/done. */
export interface WorkoutSet {
  w?: number               // weight, in doc unit
  r?: number               // reps (rest-pause: total incl. clusters)
  sec?: number             // hold time
  min?: number             // cardio minutes
  km?: number
  dist?: number
  speed?: number           // stored km/h
  rir?: number
  rpe?: number
  note?: string
  done?: boolean
  at?: Stamp               // when ticked
  warmup?: boolean         // legacy; `phase` wins
  phase?: 'warmup' | 'work' | string
  type?: 'straight' | 'dropset' | 'restpause'
  drops?: { w: number; r: number; [k: string]: unknown }[]
  clusters?: { r: number; restSec: number; [k: string]: unknown }[]
  failure?: true
  /** Per-side set: L and R each carry their own row fields (incl. type/drops). */
  sides?: { L: WorkoutSet; R: WorkoutSet }
  // live-session only (stripped by finishedRow, may appear in `active`):
  planSec?: number
  weightOrigin?: unknown   // UNSURE: shape
  [k: string]: unknown
}

export interface WorkoutEntry {
  id: ExerciseId
  sets: WorkoutSet[]
  topW?: number | null
  /** UNSURE: session target (sets/reps/repsMin/rir/rpe/pct/slotId…), not the authored SetTarget. */
  target?: Record<string, unknown> | null
  rid?: RoutineId            // routine this entry came from
  series?: string            // programme series key
  occurrenceId?: string      // programme occurrence instanceId
  weekIndex?: number
  deload?: Record<string, unknown>
  noProg?: true
  planned?: unknown          // UNSURE: routine prescription snapshot at session start
  sg?: string | number       // superset group  // UNSURE: type
  muscleSnapshot?: Record<string, unknown>
  note?: string
  notePin?: true
  [k: string]: unknown
}

export interface MediaRef {
  hash: string               // sha-256 hex (64)
  kind?: 'image' | 'video' | string
  mime?: string
  size?: number
  width?: number
  height?: number
  at?: Stamp
  [k: string]: unknown
}

export interface Workout extends EntryClocks {
  /** Normally present; legacy workouts may lack it and are keyed `${d}|${start}`. */
  id?: string
  d: ISODate
  start: Stamp
  end?: Stamp
  routineIds?: RoutineId[]
  routineId?: RoutineId | null   // legacy mirror of routineIds[0]
  programmeInstance?: { cycleId: string; instanceId: string; [k: string]: unknown }
  name?: string
  bw?: number | null
  entries: WorkoutEntry[]
  prs?: ExerciseId[]
  vol?: number
  excludeFromProgression?: boolean
  note?: string
  media?: MediaRef[]
  [k: string]: unknown
}

/** One exercise slot of a routine. */
export interface RoutineExercise {
  /** Absent only for programme "open" slots. Duplicates allowed within a routine. */
  id?: ExerciseId
  sets?: number
  reps?: number | 'max'
  repsMin?: number
  repsMax?: number
  weight?: number
  mode?: 'reps' | 'time' | 'cardio'
  sec?: number
  min?: number
  speed?: number
  bodyweight?: boolean
  prog?: string              // e.g. 'off'  // UNSURE: enum
  inc?: number
  deloadFactor?: number
  note?: string
  warmupSets?: unknown       // UNSURE
  restSec?: number
  side?: unknown             // UNSURE: per-side flag
  intensifier?: unknown      // UNSURE
  sg?: string | number
  pyramid?: (number | 'max')[]
  pyramidRest?: number[]     // UNSURE
  pyramidWeight?: number[]
  dbLoad?: 'each' | 'total' | null
  // programme-authored (retained across writers that omit them — authoredPrescriptionFields):
  slotId?: string
  slotScope?: 'session' | string
  setTargets?: SetTarget[]
  instructions?: string
  open?: true
  label?: string
  target?: SetTarget & Record<string, unknown>
  setRepsMin?: (number | null)[]
  tm?: { key: string; percentages: number[]; reference?: string; [k: string]: unknown }
  sourcePrescription?: unknown
  importNeedsPrescription?: true
  [k: string]: unknown
}

/** Authored effort target: only these keys are valid in definitions (validateSetTarget). */
export interface SetTarget {
  rir?: number   // 0..10
  rpe?: number   // 0..10
  pct?: number   // > 0
}

export interface RoutineProgrammeLink {
  cycleId: string
  instanceId: string
  weekIndex: number
  ordinal: number
  series: string
  weekId?: string
  orderIndex?: number
  fromWeekIndex?: number
  inserted?: true
  [k: string]: unknown
}

export interface Routine extends EntryClocks {
  id: RoutineId
  name: string
  ex: RoutineExercise[]
  excludeFromProgression?: boolean
  prog?: string
  deload?: { setsFactor: number; loadFactor: number; from: string; [k: string]: unknown }
  /** Owned by a running programme cycle. */
  programme?: RoutineProgrammeLink
  /** Ownership ended (cycle archived/finished). */
  programmeHistory?: { cycleId: string; series: string }
  [k: string]: unknown
}

export interface CustomExercise extends EntryClocks {
  id: ExerciseId
  n: string                  // name
  custom: true               // healed on every load
  eq?: string
  bp?: string
  tg?: string
  sm?: string[]
  primaries?: string[]
  secondaries?: string[]
  muscleGroups?: string[]
  media?: MediaRef
  url?: string
  [k: string]: unknown
}

export interface EquipProfile extends EntryClocks {
  id: string
  name: string
  equipment: string[]
  accV?: number
  [k: string]: unknown
}

export interface GymCard extends EntryClocks {
  id: string
  label: string
  value: string
  fmt: string                // 'qrcode' | 'ean13' | 'code128' | …
  [k: string]: unknown
}

/** One per day. `t` is its edit clock (later wins). */
export interface BodyweightEntry {
  d: ISODate
  w: number
  t?: Stamp
  [k: string]: unknown
}

/** One check-in per day; circumferences always cm. */
export interface MeasurementEntry {
  d: ISODate
  t?: Stamp
  neck?: number | null
  shoulders?: number | null
  chest?: number | null
  waist?: number | null
  hips?: number | null
  upperArmLeft?: number | null
  upperArmRight?: number | null
  forearmLeft?: number | null
  forearmRight?: number | null
  thighLeft?: number | null
  thighRight?: number | null
  calfLeft?: number | null
  calfRight?: number | null
  bodyFat?: number | null
  other?: { id: string; name: string; value: number | null }[]
  [k: string]: unknown
}

// ───────────────────────────── stamped maps (value carries its own _ts) ─────────────────────────────

/** key `${templateId}:${roleId}`; cleared = { id: null, _ts }. */
export type BalanceOverrides = Record<string, { id: ExerciseId | null; _ts?: Stamp; [k: string]: unknown }>
/** key exerciseId. */
export type LoadKindMap = Record<string, { kind: 'pairs' | 'single' | 'none' | null; _ts?: Stamp; [k: string]: unknown }>
/** key unit; inner keys = plate size → pair count, plus _ts. Inventory of one unit merges whole. */
export type PlatesMap = Partial<Record<Unit, { _ts?: Stamp; [size: string]: number | undefined }>>
/** key exerciseId. */
export type DbLoadMap = Record<string, { mode: 'each' | 'total' | null; _ts?: Stamp; [k: string]: unknown }>
/** key unit. */
export type DumbbellsMap = Partial<Record<Unit, { weights: number[]; _ts?: Stamp; [k: string]: unknown }>>
/** key ISODate; cleared = { _ts }. */
export type DayNotesMap = Record<ISODate, { tag?: 'sick' | 'travel' | 'rest' | 'injured' | string; text?: string; _ts?: Stamp }>

// ───────────────────────────── scheduling ─────────────────────────────

export interface Queue {
  ids: RoutineId[]
  since: Stamp
  startsOn: ISODate
  label: string
  strict?: true
  skipped?: RoutineId[]
  programmeCycleId?: string
  rotationId?: string
  [k: string]: unknown
}

export interface Rotation {
  id: string
  sequence: RoutineId[]
  label: string
  [k: string]: unknown
}

export interface Reminder {
  on: boolean
  time: string               // 'HH:MM'
  tz: string | null
  nudge?: boolean
  tone?: string              // 'friendly' | …
  [k: string]: unknown
}

// ───────────────────────────── programmes ─────────────────────────────

export interface ProgrammeSession {
  sessionTemplateId?: string
  routineSnapshot: {
    name?: string
    prog?: string
    ex: RoutineExercise[]
    [k: string]: unknown
  }
  [k: string]: unknown
}

export interface ProgrammeDay {
  key: string                // unique per week, e.g. 'd1'
  ordinal?: number
  sessions: ProgrammeSession[] // 1..8
  [k: string]: unknown
}

export interface ProgrammeWeek {
  index: number              // unique positive int, ≤ 64 weeks
  weekId?: string            // inserted weeks: `deload-<key>`
  orderIndex?: number
  fromWeekIndex?: number
  label?: string
  unit?: Unit
  mode?: 'train' | 'deload'
  rir?: number
  deload?: { setsFactor: number; loadFactor: number; from?: string; authored?: boolean; [k: string]: unknown }
  sourceWeek?: string
  days: ProgrammeDay[]       // 1..14
  [k: string]: unknown
}

export interface ProgrammeDefinition extends EntryClocks {
  id: string
  name: string
  short?: string
  unit: Unit
  weeks: ProgrammeWeek[]
  days?: { key: string; name?: string; [k: string]: unknown }[]
  source?: { kind?: string; library?: boolean; private?: boolean; [k: string]: string | boolean | null | undefined }
  rulesSupported?: boolean
  needsReview?: string[]
  instructions?: string
  end?: 'next' | string
  repeat?: unknown
  importWarnings?: string[]
  [k: string]: unknown
}

export type OccurrenceStatus = 'pending' | 'done' | 'skipped'

export interface ProgrammeOccurrence extends EntryClocks {
  instanceId: string          // `${cycleId}:${slot}`; unique within cycle
  weekIndex: number
  dayKey: string
  ordinal: number
  routineId: RoutineId
  routineName?: string
  /** 'done' is a CACHE derived from workouts (resolveOccurrences); never authoritative. */
  status: OccurrenceStatus
  date?: ISODate              // done: workout date; skipped: skip date
  skippedAt?: Stamp
  reason?: string
  pinnedOn?: ISODate
  sessionTemplateId?: string
  weekId?: string
  orderIndex?: number
  inserted?: true
  [k: string]: unknown
}

export type CycleStatus = 'active' | 'paused' | 'finished' | 'archived'

export interface ProgrammeCycle extends EntryClocks {
  id: string
  programmeId: string
  status: CycleStatus
  week1StartDate: ISODate
  lengthWeeks: number
  lap: number
  end: string
  cadence: { perWeek: number; [k: string]: unknown }  // 1..7
  since: Stamp
  startsOn: ISODate
  strict?: true
  notBefore: ISODate | null
  shiftDoneIds?: string[]
  /** Frozen copy of the definition at activation (weeks sorted; inserted weeks appended). */
  snapshot: ProgrammeDefinition
  weekIndex: number
  weekId?: string
  occurrences: ProgrammeOccurrence[]
  inserted: { weekId: string; afterWeekIndex: number; orderIndex: number }[]
  preApp?: unknown
  seriesId?: string
  tm?: Record<string, number>
  /** NEW (progression.ts): frozen at activation; the TM timeline is recomputed from it. `tm` becomes a display cache. */
  tmSeed?: Record<string, number>
  pausedOn?: ISODate
  completedOn?: ISODate
  archivedOn?: ISODate
  rollover?: { fromWeekId: string; fromWeekIndex: number; toWeekId: string; toWeekIndex: number; closedOn: ISODate }
  rolloverReviewed?: string
  /** Set by mergeProgrammes on the loser of concurrent activations; forces status 'archived'. */
  activationConflict?: string
  [k: string]: unknown
}

/** Root metadata is itself an entry (own _ts/_f) merged separately from its lists. */
export interface Programmes extends EntryClocks {
  version: 1 | number
  fork: 'opengym/1' | string
  definitions: ProgrammeDefinition[]   // union-only; unique string id
  cycles: ProgrammeCycle[]             // union-only; ≤1 active|paused after merge
  /** NEW (contract v1, ../sync/OFFLOAD.md): definitions moved to the library. Joined per id by max `at`. */
  offloaded?: Record<string, { versionId: string; at: Stamp }>
  /** NEW (OFFLOAD.md): explicit install marker; re-installation is proven only by installed.at > offloaded.at. */
  installed?: Record<string, { versionId: string; at: Stamp }>
  [k: string]: unknown
}

// ───────────────────────────── device-local (sent by client, stripped by server) ─────────────────────────────

/** In-progress workout. UNSURE: partial — the live session carries much UI bookkeeping. */
export interface ActiveWorkout {
  id: string
  d: ISODate
  start: Stamp
  routineIds: RoutineId[]
  programmeInstance?: { cycleId: string; instanceId: string }
  name: string
  bw: number | null
  cur: number
  entries: (WorkoutEntry & { [k: string]: unknown })[]
  workoutView?: 'cards' | 'list' | 'compact'
  collapseCompleted?: boolean
  note?: string
  backfill?: { replaceId?: string; [k: string]: unknown }
  editingWorkoutId?: string
  [k: string]: unknown
}

// ───────────────────────────── the document ─────────────────────────────

export interface StateDoc {
  // ── server bookkeeping (server-owned; client values ignored) ──
  _rev?: number
  _wid?: string               // 16 hex chars
  _wids?: string[]            // ≤ 50 ancestors, oldest first
  /** Stored only; never in GET/409 responses; discarded if a client sends it. */
  _unstamped?: UnstampedNote
  /** Stored only; never in GET/409 responses; discarded if a client sends it. */
  _prior?: PriorNote

  // ── copy-level clocks / records ──
  _ts?: Stamp
  edited?: EditedMap
  undone?: UndoneMap
  deleted?: DeletedMap
  resetAt?: Stamp             // monotone
  resetIds?: ResetIds
  unitSet?: UnitSet

  // ── entity lists ──
  workouts: Workout[]
  routines: Routine[]
  customEx: CustomExercise[]
  equipProfiles: EquipProfile[]
  gymCards: GymCard[]
  bodyweight: BodyweightEntry[]
  measurements: MeasurementEntry[]
  favEx: ExerciseId[]

  // ── own-merge maps ──
  exWeights: Record<ExerciseId, { w: number; d: ISODate; [k: string]: unknown }>
  programmes: Programmes

  // ── stamped maps ──
  balanceOverrides: BalanceOverrides
  loadKind: LoadKindMap
  plates: PlatesMap
  dbLoad: DbLoadMap
  dumbbells: DumbbellsMap
  dayNotes: DayNotesMap

  // ── per-key settings (edited['<key>.<sub>']) ──
  /** getDay() index '0'..'6' → routine ids (legacy: a single id). Absent/[] = rest. */
  week: Record<string, RoutineId[] | RoutineId | null>
  /** per-date override: routine id or 'rest'. */
  dayPlan: Record<ISODate, RoutineId | 'rest'>
  exNotes: Record<ExerciseId, string>
  barWeights: Record<ExerciseId, number>

  // ── whole-value settings (edited['<key>'], LWW) — defaults from DEF ──
  unit: Unit                                    // resolved by unitSet, not edited
  restSec: number                               // 90
  restPauseSec: number                          // 15
  sound: boolean
  soundOnSilent: boolean
  vibrateOnSilent: boolean
  vibrate?: boolean                             // absent = on
  timerFlash: boolean
  timedSetOvertime: boolean
  keepAwake: boolean
  lang: string
  langAuto?: true
  theme: 'dark' | 'light' | string
  accent: string                                // preset name or 'custom'
  accentCustom?: string                         // '#rrggbb', sanitized
  body: 'male' | 'female' | string
  targetW: number | null
  measurementEnabled: string[] | null
  customMeasurements: { id: string; name: string; [k: string]: unknown }[]
  queue: Queue | null
  rotation: Rotation | null
  scheduleMode: null | 'week' | 'rotation'
  gifSize: 'full' | 'mini' | string
  heatmapMetric: string                         // 'time'
  workoutView: 'cards' | 'list' | 'compact'
  collapseCompleted: boolean
  exerciseView: 'list' | 'cards'
  wc: Record<string, unknown>                   // workout controls; UNSURE: keys (WC_DEFAULT)
  hints: Record<string, boolean>
  reminder: Reminder
  effort: null | 'none' | 'rir' | 'rpe'
  showRir?: boolean                             // legacy; deleted when effort is chosen
  autoBackup: boolean
  activeEquipId: string | null
  equipFilterOn: boolean
  weekStart: 0 | 1 | number
  wdec: number
  speedUnit: null | 'kmh' | 'mph'
  lastGymCardId: string | null
  checkIn: boolean
  showWeightCard: boolean
  weighIn: boolean
  connStatus: boolean
  shareMap: boolean
  connLocal: boolean
  startFrom: 'plan' | 'last'
  enParens: Record<string, boolean>
  enOnly: Record<string, boolean>
  logRef: 'last' | 'best'
  balanceTemplate: string
  restSound?: string
  classicChime?: boolean
  oneRmFormula?: string
  exFigure?: string
  /** Coach state — one LWW value. UNSURE: inner shapes. */
  coach?: {
    consent: unknown
    profile: unknown
    cadence: 'off' | string
    lastReview: unknown
    log: unknown[]
    snapshots: unknown[]
    chat: unknown[]
    timings: unknown[]
    share?: boolean
    [k: string]: unknown
  }

  // ── device-local; present in client copies & PUT bodies, never stored ──
  active?: ActiveWorkout | null

  /** Open document: any other key is a whole-value setting and must round-trip. */
  [k: string]: unknown
}

/** What GET /api/data and a 409 return: stored doc minus server-only notes. */
export type ClientStateDoc = Omit<StateDoc, '_unstamped' | '_prior' | 'active'>

// ───────────────────────────── /api/data protocol ─────────────────────────────

export interface PutDataRequest {
  /**
   * Whole document. Must be a non-array object with at least one key other than _rev/_ts.
   * `workouts`/`routines`, if present and non-null, must be arrays (non-object items dropped).
   * `active` is accepted and stripped. Client `_rev/_wid/_wids/_unstamped/_prior` are ignored.
   */
  state: Partial<StateDoc> & Record<string, unknown>
  /** Revision the writer read. Absent or null ⇒ unconditional overwrite. Compared with `!==` (no coercion). */
  baseRev?: number | null
  /** Write id the writer read. Checked only when the key is present (`null` must match "no _wid"). Requires baseRev != null. */
  baseWid?: string | null
  /** true ⇒ writer stamps its own changes (the app). Anything else ⇒ server stamps for it. */
  stamped?: boolean
}

export interface PutDataOk {
  ok: true
  /** state._ts as stored, or null */
  ts: Stamp | null
  /** ALWAYS curRev + 1, even when the stored _rev is curRev + 2 (server corrected an unstamped writer). */
  rev: number
  wid: string
}

export interface ConflictResponse {
  error: 'conflict'
  rev: number                 // current stored revision (0 if none)
  state: ClientStateDoc | null
}

export interface ErrorResponse {
  error:
    | 'not signed in'          // 401
    | 'state required'         // 400
    | 'invalid state'          // 400 (shape, array, or nesting too deep)
    | 'invalid json'           // 400
    | 'body too large'         // 413 (> 5 MiB)
    | 'state unreadable'       // 503
    | 'cross-origin request refused' // 403
    | 'server error'           // 500
    | string
}

export type PutDataResponse =
  | { status: 200; body: PutDataOk }
  | { status: 409; body: ConflictResponse }
  | { status: 400 | 401 | 403 | 413 | 500 | 503; body: ErrorResponse }

export interface GetDataResponse {
  /** null when the profile has never been written. */
  state: ClientStateDoc | null
  rev: number                 // state?._rev || 0
}

export interface GetDataRevResponse {
  rev: number
  /** omitted when the stored doc has no _wid */
  wid?: string
}

// ───────────────────────────── client-local sync markers (localStorage) ─────────────────────────────

/** localStorage 'gym_sync' and per-tab meta.base. */
export interface SyncBase {
  rev: number
  /** the copy's _ts when it last matched the server; local `_ts > ts` ⇒ unsent change */
  ts: Stamp
  wid?: string
}

/** localStorage 'gym_stash' value: key `${serverBase || ''}|${uid}`. */
export type StashMap = Record<string, {
  server: string | null
  uid: string
  name: string
  at: Stamp
  state: StateDoc
  adopt?: true
}>

/** localStorage 'gym_adopt'. */
export interface AdoptMark {
  uid: string
  rejoined: boolean
  alwaysAsk: boolean
  /** entry names this copy held when the sign-in began */
  pre: { workouts: string[]; bodyweight: string[]; customEx: string[] }
}
