import { useStore, type StoreDocument } from '../store/useStore'
const refused = Symbol('guarded updater refusal')
const authorized = Symbol('guarded updater authorization')
/** Refuse from a deeper target-specific check inside the guarded producer. */
export function abortGuardedUpdate(): never { throw refused }
export interface GuardedUpdateOptions {
  push?: boolean
  update?: (mutate: (draft: StoreDocument) => void, push?: boolean) => unknown
  onStale?(): void
  /** A nested synchronous action owns persistence; never save the outer draft. */
  action?: boolean
}
/** One sentinel boundary for every delayed producer. Probes and actions never stamp. */
export function guardedStoreUpdate(valid: (draft: StoreDocument) => boolean,
  mutate?: (draft: StoreDocument) => unknown, options: GuardedUpdateOptions = {}): boolean {
  let applied = false
  try {
    const outcome: unknown = (options.update ?? useStore.getState().update)(draft => {
      if (!valid(draft)) throw refused
      if (!mutate) throw authorized
      mutate(draft)
      if (options.action) throw authorized
      applied = true
    }, options.push)
    return applied && outcome !== false
  } catch (error) {
    if (error === authorized) return true
    if (error !== refused) throw error
    options.onStale?.()
    return false
  }
}
