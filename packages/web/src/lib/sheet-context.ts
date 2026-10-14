import { guardedStoreUpdate } from './guarded-update'
import { useRef } from 'react'
import { clientPlatform } from './client-io'
import { useStore } from '../store/useStore'
import type { StoreDocument } from '../store/useStore'
import { useUI } from '../store/useUI'
export interface SheetContextOptions {
  /** Opt in to the extended sheet rule without changing existing callers. */
  updater?: boolean
  target?(draft: StoreDocument): boolean
}
/** Identity belongs to the sheet at open, including its account and server. */
export function captureSheetContext(options: SheetContextOptions = {}) {
  const initial = useStore.getState()
  const context = {user:initial.user, profile:initial.S?.activeEquipId ?? null, server:clientPlatform().server.baseUrl(), instance:initial.documentInstance, owner:clientPlatform().kv.get('gym_owner')}
  return (allowSignedOut = false) => {
    const state = useStore.getState(), current = state.user
    const signedOut = allowSignedOut && !!context.user && current === null && clientPlatform().kv.get('gym_owner') === null
    const same = (context.user === current || signedOut) && context.server === clientPlatform().server.baseUrl()
    const targetMatches = (draft = useStore.getState().S) => (!options.updater || signedOut || (context.owner === clientPlatform().kv.get('gym_owner') && context.profile === (draft?.activeEquipId ?? null) && context.instance === useStore.getState().documentInstance)) && (signedOut || !options.target || options.target(draft))
    const stale = () => { useUI.getState().toast(options.updater ? 'The account, profile or target changed. Open this action again.' : 'The account changed. Open this action again.'); return false }
    if (!same || !targetMatches()) return stale()
    if (!options.updater || signedOut) return true
    return guardedStoreUpdate(draft => useStore.getState().user === context.user && clientPlatform().server.baseUrl() === context.server
      && (draft.activeEquipId ?? null) === context.profile && targetMatches(draft), undefined, {update: state.update, onStale: stale})
  }
}
export function useSheetContext(options: SheetContextOptions = {}) {
  const context = useRef<ReturnType<typeof captureSheetContext> | null>(null)
  if (!context.current) context.current = captureSheetContext(options)
  return context.current
}
