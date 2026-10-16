import { create } from 'zustand'
import type { AuthTransaction } from './sync-engine'
import { sanitizeAccent } from '../lib/accent'
import type { KeyValueStore, Platform } from '@opengym/contract/platform/adapters'
import { programmesSinceReset } from '@opengym/core/programme-sync'
import { DEFAULT_TEMPLATE_ID } from '@opengym/core/structuralBalanceTemplates'
import { healCustomEx, createExerciseIndex, type ExerciseIndex } from '@opengym/core/exercises'
import { documentGeneration } from './document-generation'

/** Verbatim legacy JSON includes unknown fields and partial historic records. */
export interface StoreDocument { [key: string]: any }
export const KEY = 'gym_state_v1'
const WC_DEFAULT = { steppers: true, setShortcuts: false, pairButtons: false, exerciseButtons: false, exerciseChips: true, swipeSets: true }

export const DEF: StoreDocument = {
  unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, soundOnSilent: false, timerFlash: false, timedSetOvertime: false, keepAwake: true, lang: 'en',
  theme: 'dark', accent: 'lime', body: 'male', targetW: null,
  bodyweight: [], routines: [], week: {}, dayPlan: {},
  // A note per day off (#261): { [iso]: { tag, text, _ts } } (lib/day-notes.js). A noted day is
  // excused from the missed-day nudge; each day merges on its own stamp (lib/sync-merge.js).
  dayNotes: {},
  // Body measurements (#82): one check-in per day, values in cm whatever the weight unit
  // (lib/measurements.js); merged across devices like weigh-ins (lib/sync-merge.js).
  measurements: [], measurementEnabled: null, customMeasurements: [],
  programmes: { version: 1, fork: 'wilky/1', definitions: [], cycles: [] },
  queue: null,   // a planner's floating week (lib/queue.js) — via the API, or by this rotation feature (below)
  // The in-app rotation's reusable definition — { id, sequence, label } (lib/rotation.js). Never
  // a live queue: it only ever feeds `queue`, and `queue.rotationId` says the pass is managed here.
  rotation: null,
  // null | 'week' | 'rotation' — which of the two scheduling screens Home/Plan show. A live
  // queue always wins regardless of this (scheduleModeOf, lib/rotation.js): the flag exists only
  // to keep Rotation selected, and the weekday grid hidden, from the moment it's chosen in
  // Settings/Plan through to the first routine being added — there's no queue yet to derive it from.
  scheduleMode: null,
  exWeights: {}, workouts: [], active: null, customEx: [], gifSize: 'full',
  // Stats activity heatmap metric. Profiles without this key continue to open on time.
  heatmapMetric: 'time',
  // How the active workout is laid out — 'cards' (one exercise at a time with Prev/Next),
  // 'list' (every exercise stacked and scrollable) or 'compact' (that stack stripped to just
  // names and set rows — no media, tags, notes, last-time or progression line). Purely
  // presentational: profiles written before this setting existed overlay onto DEF and keep the
  // 'cards' behaviour. beginWorkout copies the value onto s.active, so the header ⋮ menu can
  // override it for the running session without touching this saved default.
  workoutView: 'cards',
  // List and Compact fold a finished exercise into one line (Settings → Workout; #241). The
  // workout's Layout menu can flip it for the running session (s.active.collapseCompleted).
  collapseCompleted: false,
  // How the Library, the exercise picker and the muscle explorer show exercises — 'list' (rows
  // with a small thumbnail) or 'cards' (a grid of pictures with the name underneath). Switched
  // by the button in those headers (ExerciseViewToggle); older profiles overlay onto the list.
  exerciseView: 'list',
  // Which controls the workout screen shows besides the sets themselves. The default is the
  // lean layout: one "more" button per exercise and a menu on each set number. Every switch
  // brings one of the old always-visible button groups back (Settings → During a workout).
  wc: { ...WC_DEFAULT },
  // One-time hints already shown to this profile, synced so each shows once per person rather
  // than once per device: { swipeSets: true } after the first swipe-on-sets nudge (Workout.jsx).
  hints: {},
  // effort: which per-set effort scale is logged — 'none' | 'rir' | 'rpe'. null, not 'none', so
  // that a profile which never chose (loaded state is overlaid on DEF, on every path: local,
  // server pull, backup import) still falls back to the `showRir` boolean this replaced and
  // keeps the column it had. See effortOf.
  // nudge/tone: the missed-workout nudge (lib/nudge.js), opt-in, rides on the reminder.
  reminder: { on: false, time: '08:00', tz: null, nudge: false, tone: 'friendly' }, effort: null,
  // Equipment profiles (issue: filter Library/picker/routines by what you actually own —
  // e.g. "Home" vs "Gym" — building on the session-only equipment filter from issue #6).
  equipProfiles: [], activeEquipId: null, equipFilterOn: false,
  // Standing per-exercise notes, keyed by exercise id: the gym-specific facts that are true
  // every time you do the movement ("seat 4, pin 7"). Distinct from a routine's `note`, which
  // belongs to one exercise in one plan, and from a session note, which belongs to one day.
  exNotes: {},
  // Favourite exercise ids (issue #6) — sorted to the top of the picker/Library. Personal, so
  // it syncs with the profile but is never part of a shared plan bundle (lib/favourites.js).
  favEx: [],
  // First day of the week as a getDay() index — 1 Monday, 0 Sunday. Monday is the default so
  // every profile written before this setting existed keeps the week it has been looking at.
  // See lib/format.js: nothing reads this field directly, everything goes through the helpers.
  weekStart: 1,
  // Decimals on displayed weights: 1 by default, 2 for anyone loading quarter plates or
  // microplates (issue #139). Display only — nothing is stored or rounded differently.
  wdec: 1,
  // Cardio speed shown in 'kmh' or 'mph'. null follows the weight unit (lb reads mph). Display
  // only as well: every speed is stored in km/h (lib/speed.js).
  speedUnit: null,
  // Per-exercise bar weight overrides, keyed by exercise id, in the profile unit (see
  // lib/bar.js). Personal equipment, so it syncs with the account but never travels in a
  // shared plan. Logged weights stay the total — this only feeds the plate math.
  barWeights: {},
  // Plate inventory, per unit: { lb: { 45: 1, 35: 1, …, _ts }, kg: { … } } — pairs of each size
  // you own (lib/plates.js), stamped with when the list was last changed so a sync keeps the
  // later one (lib/sync-merge.js). Kept per unit: a 45 lb plate is not a 20.4 kg one, so a unit
  // switch shows the other unit's inventory instead of converting this one. Absent for a unit,
  // or a list with no sizes = the standard set, plenty of each. Display only, like barWeights.
  plates: {},
  // How an exercise is plate-loaded when the equipment does not say, keyed by exercise id:
  // { kind: 'pairs' | 'single' | 'none' | null, _ts } (lib/plates.js loadKindFor). A plate-loaded
  // leg press is 'single'; a barbell you never load plates on is 'none'. Absent or null = derived
  // from the equipment. Stamped like the plate list, for the same reason.
  loadKind: {},
  // What a dumbbell or kettlebell weight means, keyed by exercise id: { mode: 'each' | 'total' |
  // null, _ts } (lib/dumbbells.js). Absent or null = as entered, counted once, which is how every
  // set was read before the choice existed. A routine slot can say its own (cfg.dbLoad).
  dbLoad: {},
  // The dumbbells you own, per unit: { kg: { weights: [3, 6, 8, …], _ts }, lb: { … } }
  // (lib/dumbbells.js). Single bells, lightest first. Kept per unit and stamped like the plates;
  // absent or empty = no list, and dumbbell lifts step by their increment as before.
  dumbbells: {},
  // Gym check-in cards (see views/CheckIn.jsx). Each is a membership
  // code shown as a QR/barcode at the gym's turnstile — added by typing it, importing a photo
  // of the card, or scanning it. We only ever keep the code's VALUE, never a photo: the image
  // is regenerated from `value` every time it's shown (lib/qr.js). `fmt` is the barcode symbology
  // ('qrcode' | 'ean13' | 'code128' | … — lower-cased BarcodeFormat) so it renders as the same
  // kind of code the gym issued. Just data, so it syncs and backs up like everything else.
  //   [{ id, label, value, fmt }]
  gymCards: [],
  // The card the check-in screen last settled on, so it reopens where you left it (handy when
  // you have more than one gym). Holds a gymCards id, or null before any card exists / is chosen;
  // a stale id (card since removed) is simply ignored by the view.
  lastGymCardId: null,
  // Whether the check-in feature is on at all (Settings toggle). Off hides the Home
  // card and the /checkin route; the saved gymCards stay so turning it back on restores them.
  // Defaults on; an older profile without the key reads as on (`!== false`).
  checkIn: true,
  // Whether the body-weight summary card is shown on Home. Off only hides that card: existing
  // entries, Stats, imports and the separate pre-workout weigh-in flow keep working.
  // Defaults on; an older profile without the key reads as on (`!== false`).
  showWeightCard: true,
  // Whether Start opens the quick weigh-in first (sheets.jsx startFlow, issue #137). Off starts
  // the session straight away; weight can still be logged from Home/Stats. On here, so an
  // older profile without the key reads as on (`!== false`) and keeps the step it had; a profile
  // started from nothing begins with it off (freshState below, v1.3.11): most people weigh in at
  // home in the morning, not at the gym, and the step cost a tap every workout.
  weighIn: true,
  // The connection banner at the top (components/SyncBanner.jsx, #369/#330). Off hides it; a
  // stuck sync then shows as a dot on Home instead. Defaults on; an older profile without the
  // key reads as on (`!== false`).
  connStatus: true,
  // Whether "Share as image" puts this session's muscle map on the card (sheets.jsx
  // ShareWorkoutImage, #453). On by default; absent reads as on (`!== false`).
  shareMap: true,

  connLocal: true,
  // Where a planned session's reps come from (Settings → During a workout, lib/session-start.js):
  // 'plan' opens at the routine's own sets × reps and lets history and progression decide the
  // weight; 'last' carries the reps over from the last session, the way it always worked before.
  // Absent reads as 'plan' too, which is what the MCP bridge sees on a raw state file.
  startFrom: 'plan',
  // Per-language choice for translated exercise names: whether the original English name is
  // shown in parentheses next to the translation. Map { '<lang>': boolean }; a missing key
  // (any profile written before this setting existed) reads as shown.
  enParens: {},
  // Per-language choice for translated exercise names: whether the translation is replaced
  // entirely by the original English name. Independent of enParens and keyed by the same base
  // language, so e.g. Italian can keep its parens while German pins names to English. Map
  // { '<lang>': boolean }; a missing key reads as off (translation shown as usual).
  enOnly: {},
  // What the line under an exercise holds today's rows against (#173, views/Workout.jsx): 'last'
  // is the last time in that routine, 'best' the best set of the exercise ever logged. Tapping
  // the line switches it. Absent reads as 'last', the line as it always was.
  logRef: 'last',
  // Structural Balance (views/StructuralBalance.jsx): which built-in ratio template is active,
  // and per-role exercise overrides keyed by `${templateId}:${roleId}` — see
  // lib/structuralBalance.js's overrideKey(). An override (`{ id, _ts }`, `id: null` once
  // cleared) replaces that role's curated exercise-id whitelist with a single user-chosen
  // exercise id; the stamp is what lets a sync keep the choice made last (lib/sync-merge.js).
  balanceTemplate: DEFAULT_TEMPLATE_ID, balanceOverrides: {},
}
export const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o))

// First run on a device whose language renders right-to-left starts in that language
// rather than English; the boot script in index.html mirrors this check for the
// pre-paint direction. The choice is persisted like any other setting once the user
// picks a language.
const detectedLang = () => 'en' // English-only ruling; saved language fields remain verbatim.

// A copy started from nothing on this device. `langAuto` marks its language as one nobody has
// picked yet, so the instance's DEFAULT_LANG or the browser's language may set it
// (lib/default-lang.js, #303); picking one in Settings clears it. DEF does not carry the mark:
// merged under a saved copy it would claim that every existing profile never chose.
export function freshState() {
  const s = clone(DEF)
  s.lang = detectedLang()
  s.langAuto = true
  s.weighIn = false
  // Exercise animations: Small (v1.3.11), a thumbnail beside the exercise name that a tap opens,
  // so the first set is on screen without scrolling. DEF stays 'full' for a profile saved before.
  s.gifSize = 'mini'
  return s
}

// A copy that starts over on this device: Reset everything, or another account signing in here.
// It is a new profile like freshState's (weigh-in off, small animations), but in the language
// already on screen, and still marked as never picked when it never was.
export function restartedState(cur?: StoreDocument | null) {
  const s = freshState()
  if (cur?.lang) { s.lang = cur.lang; s.langAuto = cur.langAuto === true }
  return s
}

export function loadState(kv: KeyValueStore) {
  try {
    const raw = kv.get(KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      const s = sanitizeAccent(Object.assign(clone(DEF), saved))
      if (!saved.lang) s.lang = detectedLang()
      return s
    }
  } catch (e) { /* ignore */ }
  return freshState()
}

// Whether a copy holds anything of its own worth keeping over another: workouts, routines,
// weigh-ins and custom exercises. A custom exercise is all a new guest may have made — with its
// photo or video, which the server counts as unreferenced until the state that names it lands —
// so a profile created from such a copy takes it at once, like one holding a workout.
export const hasData = (st: StoreDocument) => !!((st.workouts || []).length || (st.routines || []).length || (st.bodyweight || []).length || (st.customEx || []).length || (st.measurements || []).length || (st.programmes?.definitions || []).length || (st.programmes?.cycles || []).length)

// Decide whether a pulled account state may replace the local saved state. A local active workout
// is deliberately carried forward: the server stores completed/saved state, while the in-progress
// session belongs to the device that is currently running it.
// A clean unforked client may omit the fork's block. Omission is not a deletion.
export function adoptedState(local: StoreDocument, remote: StoreDocument) {
  const next = sanitizeAccent(Object.assign(clone(DEF), remote))
  if (!Object.prototype.hasOwnProperty.call(remote, 'programmes') && local.programmes) {
    const at = Number(remote.resetAt) || 0
    next.programmes = programmesSinceReset(local.programmes, remote.resetIds || at > (Number(local.resetAt) || 0) ? at : 0, remote.resetIds)
  }
  return next
}

export function restoredStateFor(local: StoreDocument, remote: StoreDocument | null | undefined, dirty = false) {
  if (!remote || (hasData(local) && (dirty || (remote._ts || 0) < (local._ts || 0)))) return null
  const next = adoptedState(local, remote)
  if (local.active) next.active = local.active
  return next
}


export interface InitialStoreState {
  S: StoreDocument
  index: ExerciseIndex
  user: { id: string; [key: string]: unknown } | null
  ready: boolean
  config: Record<string, unknown> | null
  linkCode: unknown
}
/** W07 composes sync metadata/actions around this initializer; no writes during hydration. */
export function initialStoreState(kv: KeyValueStore): InitialStoreState {
  const S = loadState(kv)
  S.customEx = healCustomEx(S.customEx)
  let user: InitialStoreState['user'] = null
  try { user = JSON.parse(kv.get('gym_user') || 'null') || null } catch { /* blocked/corrupt storage */ }
  return { S, index: createExerciseIndex(S.customEx), user, ready: false, config: null, linkCode: null }
}
export interface StoreState extends InitialStoreState {
  /** Ephemeral editor identity; never included in the persisted document. */
  documentInstance?: number
  beginAuthTransaction?: () => Promise<AuthTransaction>
  [key: string]: any
  update(mut: (draft: StoreDocument) => void, push?: boolean, options?: {durable?: boolean}): unknown
}
// No browser I/O at import. W01 injects the shell before rendering; W07 replaces update
// with its stamped persistence action through useStore.setState, preserving the public API.
export const useStore = create<StoreState>((set, get) => ({
  S: freshState(), index: createExerciseIndex(), user: null, ready: false, config: null, linkCode: null,
  async beginAuthTransaction() { throw new Error('Sync engine has not been initialized') },
  update(mut, _push, options) {
    if (options?.durable) throw new Error('Saved profile is not initialized')
    const S = clone(get().S)
    mut(S)
    S.customEx = healCustomEx(S.customEx)
    set({ S, index: createExerciseIndex(S.customEx) })
  },
}))
export function initializeStore(platform: Platform): InitialStoreState {
  const state = initialStoreState(platform.kv)
  // Explicit replacements have a durable editor generation, so a timer can
  // distinguish identical sessions after replacement and still survive reload.
  let documentInstance = (useStore.getState().documentInstance ?? 0) + 1
  try { documentInstance = documentGeneration(platform.kv.get('gym_state_wid'), platform.kv.get('gym_state_instance')) ?? documentInstance } catch { /* storage recovery remains available */ }
  useStore.setState({ ...state, documentInstance })
  return state
}
