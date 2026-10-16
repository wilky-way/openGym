import { guardedStoreUpdate } from '../lib/guarded-update'
import { useStore, type StoreDocument } from '../store/useStore'
import { useUI } from '../store/useUI'
import { clientPlatform } from '../lib/client-io'

const owner = (S = useStore.getState().S, state = useStore.getState()) => JSON.stringify([
  state.user?.id, state.documentInstance, S.profileId, S.resetAt, S.unit, S.activeEquipId,
  S.active && [S.active.id, S.active.start, S.active.d, S.active.editingWorkoutId, S.active.editBase?.sheetInstanceId],
])
let generation = 0
useStore.subscribe((next, previous) => {
  if (owner(next.S, next) !== owner(previous.S, previous)) generation++
})
export const workoutIdentityKey = () => JSON.stringify([owner(), generation, endpoint()])
const endpoint = () => { try { return clientPlatform().server.baseUrl() } catch { return null } }
const validators = new WeakSet<object>()
export type WorkoutTarget = (S?: StoreDocument) => boolean
/** Capture at open/mount. The epoch also rejects switch-away-and-back callbacks. */
export function captureWorkoutTarget(valid: (S: StoreDocument) => boolean = () => true): WorkoutTarget {
  const identity = owner(), opened = generation, server = endpoint()
  const target: WorkoutTarget = (S = useStore.getState().S) => opened === generation && identity === owner(S) && server === endpoint() && valid(S)
  validators.add(target)
  return target
}
/** Destructive confirms also fence W07's saved copy before its post-producer tab join.
 * The wid is read with the bytes inside the producer; a queued storage event need not
 * have updated the in-memory draft yet. This is a read-only check, never a sync write. */
export function captureDurableWorkoutTarget(snapshot = true): WorkoutTarget {
  const state = useStore.getState(), target = captureWorkoutTarget()
  const active = JSON.stringify(state.S.active)
  const identity = owner()
  const required = typeof state.replaceState === 'function'
  let kv: ReturnType<typeof clientPlatform>['kv'] | undefined, openedWid: string | null | undefined
  let durableOwner: string | null | undefined
  if (required) try {
    kv = clientPlatform().kv
    openedWid = kv.get('gym_state_wid')
    durableOwner = state.user?.id ?? kv.get('gym_owner')
  } catch { /* unavailable durable context fails closed */ }
  return (S = useStore.getState().S) => {
    if (!target(S)) return false
    if (!required) return true
    if (!kv || openedWid === undefined || durableOwner === undefined) return false
    try {
      const savedOwner = kv.get('gym_state_owner'), account = kv.get('gym_owner')
      const user = JSON.parse(kv.get('gym_user') || 'null')
      if (account !== durableOwner || (savedOwner !== null && savedOwner !== (account || '')) ||
        (user?.id ?? null) !== (useStore.getState().user?.id ?? null)) return false
      const wid = kv.get('gym_state_wid'), raw = kv.get('gym_state_v1')
      if (!raw) return wid === openedWid // first save, with W07 recovery guarantees intact
      const saved = JSON.parse(raw)
      // Degraded same-session progress may lead the saved bytes, but a normal
      // same-generation peer write must still prove the captured session identity.
      if (!snapshot && useStore.getState().sync?.localDurability && useStore.getState().sync.localDurability !== 'saved' &&
        typeof useStore.getState().validateWorkoutOwner === 'function') {
        return useStore.getState().validateWorkoutOwner() === true &&
          (typeof useStore.getState().validateWorkoutBaseline === 'function' ? useStore.getState().validateWorkoutBaseline() === true : identity === owner(saved)) && target(S) && target()
      }
      if (identity !== owner(saved)) return false
      // Destructive confirms retain the complete saved-session snapshot check.
      return JSON.stringify(saved.active) === (snapshot ? active : JSON.stringify(S.active))
    } catch { return false }
  }
}
let refusalEpoch = 0
export function staleWorkoutToast() { refusalEpoch++; useUI.getState().toast('The account, profile or workout changed. Open this action again.') }
/** W07 stamps even unchanged producers: unwind it before stamps, persistence or push. */
export function workoutTargetUpdate(target: WorkoutTarget, mutate: (S: StoreDocument) => void, push = true): boolean {
  return guardedStoreUpdate(S => target(S), mutate, {push, onStale: staleWorkoutToast})
}
/** Extract the optional trailing validator without mistaking a timed/progress callback for it. */
export function workoutCallbackTarget(args: unknown[], fallback: WorkoutTarget): WorkoutTarget {
  const last = args.at(-1)
  return typeof last === 'function' && validators.has(last) ? last as WorkoutTarget : fallback
}
/** Validate callbacks handed to W18 before dispatch; the caller also guards its producer. */
export function workoutTargetCallback<T extends (...args: any[]) => any>(target: WorkoutTarget, callback: T): T {
  return ((...args: Parameters<T>) => {
    // A no-write producer probe checks the actual draft without ever committing it.
    const valid = guardedStoreUpdate(S => target(S))
    if (!valid) { staleWorkoutToast(); return false }
    const inherited = args.at(-1)
    const supplied = typeof inherited === 'function' && validators.has(inherited) ? inherited as WorkoutTarget : null
    const combined: WorkoutTarget = supplied ? S => target(S) && supplied(S) : target
    validators.add(combined)
    const before = refusalEpoch
    const result = callback(...(supplied ? args.slice(0, -1) : args), combined)
    // A void legacy caller may catch the sentinel in its own guarded updater. Preserve that
    // refusal for chained actions (effort then tick) instead of issuing a second write.
    return refusalEpoch === before ? result : false
  }) as T
}
/** Delayed row menus reject structural edits, including duplicate exercise occurrences. */
export function captureWorkoutRow(entryIdx: number, setIdx?: number): WorkoutTarget {
  const entries = useStore.getState().S.active?.entries
  const before = JSON.stringify(entries)
  const row = setIdx == null ? null : JSON.stringify(entries?.[entryIdx]?.sets?.[setIdx])
  const length = entries?.[entryIdx]?.sets?.length
  const durable = captureDurableWorkoutTarget(false)
  return captureWorkoutTarget(S => durable(S) && JSON.stringify(S.active?.entries) === before &&
    !!S.active?.entries?.[entryIdx] && (setIdx == null || (S.active.entries[entryIdx].sets.length === length && JSON.stringify(S.active.entries[entryIdx].sets[setIdx]) === row)))
}
