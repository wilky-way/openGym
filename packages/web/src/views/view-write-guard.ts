import { guardedStoreUpdate } from '../lib/guarded-update'
import { useStore, type StoreDocument, type StoreState } from '../store/useStore'
import { useUI } from '../store/useUI'
import { t } from '../lib/i18n'

const contextKey = (state: StoreState, draft = state.S) => JSON.stringify([
  state.user?.id ?? null, state.documentInstance ?? null, state.user?.profileId ?? draft.profileId ?? null, draft.unit,
])
let epoch = 0
// Catch A → B → A as well as a profile or unit change while an editor stays open.
useStore.subscribe((next, prev) => {
  if (contextKey(next) !== contextKey(prev)) epoch++
})
export function captureViewTarget() {
  return { epoch, key: contextKey(useStore.getState()) }
}
export function updateViewTarget(
  target: ReturnType<typeof captureViewTarget>,
  current: (draft: StoreDocument) => boolean,
  mutate: (draft: StoreDocument) => void,
): boolean {
  return guardedStoreUpdate(draft => target.epoch === epoch && target.key === contextKey(useStore.getState(), draft) && current(draft), mutate,
    {onStale: () => useUI.getState().toast(t('This sheet is out of date. Open it again.'))})
}
