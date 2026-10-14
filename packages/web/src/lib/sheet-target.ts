import { useStore, type StoreDocument } from '../store/useStore'
import { useUI } from '../store/useUI'
import { clientPlatform } from './client-io'

// Cloned drafts change object reference on every edit. Stable session fields and
// a monotonic epoch detect replacement, including switch-away-and-back, while
// permitting ordinary logging on the same session.
const identity = (store: ReturnType<typeof useStore.getState>) => {
  const { S, user } = store
  const a = S.active
  return JSON.stringify([user?.id ?? null, store.documentInstance ?? 0, S.profileId, S.unit, S.activeEquipId, S.resetAt,
    a ? [a.id, a.start, a.d, a.routineId, a.editingWorkoutId, a.programme?.instanceId, a.editBase?.sheetInstanceId] : null])
}
let epoch = 0
useStore.subscribe((next, previous) => { if (identity(next) !== identity(previous)) epoch++ })
const server = () => { try { return clientPlatform().server.baseUrl() } catch { return null } }

/** Capture at open, never at render or confirm. Stale actions have no side effects. */
export type SheetTarget = (draft?: StoreDocument) => boolean
export function captureSheetTarget(): SheetTarget {
  const opened = epoch, endpoint = server(), target = identity(useStore.getState())
  return draft => {
    const current = useStore.getState()
    if (opened === epoch && endpoint === server() && target === identity(draft ? { ...current, S: draft } : current)) return true
    useUI.getState().toast('The account, profile or workout changed. Open this sheet again.')
    return false
  }
}
