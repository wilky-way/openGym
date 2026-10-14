// The shell supplies route and sheet-history readers during boot.
export interface NavReaders {
  sheetEntry(): unknown
  currentHash(): unknown
}
type Navigate = (to: string, opts?: Record<string, unknown>) => void
let _nav: Navigate = () => {}
let readers: NavReaders = { sheetEntry: () => false, currentHash: () => '' }
export const setNav = (fn: Navigate): void => { _nav = fn }
export const setNavReaders = (next: NavReaders): void => { readers = next }
export const nav = (to: string, opts?: Record<string, unknown>): void => opts ? _nav(to, opts) : _nav(to)
export const onSheetEntry = (): boolean => {
  try { return !!readers.sheetEntry() } catch { return false }
}
export function closeThenNav(close: () => void, to: string): void {
  const replace = onSheetEntry()
  close()
  nav(to, replace ? { replace: true } : undefined)
}
export function navToWorkout(): void {
  const here = String(readers.currentHash() || '').startsWith('#/workout')
  nav('/workout', here || onSheetEntry() ? { replace: true } : undefined)
}
