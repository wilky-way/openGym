import { guardedStoreUpdate } from '../lib/guarded-update'
import { useStore, type StoreDocument, type StoreState } from '../store/useStore'
import { useUI } from '../store/useUI'
import { clientPlatform } from '../lib/client-io'

const ownerKey = (st: StoreState, S = st.S) => JSON.stringify([
  st.user?.id ?? null, st.user?.profileId ?? S.profileId ?? null,
  S.activeEquipId ?? null, S.unit, S.resetAt ?? null,
  S.active ? [S.active.id, S.active.start, S.active.instanceId, S.active.editingWorkoutId] : null,
  (st as StoreState & { documentInstance?: unknown }).documentInstance ?? null,
])
let epoch = 0
useStore.subscribe?.((next, prev) => { if (ownerKey(next) !== ownerKey(prev)) epoch++ })
export interface PlanTarget { epoch: number; owner: string; endpoint: string | null; valid?: () => boolean; matches?: (s: StoreDocument) => boolean }
export function capturePlanTarget(matches?: PlanTarget['matches'], valid?: PlanTarget['valid']): PlanTarget {
  let endpoint: string | null = null
  try { endpoint = clientPlatform().server.baseUrl() } catch { /* injected at boot */ }
  return { epoch, owner: ownerKey(useStore.getState()), endpoint, matches, valid }
}
function current(target: PlanTarget, state: StoreDocument): boolean {
  const st = useStore.getState()
  try { if (target.endpoint !== clientPlatform().server.baseUrl()) return false } catch { if (target.endpoint !== null) return false }
  if (target.epoch !== epoch || target.owner !== ownerKey(st, state) || target.valid?.() === false || target.matches?.(state) === false) return false
  // Sync store may join another tab's context after the producer. Refuse a pending owner switch.
  if (typeof st.replaceState === 'function') {
    try {
      const kv = clientPlatform().kv, user = JSON.parse(kv.get('gym_user') || 'null')
      const owner = kv.get('gym_owner'), savedOwner = kv.get('gym_state_owner')
      if ((user?.id ?? null) !== (st.user?.id ?? null) || (st.user && owner !== st.user.id) || (savedOwner !== null && savedOwner !== (owner || ''))) return false
      const raw = kv.get('gym_state_v1')
      if (raw) {
        const saved = JSON.parse(raw)
        if (target.owner !== ownerKey({ ...st, user, S: saved }) || target.matches?.(saved) === false) return false
      }
    } catch { return false }
  }
  return true
}
export function validatePlanTarget(target: PlanTarget): boolean {
  if (current(target, useStore.getState().S)) return true
  useUI.getState().toast('The target changed. Open this editor again.'); return false
}
export function updatePlanTarget(target: PlanTarget, mutate: (s: StoreDocument) => void): boolean {
  return guardedStoreUpdate(s => current(target, s), mutate,
    {onStale: () => useUI.getState().toast('The target changed. Open this editor again.')})
}
export const planFingerprint = (s: StoreDocument) => JSON.stringify([s.routines, s.week, s.dayPlan, s.rotation, s.queue, s.scheduleMode])

// Content plus a duplicate ordinal identifies occurrences without using their list position.
// Unchanged occurrences keep their React identity when moved; changed content remounts them.
export function occurrenceKeys(values: readonly unknown[]): string[] {
  const counts = new Map<string, number>()
  return values.map(value => {
    const identity = JSON.stringify(value)
    const occurrence = counts.get(identity) ?? 0
    counts.set(identity, occurrence + 1)
    return JSON.stringify([identity, occurrence])
  })
}
