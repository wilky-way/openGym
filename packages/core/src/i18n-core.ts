// English-only readers. The web shell supplies the lazy details loader.
export interface ExerciseText { id?: string; n?: string; st?: string[]; desc?: string }
export const LANGS = { en: 'English' }
export const INSTR_LANGS = ['en']
export const EXERCISE_NAME_LANGS: string[] = []
export const RTL_LANGS = new Set<string>()
export const DATE_LOCALES = { en: 'en-US' }
export const DERIVED_LOCALES = {}
export const CASED_NAME_LANGS: string[] = []
export const baseLang = <T,>(l: T): T => l
export const derivePack = <T,>(_l: unknown, pack: T): T => pack
export const getLang = () => 'en'
export const dateLocale = () => DATE_LOCALES.en
let version = 0
export const getVersion = () => version
export function t(s: string, ...args: unknown[]): string {
  let out = s
  for (let i = 0; i < args.length; i++) out = out.replaceAll('{' + i + '}', String(args[i]))
  return out
}
export function tn(one: string, other: string, n: number, ...rest: unknown[]): string {
  return t(n === 1 ? one : other, n, ...rest)
}
let enInstr: Record<string, string[]> | null = null
let enDescs: Record<string, string> | null = null
let detailsLoader: (() => void) | null = null
let detailsAsked = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
function clearRetry() {
  if (retryTimer != null) clearTimeout(retryTimer)
  retryTimer = null
}
const askDetails = () => {
  if (detailsAsked || !detailsLoader) return
  detailsAsked = true
  detailsLoader()
}
// Online retry is registered by the web shell; this core only schedules the retry pause.
export function _detailsFailed(retryMs = 20000): void {
  clearRetry()
  retryTimer = setTimeout(() => { clearRetry(); detailsAsked = false }, retryMs)
}
export function _retryDetails(): void {
  clearRetry()
  detailsAsked = false
  askDetails()
}
export const instrFor = (ex: ExerciseText): string[] => {
  if (!enInstr) askDetails()
  return (enInstr && enInstr[ex.id!]) || ex.st || []
}
export const instrTranslated = (_ex: ExerciseText | null | undefined): boolean => false
export const descFor = (ex: ExerciseText | null | undefined): string => {
  if (!ex) return ''
  if (!enDescs) askDetails()
  return (enDescs && enDescs[ex.id!]) || ex.desc || ''
}
export function _setDetailsLoader(fn: (() => void) | null): void {
  detailsLoader = fn
  detailsAsked = false
  clearRetry()
}
export function _setDetails(newEnInstr: Record<string, string[]> | null, newEnDescs: Record<string, string> | null,
  _newDescs: unknown, forLang = 'en'): boolean {
  enInstr = newEnInstr || enInstr
  enDescs = newEnDescs || enDescs
  if (enInstr && enDescs) clearRetry()
  version++
  return forLang === 'en'
}
export const exerciseNameFor = (ex: ExerciseText | null | undefined): string => ex?.n || ''
export const exerciseNameClass = (_ex: ExerciseText | null | undefined): 'capitalize' => 'capitalize'
export const exerciseNameSearchText = exerciseNameFor
export function _setLangState(_newLang: unknown, _newDict: unknown, _newInstr: unknown,
  _newExerciseNames: unknown, _showEn = true, _enOnlyFlag = false): number {
  return ++version
}
