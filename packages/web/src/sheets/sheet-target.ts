import { guardedStoreUpdate } from '../lib/guarded-update'
import type { ReactNode } from 'react'
import { t } from '@opengym/core/i18n-core'
import { useStore, type StoreDocument } from '../store/useStore'
import { useUI } from '../store/useUI'
export type ValidateTarget = (state?: StoreDocument) => boolean
const S = () => useStore.getState().S
const ui = () => useUI.getState()
const toast = (message: string) => ui().toast(message)
// Sheet target re-validation (design safety exception): callbacks belong to the account,
// session instance and editor that opened them, even if a newer sheet is now visible.
const sessionIdentity = (state: StoreDocument = S()) => {
  const active = state.active
  return JSON.stringify(active ? [active.id, active.start, active.editingWorkoutId, active.backfill?.replaceId] : null)
}
export function captureContext(): ValidateTarget {
  const user = useStore.getState().user?.id ?? null
  const instance = useStore.getState().documentInstance
  const session = sessionIdentity(), profile = S().activeEquipId ?? null, unit = S().unit
  return (state = S()) => {
    if (useStore.getState().documentInstance === instance && (useStore.getState().user?.id ?? null) === user && sessionIdentity(state) === session && (state.activeEquipId ?? null) === profile && state.unit === unit) return true
    toast(t('The target changed. Open this sheet again.')); return false
  }
}
export function targetUnchanged(before: string, current: unknown): boolean {
  if (JSON.stringify(current) === before) return true
  toast(t('The target changed. Open this sheet again.')); return false
}
export function openEditor(render: (close: () => void, validate: ValidateTarget) => ReactNode, options?: { kind?: string }) {
  const context = captureContext()
  const sheet = ui().openSheet(close => render(close, state => {
    if (!context(state)) return false
    if (ui().sheets.some(s => s.id === sheet.id)) return true
    toast(t('The target changed. Open this sheet again.')); return false
  }), options)
  return sheet
}

/** A rejected producer never reaches sync store persistence. */
export function createSheetUpdater(validate: ValidateTarget, defaultPush = false) {
  return (mutate: (state: StoreDocument) => void, push = defaultPush): boolean =>
    guardedStoreUpdate(state => validate(state), mutate, {push})
}
