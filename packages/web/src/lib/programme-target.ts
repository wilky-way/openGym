import { guardedStoreUpdate } from './guarded-update'
import type { Platform } from '@opengym/contract/platform/adapters'
import { useStore, type StoreState, type StoreDocument } from '../store/useStore'
import { useUI } from '../store/useUI'

// References change on normal draft edits. These fields identify the editor and
// session without invalidating a settings edit or ordinary workout logging.
const identity = (store: StoreState, draft = store.S, session = true) => JSON.stringify([
  store.user?.id ?? null, store.documentInstance ?? 0,
  draft.profileId, draft.unit, draft.activeEquipId, draft.resetAt,
  session && draft.active ? [draft.active.id, draft.active.start, draft.active.d,
    draft.active.routineId, draft.active.editingWorkoutId, draft.active.programme?.instanceId] : null,
])
let epoch = 0, sessionEpoch = 0
useStore.subscribe((next, previous) => {
  if (identity(next, next.S, false) !== identity(previous, previous.S, false)) epoch++
  if (identity(next) !== identity(previous)) sessionEpoch++
})
export type ProgrammeTarget = (draft?: StoreDocument) => boolean
export function programmeIdentity(platform: Platform, get = useStore.getState): string {
  return JSON.stringify([platform.server.baseUrl(), epoch, identity(get(), get().S, false)])
}
export function captureProgrammeTarget(platform: Platform, get = useStore.getState, owner = programmeIdentity(platform, get), target?: ProgrammeTarget): ProgrammeTarget {
  const currentIdentity = identity(get()), openedSession = sessionEpoch
  return draft => {
    if (owner !== programmeIdentity(platform, get)) {
      useUI.getState().toast('Account changed or the profile or workout changed. Open the program again.')
      return false
    }
    if (openedSession !== sessionEpoch || currentIdentity !== identity(get(), draft)) {
      useUI.getState().toast(get().S.active ? 'Finish the current workout before changing the program.' : 'The workout changed. Open the program again.')
      return false
    }
    if (target && !target(draft)) {
      useUI.getState().toast('The program changed. Open it again.')
      return false
    }
    return true
  }
}
export function updateProgramme(mutate: (draft: StoreDocument) => unknown, valid: ProgrammeTarget, get = useStore.getState): boolean {
  return guardedStoreUpdate(draft => valid(draft), mutate, {update: get().update})
}
