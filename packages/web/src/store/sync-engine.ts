import type { KeyValueStore, Platform } from '@opengym/contract/platform/adapters'
import { KEY, DEF, clone, freshState, restartedState, loadState, hasData, restoredStateFor, adoptedState, useStore, type StoreDocument, type StoreState } from './useStore'
import { t } from '@opengym/core/i18n-core'
import { healCustomEx, createExerciseIndex } from '@opengym/core/exercises'
import { advanceProgramme } from '@opengym/core/programme'
import { refillIfComplete } from '@opengym/core/rotation'
import { liftLegacy } from '@opengym/core/sync-legacy'
import { mergeStates, localExtras, stampChange, highestStamp, stampRestore, stampReplace, inUnitOf, keepReset, resetIdsOf, mergeResetIds, entryKey } from '@opengym/core/sync-merge'
import { convertStateUnit } from '@opengym/core/units'
import { countChanges, syncFingerprint } from '@opengym/core/sync-changes'
import { saveWorkoutEdit, deleteEditedWorkout } from '@opengym/core/session-edit'
import { sanitizeAccent } from '../lib/accent'
import { ux } from '../platform/ux'
import { documentGeneration } from './document-generation'
import { sha256HexJs } from '@opengym/core/sha256'
import { claimBrowserRecoveryReload } from '../platform/reload-guard'

export type ApiClient = (path: string, options?: RequestInit) => Promise<any>
export type AdoptionPrompt = (extras: NonNullable<ReturnType<typeof localExtras>>) => boolean | Promise<boolean>
export interface AuthenticatedUser { id: string; name?: string }
export interface AuthTransaction {
  commit(exchange: () => Promise<AuthenticatedUser>, valid: () => boolean, options?: { adopt?: boolean | { alwaysAsk?: boolean }; carrierUnchanged?: boolean }): Promise<AuthenticatedUser | null>
  cancel(): void
}
export type AcquireAuthLock = () => Promise<(() => void) | null>
export interface LeaveOptions { force?: boolean; valid?(): boolean }
export interface SyncServices {
  platform: Platform
  acquireAuthLock?: AcquireAuthLock
  acquireSyncLock?: AcquireAuthLock
  claimReload?(fingerprint: string): boolean
  api: ApiClient
  prompts: { askAddDeviceData: AdoptionPrompt; toast(message: string): void; stopTimers?(): void | Promise<void> }
}
export interface SyncActions {
  [key: string]: any
  S: StoreDocument
  user: StoreState['user']
  ready: boolean
  update(mut: (draft: StoreDocument) => void, push?: boolean): void
  pushState(): Promise<void>
  pullState(): Promise<void>
  boot(): Promise<void>
  beginAuthTransaction(): Promise<AuthTransaction>
}
const documentIndex = (a?: StoreDocument | null, b?: StoreDocument | null) => createExerciseIndex([...(b?.customEx || []), ...(a?.customEx || [])])
const mergeDocs = (a?: StoreDocument | null, b?: StoreDocument | null, options: any = {}): StoreDocument => mergeStates(a, b, options, documentIndex(a, b)) as StoreDocument
const linkTokenFromSearch = (search: string) => new URLSearchParams(search).get('link')
const guestAllowed = (config: Record<string, unknown> | null) => config?.allow_guest !== false
const staleResetTarget = Symbol('stale reset target')
const appliedReset = Symbol('reset response applied')
const staleLeaveData = Symbol('sign-out data changed')
const appliedLeave = Symbol('sign-out applied')
const staleDurableOwner = Symbol('durable owner changed')
const stalePushSnapshot = Symbol('replaced push snapshot')
const recoveryAdoption = Symbol('explicit recovery adoption')

/** One closure per store/tab; no shell access occurs at module import. */
export function createSyncEngine(set: (patch: Partial<StoreState>) => void, get: () => StoreState, services: SyncServices) {
  const api = services.api
  const durableStorage = services.platform.kv
  // A storage event is queued, not a lock. Check the actual owner synchronously on
  // every write (including metadata/removals), and before entering a producer.
  let cachedRecord: string | null | undefined
  let cachedLineage: string | null | undefined
  let cachedReadable = false
  const readFence = () => {
    let lineage: string | null | undefined
    let record: string | null | undefined
    let readable = false
    try {
      const raw = durableStorage.get(KEY)
      record = raw
      if (raw === cachedRecord) { lineage = cachedLineage; readable = cachedReadable }
      else {
        lineage = raw
        try { const S = JSON.parse(raw || 'null'); lineage = JSON.stringify([S?._wid ?? null, S?._rev ?? null]); readable = true } catch { /* preserve corrupt bytes before replacing */ }
        cachedRecord = raw; cachedLineage = lineage; cachedReadable = readable
      }
    } catch { /* preserveUnreadable retries before every primary replacement */ }
    const userRecord = durableStorage.get('gym_user')
    let userId: string | null = null
    try { userId = JSON.parse(userRecord || 'null')?.id ?? null } catch { userId = userRecord }
    let owner: string | null | undefined, ownerError: unknown
    try { owner = durableStorage.get('gym_owner') } catch (error) { ownerError = error }
    let syncRecord: string | null = null, dirty = false
    try { syncRecord = durableStorage.get('gym_sync'); dirty = durableStorage.get('gym_dirty') === '1' } catch { /* legacy first-sync metadata */ }
    return { owner, ownerError, user: userId, userRecord, record, readable, syncRecord, dirty,
      tag: durableStorage.get('gym_state_owner'), wid: durableStorage.get('gym_state_wid'), instance: durableStorage.get('gym_state_instance'), lineage }
  }
  const hydration = (() => {
    try { return readFence() } catch (error) { return {owner:undefined,ownerError:error,user:null,userRecord:null,record:undefined,readable:false,syncRecord:null,dirty:false,tag:null,wid:null,instance:null,lineage:undefined} }
  })()
  let partialCopy = (!!hydration.tag && hydration.tag !== (hydration.owner || '')) ||
    (!!hydration.user && !!hydration.owner && hydration.user !== hydration.owner)
  let recoveryFence: ReturnType<typeof readFence> | null = partialCopy ? hydration : null
  const fingerprintOf = (snapshot: ReturnType<typeof readFence>) => sha256HexJs(new TextEncoder().encode(JSON.stringify([
    services.platform.server.baseUrl(), snapshot.owner, snapshot.userRecord, snapshot.tag,
    snapshot.wid, snapshot.instance, snapshot.record,
  ])))
  let fence: ReturnType<typeof readFence> = hydration
  let constructing = true
  let pendingReplacementInstance: number | null = null
  let writeFrame: {uid:string|null;instance:number|undefined} | null = null
  let ownerTransition = 0
  let fenceBlocked = false
  let toldOwnershipUnavailable = false
  let toldOwnerMismatch = false
  const refreshFence = () => { fence = readFence(); fenceBlocked = false }
  const assertDurableOwner = () => {
    if (disposed) throw staleDurableOwner
    try {
      const now = readFence()
      if (now.owner === undefined) throw now.ownerError
      toldOwnershipUnavailable = false
      if (fence.owner === undefined && now.owner === (fence.user ?? fence.tag ?? null)
        && now.user === fence.user && now.tag === fence.tag && now.wid === fence.wid
        && now.instance === fence.instance && now.record === fence.record) {
        fence = now; seenOwner = now.owner; seenWid = now.wid
      }
      const peerWrite = !constructing && now.wid !== fence.wid && now.tag === (now.owner || '')
      const generationOnly = !constructing && now.instance !== fence.instance && now.wid === fence.wid && now.tag === fence.tag && now.record === fence.record
      const memoryUser = get().user?.id ?? null
      if (!fenceBlocked && now.owner === fence.owner && now.user === fence.user
        && (constructing || ownerTransition || partialCopy || !now.tag || now.tag === (now.owner || ''))
        && (now.tag === fence.tag || peerWrite)
        && (now.record === fence.record || peerWrite || now.record === undefined || fence.record === undefined)
        && (fence.record !== undefined || !now.readable || now.record === null)
        && (now.lineage === fence.lineage || peerWrite || now.lineage === undefined || fence.lineage === undefined)
        && (now.instance === fence.instance || peerWrite || generationOnly)
        && (constructing || ownerTransition || !now.user || !memoryUser || now.user === memoryUser)) {
        if (peerWrite || generationOnly) {
          fence = now
          const instance = documentGeneration(now.wid, now.instance)
          if (instance !== null && (instance !== get().documentInstance || pendingReplacementInstance === instance)) takeSnapshot(now, instance)
        }
        if (!ownerTransition && writeFrame && (writeFrame.uid !== (get().user?.id ?? null) || writeFrame.instance !== get().documentInstance)) {
          try { services.prompts.toast(t('The account or saved profile changed. Your change was not saved.')) } catch { /* refusal still stands */ }
          throw staleDurableOwner
        }
        return
      }
    } catch (error) {
      if (error === staleDurableOwner) throw error
      if (!constructing && !toldOwnershipUnavailable) {
        toldOwnershipUnavailable = true
        notify(t('Device ownership could not be read. Your saved data is kept; restore storage access and try again.'))
      }
      throw error
    }
    fenceBlocked = true
    if (!constructing && !toldOwnerMismatch) {
      toldOwnerMismatch = true
      sessionEpoch++
      clearTimeout(pushTm ?? undefined); pushTm = null; pushAgain = false; pushPending = false
      setHold(true)
      try { services.prompts.toast(t('The account or saved profile changed in another tab. Your change was not saved. Reloading the saved profile.')) } catch { /* refusal still stands */ }
      recoveryFence = readFence()
      const fingerprint = fingerprintOf(recoveryFence)
      setSync({recovery: {fingerprint}, held: true})
      if (services.claimReload?.(fingerprint)) services.platform.nav.reload?.()
    }
    throw staleDurableOwner
  }
  const recordMutation = (key: string, value: string | null) => {
    // Record only our intended mutation. A peer write immediately after ours must
    // not become authority for the remaining writes in this action.
    const next = {...fence}
    if (key === KEY) {
      next.record = value; next.lineage = value; next.readable = false
      try { const S = JSON.parse(value || 'null'); next.lineage = JSON.stringify([S?._wid ?? null,S?._rev ?? null]); next.readable = true } catch { /* corrupt-copy safety */ }
    } else if (key === 'gym_owner') { next.owner = value; next.ownerError = undefined }
    else if (key === 'gym_user') {
      next.userRecord = value
      try { next.user = JSON.parse(value || 'null')?.id ?? null } catch { next.user = value }
    } else if (key === 'gym_state_owner') next.tag = value
    else if (key === 'gym_state_wid') next.wid = value
    else if (key === 'gym_state_instance') next.instance = value
    else if (key === 'gym_sync') next.syncRecord = value
    else if (key === 'gym_dirty') next.dirty = value === '1'
    fence = next
  }
  const storage: KeyValueStore = {
    get: key => durableStorage.get(key), subscribe: listener => durableStorage.subscribe(listener),
    set(key, value) { assertDurableOwner(); durableStorage.set(key, value); recordMutation(key,value) },
    remove(key) { assertDurableOwner(); durableStorage.remove(key); recordMutation(key,null) },
  }
  let disposed = false
  let sessionEpoch = 0
  const AUTH_KEY = 'gym_auth_transaction'
  const AUTH_UNCHANGED_KEY = 'gym_auth_unchanged'
  let passiveAuth: {marker:string;user:StoreState['user'];owner:string|null;record:string|null;server:string;adoption:string|null;hold:boolean} | null = null
  let authHeld = false
  let authActive = false
  let committingAuth = false
  const authBlocked = () => {
    try { return authHeld || storage.get(AUTH_KEY) !== null } catch { return true }
  }
  const sessionOwner = () => { try { return storage.get('gym_owner') } catch { return undefined } }
  const session = () => ({ epoch: sessionEpoch, uid: get().user?.id ?? null, server: services.platform.server.baseUrl(), owner: sessionOwner() })
  const currentSession = (started: ReturnType<typeof session>) => {
    try { assertDurableOwner() } catch { return false }
    return !disposed && !authBlocked() && started.owner !== undefined &&
      (!started.uid || !started.owner || started.uid === started.owner) &&
      started.epoch === sessionEpoch && started.uid === (get().user?.id ?? null) &&
      started.server === services.platform.server.baseUrl() && started.owner === sessionOwner()
  }
  const listeners: (() => void)[] = []
  const listen = (target: Window | Document | null, event: string, handler: (event: any) => void) => {
    target?.addEventListener(event, handler)
    listeners.push(() => target?.removeEventListener(event, handler))
  }
  // A corrupt load must stay recoverable before the first replacing write (design safety exception).
  let unreadableRaw: string | null = null
  let unresolvedRead = true
  const readRecoverySource = () => {
    const raw = storage.get(KEY)
    if (raw) { try { JSON.parse(raw) } catch { unreadableRaw = raw } }
    unresolvedRead = false
  }
  try { readRecoverySource() } catch { /* resolve the read before any replacing save/delete */ }
  const recoveryPointer = `${KEY}_corrupt_key`
  const preserveUnreadable = () => {
    if (unresolvedRead) readRecoverySource()
    if (unreadableRaw === null) return
    if (new TextEncoder().encode(unreadableRaw).byteLength > 5 * 1024 * 1024) throw new Error('Unreadable profile exceeds the recovery-copy cap')
    const previous = storage.get(recoveryPointer)
    const prefix = `${KEY}.corrupt-${Date.now()}`
    let recoveryKey = prefix
    let suffix = 0
    // KV has no enumeration or atomic create: probe synchronously before every aside write.
    // A retry after a failed pointer write must also leave its earlier copy untouched.
    while (storage.get(recoveryKey) !== null) recoveryKey = `${prefix}-${++suffix}`
    storage.set(recoveryKey, unreadableRaw)
    storage.set(recoveryPointer, recoveryKey)
    if (previous && previous !== recoveryKey) storage.remove(previous)
    unreadableRaw = null
    notify(t('Saved data on this device could not be read. A recovery copy was kept before saving your changes.'))
  }
  const storageListeners: ((event: { key: string | null; newValue: string | null }) => void)[] = []
  const onStorage = (handler: (event: { key: string | null; newValue: string | null }) => void) => { storageListeners.push(handler) }
  listeners.push(storage.subscribe(key => {
    const event = { key, newValue: key === null ? null : storage.get(key) }
    for (const handler of storageListeners) {
      try { handler(event) } catch (error) { if (error !== staleDurableOwner) throw error }
    }
  }))
  const notify = (message: string) => { Promise.resolve().then(() => services.prompts.toast(message)).catch(() => {}) }
const SYNC_KEY = 'gym_sync'
// Which write of the saved copy this is: a tab finds another tab's write by it (persist, joinSaved).
const WID_KEY = 'gym_state_wid'
// Local editor generation; never included in the synced document or request.
const INSTANCE_KEY = 'gym_state_instance'
const storedInstance = () => documentGeneration(storage.get(WID_KEY), storage.get(INSTANCE_KEY))
const prepareDocumentInstance = () => {
  assertDurableOwner()
  const previous = storage.get(INSTANCE_KEY)
  const previousWid = storage.get(WID_KEY), previousTag = storage.get('gym_state_owner')
  const documentInstance = Math.max(get().documentInstance ?? 0, storedInstance() ?? 0) + 1
  const committed = `g${storedInstance() ?? get().documentInstance ?? 0}:${previousWid || 'legacy'}`
  let prepared = false, upgraded = false, tagged = false
  const rollback = () => {
    if (prepared && storage.get(INSTANCE_KEY) === String(documentInstance)) {
      if (previous === null) storage.remove(INSTANCE_KEY); else storage.set(INSTANCE_KEY, previous)
    }
    if (upgraded && storage.get(WID_KEY) === committed) {
      if (previousWid === null) storage.remove(WID_KEY); else storage.set(WID_KEY, previousWid)
    }
    if (tagged && storage.get(WID_KEY) === previousWid && storage.get('gym_state_owner') === (seenOwner || '')) {
      if (previousTag === null) storage.remove('gym_state_owner'); else storage.set('gym_state_owner', previousTag)
    }
  }
  try {
    // Keep the previous generation in the legacy marker for rollback. Peers
    // honor the newer reservation too, even if final publication later fails.
    if (!/^g\d+:/.test(previousWid || '')) {
      storage.set('gym_state_owner', seenOwner || ''); tagged = true
      storage.set(WID_KEY, committed); upgraded = true
    }
    storage.set(INSTANCE_KEY, String(documentInstance)); prepared = true
  } catch (error) { rollback(); throw error }
  return { documentInstance, rollback }
}
// Whose copy that write was: the owner (gym_owner) the writing tab held, '' for a guest's. A tab
// joins only a copy written under the owner it holds itself (joinSaved, syncFromSaved).
const WID_OWNER_KEY = 'gym_state_owner'
const DIRTY_KEY = 'gym_dirty'          // the saved copy owes the server a change
// An owed copy an older app (v1.3.9) left behind: its first sync stamps what it changed
// (lib/sync-legacy.js), holding the fingerprint that app last agreed on with the server.
const LEGACY_KEY = 'gym_legacy_owed'
const SYNCED_AT_KEY = 'gym_synced_at'  // when this device and the server last held the same copy
const SYNCED_FP_KEY = 'gym_synced_fp'

const STASH_KEY = 'gym_stash'

// A browser sign-out whose request never reached the server. The session cookie is HttpOnly, so
// only the server's answer to /api/logout takes it out of the browser; until that answer comes,
// boot sends the logout again instead of asking /api/me, which would sign the browser straight
// back in with no passkey or password. Any sign-in replaces the cookie and clears the mark.
const LOGOUT_OWED_KEY = 'gym_logout_owed'

const ADOPT_KEY = 'gym_adopt'
// Reads the mark with no argument, sets or clears it with one. Storage that cannot be read owes nothing.
function logoutOwed(on?: boolean) {
  try {
    if (on === undefined) return storage.get(LOGOUT_OWED_KEY) === '1'
    if (on) storage.set(LOGOUT_OWED_KEY, '1'); else storage.remove(LOGOUT_OWED_KEY)
  } catch { /* private mode with storage blocked */ }
  return false
}

const CHECK_MIN_MS = 3000    // rev checks closer together than this are the same event (focus + visibility)
const POLL_MS = 30000        // while the app is open and signed in, ask the server for its revision this often
     let pushTm: ReturnType<typeof setTimeout> | null = null

  let toldTooLarge = false
  let toldNoRoom = false   // the save itself was refused — said once per streak, like the above
  let pushing: any = null       // the PUT in flight, so a second push waits for it instead of racing it
  let pushAgain = false    // a push asked for while one was in flight — run once more after it
  let pulling: any = null       // the GET in flight, so two resume signals make one request
  let configFetch: any = null   // the /api/config in flight, so two callers make one request
  let pushPending = false  // a change made before boot's pull — pushed once boot is through
  let forceNext = false    // the next push replaces the server copy outright (reset)
  // A backup import's replace: pushed against the revision the import's check read (importRead),
  // so a change another device synced while the confirm was open is merged in, not wiped.
  let replaceRev: any = null
  let undispatchedIntent: { started: ReturnType<typeof session>; force: boolean; asReplace: any } | null = null
  let importRead: any = null    // what importConflict last read: { uid, state, rev }
  let lastCheck = 0
  let pollTm: ReturnType<typeof setTimeout> | null = null
  let offlineChanges = false

  let adoptHold = false    // a sign-in's adoption has not decided yet: no pull, no push (ADOPT_KEY)
  let adopting: any = null      // the adoptProfile in flight
  let rejoined = false     // the account signing in is the one this copy already belongs to (setUser)

  let fpOf: any = null

  let seenWid = (() => { try { return storage.get(WID_KEY) } catch { return null } })()
  let seenOwner = (() => { try { return storage.get('gym_owner') } catch { return null } })()
  // Another tab signed in or out under this one (the gym_owner storage event below): what this
  // tab holds is no copy of the new owner's, so it writes nothing until it has taken that owner's
  // saved copy as it is (takeSaved).
  let handedOver = false
  const staleUid = 'device-tab-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  // A copy that owes the server a change and was never written with a write id was last saved by
  // an app from before this one (v1.3.9), which stamped none of its settings, plan days or notes.
  // Noted now, before this app's first save writes a write id beside it.
  try {
    if (!seenWid && seenOwner && storage.get(DIRTY_KEY) === '1' && storage.get(KEY) && !storage.get(LEGACY_KEY)) {
      let fp = null
      try { fp = JSON.parse(storage.get(SYNCED_FP_KEY) || 'null') } catch { /* no fingerprint: the copy is kept aside instead */ }
      storage.set(LEGACY_KEY, JSON.stringify({ fp, owner: seenOwner }))
    }
  } catch { /* storage refused: the first sync merges it as before */ }
  const readLegacy = () => { try { return JSON.parse(storage.get(LEGACY_KEY) || 'null') || null } catch { return null } }
  const clearLegacy = () => { try { storage.remove(LEGACY_KEY) } catch { /* the next sync tries again */ } }

  let memoryAdopt: any = null
  let adoptWritePending = false
  const readAdopt = () => {
    if (adoptWritePending) return memoryAdopt
    try {
      const raw = storage.get(ADOPT_KEY)
      if (!raw) return null
      const mark = JSON.parse(raw)
      return mark && typeof mark.uid === 'string' && mark.uid && typeof mark.rejoined === 'boolean' &&
        (mark.alwaysAsk === undefined || typeof mark.alwaysAsk === 'boolean') &&
        ADOPT_FIELDS.every(f => Array.isArray(mark.pre?.[f]) && mark.pre[f].every((id: unknown) => typeof id === 'string'))
        ? mark : { incomplete: true }
    } catch { return memoryAdopt || { incomplete: true } }
  }
  const writeAdopt = (v: any) => {
    memoryAdopt = v
    adoptWritePending = true
    try {
      if (v) storage.set(ADOPT_KEY, JSON.stringify(v)); else storage.remove(ADOPT_KEY)
      adoptWritePending = false
    } catch { /* the original before/later split and hold remain in memory for retry */ }
    return !adoptWritePending
  }
  // The adoption owed by the account signed in now, if there is one.
  const adoptOwed = () => {
    const m = readAdopt(), u = get()?.user
    if (!m || !u) return null
    return m.incomplete ? { uid: u.id, rejoined: false, alwaysAsk: true, pre: preOf(get().S) } : m.uid === u.id ? m : null
  }
  // Sync held or not, and the screens told (`sync.held`, status 'held').
  const setHold = (on: any) => { adoptHold = on; if (get()?.sync) setSync({ held: on || authBlocked() }) }
  const invalidateAuth = () => {
    sessionEpoch++
    clearTimeout(pushTm ?? undefined); pushTm = null; pushAgain = false
    setSync({ held: true })
  }
  const quarantineAuth = () => {
    authHeld = true
    invalidateAuth()
    set({ user: null })
    try { storage.remove('gym_user'); storage.set(AUTH_KEY, 'quarantined') } catch { /* in-memory hold is authoritative until restart */ }
    notify(t('Sign-in was interrupted. Your saved data is kept; sign in again before syncing.'))
  }
  onStorage(event => {
    if (event.key !== AUTH_KEY && event.key !== null) return
    // A passive tab remembers its own session, never a document to replay over later edits.
    if (!authActive) {
      let marker: string | null = null
      try {
        marker = storage.get(AUTH_KEY)
        authHeld = marker !== null
        const user = get().user, owner = sessionOwner()
        if (marker?.startsWith('active-') && user && owner === user.id) passiveAuth = {
          marker, user, owner, record:storage.get('gym_user'), server:services.platform.server.baseUrl(),
          adoption:storage.get(ADOPT_KEY), hold:adoptHold,
        }
        else if (marker && !marker.startsWith('active-')) passiveAuth = null
      } catch { authHeld = true; passiveAuth = null }
      invalidateAuth()
      if (authHeld) set({ user: null })
      else {
        const prior = passiveAuth
        passiveAuth = null
        // Only a fresh durable pre-exchange cancellation/non-carrier completion proves
        // that the old session may resume without followSignIn's server-base prerequisite.
        try {
          if (prior && storage.get(AUTH_UNCHANGED_KEY) === prior.marker && !handedOver
            && prior.owner === sessionOwner() && prior.owner === seenOwner
            && prior.record === storage.get('gym_user') && prior.server === services.platform.server.baseUrl()
            && prior.adoption === storage.get(ADOPT_KEY) && prior.hold === adoptHold) {
            set({ user: prior.user })
            setSync({ held: adoptHold })
            return
          }
        } catch { /* no proof: retain the normal held/handoff behavior */ }
        setSync({ held: adoptHold }); followSignIn()
      }
    }
  })
  const beginAuthTransaction = async (): Promise<AuthTransaction> => {
    if (authActive || disposed) throw new Error('Another sign-in is already in progress')
    // Host lock spans all awaits, including token persistence and the response installing a cookie.
    if (!services.acquireAuthLock || !services.acquireSyncLock) throw new Error('Authentication lock is not configured')
    const unlock = await services.acquireAuthLock()
    if (!unlock) throw new Error('Another sign-in is already in progress')
    if (disposed || authActive) { unlock(); throw new Error('Another sign-in is already in progress') }
    const wasHeld = authBlocked()
    const id = 'active-' + staleUid + '-' + (++sessionEpoch)
    // Any completion proof predating this ceremony cannot authorize its passive tabs.
    try { storage.remove(AUTH_UNCHANGED_KEY); storage.set(AUTH_KEY, id) } catch (error) { unlock(); throw error }
    authActive = true; authHeld = true; invalidateAuth()
    // A native transport may await its keychain before dispatching a previously started PUT.
    // Drain such requests before installing another carrier; their responses are epoch-invalid.
    await Promise.allSettled([pushing, pulling].filter(Boolean))
    if (disposed) { quarantineAuth(); authActive = false; unlock(); throw new Error('Sign-in was interrupted') }
    let settled = false, exchanging = false
    const finish = () => { authActive = false; settled = true; unlock() }
    const cancel = () => {
      if (settled || exchanging) return
      try {
        if (wasHeld) quarantineAuth()
        else { storage.set(AUTH_UNCHANGED_KEY, id); storage.remove(AUTH_KEY); authHeld = false; setSync({ held: adoptHold }) }
      } catch { quarantineAuth() }
      finish()
    }
    // An explicitly non-carrier-changing account mutation cannot invalidate a different
    // owner on an error or stale reply. Release only our marker; never assign user/owner.
    const releaseUnchanged = () => {
      try {
        if (storage.get(AUTH_KEY) === id) {
          // This marker belongs to this locked ceremony, not to either profile.
          // Releasing it cannot assign an owner or change any profile bytes.
          if (wasHeld) durableStorage.set(AUTH_KEY, 'quarantined')
          else { durableStorage.set(AUTH_UNCHANGED_KEY, id); durableStorage.remove(AUTH_KEY) }
        }
        authHeld = storage.get(AUTH_KEY) !== null
        setSync({ held: authHeld || adoptHold })
      } catch (error) {
        authHeld = true
        setSync({ held: true })
        throw error
      }
    }
    return {
      cancel,
      async commit(exchange, valid, options = {}) {
        if (settled || exchanging) throw new Error('Sign-in transaction already settled')
        if (options.carrierUnchanged) {
          exchanging = true
          try {
            if (!valid()) return null
            const user = await exchange()
            const allowed = valid()
            if (disposed || storage.get(AUTH_KEY) !== id || !allowed) return null
            return user
          } finally { try { releaseUnchanged() } finally { finish() } }
        }
        if (!valid()) { cancel(); return null }
        exchanging = true
        try {
          const user = await exchange()
          if (disposed || storage.get(AUTH_KEY) !== id || !valid()) { quarantineAuth(); return null }
          // No await between assigning the owner and releasing the carrier hold.
          committingAuth = true
          try { get().setUser(user, options) } finally { committingAuth = false }
          storage.remove(AUTH_KEY)
          authHeld = false
          setSync({ held: adoptHold })
          return user
        } catch (error) {
          // Failed/aborted HTTP can still have installed HttpOnly auth; restoring is unprovable.
          quarantineAuth()
          throw error
        } finally { finish() }
      },
    }
  }
  const carrierApi = (started: ReturnType<typeof session>, path: string, options?: RequestInit, valid?: () => boolean): ReturnType<ApiClient> => {
    // Preserve the legacy request/promise timing when no carrier service is injected.
    if (!services.acquireSyncLock) {
      if (!currentSession(started) || (valid && !valid())) return Promise.reject(new Error('Authentication changed before sync dispatch'))
      return api(path, options)
    }
    return (async () => {
      // Shared leases cover delayed native keychain/transport dispatch in every window.
      let release: (() => void) | null
      try { release = await services.acquireSyncLock!() }
      catch (error) { if (valid) throw Object.assign(new Error('Authentication lock is not available', {cause:error}), {code:'auth-lock-unavailable'}); throw error }
      try {
        if (!release && valid) throw Object.assign(new Error('Authentication lock is not available'), {code:'auth-lock-unavailable'})
        if (!release || !currentSession(started) || (valid && !valid())) throw new Error('Authentication changed before sync dispatch')
        return await api(path, options)
      } finally { release?.() }
    })()
  }
  // The question is answered: sync as usual from here.
  const releaseAdopt = () => {
    // An unrecorded sign-in must not escape its hold, even after the question is answered.
    if (get()?.user && adoptWritePending && memoryAdopt) {
      throw Object.assign(new Error('Adoption could not be recorded; free some storage and try again'), { keepAdoptionHeld: true })
    }
    setHold(false)
    // Keep the pending marker until the decided copy is durable. In particular, a failed
    // state write must not make the saved guest copy look like a completed adoption.
    if (!get()?.user) writeAdopt(null)
  }
  const readStoredSync = () => { try { return JSON.parse(storage.get(SYNC_KEY) || 'null') || null } catch { return null } }
  const storedOwed = () => { try { return storage.get(DIRTY_KEY) === '1' } catch { return false } }

  /* Where the copy in memory stands with the server: the revision it descends from (`base`, as
     { rev, ts }) and whether it owes the server a change (`owed`). Both belong to the copy, per
     tab. The marker and the dirty flag in localStorage are shared by every tab of the browser:
     a tab left open used to quote the revision ANOTHER tab had just synced, so the server saw a
     current baseRev, took the stale copy without a 409, and the workout logged in the other tab
     was gone (#283); and a tab that owed nothing read another tab's failed push as its own,
     merged where it should have adopted, and brought back what the other tab had just deleted.
     Every copy this store puts in place records where it stands; storage is only where a copy
     loaded fresh (a new tab, a reload) learns it, which is why persist writes them beside it.
     A copy set on the store directly, not through persist, has nothing recorded yet: it takes
     what storage says the first time it is asked, and keeps that. */
  const meta = new WeakMap<StoreDocument, {base: any; owed: boolean}>()
  const metaOf = (S: any = get().S) => {
    let m = meta.get(S)
    if (!m) { m = { base: readStoredSync(), owed: storedOwed() }; meta.set(S, m) }
    return m
  }
  // The saved copy is not the one in memory: its last write was refused (storage full). The
  // marker and the dirty flag then must not describe the copy in memory, or a restart loads the
  // older saved copy as one in step with a newer revision, calls it synced, and its next push
  // (a conditional one that matches) deletes from the server everything it received meanwhile.
  // Until a write lands again the marker is left out (a restart merges, its first-sync path) and
  // the copy stays owed.
  let storeLag = false
  const saveMarker = (base: any) => {
    try {
      if (!base || storeLag) { storage.remove(SYNC_KEY); return }
      const v = JSON.stringify(base)
      // Unchanged, it is not written again: other tabs react to this key moving (see below).
      if (storage.get(SYNC_KEY) !== v) storage.set(SYNC_KEY, v)
    } catch { /* storage refused — the copy in memory still knows */ }
  }
  const saveOwed = (owed: any) => { try { if (owed || storeLag) storage.set(DIRTY_KEY, '1'); else storage.remove(DIRTY_KEY) } catch { /* as above */ } }
  // `wid`: the write id of the server's document at that revision (api/server.js PUT /api/data):
  // the same `rev` after the server went back in time names a different document.
  const writeSync = (rev: any, ts: any, wid?: string) => {
    const base = { rev, ts: ts || 0, ...(typeof wid === 'string' ? { wid } : {}) }
    meta.set(get().S, { ...metaOf(), base })
    saveMarker(base)
  }
  const dropSync = () => { meta.set(get().S, { ...metaOf(), base: null }); saveMarker(null) }
  const markOwed = (owed: any) => { meta.set(get().S, { ...metaOf(), owed }); saveOwed(owed) }
  // Whether anything here is still on its way to the server: a push that failed, one waiting in
  // the debounce or in flight, a change made while boot was pulling, or a copy changed since the
  // revision it descends from.
  const localChanged = (S: any = get().S) => { const { base } = metaOf(S); return !!base && (S._ts || 0) > (base.ts || 0) }
  // A sign-in whose question is still open (adoptHold, e.g. its GET failed) holds a copy that has
  // reached no server yet: with any data in it, it is owed, so a sign-out asks and keeps it aside
  // instead of wiping the guest's history and what was logged during the hold.
  const owesOwn = () => metaOf().owed || pushPending || pushTm !== null || !!pushing || localChanged()
  const owes = () => owesOwn() || (adoptHold && hasData(get().S))

  const statusOf = (x: any, user: any) => x.auth ? 'auth' : !user ? 'local' : x.offline ? 'offline' : x.lastError ? 'error' : x.held ? 'held' : x.pending ? 'pending' : 'ok'
  const sameError = (a: any, b: any) => (a && b ? a.status === b.status && a.code === b.code : a === b)
  const setSync = (patch: any) => {
    const cur = get().sync
    const next = { ...cur, ...patch }
    next.status = statusOf(next, get().user)
    if (Object.keys(next).some((k: any) => (k === 'lastError' ? !sameError(next[k], cur[k]) : next[k] !== cur[k]))) set({ sync: next })
  }
  const isNetworkError = (e: any) => e && e.status == null   // fetch itself failed, or gave up: no response at all
  const refused = (e: any) => e?.status === 401
  // The server answered: whatever was wrong with the connection is over.
  const reached = (extra: any = {}) => setSync({ offline: false, auth: false, lastError: null, ...extra })

  const failed = (e: any, extra: any = {}) => {
    const lastError = { status: e?.status ?? 0, code: e?.code || (e?.status === 401 ? 'auth' : isNetworkError(e) ? 'network' : 'http') }
    if (refused(e)) setSync({ auth: true, offline: false, lastError, ...extra })
    else if (isNetworkError(e)) setSync({ offline: true, lastError, ...extra })
    else setSync({ offline: false, lastError, ...extra })
  }
  // This device and the server hold the same copy: a push landed, a pull adopted, or a check found
  // that nothing moved on either side. The fingerprint is what signing out counts changes against.
  const confirmed = (S: any) => {
    const at = Date.now()
    try {
      storage.set(SYNCED_AT_KEY, String(at))
      if (fpOf !== S) { storage.set(SYNCED_FP_KEY, JSON.stringify(syncFingerprint(S))); fpOf = S }
    } catch { /* storage refused — only the count is lost */ }
    reached({ pending: false, lastSynced: at })
  }
  const readFingerprint = () => { try { return JSON.parse(storage.get(SYNCED_FP_KEY) || 'null') } catch { return null } }

  // Sync fingerprints include the configured API host or this browser deployment's subpath.
  const serverBase = () => {
    if (services.platform.server.baseUrl()) return services.platform.server.baseUrl()
    try { const page = new URL(services.platform.nav.href()); return page.origin !== 'null' ? page.origin + page.pathname.slice(0, page.pathname.lastIndexOf('/')) : null } catch { return null }
  }

  // `_ts` is when this device last changed the data — it decides which copy wins on the next

  // stamp it came with: re-stamping a read would make an unchanged copy look newer than a real
  // change made on another device, and push it over that change. A change is never stamped
  // before the revision it builds on: that stamp came from the clock of whichever device wrote
  // it, and with this clock behind, the change looked older than its own base — unchanged — and
  // a pull replaced it with the server's copy.
  /* Two tabs of one browser share the saved copy, and each writes its own copy over it whole. A
     change one tab saved and had not pushed (offline, the server down, a guest who never pushes)
     was gone as soon as the other tab saved anything, or the closed tab's finished workout was:
     no trace in storage, on the server or in the count of changes owed. And a second tab's pull
     wrote its `active: null` over the workout running in the first. So every write of the saved
     copy carries a write id (WID_KEY). A tab that finds another tab's write there joins that copy
     into its own first, the way two devices merge (joinSaved), and a tab told of one by the
     browser (the storage event below) takes it into memory straight away. The running workout
     belongs to the browser, not the tab: it is the saved copy's unless this change touched it. */
  const sameCopy = (a: any, b: any) => JSON.stringify({ ...a, _ts: 0 }) === JSON.stringify({ ...b, _ts: 0 })
  const readWid = () => { try { return storage.get(WID_KEY) } catch { return null } }
  const readOwner = () => { try { return storage.get('gym_owner') } catch { return null } }
  // The owner the saved copy was written under; null for a copy saved before this was recorded.
  const readWidOwner = () => { try { return storage.get(WID_OWNER_KEY) } catch { return null } }
  // The saved copy is the one this tab may join: written under the owner this tab holds. QA
  // 2026-10-06: a sign-out (or another account signing in) wrote its wiped copy while the owner
  // key still named the previous account, a second tab joined its whole in-memory copy into it,
  // and the next guest, or the next profile created there, got the previous account's history.
  const savedIsMine = () => {
    if (readOwner() !== seenOwner) return false
    const tag = readWidOwner()
    return tag === null || tag === (seenOwner || '')
  }
  const readSaved = () => {
    try { const raw = storage.get(KEY); return raw ? Object.assign(clone(DEF), JSON.parse(raw)) : null } catch { return null }
  }
  const stateOfSnapshot = (snapshot: ReturnType<typeof readFence>) => loadState({ ...storage,
    get: key => key === KEY ? snapshot.record ?? null : storage.get(key) })
  const metadataOfSnapshot = (snapshot: ReturnType<typeof readFence>) => {
    let base = null
    try { base = JSON.parse(snapshot.syncRecord || 'null') } catch { /* legacy first sync */ }
    return {base, owed:snapshot.dirty}
  }
  const takeSnapshot = (snapshot: ReturnType<typeof readFence>, documentInstance: number) => {
    // A reservation may arrive before its replacement. Once the write id lands,
    // take that document exactly, even though the reservation already moved the
    // peer's in-memory generation. Merging here would resurrect the old copy.
    pendingReplacementInstance = documentInstance > (documentGeneration(snapshot.wid, null) ?? 0) ? documentInstance : null
    const S = stateOfSnapshot(snapshot)
    S.customEx = healCustomEx(S.customEx)
    meta.set(S, metadataOfSnapshot(snapshot))
    seenWid = snapshot.wid; seenOwner = snapshot.owner ?? null
    fence = snapshot; fenceBlocked = false; toldOwnerMismatch = false
    set({S, index:createExerciseIndex(S.customEx), documentInstance})
  }
  // Another tab's copy joined into `mine`; `touched` when this change set the running workout.
  const joinTabs = (mine: any, theirs: any, touched: any) => {
    const merged: any = Object.assign(clone(DEF), mergeDocs(mine, theirs))
    merged.active = touched ? carryActive(mine, merged) : carryActive(theirs, merged)
    return merged
  }
  // `S` with what another tab saved since this one last read or wrote the copy; null when there is
  // nothing to join (the same write, no saved copy, or a copy another account's sign-in replaced).
  const joinSaved = (S: any, prev: any) => {
    if (readWid() === seenWid || !savedIsMine()) return null
    const theirs = readSaved()
    if (!theirs) return null
    const touched = JSON.stringify(prev?.active ?? null) !== JSON.stringify(S?.active ?? null)
    const merged: any = joinTabs(S, theirs, touched)
    return sameCopy(merged, S) ? null : merged
  }

  // A tab whose owner changed under it (another tab signed in or out) does not write: its copy is
  // not the new owner's, and written, it went into that owner's copy, settings and all, and on to
  // the server (QA 2026-10-06). Once the new owner's copy is saved it takes that copy as it is.
  // What it was asked to save was made on the empty copy it holds meanwhile, never on the previous
  // owner's: that small change is kept aside, as "Keep profile as is" keeps a device's copy.
  const refuseStale = (S: any) => {
    if (!handedOver) return false
    takeSaved()
    clearTimeout(pushTm ?? undefined)
    pushTm = null
    if (hasData(S)) keepAside(S, t('This device, before signing in'), staleUid).catch(() => {})
    return true
  }
  const persist = (S: any, push: any = true, stamp: any = true, durable = false,
    { afterPrimary, replacement = false }: { afterPrimary?: () => void; replacement?: boolean } = {}) => {
    assertDurableOwner()
    if (durable && handedOver) throw new Error('The account changed; replacement was refused')
    if (refuseStale(S)) return false
    const { base, owed } = metaOf()   // the copy being replaced; the new one stands where it stood
    const joined = joinSaved(S, get()?.S)
    if (joined) S = joined
    // A join holds another tab's changes, which this copy then owes the server too.
    if (stamp || joined) S._ts = Math.max(Date.now(), (base?.ts || 0) + 1, Number(S._ts) || 0)
    // Every copy that enters the store — an edit, a pull, an adoption, a restored backup — has its
    // custom exercises marked as such (#378): one stored without the flag by an older plan import
    // goes out with it on the next push, without a stamp of its own (healCustomEx).
    S.customEx = healCustomEx(S.customEx)
    if (!durable && !replacement) set({ index: createExerciseIndex(S.customEx) })
    // A refused write used to take the change with it — Finish looked like it simply did
    // nothing. The copy is kept in memory either way and marked as owed to the server, so a
    // signed-in device still gets it there; and it is said out loud once, because a change that
    // is not on the device is the one thing the screen cannot show on its own.
    let saved: any = true
    let primarySaved = false
    let generation: ReturnType<typeof prepareDocumentInstance> | undefined
    try {
      preserveUnreadable()
      if (replacement) generation = prepareDocumentInstance()
      // The marker goes first: a tab that loads the copy in between gets an older base than the
      // copy's, which costs one merge at worst — never a newer one, which would lose data.
      saveMarker(base)
      storage.set(KEY, JSON.stringify(S))
      primarySaved = true
      // Sign-out changes the owner only after its replacement bytes are durable,
      // and before publishing the new write id that lets peer tabs join them.
      afterPrimary?.()
      storage.set(WID_OWNER_KEY, seenOwner || '')
      const wid = `g${generation?.documentInstance ?? get().documentInstance ?? 0}:` + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      storage.set(WID_KEY, wid)
      seenWid = wid
      seenOwner = readOwner()
      toldNoRoom = false
      if (storeLag) { storeLag = false; saveMarker(base) }   // the saved copy is this one again
    } catch (e: any) {
      if (e === staleDurableOwner) throw e
      // Opt-in destructive replacements are never made current or uploaded if the atomic
      // primary write failed. Metadata failures after that write cannot undo its durability.
      if (!primarySaved) generation?.rollback()
      if (!primarySaved && (durable || (replacement && !generation))) {
        notify('Could not save the replacement. Your previous data is kept.')
        throw new Error('Replacement could not be saved', {cause:e})
      }
      saved = false
      storeLag = true
      try { storage.remove(SYNC_KEY) } catch { /* nothing to take back */ }
      if (!toldNoRoom) {
        toldNoRoom = true
        notify(t('This device is out of storage: the change is not saved on it. Signed in, it still goes to the server.'))
      }
    }
    if (durable || replacement) { saved = primarySaved; set({ index: createExerciseIndex(S.customEx) }) }
    meta.set(S, { base, owed: owed || !saved || (!!joined && storedOwed()) })
    if (!saved) saveOwed(true)
    set({ S, ...(generation ? {documentInstance:generation.documentInstance} : {}) })

    if (push && get().user) {
      // Before boot has pulled, the copy in hand may be older than the server's: a push now
      // would carry it with a stale (or no) baseRev. It waits for finishBoot.
      if (!get().ready) { pushPending = true; return saved }
      clearTimeout(pushTm ?? undefined)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
    return saved
  }
  // Boot's last step: from here on changes push, and one made during boot goes now.
  const finishBoot = (extra: any = {}) => {
    set({ ready: true, ...extra })
    if (pushPending && get().user) {
      clearTimeout(pushTm ?? undefined)
      pushTm = setTimeout(() => get().pushState(), 1500)
    }
    pushPending = false
  }

  // A signed-in device shows what the server has. Coming back — to the tab, the window, the app,
  // the network — and every half minute while open, it asks the server for its revision (one
  // small GET) and fetches the document only when the number moved; a change still owed to the
  // server is pushed on the same occasion. A phone that sat in a pocket all afternoon and a
  // desktop tab left open all week used to show, and then push, whatever they last had.
  const checkRev = async (force: any = false) => {
    if (get().sync?.recovery) return
    if (authBlocked() || !get().user || !get().ready || ux().document?.visibilityState === 'hidden') return
    if (!force && Date.now() - lastCheck < CHECK_MIN_MS) return
    lastCheck = Date.now()
    // A sign-in still deciding what becomes of this copy: no check of its own. One whose adoption
    // never ran or did not get through (no server, a pairing that failed on the way to it) runs it
    // here, question and all; one already running is left to answer.
    if (adoptHold) { if (!adopting && adoptOwed()) get().resumeAdoption(); return }
    if (pulling) return pulling
    const started = session()
    const { base } = metaOf()
    if (!base || owes()) return get().pullState()
    try {
      const { rev, wid } = await api('/api/data/rev')
      if (!currentSession(started)) return
      if (rev !== base.rev || (base.wid && wid && wid !== base.wid)) return get().pullState()
      confirmed(get().S)   // nothing moved on either side
    } catch (e: any) {
      if (!currentSession(started)) return
      if (isNetworkError(e) || refused(e)) failed(e)
      else return get().pullState()   // a server that lacks the route (older API) — the full pull knows the old protocol
    }
  }
  const schedulePoll = () => {
    clearTimeout(pollTm ?? undefined)
    if (disposed) return
    pollTm = setTimeout(() => { checkRev(); schedulePoll() }, POLL_MS)
  }
  listen(ux().document, 'visibilitychange', () => { if (ux().document?.visibilityState === 'visible') checkRev() })
  listen(ux().window, 'focus', () => checkRev())
  listen(ux().window, 'pageshow', (e: any) => { if (e.persisted) checkRev() })
  listen(ux().window, 'online', () => checkRev(true))   // also retries a push that failed offline
  schedulePoll()

  // Both copies changed: keep both sides' entries, let the newer copy decide the rest
  // (lib/sync-merge.js), and remember the server's revision so the push that follows is
  // conditional on exactly the document that was merged. The merged copy is stamped — it is a
  // real change this device now holds — while `ts` in the base stays old, so a pull that
  // happens before the push lands still sees it as unsent.
  const mergeInto = (local: any, remote: any, rev: any, replacement = false) => {
    const ts = metaOf().base?.ts || 0
    // The first merge of an older app's owed copy: what that app changed besides its lists is
    // stamped so the merge keeps it (lib/sync-legacy.js). When that cannot be told, the copy as
    // it was is kept aside before the merge, to be saved from Settings, so nothing is lost.
    const legacy = readLegacy()
    if (legacy && legacy.owner === get().user?.id) {
      const lifted = liftLegacy(local, remote, legacy.fp, Math.max(Date.now(), highestStamp(local) + 1, highestStamp(remote) + 1))
      if (!lifted.resolved) keepAside(local, t('This device, before the update'))
      local = Object.assign(clone(DEF), lifted.state)
    }
    if (legacy) clearLegacy()
    const merged: any = Object.assign(clone(DEF), mergeDocs(local, remote))
    merged.active = carryActive(local, merged)
    // A pass of this app's rotation that the merge left complete (each copy finished a session of
    // it, or one copy's refill lost to the other's older queue) starts its next pass here, as the
    // finish that completed it would have (lib/rotation.js).
    if (refillIfComplete(merged)) merged.edited = { ...(merged.edited || {}), queue: Math.max(Date.now(), highestStamp(merged) + 1) }
    if (Array.isArray(merged.programmes?.cycles) && merged.programmes.cycles.some((c: any) => c?.status === 'active' || c?.status === 'paused')) {
      const beforeProgramme = clone(merged)
      if (advanceProgramme(merged)) merged._ts = stampChange(beforeProgramme, merged, Date.now())
    }
    persist(merged, false, true, false, {replacement})
    if (rev == null) dropSync()
    else writeSync(rev, ts, remote?._wid)
  }
  // The workout running on this device, carried from its copy into the one replacing it — in that
  // copy's unit: a merge or a pull can bring the other device's switch to lb along, and a session
  // left in kg would then log kg numbers under an lb label. A switch that only changed the label
  // (`unitSet.convert === false`) relabels the session as it relabels the history (inUnitOf).
  const carryActive = (from: any, to: any) => {
    const a = from?.active || null
    const fu = from?.unit || 'kg', tu = to?.unit || 'kg'
    return !a || fu === tu ? a : inUnitOf({ unit: fu, active: a }, to, documentIndex(from, to)).active
  }
  // Take the server's copy as this device's own, timestamp and all (see persist).
  const advanceAdoption = (next: any) => {
    const before = clone(next)
    if (!advanceProgramme(next)) return false
    next._ts = stampChange(before, next, Date.now())
    return true
  }
  const adopt = (next: any, rev: any, replacement = false) => {
    const serverTs = next._ts
    const advanced = advanceAdoption(next)
    persist(next, advanced, false, false, {replacement})
    writeSync(rev, serverTs, next._wid)
    markOwed(advanced)
    return advanced
  }

  const doPush = async (attempt: number = 0, started = session()) => {
    if (!currentSession(started) || adoptHold || !get().user) return
    syncFromSaved()
    const S = get().S, capturedInstance = get().documentInstance
    const { base } = metaOf()
    // A forced push is one attempt. One that fails is retried as an ordinary push against the
    // revision this copy descends from: kept armed, it went out later without a baseRev and
    // replaced whatever another device had written in the meantime.
    // A stale body never reached the server. Carry its intent to this snapshot,
    // unless a newer local replacement or a different session superseded it.
    const pendingIntent = undispatchedIntent
    undispatchedIntent = null
    const inherited = !forceNext && replaceRev == null && pendingIntent && currentSession(pendingIntent.started) ? pendingIntent : null
    const force = inherited ? inherited.force : forceNext
    forceNext = false
    const asReplace = inherited ? inherited.asReplace : replaceRev
    replaceRev = null
    // `stamped`: this client stamps its own changes; the server stamps only for one that does not
    // (api/sync-stamps.js).
    // An older app's owed copy over the revision it read: the server stamps what that app changed
    // against the copy it holds, exactly as it would for that app (api/sync-stamps.js).
    const legacy = readLegacy()
    const body: any = { state: S, stamped: !(legacy && legacy.owner === get().user?.id) }
    if (asReplace != null) { body.baseRev = asReplace.rev; if (asReplace.wid) body.baseWid = asReplace.wid }
    else if (!force && base) { body.baseRev = base.rev; if (base.wid) body.baseWid = base.wid }
    try {
      const r = await carrierApi(started, '/api/data', { method: 'PUT', body: JSON.stringify(body) }, () => {
        if (get().documentInstance !== capturedInstance) throw stalePushSnapshot
        return true
      })
      if (!currentSession(started) || adoptHold) return
      syncFromSaved()
      const changedWhileSending = !sameCopy(get().S,S)
      // A server from before revisions answers without one — then there is nothing to hold the
      // next push to, and the marker must not pretend otherwise.
      if (r.rev == null) dropSync()
      else writeSync(r.rev, S._ts, r.wid)
      if (legacy) clearLegacy()
      markOwed(changedWhileSending)
      toldTooLarge = false
      confirmed(S)
      if (changedWhileSending) { pushAgain = true; setSync({pending:true}) }
      // Back from offline with changes that were waiting: say so once — the banner that promised
      // "syncs when you're back online" has just kept its word.
      if (offlineChanges) {
        offlineChanges = false
        notify(t('Back online and synced with the server.'))
      }
    } catch (e: any) {
      if (e === stalePushSnapshot) {
        if (!currentSession(started) || adoptHold) return
        // Keep undispatched intent separate from newly armed replacement flags.
        // The next snapshot rechecks its session and gives newer intent priority.
        undispatchedIntent = { started, force, asReplace }
        pushAgain = true
        return
      }
      if (!currentSession(started) || adoptHold) return
      if (e.status === 409 && e.data && attempt < 2) {
        // Another device wrote since this one last read. The server sent its document along;
        // merge and push once more against that revision. A second refusal in a row leaves the
        // copy owed and the next resume pull takes it from there. A backup import whose replace
        // met another device's sync keeps that device's changes too, and says so.
        if (asReplace != null) {
          notify(t('Another device synced while you were importing, so its changes were kept next to the backup.'))
        }
        mergeInto(get().S, e.data.state, e.data.rev || 0)
        return get().pushState({ attempt: attempt + 1, started })
      }

      markOwed(true)
      if (isNetworkError(e)) offlineChanges = true
      failed(e, { pending: true })
      // A 413 comes from the proxy in front of the API (nginx: client_max_body_size), which
      // caps the request body. Every later push is at least as big, so nothing reaches the
      // server until the limit is raised — said once per refusal streak; the owed copy keeps
      // the retries going. useUI imports this store, hence the lazy import.
      if (e.status === 413 && !toldTooLarge) {
        toldTooLarge = true
        notify(t('Sync failed: the server refused the upload as too large. Your changes have not reached the server.'))
      }
    }
  }

  // A setting changed right before switching away/closing the tab must not get lost mid-debounce
  // (e.g. setting the reminder time then immediately backgrounding to test it).

  const flush = () => {

    if (pushTm) {
      clearTimeout(pushTm ?? undefined)
      pushTm = null
      get().pushState()
    }
  }
  listen(ux().document, 'visibilitychange', () => { if (ux().document?.visibilityState === 'hidden') flush() })
  listen(ux().window, 'pagehide', flush)   // Safari kills the home-screen app without a visibilitychange at times

  // The owner check in setUser only runs in the tab that signs in. Another tab of the same
  // browser still holding the previous profile, or a guest's copy, would keep writing it over the
  // shared copy and push it under the new session's cookie, or join it into the new owner's copy
  // the moment that one is saved (QA 2026-10-06: a guest tab left open put its workout, routine
  // and default settings into the account after "Keep profile as is"). So any tab whose owner
  // changes under it drops what it holds, signed in or not, and takes the new owner's copy as it
  // is once that is saved (takeSaved); until then it writes nothing (refuseStale). Whoever signs in
  // there passes the same check. The owner key goes first on both a sign-in and a sign-out, so
  // this runs before the new owner's copy reaches this tab.
  onStorage((e: any) => {
    if (e.key !== 'gym_owner') return
    const owner = readOwner()
    if (owner === seenOwner) return
    sessionEpoch++
    clearTimeout(pushTm ?? undefined)
    pushTm = null
    // A guest's workout running here went along with the sign-in in the other tab (it joined this
    // browser's saved copy first, setUser), and this tab shows it again once that tab is done
    // (followSignIn). Said, so a workout that leaves the screen mid-set is not taken for lost; only
    // where the workout is on screen (a tab on Stats never showed it), and it goes on right here.
    if (!seenOwner && owner && get().S.active && /^#\/workout(?:[/?]|$)/.test(new URL(services.platform.nav.href()).hash || '')) {
      notify(t('Signed in from another tab. Your workout came along, keep going here.'))
    }
    const S = restartedState(get().S)
    meta.set(S, { base: null, owed: false })
    seenWid = readWid()
    seenOwner = owner
    handedOver = true
    const user = get().user
    set({ ...(user && user.id !== owner ? { user: null } : {}), S })
    refreshFence()
    takeSaved()
  })
  // Another tab of this browser synced — its marker moved to a revision this tab's copy does not
  // descend from. Rather than take that tab's saved copy (storage holds the copy and its marker
  // under two keys, and an event can arrive with one updated and not the other), this tab asks
  // the server, as it would on coming back to it: one small request, and a pull only if the
  // revision really moved. A hidden tab does the same when it is shown again. Its own base still
  // guards the push either way: a copy this tab has not refreshed gets a 409 and a merge.
  onStorage((e: any) => {
    if (e.key !== SYNC_KEY || !e.newValue) return
    if (!get().user && !followSignIn()) return
    const user = get().user
    if (!user || storage.get('gym_owner') !== user.id) return
    let theirs = null
    try { theirs = JSON.parse(e.newValue) } catch { return }
    if (theirs?.rev == null || (theirs.rev === metaOf().base?.rev && theirs.wid === metaOf().base?.wid)) return
    checkRev(true)
  })

  // Another tab saved: its copy joins this one's at once, so this tab shows it and never writes
  // over it. When the saved copy holds everything this tab has, this tab takes it as it is, with
  // where it stands with the server (its marker and dirty flag); otherwise the join is saved and
  // pushed like any change.
  // A tab the owner changed under takes the new owner's saved copy as it is, with where it stands
  // with the server: it has no changes of its own to join, only the previous owner's copy, or a
  // guest's, which must not go into it.
  const takeSaved = () => {
    if (!handedOver) return false
    // Only a copy known to be written under the new owner: one saved before the owner was
    // recorded beside it is most likely the guest's copy the sign-in is still asking about.
    const snapshot = readFence()
    if (snapshot.owner !== seenOwner || snapshot.tag !== (seenOwner || '') || !snapshot.record || !snapshot.readable) return false
    handedOver = false
    takeSnapshot(snapshot, documentGeneration(snapshot.wid,snapshot.instance) ?? (get().documentInstance ?? 0) + 1)
    followSignIn()
    return true
  }
  // A tab signed out, or a guest's, whose browser another tab signed in: once that sign-in is
  // settled (its question answered, its copy saved under the account and in step with a revision),
  // this tab is signed in too, as a tab opened now would be. The session cookie is the browser's.
  // A guest's workout carried into the account shows here again.
  const followSignIn = () => {
    if (get()?.user || handedOver) return false
    const owner = readOwner()
    if (!owner || owner !== seenOwner || readWidOwner() !== owner || readWid() !== seenWid) return false
    let u = null
    try { u = JSON.parse(storage.get('gym_user') || 'null') } catch { return false }
    if (!u || u.id !== owner) return false
    const m = readAdopt()
    if (m && (m.incomplete || m.uid === owner)) return false
    const base = readStoredSync()
    if (!base) return false
    meta.set(get().S, { base, owed: storedOwed() })
    sessionEpoch++
    pushAgain = false
    set({ user: u })
    partialCopy = false; recoveryFence = null
    setSync({ held: false, recovery: null })
    return true
  }
  onStorage(e => { if (e.key === ADOPT_KEY && !e.newValue) followSignIn() })
  onStorage(e => {
    if (e.key !== INSTANCE_KEY || !savedIsMine() || handedOver) return
    const documentInstance = storedInstance()
    if (documentInstance !== null && documentInstance !== get().documentInstance) {
      pendingReplacementInstance = documentInstance
      set({ documentInstance })
    }
  })
  // The answered sign-in's copy saved under its account once, whatever the answer did: an answer
  // that changed nothing here ("Add them" with nothing to add, a profile with no copy yet) wrote
  // no save, and another tab waited on one (takeSaved).
  const claimSaved = () => {
    const u = get().user
    if (u && readOwner() === u.id && readWidOwner() !== u.id) return persist(get().S, false, false)
    return !storeLag
  }
  const syncFromSaved = () => {
    if (handedOver) { takeSaved(); return }
    const wid = readWid()
    if (wid === seenWid || !savedIsMine()) return
    const theirs = readSaved()
    if (!theirs) return
    const snapshot = readFence(), documentInstance = documentGeneration(snapshot.wid,snapshot.instance)
    if (documentInstance !== null && (documentInstance !== get().documentInstance || pendingReplacementInstance === documentInstance)) {
      if (snapshot.owner === seenOwner && snapshot.tag === (seenOwner || '') && snapshot.readable) takeSnapshot(snapshot, documentInstance)
      return
    }
    const mine = get().S
    const merged: any = joinTabs(mine, theirs, false)
    seenWid = wid
    if (sameCopy(merged, mine)) return
    if (sameCopy(merged, theirs)) {
      merged._ts = Math.max(Number(theirs._ts) || 0, Number(mine._ts) || 0)
      meta.set(merged, { base: readStoredSync(), owed: storedOwed() })
      set({ index: createExerciseIndex(merged.customEx) })
      set({ S: merged })
      return
    }
    persist(merged, true)
  }
  onStorage((e: any) => {
    if (e.key !== WID_KEY || !e.newValue || e.newValue === seenWid) return
    syncFromSaved()
  })

  // Before a sign-out decides anything: the pull on its way has landed, and every push asked
  // like a change is.
  const settle = async () => {
    syncFromSaved()   // what another tab of this browser saved and has not sent counts too
    if (pulling) await pulling
    await get().pushState()   // never throws — an owed copy stays owed when it does not land
    while (pushing) await pushing
  }

  // Forget where this device stood with the server — a different account, a sign-out. The copy
  // that replaces it descends from no revision and owes nothing.
  const forgetSync = () => {
    meta.set(get().S, { base: null, owed: false })
    offlineChanges = false   // a push the previous account owed is not this one's to announce
    try { for (const k of [SYNC_KEY, DIRTY_KEY, SYNCED_AT_KEY, SYNCED_FP_KEY]) storage.remove(k) } catch { /* nothing to keep */ }
    fpOf = null
  }

  // Everything a sign-out leaves behind on this device, whichever way it was triggered. The owner
  // goes before the wiped copy's write id is published: another tab must learn that
  // the copy is nobody's before it joins it (QA 2026-10-06).
  const clearLocalSession = () => {
    assertDurableOwner()
    ownerTransition++
    try {
      persist(freshState(), false, true, true, {afterPrimary: () => {
        get().setUser(null)
        storage.remove('gym_guest')
        releaseAdopt()   // the replacement is durable; the copy it was about is gone
        storage.remove('gym_owner_name')
        storage.remove('gym_owner')
        seenOwner = null
        handedOver = false
      }})
      forgetSync()
      setSync({ offline: false, auth: false, lastError: null, pending: false, lastSynced: 0 })
    } finally { ownerTransition-- }

    // except the ones a stash still refers to — whatever was pending is in a stash by now
    // (signOut refuses otherwise) and comes back with it. A file picked from here on is kept.
    // After the state file, which is the one write a sign-out must not be kept waiting for. Also
    // exercise was deleted, is still in the store until the local clean-up's grace has passed,
    // and on a shared device it must not outlast the sign-out. The app's sync opens the store at
    // left alone, since nothing can have been put into it.
    return null
  }

  // A logout response is not authority to delete an edit saved while it was pending.
  // Check the actual producer draft, and suppress the outer updater's stamped write.
  const finishLeave = (started: ReturnType<typeof session>, document: string, saved: {raw:string|null;wid:string|null;owner:string|null}, valid?: () => boolean) => {
    try {
      get().update(draft => {
        if (!currentSession(started) || JSON.stringify(draft) !== document
          || storage.get(KEY) !== saved.raw || readWid() !== saved.wid || readWidOwner() !== saved.owner
          || (valid && !valid())) throw staleLeaveData
        clearLocalSession()
        throw appliedLeave
      })
    } catch (error) {
      if (error === appliedLeave) return
      if (error === staleLeaveData) {
        notify('Your data changed during sign-out. Your saved copy is kept on this device.')
        throw new Error('The account or data changed; open sign-out again')
      }
      throw error
    }
  }

  const stashKey = (server: any, uid: any) => (server || '') + '|' + uid
  const readStashes = async () => {
    let all: any = {}
    try { all = JSON.parse(storage.get(STASH_KEY) || 'null') || {} } catch { /* none */ }

    return all
  }
  // True when at least one durable copy of the stashes was written.
  const writeStashes = async (all: any) => {
    const empty = !Object.keys(all).length
    let ok = false
    try { if (empty) storage.remove(STASH_KEY); else storage.set(STASH_KEY, JSON.stringify(all)); ok = true } catch { /* full */ }

    set({ keptRev: get().keptRev + 1 })
    return ok || empty
  }

  const keepForPrevious = (uid: any) => {
    syncFromSaved()
    const S = get().S
    if (!hasData(S) && !S.active) return true
    // Still signed in (an account switch on a live session): its server has the copy, so only
    // what it owes and a running workout are kept, as before.
    const live = get().user?.id === uid
    if (live && !(owesOwn() && hasData(S)) && !S.active) return true
    const server = serverBase()
    const key = stashKey(server, uid)
    let all: any = {}
    try { all = JSON.parse(storage.get(STASH_KEY) || 'null') || {} } catch { /* none */ }
    const prev = all[key]?.state
    const state: any = prev ? mergeDocs(S, prev) : clone(S)
    state.active = carryActive(S, state) || carryActive(prev, state) || null
    // The name comes from beside the owner when the account is no longer signed in here (its
    // session ended), so the screens say whose changes these are rather than an id.
    let name = get().user?.id === uid ? get().user?.name || '' : ''
    if (!name) { try { name = storage.get('gym_owner_name') || '' } catch { /* the id then */ } }
    const entry = { server: server || null, uid, name, at: Date.now(), state }
    all[key] = entry
    // Storage must hold both until the kept copy succeeds. Never free the original to retry.
    try { storage.set(STASH_KEY, JSON.stringify(all)) }
    catch {
      notify(t('This device is out of storage: the previous profile was kept. Free some space before switching accounts.'))
      return false
    }
    set({ keptRev: get().keptRev + 1 })
    return true
  }
  // What a sign-out or disconnect answers when something is owed: how many changes, and how many
  const owedResult = (left: any, extra: any = {}) => ({ owed: true, count: left.count, ...extra })
  const stashOwed = async () => {
    const started = session()
    const user = get().user
    if (!user) return true
    const all: any = await readStashes()
    if (!currentSession(started)) return false
    const server = serverBase()
    const key = stashKey(server, user.id)
    const prev = all[key]?.state
    const state: any = prev ? mergeDocs(get().S, prev) : clone(get().S)
    // Each running workout in the kept copy's unit (carryActive), never a kg session under lb.
    state.active = carryActive(get().S, state) || carryActive(prev, state) || null
    // Kept while a sign-in's question was open: a copy that was never this account's, added back
    // like an answered "Add them" (applyStash), the account's settings and history first.
    const adopt = adoptHold || !!all[key]?.adopt
    all[key] = { server: server || null, uid: user.id, name: user.name || '', at: Date.now(), state, ...(adopt ? { adopt: true } : {}) }
    return writeStashes(all)
  }
  // A workout running here is never on the server (a push leaves `active` out), so a sign-out
  // with nothing owed used to wipe it. It is kept aside the way owed changes are, on its own:
  // the rest of the copy is the server's already, and a shared device keeps no more of the
  // account than it has to. It comes back on the next sign-in here as this account (applyStash).
  const stashActive = async () => {
    const started = session()
    const user = get().user
    const a = get().S.active
    if (!user || !a) return true
    const all: any = await readStashes()
    if (!currentSession(started)) return false
    const server = serverBase()
    const key = stashKey(server, user.id)
    const prev = all[key]?.state
    const state: any = prev ? clone(prev) : Object.assign(clone(DEF), { _ts: 0, unit: get().S.unit || 'kg' })
    state.active = clone(carryActive(get().S, state))
    all[key] = { server: server || null, uid: user.id, name: user.name || '', at: Date.now(), state }
    return writeStashes(all)
  }
  // A sign-out ends the rest and the hold running on this device: the countdown must not go on
  // over the sign-in screen, or ring for an account that has left. Before the logout request,
  // while the session can still call the server push off. A hold hands back what it held first.
  const stopTimers = async () => {
    try { await services.prompts.stopTimers?.() } catch { /* legacy timer hooks never prevent signing out */ }
  }

  // Back on the server and account a forced sign-out or disconnect left: the kept changes are
  // merged in like a conflict (lib/sync-merge.js), marked owed and pushed, and the stash goes.
  // If the push does not land, the copy itself owes them from here and nothing wipes it.
  const applyStash = async () => {
    const started = session()
    const user = get().user
    if (!user) return
    const all: any = await readStashes()
    if (!currentSession(started)) return
    const exact = stashKey(serverBase(), user.id)
    const keys = Object.keys(all).filter((k: any) => k === exact || (all[k]?.uid === user.id && !all[k]?.server))
    if (!keys.length) return
    const S = get().S
    let merged: any = S
    for (const k of keys) merged = all[k].adopt ? mergeDocs(merged, all[k].state, { prefer: 'a' }) : mergeDocs(merged, all[k].state)
    merged = Object.assign(clone(DEF), merged)
    // A kept running workout comes back in the unit of the copy it joins: the account may have
    // switched to lb (converting every weight) since it was kept in kg.
    merged.active = S.active || keys.map((k: any) => carryActive(all[k].state, merged)).find(Boolean) || null
    const saved = persist(merged, false)
    markOwed(true)
    await get().pushState()
    // A PUT omits active. Even a successful PUT cannot replace its durable local stash.
    if (!saved || !currentSession(started)) return
    for (const k of keys) delete all[k]
    await writeStashes(all)
  }

  const keepAside = async (S: StoreDocument, name: string, keepUid?: string) => {
    const started = session()
    if (!hasData(S)) return true
    const state: any = clone(S)
    const all: any = await readStashes()
    if (!currentSession(started)) return false
    const uid = keepUid || 'device-' + Date.now().toString(36)
    all[stashKey(serverBase(), uid)] = { server: serverBase() || null, uid, name, at: Date.now(), state }
    const saved = await writeStashes(all)
    if (!saved) notify(t('This device is out of storage: your device data was kept and the profile was not replaced. Free some space and try again.'))
    return saved
  }
  const keepDeviceCopy = async () => {
    const started = session()
    const saved = await keepAside(get().S, t('This device, before signing in'))
    if (!currentSession(started) || saved) return
    // Persist the adoption hold when possible; otherwise the in-memory hold still prevents
    // a later poll from uploading guest data to this account after the refused replacement.
    setHold(true)
    if (get().user && !adoptOwed()) writeAdopt({ uid: get().user!.id, rejoined: false, alwaysAsk: true, pre: preOf(get().S) })
    throw Object.assign(new Error('Device copy could not be kept; profile replacement was refused'), { keepAdoptionHeld: true })
  }

  // adoptProfile's work (see there). Every way out answers the question — releaseAdopt — before
  // the decision is written and pushed; only a server that could not be reached leaves it owed.
  const runAdopt = async (ask: any, { alwaysAsk = false }: any = {}) => {
    const started = session()
    const cancelled = { adopted: false, added: false, cancelled: true }
    if (pulling) await pulling
    if (!currentSession(started)) return cancelled
    // An adoption resumed after a restart is the sign-in's own: whether this copy already belonged
    // to the account was decided then — boot's sign-in sees the owner that sign-in wrote.
    const owedMark = adoptOwed()
    const sameAccount = owedMark ? !!owedMark.rejoined : rejoined
    if (owedMark?.alwaysAsk) alwaysAsk = true
    let res: any
    try { res = await carrierApi(started, '/api/data') }
    catch (e: any) {
      if (!currentSession(started)) return cancelled
      failed(e)
      // Nothing decided: with a sign-in that marked it, sync stays held and the next check asks
      // again (checkRev); a bare call has nothing to hold for.
      if (!owedMark) releaseAdopt()
      throw e   // the caller's toast: sign-in needed the server anyway
    }
    if (!currentSession(started)) return cancelled
    let { state, rev } = res
    reached()
    let asked = false
    const askAbout = async (extras: any) => {
      if (!(extras.workouts || extras.bodyweight || extras.customEx || extras.routines || extras.setup) || typeof ask !== 'function') return false
      asked = true
      return !!(await ask(extras))
    }
    // The question can stay open for minutes: what is applied is the server's copy once it
    // closes. Unreachable by then, the copy read before it stands — its revision is older than
    // the server's, so the next pull still brings in what changed.
    const reread = async () => {
      if (!asked) return
      try { const r = await carrierApi(started, '/api/data'); if (currentSession(started) && r && r.state) ({ state, rev } = r) } catch { /* the first read */ }
    }
    const takeServer = () => {
      const copy = sanitizeAccent(Object.assign(clone(DEF), state))
      copy.active = carryActive(get().S, copy)
      if (rev != null) adopt(copy, rev, true)
      else { dropSync(); persist(copy, false, false, false, {replacement:true}); markOwed(false) }
      confirmed(get().S)
    }
    const S0 = get().S
    if (!state) {
      const push = hasData(S0) && (!alwaysAsk || sameAccount || await askAbout(localExtras(S0, null)))
      if (!currentSession(started)) return cancelled
      if (hasData(get().S) && !push) {
        if (asked) await keepDeviceCopy()
        if (!currentSession(started)) return cancelled
        releaseAdopt()
        takeServer()
        if (!currentSession(started)) return cancelled
        await applyStash()
        return { adopted: true, added: false }
      }
      releaseAdopt()
      markOwed(false)
      if (push) { if (rev != null) writeSync(rev, 0); forceNext = true; await get().pushState() }
      else { if (rev != null) writeSync(rev, 0); confirmed(get().S) }
      if (!currentSession(started)) return cancelled
      await applyStash()
      return { adopted: false, added: false }
    }
    if (sameAccount) {

      releaseAdopt()
      const S = get().S
      const { base, owed } = metaOf()
      if (!hasData(S) || (!owed && base && !localChanged(S))) {
        takeServer()
        if (!currentSession(started)) return cancelled
        await applyStash()
        return { adopted: true, added: false, merged: false }
      }
      mergeInto(S, state, rev)
      await get().pushState()
      if (!currentSession(started)) return cancelled
      await applyStash()
      return { adopted: true, added: false, merged: true }
    }
    // The question is about what this copy held when the sign-in began (the marker's `pre`). What
    // was logged since — while an adoption that could not reach the server kept sync held — is
    // this account's own already: never offered as "logged while signed out", never dropped by
    // "Keep profile as is", but merged like any change of the account's.
    const pre = owedMark?.pre
    const keep = await askAbout(localExtras(pre ? splitByPre(S0, pre).before : S0, state))
    if (!currentSession(started)) return cancelled
    await reread()
    if (!currentSession(started)) return cancelled
    if (keep) {
      releaseAdopt()
      const S = get().S
      const merged: any = Object.assign(clone(DEF), mergeDocs(state, S, { prefer: 'a' }))
      merged.active = carryActive(S, merged)
      // The account's plan wins; a day it has nothing planned for takes the device's.
      for (const f of ['week', 'dayPlan']) {
        const mine = S[f] && typeof S[f] === 'object' ? S[f] : {}
        merged[f] = { ...mine, ...(merged[f] || {}) }
      }
      persist(merged, false)
      if (rev != null) writeSync(rev, 0, state?._wid)
      else dropSync()
      await get().pushState()
      if (!currentSession(started)) return cancelled
      await applyStash()
      return { adopted: true, added: true }
    }
    const later: any = pre ? splitByPre(get().S, pre).later : null
    if (asked) await keepDeviceCopy()
    if (!currentSession(started)) return cancelled
    releaseAdopt()
    takeServer()
    if (later) {
      const S = get().S
      const merged: any = Object.assign(clone(DEF), mergeDocs(S, later, { prefer: 'a' }))
      merged.active = S.active || null
      persist(merged, false)
      if (rev != null) writeSync(rev, 0, state?._wid)
      else dropSync()
      await get().pushState()
    }
    if (!currentSession(started)) return cancelled
    await applyStash()
    return { adopted: true, added: false }
  }
  // A copy's workouts, weigh-ins and custom exercises split by the names a sign-in recorded when it
  // began (`pre`, see setUser): `before` holds what was there then, `later` — null when nothing
  // is — what was logged since, with the custom exercises its workouts use, in this copy's unit.
  const ADOPT_FIELDS = ['workouts', 'bodyweight', 'customEx']
  const splitByPre = (S: any, pre: any) => {
    const before = { ...S }
    const later: any = { _ts: S._ts, unit: S.unit, ...(S.unitSet ? { unitSet: S.unitSet } : {}) }
    let any = false
    for (const f of ADOPT_FIELDS) {
      const had = new Set(Array.isArray(pre?.[f]) ? pre[f] : [])
      const xs = Array.isArray(S[f]) ? S[f].filter((x: any) => x != null) : []
      before[f] = xs.filter((x: any) => had.has(entryKey(f, x)))
      later[f] = xs.filter((x: any) => !had.has(entryKey(f, x)))
      if (later[f].length) any = true
    }
    if (!any) return { before, later: null }
    const used = new Set(later.workouts.flatMap((w: any) => (Array.isArray(w?.entries) ? w.entries : []).map((e: any) => e?.id)))
    later.customEx = [...later.customEx, ...before.customEx.filter((c: any) => used.has(c.id))]
    return { before, later }
  }
  const preOf = (S: any) => {
    const ids: Record<string, string[]> = resetIdsOf(S)
    return Object.fromEntries(ADOPT_FIELDS.map((f: any) => [f, ids[f] || []]))
  }

  const S0 = stateOfSnapshot(hydration)
  S0.customEx = healCustomEx(S0.customEx)
  set({ index: createExerciseIndex(S0.customEx) })
  meta.set(S0, metadataOfSnapshot(hydration))
  seenOwner = hydration.owner ?? seenOwner; seenWid = hydration.wid
  let user0 = (() => { try { return JSON.parse(hydration.userRecord || 'null') || null } catch { return null } })()
  const savedOwner0 = hydration.tag
  let mark0 = readAdopt()
  if (user0 && (hasData(S0) || partialCopy) && (!seenOwner || (savedOwner0 !== null && savedOwner0 !== user0.id)) &&
      (!mark0 || (!mark0.incomplete && (mark0.uid !== user0.id || mark0.rejoined)))) {
    mark0 = { uid: user0.id, rejoined: false, alwaysAsk: true, pre: preOf(S0) }
    writeAdopt(mark0)
  }
  adoptHold = partialCopy || !!user0 && (!!mark0?.incomplete || mark0?.uid === user0.id)
  const sync0: any = { offline: false, pending: storedOwed(), auth: false, lastError: null, lastSynced: (() => { try { return +(storage.get(SYNCED_AT_KEY) || 0) || 0 } catch { return 0 } })(), server: serverBase(), held: adoptHold }
  if (authBlocked()) { authHeld = true; user0 = null; sync0.held = true }
  if (partialCopy) { sync0.recovery = {fingerprint: fingerprintOf(hydration)}; if (hydration.user && hydration.owner && hydration.user !== hydration.owner) user0 = null }
  sync0.status = statusOf(sync0, user0)

  const actions: SyncActions = {
    beginAuthTransaction,
    S: S0,
    documentInstance: storedInstance() ?? get().documentInstance ?? 0,
    user: user0,
    ready: false,
    // The connection as the screens show it — see statusOf above for every field.
    sync: sync0,

    // Capabilities offered by the current server.
    config: null,
    // A short-lived QR device-link code, never persisted or synced.
    linkCode: null,

    // Mutate a draft of S via producer fn, then persist + schedule sync. Every routine the change
    // touched carries the time of it, for a conflict to keep the version edited last.
    update(mut: any, push: any = true) {
      if (get().sync?.recovery) return false
      assertDurableOwner()
      const previousFrame = writeFrame
      writeFrame = {uid:get().user?.id ?? null,instance:get().documentInstance}
      try {
      const prev = get().S
      const S = clone(prev)
      mut(S)
      assertDurableOwner()
      advanceProgramme(S)
      // What the change removed, and which routines, workouts, settings and plan days it touched,
      // each with one time that comes after every stamp the copy already carries: a conflict then
      // keeps a removal and the edit made last, even from a device whose clock runs behind
      // (lib/sync-merge.js stampChange).
      S._ts = stampChange(prev, S, Date.now())
      persist(S, push)
      } finally { writeFrame = previousFrame }
    },
    // Timer records share the same owner fence and producer context as workouts.
    persistTimerRecord(key: string, value: string | null, valid?: (draft:StoreDocument)=>boolean, expected?: string | null) {
      if (key !== 'gym_work' && key !== 'gym_rest') throw new Error('Invalid timer key')
      const stale = Symbol('stale timer record'), applied = Symbol('timer record saved')
      try {
        get().update(draft => {
          if ((valid && !valid(draft)) || (expected !== undefined && storage.get(key) !== expected)) throw stale
          if (value === null) storage.remove(key); else storage.set(key,value)
          throw applied
        })
      } catch (error) {
        if (error === applied) return true
        if (error !== stale) throw error
        notify(t('The account, profile or workout changed. The timer was not saved.'))
      }
      return false
    },
    // An edit of a saved workout (lib/session-edit.js) is saved or dropped like any other change:
    // the store's own sync takes it to the server, and a conflict on the way is settled by
    // mergeStates like one between two devices. A save that cannot happen throws before anything
    // is written, and the editor stays open with the edits.
    saveHistoryEdit() {
      let saved: any = null
      get().update((S: any) => { saved = saveWorkoutEdit(S, Date.now(), createExerciseIndex(S.customEx)) })
      return saved
    },
    discardHistoryEdit() { get().update((S: any) => { S.active = null }) },
    // An edit that took out every set deletes the workout rather than saving it empty.
    deleteHistoryEdit() {
      let removed = false
      get().update((S: any) => { removed = deleteEditedWorkout(S, createExerciseIndex(S.customEx)) })
      return removed
    },
    // Settings → unit. `convert` walks every stored weight into the new unit (lib/units.js); off,
    // only the label changes. Either way the choice is stamped (`unitSet`), so a merge with a
    // copy still in the old unit brings that copy over rather than mixing the two (lib/sync-merge.js),
    // and a conversion goes to the server at once, as an ordinary conditional push: another device
    // still logging in the old unit meets it on its very next push, and a copy it pushed first is
    // converted before it is merged in.
    setUnit(to: any, { convert = true }: any = {}) {
      const S0 = get().S
      if ((S0.unit || 'kg') === to) return null
      const S = clone(convert ? convertStateUnit(S0, to, createExerciseIndex(S0.customEx)) : { ...S0, unit: to })
      S.unitSet = { at: Math.max(Date.now(), highestStamp(S0) + 1), convert }
      persist(S, true)
      return convert && get().ready ? get().pushState() : null
    },
    // Settings → Reset everything: a new profile (restartedState), stamped with when (`resetAt`).
    // Pushed as a replace, and the stamp is what makes it hold: a device that has not seen the
    // reset and still pushes a change of its own gets the 409, and its merge keeps only what that
    // device made after the reset instead of bringing the whole profile back (lib/sync-merge.js).
    //
    // With it goes `resetIds`, the names of every entry the reset wiped: this copy's, the earlier
    // resets' (a copy older than those too is still judged right), and the server's once it
    // answers — it may hold entries this device never pulled. A device that has not seen the
    // reset loses exactly those, and keeps whatever else it holds, whatever its dates say.
    // Resolves once the server's names are in (or could not be had).
    resetEverything({ durable = false }: {durable?: boolean} = {}) {
      const cur = get().S
      const S = restartedState(cur)
      S.resetAt = Math.max(Date.now(), highestStamp(cur) + 1)
      S.resetIds = mergeResetIds(cur.resetIds, resetIdsOf(cur))
      get().replaceState(S, !!get().user, {durable})
      if (!get().user) return Promise.resolve()
      const started = session()
      const resetOwner = get().user, resetProfile = get().S.activeEquipId ?? null, resetDocument = JSON.stringify(get().S)
      return carrierApi(started, '/api/data').catch(() => null).then((res: any) => {
        if (!currentSession(started)) { if (durable) notify('The account, profile or target changed. Open this action again.'); return }
        const now = get().S
        if (!res?.state || now.resetAt !== S.resetAt) return
        const ids = mergeResetIds(now.resetIds, mergeResetIds(res.state.resetIds, resetIdsOf(res.state)))
        if (JSON.stringify(ids) === JSON.stringify(now.resetIds)) return
        if (!durable) { persist(Object.assign(clone(now), { resetIds: ids }), true); return }
        try {
          get().update(draft => {
            if (!currentSession(started) || get().user !== resetOwner || (draft.activeEquipId ?? null) !== resetProfile || JSON.stringify(draft) !== resetDocument) throw staleResetTarget
            persist(Object.assign(clone(draft), {resetIds:ids}), true, true, true)
            throw appliedReset
          })
        } catch (error) {
          if (error === staleResetTarget) notify('The account, profile or target changed. Open this action again.')
          else if (error !== appliedReset) throw error
        }
      }).catch(error => { if (durable) throw error })
    },
    // Before a backup replaces this copy (Settings → Import): the workouts the server holds that the
    // backup does not — logged since it was made, or on another device meanwhile. The import is a
    // deliberate replace and deletes them from the profile; the confirm says so and offers to merge
    // them in instead (importBackup). null when there are none, when nobody is signed in, or when
    // the server cannot be asked — the replace then goes as it always has.
    async importConflict(backup: any) {
      if (!get().user) return null
      const started = session()
      let res: any
      try { res = await carrierApi(started, '/api/data') } catch { return null }
      if (!currentSession(started)) return null
      const state: any = res?.state
      importRead = { uid: get().user?.id, state: state || null, rev: res?.rev ?? null }
      if (!state) return null
      const key = (w: any) => entryKey('workouts', w)
      const inBackup = new Set((Array.isArray(backup?.workouts) ? backup.workouts : []).filter(Boolean).map(key))
      const server = (Array.isArray(state.workouts) ? state.workouts : []).filter(Boolean)
      const onServer = new Set(server.map(key))
      const workouts = server.filter((w: any) => !inBackup.has(key(w))).length
      // This device's own workouts the server has not received yet go the same way, and count too.
      const mine = owes() ? (get().S.workouts || []).filter((w: any) => w && !inBackup.has(key(w)) && !onServer.has(key(w))).length : 0
      return workouts + mine ? { workouts: workouts + mine, state, rev: res.rev, local: mine > 0 || owes() } : null
    },
    // A backup in place of this copy. With `mergeWith` — importConflict's answer — the server's copy
    // is merged in instead of replaced (with this device's changes not yet on it, when there are
    // any): the backup's settings and plan, every entry of all of them (mergeStates with the backup
    // preferred, in the backup's unit), pushed against that revision like any other change, so a
    // workout logged meanwhile elsewhere, or here, is not lost either.
    //
    // Either way the backup is a deliberate add-back (lib/sync-merge.js stampRestore): what it holds
    // stays, though this device or the server recorded it as deleted since, and its settings and
    // plan are the latest choice, on every device. The replace goes against the revision the check
    // read (or this copy's own): a change another device synced meanwhile is merged in, not wiped.
    importBackup(backup: any, { mergeWith, durable = false }: any = {}) {
      const cur = get().S
      const uid = get().user?.id
      const read = mergeWith?.state ? mergeWith : importRead && importRead.uid === uid ? importRead : null
      importRead = null
      const server = read?.state || null
      const now = Math.max(Date.now(), highestStamp(cur) + 1, highestStamp(server) + 1, highestStamp(backup) + 1)
      const next = sanitizeAccent(Object.assign(clone(DEF), backup))
      // A workout running here lives on this device only: no backup and no server copy holds it,
      // so the import keeps it (in the backup's unit). Only with none running does a backup taken
      // mid-workout bring its own session back. Both the replace and "Merge them in" dropped it.
      const running = carryActive(cur, next) || next.active || null
      if (!mergeWith?.state || !uid) {
        stampRestore(next, [cur, server], now)
        // …and like a reset of what it replaces: an unsent change of another device from before it
        // no longer brings the replaced workouts back (lib/sync-merge.js stampReplace).
        stampReplace(next, [cur, server].filter(Boolean), now)
        next._ts = now
        next.active = running
        const at = read?.rev != null ? { rev: read.rev, wid: read.state?._wid } : metaOf().base
        get().replaceState(next, !!uid, { baseRev: at?.rev ?? null, baseWid: at?.wid, durable })
        return
      }
      const others = mergeWith.local ? mergeDocs(cur, mergeWith.state) : mergeWith.state
      // The merge keeps the backup's reset stamp (prefer); a later one this copy or the server's
      // holds stays, as it does on a replace.
      const merged: any = keepReset(others, keepReset(cur, Object.assign(clone(DEF), mergeDocs(next, others, { prefer: 'a' }))))
      stampRestore(merged, [cur, mergeWith.state, next], now)
      merged._ts = now
      merged.active = carryActive({ unit: next.unit, active: running }, merged)
      persist(merged, true, true, durable, {replacement:true})
      if (mergeWith.rev != null) writeSync(mergeWith.rev, 0, mergeWith.state?._wid)
    },
    // A replace that is meant to reach the server (backup import, reset) is a deliberate
    // overwrite, not a change to merge: the push it arms goes without a baseRev — or, given one
    // (an import), against that revision, so a 409 merges what another device wrote since. It
    // never takes the reset stamp back (keepReset).
    replaceState(S: any, push: any = false, { baseRev = null, baseWid, durable = false }: any = {}) {
      assertDurableOwner()
      persist(keepReset(get().S, clone(S)), push, true, durable, {replacement:true})
      if (push) { if (baseRev != null) replaceRev = { rev: baseRev, wid: baseWid }; else forceNext = true }
      // Explicit restore/replacement starts a new editor even when every id matches.
    },

    isGuest: () => storage.get('gym_guest') === '1',
    // Choosing to go on without a server ends whatever was said about the last one.
    setGuest(v: any) {
      if (v) storage.set('gym_guest', '1'); else storage.remove('gym_guest')
      set({})
      if (v) setSync({ auth: false, offline: false, lastError: null })
    },

    // Public config from /api/config (invite_only, allow_guest). null until the first successful
    // fetch — the login screen and boot both read it, so it is fetched once and cached here
    // rather than by each screen that happens to need it.
    async loadConfig() {
      if (get().config) return get().config
      return get().refreshConfig()
    },

    async refreshConfig() {
      if (configFetch) return configFetch
      configFetch = (async () => {
        try { const c = await api('/api/config'); set({ config: c }); return c }
        catch { return null }
        finally { configFetch = null }
      })()
      return configFetch
    },

    // `adopt` (a sign-in, a pairing — { alwaysAsk } for a device link): adoptProfile follows and
    // decides what becomes of this copy; until it has, nothing is pulled or pushed (ADOPT_KEY).
    setUser(u: any, { adopt }: any = {}) {
      if (authBlocked() && !committingAuth) throw new Error('Sign-in transaction must settle before changing the session')
      const accountChanged = get().user?.id !== u?.id
      ownerTransition++
      try {
        assertDurableOwner()
        if (u) {

          const owner = storage.get('gym_owner')
          const savedOwner = storage.get(WID_OWNER_KEY)
          rejoined = owner === u.id && (savedOwner === null || savedOwner === u.id)
          const other = !!owner && owner !== u.id
          syncFromSaved()
          if (other) {
            preserveUnreadable()
            if (!keepForPrevious(owner)) throw new Error('Previous profile could not be kept; account switch was refused')
          }
          // The hold goes on before anything else can run: a poll, a resume, a debounced push.
          if (adopt) {
            adoptHold = true
            clearTimeout(pushTm ?? undefined)
            pushTm = null
          } else {
            // Boot signing the account back in: an adoption it still owes holds sync until it is
            // answered (resumeAdoption); one another account left behind is void.
            const m = readAdopt()
            if (m && !m.incomplete && m.uid !== u.id) writeAdopt(null)
            adoptHold = !!m && (m.incomplete || m.uid === u.id)
            if (m?.incomplete) writeAdopt({ uid: u.id, rejoined: false, alwaysAsk: true, pre: preOf(get().S) })
          }
          // What another tab of this browser saved under the copy's owner so far is this copy's
          // too: the question below is about it, and from here on this tab joins only the
          // account's saves (seenOwner below).
          syncFromSaved()
          const recorded = adopt ? writeAdopt({ uid: u.id, rejoined, alwaysAsk: !!adopt.alwaysAsk, pre: preOf(other ? restartedState(get().S) : get().S) }) : !adoptWritePending
          if (other && !recorded) throw new Error('Adoption could not be recorded; account switch was refused')
          if (other) {
            forgetSync()
            storage.remove(KEY)
            // The new owner before the new copy, as on a sign-out: another tab still holding the
            // previous account's copy must not join it into this one (QA 2026-10-06).
            storage.set('gym_owner_name', u.name || '')
            storage.set('gym_owner', u.id)
            seenOwner = u.id
            persist(restartedState(get().S), false)
            setSync({ pending: false, lastSynced: 0, lastError: null })
          }
          // The mark, with the names of what this copy holds now (`pre`) — what the question is
          // about; whatever is logged later belongs to the account (runAdopt).
          if (recorded) {
            storage.set('gym_owner_name', u.name || '')
            storage.set('gym_owner', u.id)
            // This tab now joins the account's saves like any tab opened on it: one opened after the
            // sign-in saves under the new owner, and a tab still comparing against the old one took
            // no part until it had saved itself, then wrote its copy over theirs (joinSaved).
            seenOwner = u.id
            handedOver = false
            storage.set('gym_user', JSON.stringify(u)); storage.remove('gym_guest')
          }
          logoutOwed(false)   // this sign-in's cookie replaced the one a failed sign-out left behind
          // A profile created here (no question: this copy becomes it) is saved once under its owner
          // now. Another tab of this browser takes only a copy saved under the new owner, and went
          // blank until this one happened to save something (takeSaved).
          if (!adopt && !other && owner !== u.id) persist(get().S, false, false)
          // The file follows at once, as the new account's: until then it holds the previous one's.

          // before this sign-in (boot's, or the login screen asking for invite_only), and every

          // nothing on this path waits for the answer. A copy that has the key was made for a

          if (get().config && accountChanged) get().refreshConfig()
        } else { rejoined = false; adoptHold = false; storage.remove('gym_user') }
        sessionEpoch++
        pushAgain = false
        set({ user: u })
        setSync({ held: adoptHold })
      } catch (error) {
        if (error === staleDurableOwner) throw error
        // Login may already have changed the HttpOnly cookie. This applies to every
        // failed session write, even if preserving the old profile already succeeded.
        sessionEpoch++
        clearTimeout(pushTm ?? undefined)
        pushTm = null
        pushAgain = false
        setHold(true)
        set({ user: null })
        try { storage.remove('gym_user') } catch { /* the in-memory session is still revoked */ }
        notify(t('The account switch was refused. Your previous profile is still on this device; free some storage and sign in again.'))
        throw error
      } finally { ownerTransition-- }
    },

    // One PUT at a time: a push asked for while one is in flight runs after it (once, however
    // many asked), and the promise returned covers that follow-up too, so a caller that awaits
    // before signing out knows the last change is on the server.
    async pushState(retry?: { attempt: number; started: ReturnType<typeof session> }) {
      if (!get().user || handedOver) return
      clearTimeout(pushTm ?? undefined)
      pushTm = null
      if (authBlocked() || adoptHold) return   // the sign-in has not decided what this copy is yet (adoptProfile)
      // Conflict retries use this same public hold gate, retaining their original session.
      if (retry) {
        if (!currentSession(retry.started) || retry.attempt < 1 || retry.attempt > 2) return
        return doPush(retry.attempt, retry.started)
      }
      if (pushing) { pushAgain = true; return pushing.then(() => pushing) }
      const started = session()
      if (started.owner === undefined) { markOwed(true); failed(Object.assign(new Error('Device ownership could not be read'), { code: 'ownership-unavailable' }), { pending: true }); return }
      pushing = doPush(0, started).finally(() => {
        pushing = null
        if (pushAgain) { pushAgain = false; return get().pushState() }
      })
      return pushing
    },
    // Ask the server for its copy and settle the difference. Coalesced, and a push still waiting
    // in the debounce goes first — the server's answer is then the one that already includes it,
    // and the push itself is what catches a conflict.
    async pullState() {
      if (authBlocked() || adoptHold) return   // as pushState: adoptProfile reads the server itself
      if (pulling) return pulling
      const started = session()
      if (started.owner === undefined) { failed(Object.assign(new Error('Device ownership could not be read'), { code: 'ownership-unavailable' }), { pending: owes() }); return }
      pulling = (async () => {
        try {
          if (pushTm) { clearTimeout(pushTm ?? undefined); pushTm = null; await get().pushState() }
          else if (pushing) await pushing
          if (!currentSession(started)) return
          const res: any = await carrierApi(started, '/api/data')
          if (!currentSession(started)) return
          lastCheck = Date.now()
          reached()
          const { state, rev } = res
          const S = get().S
          const { base, owed } = metaOf()
          // Owed to the server: a push that failed, or a change made while boot was still pulling.
          const dirty = owed || pushPending
          // A server from before revisions: the old rule, newer `_ts` wins outright.
          if (rev == null) {
            dropSync()
            const restored = restoredStateFor(S, state, dirty)
            if (restored) {
              const advanced = advanceAdoption(restored)
              persist(restored, advanced, false, false, {replacement:!base})
              if (advanced) { markOwed(true); await get().pushState() }
              else confirmed(get().S)
            }
            else if (hasData(S)) await get().pushState()
            return
          }
          // No base yet — first pull on this device, or a client that just learned about
          // revisions. The newer copy wins as before, except that a copy still owed to the
          // server (dirty) is merged instead of pushed over whatever is there.
          if (!base) {
            if (dirty && state) { mergeInto(S, state, rev, true); pushPending = false; await get().pushState(); return }
            const restored = restoredStateFor(S, state, false)
            if (restored) { if (adopt(restored, rev, true)) await get().pushState(); else confirmed(get().S) }
            else if (hasData(S)) { writeSync(rev, 0, state?._wid); await get().pushState() }
            else { writeSync(rev, state?._ts || 0, state?._wid); confirmed(get().S) }
            return
          }
          // The document the server holds now, and whether it descends from the one this copy last
          // synced: one it does not (the server's data went back in time — a restored backup, a
          // write lost to a power cut — or an answer that left before this device's own push
          // landed) is never taken as it is. It is merged, and pushed: what this device had
          // confirmed would otherwise vanish here too, and the same revision number can name a
          // different document, which a push would have overwritten without a 409.
          const wid = state?._wid
          const serverMoved = rev !== base.rev || (!!base.wid && !!wid && wid !== base.wid)
          const descends = !base.wid || !wid || wid === base.wid || (Array.isArray(state?._wids) && state._wids.includes(base.wid))
          const changed = dirty || localChanged(S)
          if (!serverMoved) { if (changed) await get().pushState(); else confirmed(S); return }
          if (!state) { writeSync(rev, 0); if (hasData(S)) await get().pushState(); return }
          if (!descends) { mergeInto(S, state, rev); pushPending = false; await get().pushState(); return }
          if (!changed) { const next = adoptedState(S, state); next.active = carryActive(S, next); if (adopt(next, rev)) await get().pushState(); else confirmed(get().S); return }
          mergeInto(S, state, rev)
          pushPending = false
          await get().pushState()
        } catch (e: any) { if (currentSession(started)) failed(e) /* keep local; the poll retries */ }
        finally { pulling = null }
      })()
      return pulling
    },

    // "Sync now": what is waiting goes, the server's copy is checked, and the answer is the
    // `sync` every screen reads — status 'ok' when the two agree.
    async syncNow() {
      if (authBlocked()) return get().sync
      if (!get().user) { setSync({}); return get().sync }
      // Held for a sign-in's question: "Sync now" is asking it (again), and the sync follows.
      if (adoptHold) { await get().resumeAdoption(); if (adoptHold) return get().sync }
      if (pulling) await pulling
      await get().pullState()
      return get().sync
    },

    // What this device holds that the server has not seen: `owed` when anything would be lost by
    // wiping the copy now, `count` how many workouts, weigh-ins, routines and custom exercises
    // differ from the last copy the two agreed on (plus one for settings and the plan) — null
    // when the device has no record of that copy (it last agreed with the server under an older
    // version), and then only `owed` is known.
    //
    unsyncedChanges() {
      if (!get().user) return { owed: false, count: 0 }
      if (!owes()) return { owed: false, count: 0 }
      const count = countChanges(get().S, readFingerprint())
      return { owed: count !== 0, count }
    },

    keptRev: 0,
    async keptChanges() {
      const all: any = await readStashes()
      return Object.values(all).map(({ server, uid, name, at }: any) => ({ server: server || null, uid, name, at }))
    },
    // The copy kept for one account (keptChanges' server and uid), to save as a backup file.
    async keptState(server: any, uid: any) {
      const all: any = await readStashes()
      return all[stashKey(server, uid)]?.state || null
    },
    adoptProfile(ask: any, opts: any = {}) {
      if (get().sync?.recovery && opts.recovery !== recoveryAdoption) return Promise.resolve({adopted:false,added:false,cancelled:true})
      if (authBlocked()) return Promise.resolve({ adopted: false, added: false, cancelled: true })
      if (!get().user) return Promise.resolve({ adopted: false, added: false, cancelled: true })
      if (adopting) return adopting
      setHold(true)
      // Retry the original split before claiming ownership. A reload while it is unrecorded
      // sees the existing guest/previous owner and must ask again.
      if (adoptWritePending && memoryAdopt && writeAdopt(memoryAdopt)) get().setUser(get().user)
      // Whatever throws on the way (the server, the question itself): a sign-in that marked it
      // stays held, and the next check or "Sync now" runs it again; a bare call has nothing to
      // hold for and lets go.
      const started = session()
      adopting = runAdopt(ask, opts)
        .then((r: any) => {
          if (currentSession(started) && !r?.cancelled) {
            if (claimSaved()) writeAdopt(null)
            else setHold(true)
          }
          return r
        })
        .catch((e: any) => { if (currentSession(started) && !e.keepAdoptionHeld && !adoptOwed()) releaseAdopt(); throw e })
        .finally(() => { adopting = null })
      return adopting
    },
    // The adoption a sign-in still owes — the app was closed with its question open, or the server
    // could not be reached for it: asked again, with the sign-in's own question.
    async resumeAdoption(ask: any) {
      if (get().sync?.recovery) return null
      if (authBlocked()) return null
      const m = adoptOwed()
      if (!m) { if (adoptHold && !adopting) releaseAdopt(); return null }
      if (adopting) return adopting
      try {
        if (typeof ask !== 'function') ask = services.prompts.askAddDeviceData
        const r = await get().adoptProfile(ask, { alwaysAsk: !!m.alwaysAsk })

        return r
      } catch { return null }
    },

    /* Signing out wipes this device's copy — never while it holds changes the server has not
       seen. After one more push, if anything is still owed, nothing is wiped and the result
       says so: { owed: true, count } (see unsyncedChanges), for the screen to offer a retry, an
       export, or going ahead anyway. `force` goes ahead: the owed copy is kept aside on this
       device (stashOwed) and comes back when it next reaches this server as this account. If
       even that cannot be written, nothing is wiped ({ owed, count, stashed: false }).
       Otherwise { owed: false } or { owed: true, count, stashed: true }, signed out. A workout
       running here is kept aside either way (stashActive), and the rest and hold timers stop. */
    async signOut({ force = false, valid }: LeaveOptions = {}) {
      assertDurableOwner()
      if (valid && (!services.acquireAuthLock || !services.acquireSyncLock)) throw new Error('Authentication lock is not configured')
      if (authBlocked()) throw new Error('Finish signing in before signing out')
      const started = session()
      const stillHere = () => { const allowed = !valid || valid(); if (!allowed || !currentSession(started)) throw new Error(valid ? 'The account, profile or data changed; open sign-out again' : 'The account changed; open sign-out again') }
      if (valid) {
        stillHere()
        // A shared sync fallback exists without Web Locks; presence of the exclusive
        // provider alone does not prove authentication can serialize on this host.
        const release = await services.acquireAuthLock!()
        if (!release) throw new Error('Authentication lock is not available')
        release()
        stillHere()
      }
      preserveUnreadable()
      await settle()
      stillHere()
      let left = get().unsyncedChanges()
      if (left.owed && !force) return owedResult(left)
      await stopTimers()
      stillHere()
      // Timer writes can join an unsent peer edit; decide what to keep from that copy.
      syncFromSaved()
      stillHere()
      left = get().unsyncedChanges()
      if (left.owed && !force) return owedResult(left)
      // Abandoning a running hold logs its elapsed seconds through the updater.
      const leavingDocument = JSON.stringify(get().S)
      const leavingSaved = {raw:storage.get(KEY),wid:readWid(),owner:readWidOwner()}
      if (left.owed && !(await stashOwed())) return owedResult(left, { stashed: false })
      if (!left.owed && !(await stashActive())) return { owed: true, count: 0, stashed: false }
      stillHere()
      // The device is signed out either way. A request that did not get through leaves the cookie
      // behind, still valid, so the logout is owed until the server answers it (see boot).
      try { await carrierApi(started, '/api/logout', { method: 'POST', body: '{}' }, valid) } catch (e: any) { if (valid) { stillHere(); if (e?.code === 'auth-lock-unavailable') throw e }; logoutOwed(true) }
      stillHere()
      finishLeave(started, leavingDocument, leavingSaved, valid)
      return left.owed ? owedResult(left, { stashed: true }) : { owed: false }
    },

    // "Sign out everywhere": the server bumps this profile's session version, which kills every
    // session it has on any device — this browser included, so the app has to end up exactly
    // where a normal signOut leaves it, under the same rule about changes still owed. Unlike
    // signOut the request is NOT swallowed: if it fails the sessions elsewhere are all still
    // valid, and wiping this device's copy of the data would sign the user out of the one place
    // the bump didn't reach. Caller reports the error.
    async signOutAll({ force = false, valid }: LeaveOptions = {}) {
      assertDurableOwner()
      if (valid && (!services.acquireAuthLock || !services.acquireSyncLock)) throw new Error('Authentication lock is not configured')
      if (authBlocked()) throw new Error('Finish signing in before signing out')
      const started = session()
      const stillHere = () => { const allowed = !valid || valid(); if (!allowed || !currentSession(started)) throw new Error(valid ? 'The account, profile or data changed; open sign-out again' : 'The account changed; open sign-out again') }
      if (valid) {
        stillHere()
        // A shared sync fallback exists without Web Locks; presence of the exclusive
        // provider alone does not prove authentication can serialize on this host.
        const release = await services.acquireAuthLock!()
        if (!release) throw new Error('Authentication lock is not available')
        release()
        stillHere()
      }
      preserveUnreadable()
      await settle()
      stillHere()
      let left = get().unsyncedChanges()
      if (left.owed && !force) return owedResult(left)
      await stopTimers()
      stillHere()
      // Timer writes can join an unsent peer edit; decide what to keep from that copy.
      syncFromSaved()
      stillHere()
      left = get().unsyncedChanges()
      if (left.owed && !force) return owedResult(left)
      // Abandoning a running hold logs its elapsed seconds through the updater.
      const leavingDocument = JSON.stringify(get().S)
      const leavingSaved = {raw:storage.get(KEY),wid:readWid(),owner:readWidOwner()}
      await carrierApi(started, '/api/logout/all', { method: 'POST', body: '{}' }, valid)
      stillHere()
      if (left.owed && !(await stashOwed())) return owedResult(left, { stashed: false })
      if (!left.owed && !(await stashActive())) return { owed: true, count: 0, stashed: false }
      stillHere()
      finishLeave(started, leavingDocument, leavingSaved, valid)
      return left.owed ? owedResult(left, { stashed: true }) : { owed: false }
    },

    async recoverOwnership(choice: 'keep' | 'signout', expected: string) {
      if (!recoveryFence || expected !== get().sync?.recovery?.fingerprint) return false
      const current = readFence()
      if (fingerprintOf(current) !== expected || current.owner === undefined || !current.readable) return false
      try {
        fence = current; fenceBlocked = false; toldOwnerMismatch = false; partialCopy = true
        seenOwner = current.owner; seenWid = current.wid
        const S = stateOfSnapshot(current), user = (() => {try{return JSON.parse(current.userRecord || 'null')}catch{return null}})()
        const coherentUser = user?.id === current.owner ? user : null
        sessionEpoch++
        set({S,index:createExerciseIndex(S.customEx),user:coherentUser,documentInstance:Math.max(get().documentInstance ?? 0,storedInstance() ?? 0)+1})
        setHold(true)
        if (authBlocked()) {
          if (choice !== 'signout') throw new Error(t('Sign out first, then sign in again. Your saved copy is kept.'))
          const marker = storage.get(AUTH_KEY), release = await services.acquireAuthLock?.()
          try {
            if (services.acquireAuthLock && !release) throw new Error(t('Authentication lock is not available'))
            if (fingerprintOf(readFence()) !== expected || storage.get(AUTH_KEY) !== marker) return false
            // Explicit sign-out cancels a stranded exchange; no profile upload is enabled.
            storage.remove(AUTH_KEY); storage.remove(AUTH_UNCHANGED_KEY); authHeld = false
            sessionEpoch++; logoutOwed(true)
          } finally { release?.() }
        }
        const started = session()
        // Preserve even opaque-only documents before any destructive recovery choice.
        const copies = await readStashes()
        if (!currentSession(started) || fingerprintOf(readFence()) !== expected) return false
        const uid = 'device-recovery-' + expected
        copies[stashKey(serverBase(),uid)] = {server:serverBase() || null,uid,name:t('This device, before recovery'),at:Date.now(),state:clone(S)}
        if (!(await writeStashes(copies))) throw new Error(t('Your copy could not be kept. Free some storage and try again.'))
        if (!currentSession(started) || fingerprintOf(readFence()) !== expected) return false
        if (choice === 'signout') {
          await stopTimers()
          if (!currentSession(started) || fingerprintOf(readFence()) !== expected) return false
          try { await carrierApi(started,'/api/logout',{method:'POST',body:'{}'}) } catch { logoutOwed(true) }
          if (!currentSession(started) || fingerprintOf(readFence()) !== expected) return false
          clearLocalSession()
          // Removing a stale tag requires no quota growth and keeps legacy guest behavior.
          ownerTransition++
          try { if (readOwner() === null && !get().user && readWidOwner()) storage.remove(WID_OWNER_KEY) } finally {ownerTransition--}
        } else {
          const me = await carrierApi(started,'/api/me')
          if (!currentSession(started) || fingerprintOf(readFence()) !== expected || !me?.user?.id) return false
          get().setUser(me.user,{adopt:{alwaysAsk:true}})
          rejoined = false
          writeAdopt({uid:me.user.id,rejoined:false,alwaysAsk:true,pre:preOf(get().S)})
          const result = await get().adoptProfile(async()=>false,{alwaysAsk:true,recovery:recoveryAdoption})
          if (!result || result.cancelled || adoptHold) return false
        }
        partialCopy = false; recoveryFence = null
        setSync({recovery:null})
        return true
      } finally {
        if (get().sync?.recovery) { recoveryFence = readFence(); setSync({recovery:{fingerprint:fingerprintOf(recoveryFence)}}) }
      }
    },

    // Boot: ask the server who we are, then pull.
    async boot() {
      if (get().sync?.recovery) { finishBoot(); return }
      if (authBlocked()) { quarantineAuth(); finishBoot(); return }
      let started = session()
      if (started.owner === undefined) {
        // No sync request is safe until ownership is readable. The local screen still boots
        // so storage recovery/export and a later sign-in remain available.
        sessionEpoch++
        clearTimeout(pushTm ?? undefined)
        pushTm = null
        pushAgain = false
        set({ user: null })
        try { storage.remove('gym_user') } catch { /* local authentication is still quarantined */ }
        setHold(true)
        failed(Object.assign(new Error('Device ownership could not be read'), { code: 'ownership-unavailable' }))
        notify(t('Device ownership could not be read. Your profile is still on this device; restore storage access and sign in again.'))
        finishBoot()
        return
      }

      // Opened from a device-link QR code (#95): the code comes off the address at once — a reload,
      // a bookmark or a shared screenshot of the address bar must not carry it around — and waits
      // here for the sheet that redeems it (App.jsx, components/Passkeys.jsx).
      const address = new URL(services.platform.nav.href())
      const linkCode = linkTokenFromSearch(address.search)
      if (linkCode) { services.platform.nav.replaceQuery({ link: null }); set({ linkCode }) }
      // Guests never authenticate, so an instance that turned guest mode off has no request to
      // refuse — the only way the switch reaches someone already inside is here, on their next
      // boot. Ending the session needs a positive `allow_guest: false`; see lib/guest.js for why
      // an unreachable server must not be allowed to lock anyone out (#42).
      const cfg = await get().loadConfig()
      if (!currentSession(started)) return
      if (!guestAllowed(cfg)) get().setGuest(false)
      // A sign-out that could not reach the server: finish it first. Still unanswered, the
      // browser stays signed out rather than adopt the session it left behind.
      if (logoutOwed()) {
        try { await carrierApi(started, '/api/logout', { method: 'POST', body: '{}' }); logoutOwed(false) } catch { /* owed until it is answered */ }
        if (logoutOwed()) { finishBoot(); return }
      }
      try {
        const me = await api('/api/me')
        if (!currentSession(started)) return
        if (!me.user?.id) throw Object.assign(new Error('no user'), { status: 200, code: 'bad-response' })
        // A saved guest copy, or a write explicitly tagged under another owner, cannot be
        // uploaded merely because the authentication cookie survived a refused sign-in.
        const owner = storage.get('gym_owner')
        const savedOwner = storage.get(WID_OWNER_KEY)
        const unclaimed = hasData(get().S) && (!owner || (savedOwner !== null && savedOwner !== me.user.id))
        const mark = readAdopt()
        const needsAdoption = unclaimed && (!mark || (!mark.incomplete && mark.uid !== me.user.id))
        try { get().setUser(me.user, needsAdoption ? { adopt: { alwaysAsk: true } } : {}) }
        catch { finishBoot(); return } // this boot's own refused initialization is a settled local state
        started = session()
        // Re-stamp the reminder's timezone on every load — keeps it correct if you're travelling,
        // without needing to revisit Settings.
        const restampTz = () => {
          if (!currentSession(started)) return
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
          if (get().S.reminder?.on && get().S.reminder.tz !== tz) {
            get().update((s: any) => { s.reminder = { ...s.reminder, tz } })
          }
        }

        if (adoptOwed()) {
          finishBoot()
          get().resumeAdoption().then(() => { if (!adoptHold) restampTz() })
          return
        }
        await get().pullState()
        if (!currentSession(started)) return
        if (!get().sync.lastError) await applyStash()   // only once the server really answered
        restampTz()
      } catch (e: any) {
        if (!currentSession(started)) return
        // The session ended (expired, revoked, signed out everywhere): back to the sign-in
        // screen, which says so. The copy stays here with its owner, and signing in again as the
        // same account merges it (adoptProfile). A later reload still says so while that copy
        // owes its account changes — the user is gone by then, the owner and the copy are not —
        // unless whoever is here chose to go on as a guest.
        if (e.status === 401) {
          const kept = !!get().user || (!get().isGuest() && !!storage.get('gym_owner') && owes())
          get().setUser(null)
          if (kept) failed(e, { pending: owes() })
        }
        // Started without a network (a home-screen app reopened in the gym's basement), or
        // behind a proxy answering for the server: keep the signed-in copy and say so from the
        // first screen, not only after the first failed push.
        else if (get().user) failed(e, { pending: owes() })
      }
      finishBoot()
    }
  }
  try { assertDurableOwner() } catch { /* construction never publishes an unverified owner */ }
  constructing = false
  if (fenceBlocked) {
    actions.user = null; actions.sync.held = true; actions.sync.status = 'held'
    try { assertDurableOwner() } catch { /* notify and reload, without writing */ }
  }
  // Like the call-site stale-target sentinels, this abort unwinds the whole action.
  // Keep unrelated producer/transport/storage errors observable to their callers.
  for (const [name, action] of Object.entries(actions)) {
    if (typeof action !== 'function') continue
    actions[name] = (...args: any[]) => {
      try {
        const result = action(...args)
        if (result instanceof Promise) return result.catch(error => { if (error !== staleDurableOwner) throw error; return undefined })
        return result
      } catch (error) { if (error !== staleDurableOwner) throw error; return name === 'update' ? false : undefined }
    }
  }
  return { actions, hydrateOwner() { refreshFence(); seenOwner = readOwner(); seenWid = readWid() }, dispose() { disposed = true; clearTimeout(pushTm ?? undefined); clearTimeout(pollTm ?? undefined); for (const remove of listeners) remove() } }
}
let currentEngine: ReturnType<typeof createSyncEngine> | null = null
export function initializeSyncEngine(services: SyncServices) {
  currentEngine?.dispose()
  const engine = createSyncEngine(useStore.setState, useStore.getState, {...services,claimReload:services.claimReload ?? claimBrowserRecoveryReload})
  useStore.setState(engine.actions)
  currentEngine = engine
  return engine.dispose
}
