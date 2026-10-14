import { _retryDetails } from '../../../core/src/i18n-core'
import { useSyncExternalStore } from 'react'
import { _setDetailsLoader, _setDetails, _detailsFailed, _setLangState, getVersion } from '@opengym/core/i18n-core'
import { ux } from '../platform/ux'
export * from '@opengym/core/i18n-core'
const subs = new Set<() => void>()
const notify = () => subs.forEach(fn => fn())
let retryNeeded = false
let loading = false
async function loadDetails(): Promise<void> {
  if (loading) return
  loading = true
  const load = async <T,>(fn: () => Promise<{default: T}>): Promise<T | null> => { try { return (await fn()).default } catch { return null } }
  const [instr, desc] = await Promise.all([load(() => import('@opengym/core/instr/en')), load(() => import('@opengym/core/exercise-desc/en'))])
  _setDetails(instr, desc, null, 'en')
  loading = false
  retryNeeded = !instr || !desc
  if (retryNeeded) _detailsFailed()
  notify()
}
let unsubscribe: (() => void) | null = null
/** Boot and teardown are explicit so retries follow the currently injected shell. */
export function initializeI18n(): () => void {
  unsubscribe?.()
  _setDetailsLoader(() => { void loadDetails() })
  const win = ux().window
  const online = () => { if (retryNeeded && !loading) _retryDetails() }
  win?.addEventListener('online', online)
  const stop = () => { win?.removeEventListener('online', online); _setDetailsLoader(null); if (unsubscribe === stop) unsubscribe = null }
  unsubscribe = stop
  return stop
}
export async function setLang(_lang: unknown, showEn?: boolean, enOnly?: boolean): Promise<void> {
  if (!unsubscribe) initializeI18n()
  _setLangState('en', {}, null, null, showEn, enOnly)
  const root = ux().document?.documentElement
  if (root) { root.lang = 'en'; root.dir = 'ltr' }
  notify()
}
export function useLang(): number { return useSyncExternalStore(fn => { subs.add(fn); return () => { subs.delete(fn) } }, getVersion) }
