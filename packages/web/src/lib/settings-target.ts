import { guardedStoreUpdate } from './guarded-update'
import { clientPlatform } from './client-io'
import { useStore, type StoreDocument } from '../store/useStore'
import { useUI } from '../store/useUI'
export interface SettingsTarget {
  account: string | null
  owner: string | null
  user: unknown
  profile: unknown
  server: string
  instance: unknown
  document: string
}
export function settingsTarget(): SettingsTarget {
  const st = useStore.getState()
  return { account: st.user?.id ?? null, owner:clientPlatform().kv.get('gym_owner'), user: st.user, profile: st.S.activeEquipId ?? null, server: clientPlatform().kv.get('gym_server_url') ?? '', instance: st.documentInstance, document:JSON.stringify(st.S) }
}
export function sameSettingsTarget(target: SettingsTarget, draft: StoreDocument): boolean {
  const st = useStore.getState()
  return target.account === (st.user?.id ?? null) && target.owner === clientPlatform().kv.get('gym_owner') && target.user === st.user && target.profile === (draft.activeEquipId ?? null)
    && target.server === (clientPlatform().kv.get('gym_server_url') ?? '') && target.instance === st.documentInstance
    && target.document === JSON.stringify(draft)
}
/** Throw before sync store stamps/persists; an authorization-only probe also never writes. */
export function settingsUpdate(target: SettingsTarget, mutate?: (draft: StoreDocument) => void, extra: () => boolean = () => true): boolean {
  return guardedStoreUpdate(draft => sameSettingsTarget(target, draft) && extra(), mutate,
    {onStale: () => useUI.getState().toast('The account, profile or target changed. Open this action again.')})
}
/** A synchronous action owns its own save. */
export function settingsAction(target: SettingsTarget, action: () => void, extra: () => boolean = () => true): boolean {
  return guardedStoreUpdate(draft => sameSettingsTarget(target, draft) && extra(), action,
    {action: true, onStale: () => useUI.getState().toast('The account, profile or target changed. Open this action again.')})
}
